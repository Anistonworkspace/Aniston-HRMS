/**
 * kyc-recovery.service.ts
 *
 * Startup recovery for KYC gates stuck in PROCESSING.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Combined PDF classification is done inside a fire-and-forget background IIFE
 * in onboarding.routes.ts.  The gate is set to PROCESSING before the IIFE runs
 * so the employee's UI shows a spinner.  If the Node.js process restarts
 * (PM2 reload, crash, OOM kill, deployment) while the IIFE is in-flight, the gate
 * stays at PROCESSING permanently because the IIFE never completes.
 *
 * The employee's submit button stays disabled.  HR cannot act.  The only escape
 * is an HR "reclassify" action — but HR has to know to look for it.
 *
 * This service runs once on each server startup, finds stale PROCESSING gates,
 * and recovers them deterministically:
 *
 *   - Gate has a valid combinedPdfAnalysis → keep the analysis, move to PENDING.
 *     (Classification finished but the status write was lost on crash.)
 *
 *   - Gate has no analysis or an error analysis → move to PENDING with an HR note
 *     asking the employee to re-upload or HR to reclassify.
 *
 * Recovery is idempotent — running it multiple times has no side effects.
 * A gate that was already recovered (PENDING) is invisible to subsequent runs.
 */

import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

/** How many minutes a PROCESSING gate must sit untouched before we treat it as stale. */
const STALE_THRESHOLD_MINUTES = 15;

export async function recoverStaleProcessingKyc(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000);

  let staleGates: any[];
  try {
    staleGates = await prisma.onboardingDocumentGate.findMany({
      where: {
        kycStatus: 'PROCESSING',
        updatedAt: { lt: cutoff },
      },
      include: {
        employee: {
          select: { organizationId: true, firstName: true, lastName: true, employeeCode: true },
        },
      },
    });
  } catch (err: any) {
    logger.warn(`[KYC Recovery] Could not query stale gates: ${err?.message}`);
    return;
  }

  if (staleGates.length === 0) {
    logger.info('[KYC Recovery] No stale PROCESSING gates found — nothing to recover.');
    return;
  }

  logger.warn(`[KYC Recovery] Found ${staleGates.length} stale PROCESSING gate(s) — recovering...`);

  let recovered = 0;
  let failed = 0;

  for (const gate of staleGates) {
    try {
      const analysis = gate.combinedPdfAnalysis as any;

      // Determine if a valid (non-error) analysis was already stored.
      // A classification that completed before the crash would have written
      // combinedPdfAnalysis with a real _source value.
      const hasValidAnalysis =
        analysis !== null &&
        analysis !== undefined &&
        typeof analysis === 'object' &&
        !analysis.error &&
        analysis._source &&
        analysis._source !== 'error' &&
        analysis._source !== 'manual_review';

      let hrNote: string;
      if (hasValidAnalysis) {
        hrNote =
          '[System] KYC classification completed but the status update was lost on server restart. ' +
          'Classification data is available — employee can submit for review.';
        logger.info(
          `[KYC Recovery] Gate ${gate.id} (${gate.employeeId}) — has valid analysis (source: ${analysis._source}), restoring PENDING.`
        );
      } else {
        hrNote =
          '[System] KYC was interrupted during document classification (server restart / crash). ' +
          'No valid analysis is stored. Employee should re-upload their combined PDF, or HR can use ' +
          '"Re-run Classification" to retry without re-upload.';
        logger.warn(
          `[KYC Recovery] Gate ${gate.id} (${gate.employeeId}) — no valid analysis found, restoring PENDING with re-upload note.`
        );
      }

      // Compose the final HR notes — preserve any pre-existing notes
      const existingNotes: string = gate.hrReviewNotes || '';
      const newNotes = existingNotes
        ? `${existingNotes}\n${hrNote}`
        : hrNote;

      await prisma.onboardingDocumentGate.update({
        where: { id: gate.id },
        data: {
          kycStatus: 'PENDING',
          hrReviewNotes: newNotes,
        },
      });

      // Emit real-time socket update so the employee's page stops spinning
      try {
        const { emitToOrg } = await import('../sockets/index.js');
        if (gate.employee?.organizationId) {
          emitToOrg(gate.employee.organizationId, 'kyc:status-changed', {
            employeeId: gate.employeeId,
            employeeName: gate.employee
              ? `${gate.employee.firstName} ${gate.employee.lastName}`
              : 'Unknown',
            employeeCode: gate.employee?.employeeCode,
            status: 'PENDING',
          });
        }
      } catch {
        // Socket failure must never prevent the DB update from being counted
      }

      recovered++;
    } catch (err: any) {
      logger.error(`[KYC Recovery] Failed to recover gate ${gate.id}: ${err?.message}`);
      failed++;
    }
  }

  logger.info(
    `[KYC Recovery] Done. Recovered: ${recovered}, Failed: ${failed} of ${staleGates.length} stale gate(s).`
  );
}
