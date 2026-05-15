import { Worker, Job } from 'bullmq';
import { bullmqConnection } from '../queues.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { redis } from '../../lib/redis.js';
import { leavePolicyService } from '../../modules/leave/leave-policy.service.js';

/**
 * New-year leave balance provisioning.
 *
 * BUG-002 FIX: Uses the policy engine (leavePolicyService.allocateForEmployee) to
 * determine the correct yearly allocation for each employee, instead of using the
 * raw `defaultBalance` field on the LeaveType.  This respects HR-configured policy
 * rules (yearly days, prorata, monthly accrual, category filters, etc.).
 *
 * Falls back to `lt.defaultBalance ?? 0` only when no policy rule exists for the
 * employee+leave-type combination, so existing orgs without a configured policy
 * continue to work without crashing.
 *
 * Idempotent: existing balances are never overwritten.
 */
async function provisionNewYearBalances(targetYear: number) {
  logger.info(`[Leave CF] Provisioning new-year balances for ${targetYear} (policy-engine)...`);
  let created = 0;
  let policyUsed = 0;
  let fallback = 0;

  const orgs = await prisma.organization.findMany({ select: { id: true } });

  for (const org of orgs) {
    const leaveTypes = await prisma.leaveType.findMany({
      where: { organizationId: org.id, isActive: true },
      select: { id: true, defaultBalance: true },
    });
    if (leaveTypes.length === 0) continue;

    const employees = await prisma.employee.findMany({
      where: { organizationId: org.id, deletedAt: null, status: { in: ['ACTIVE', 'PROBATION', 'INTERN'] } },
      select: { id: true, status: true, joiningDate: true, user: { select: { role: true } } },
    });
    if (employees.length === 0) continue;

    // Load the default policy once per org to use for allocation resolution
    let defaultPolicy: Awaited<ReturnType<typeof leavePolicyService.getOrCreateDefaultPolicy>> | null = null;
    try {
      defaultPolicy = await leavePolicyService.getOrCreateDefaultPolicy(org.id);
    } catch (err) {
      logger.warn(`[Leave CF] Could not load policy for org ${org.id}, falling back to defaultBalance:`, err);
    }

    for (const lt of leaveTypes) {
      const existingBalances = await prisma.leaveBalance.findMany({
        where: { leaveTypeId: lt.id, year: targetYear },
        select: { employeeId: true },
      });
      const existingSet = new Set(existingBalances.map(b => b.employeeId));

      const toCreate: {
        employeeId: string;
        leaveTypeId: string;
        year: number;
        allocated: number;
        policyAllocated: number;
        used: number;
        pending: number;
        carriedForward: number;
        organizationId: string;
      }[] = [];

      for (const emp of employees) {
        if (existingSet.has(emp.id)) continue;

        let allocated = Number(lt.defaultBalance ?? 0); // graceful fallback

        if (defaultPolicy) {
          const empSnapshot = {
            id: emp.id,
            status: emp.status,
            joiningDate: emp.joiningDate,
            organizationId: org.id,
            user: emp.user ?? null,
          };
          const resolution = leavePolicyService._resolveFromPolicy(empSnapshot, lt.id, targetYear, defaultPolicy);
          if (resolution !== null) {
            allocated = resolution.days;
            policyUsed++;
          } else {
            // No policy rule for this employee+leave-type combo — use defaultBalance as fallback
            fallback++;
          }
        } else {
          fallback++;
        }

        toCreate.push({
          employeeId: emp.id,
          leaveTypeId: lt.id,
          year: targetYear,
          allocated,
          policyAllocated: allocated,
          used: 0,
          pending: 0,
          carriedForward: 0,
          organizationId: org.id,
        });
      }

      if (toCreate.length > 0) {
        await prisma.leaveBalance.createMany({ data: toCreate as any, skipDuplicates: true });
        created += toCreate.length;
      }
    }
  }

  logger.info(`[Leave CF] Provisioned ${created} new leave balance records for ${targetYear} (policy-engine: ${policyUsed}, fallback: ${fallback}).`);
  return { created };
}

/**
 * Year-end carry forward processor.
 *
 * Runs on April 1 (Indian financial year start) via the leaveCarryForwardQueue cron.
 * For every leave type where carryForward = true, it reads each employee's allocated
 * vs. used balance for the previous year, calculates unused days (capped by
 * maxCarryForward if set), then adds that amount to the current year's LeaveBalance
 * as carriedForward + increases their allocated days accordingly.
 *
 * Idempotent: running it twice for the same year is safe — the upsert only adds the
 * difference between what was already carried forward and what should be.
 */
async function processYearEndCarryForward(targetYear?: number) {
  // Default: current year (the NEW year we are adding carry-forward into)
  const currentYear = targetYear ?? new Date().getFullYear();
  const previousYear = currentYear - 1;

  logger.info(`[Leave CF] Starting carry-forward: FY ${previousYear} → ${currentYear}`);

  let totalUpdated = 0;
  let totalSkipped = 0;

  const orgs = await prisma.organization.findMany({ select: { id: true } });

  for (const org of orgs) {
    // Only process leave types that allow carry-forward for this org
    const cfTypes = await prisma.leaveType.findMany({
      where: { organizationId: org.id, isActive: true, carryForward: true },
      select: { id: true, name: true, defaultBalance: true, maxCarryForward: true },
    });

    if (cfTypes.length === 0) continue;

    for (const lt of cfTypes) {
      // Get all employee balances for this leave type in the PREVIOUS year
      const prevBalances = await prisma.leaveBalance.findMany({
        where: { leaveTypeId: lt.id, year: previousYear },
        select: { id: true, employeeId: true, allocated: true, used: true, pending: true, carriedForward: true },
      });

      for (const prev of prevBalances) {
        try {
          const allocated = Number(prev.allocated);
          const used      = Number(prev.used);
          // Do NOT subtract pending: if a pending leave is approved after April 1 the
          // employee should not lose carry-forward days they legitimately earned.
          const unused    = Math.max(0, allocated - used);

          if (unused <= 0) {
            totalSkipped++;
            continue; // nothing to carry forward
          }

          // Apply the maxCarryForward cap (null = unlimited)
          const maxCF      = lt.maxCarryForward != null ? Number(lt.maxCarryForward) : null;
          const carryDays  = maxCF !== null ? Math.min(unused, maxCF) : unused;

          if (carryDays <= 0) {
            totalSkipped++;
            continue;
          }

          // Upsert the CURRENT year balance
          const existing = await prisma.leaveBalance.findUnique({
            where: { employeeId_leaveTypeId_year: { employeeId: prev.employeeId, leaveTypeId: lt.id, year: currentYear } },
          });

          if (existing) {
            // Only add the delta — prevent double-counting on re-run
            const alreadyCarried = Number(existing.carriedForward);
            const delta = Math.max(0, carryDays - alreadyCarried);
            if (delta > 0) {
              await prisma.leaveBalance.update({
                where: { id: existing.id },
                data: {
                  carriedForward: { increment: delta },
                  allocated:      { increment: delta },
                },
              });
            }
          } else {
            // Create new balance for this year — seed with policy-allocated days + carry-forward.
            // BUG-002 FIX: resolve allocation from policy engine; fall back to defaultBalance if
            // the policy has no rule configured for this employee+leave-type combination.
            const empForCf = await prisma.employee.findUnique({
              where: { id: prev.employeeId },
              select: { id: true, status: true, joiningDate: true, organizationId: true, user: { select: { role: true } } },
            });
            let policyAlloc = Number(lt.defaultBalance ?? 0); // fallback
            if (empForCf) {
              try {
                const cfPolicy = await leavePolicyService.getOrCreateDefaultPolicy(empForCf.organizationId);
                const resolution = leavePolicyService._resolveFromPolicy(empForCf, lt.id, currentYear, cfPolicy);
                if (resolution !== null) {
                  policyAlloc = resolution.days;
                }
              } catch {
                // Non-fatal: fall back to defaultBalance
              }
            }
            const newAllocated = policyAlloc + carryDays;
            await prisma.leaveBalance.create({
              data: {
                employeeId:     prev.employeeId,
                leaveTypeId:    lt.id,
                year:           currentYear,
                allocated:      newAllocated,
                policyAllocated: policyAlloc,
                used:           0,
                pending:        0,
                carriedForward: carryDays,
                organizationId: empForCf?.organizationId,
              } as any,
            });
          }

          totalUpdated++;
          logger.debug(`[Leave CF] Employee ${prev.employeeId} | ${lt.name}: +${carryDays} days carried into ${currentYear}`);
        } catch (err) {
          logger.error(`[Leave CF] Failed for employee ${prev.employeeId}, leaveType ${lt.id}:`, err);
        }
      }
    }
  }

  logger.info(`[Leave CF] Done — updated: ${totalUpdated}, skipped (fully used or zero): ${totalSkipped}`);
  return { updated: totalUpdated, skipped: totalSkipped };
}

export function startLeaveCarryForwardWorker() {
  const worker = new Worker(
    'leave-carry-forward',
    async (job: Job) => {
      switch (job.name) {
        case 'year-end-carry-forward':
        case 'carry-forward-catchup': {
          const year = job.data?.targetYear ?? new Date().getFullYear();
          const provision = await provisionNewYearBalances(year);
          const carryForward = await processYearEndCarryForward(job.data?.targetYear);
          // Mark that carry-forward ran for this year so the startup catch-up won't re-queue it
          const yearKey = `leave:carryforward:ran:${year}`;
          await redis.setex(yearKey, 60 * 60 * 24 * 365, '1');
          logger.info(`[Leave CF] Redis flag set: ${yearKey}`);
          return { ...provision, ...carryForward };
        }
        case 'provision-balances':
          return provisionNewYearBalances(job.data?.targetYear ?? new Date().getFullYear());
        default:
          logger.warn(`[Leave CF] Unknown job name: ${job.name}`);
      }
    },
    { connection: bullmqConnection, concurrency: 1 }
  );

  worker.on('completed', (job) => {
    logger.info(`[Leave CF] Job "${job.name}" completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`[Leave CF] Job "${job?.name}" failed:`, err);
  });

  logger.info('✅ Leave carry-forward worker started');
  return worker;
}
