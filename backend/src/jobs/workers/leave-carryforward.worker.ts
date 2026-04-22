import { Worker, Job } from 'bullmq';
import { bullmqConnection } from '../queues.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

/**
 * New-year leave balance provisioning.
 * Creates fresh LeaveBalance records for ALL active leave types for all active employees
 * who don't yet have a balance for the target year. This covers leave types where
 * carryForward=false — they simply get allocated=defaultBalance each year.
 * Idempotent: existing balances are never overwritten.
 */
async function provisionNewYearBalances(targetYear: number) {
  logger.info(`[Leave CF] Provisioning new-year balances for ${targetYear}...`);
  let created = 0;

  const orgs = await prisma.organization.findMany({ select: { id: true } });

  for (const org of orgs) {
    const leaveTypes = await prisma.leaveType.findMany({
      where: { organizationId: org.id, isActive: true },
      select: { id: true, defaultBalance: true },
    });
    if (leaveTypes.length === 0) continue;

    const employees = await prisma.employee.findMany({
      where: { organizationId: org.id, deletedAt: null, status: { in: ['ACTIVE', 'PROBATION', 'INTERN', 'ONBOARDING'] } },
      select: { id: true },
    });
    if (employees.length === 0) continue;

    for (const lt of leaveTypes) {
      const existingBalances = await prisma.leaveBalance.findMany({
        where: { leaveTypeId: lt.id, year: targetYear },
        select: { employeeId: true },
      });
      const existingSet = new Set(existingBalances.map(b => b.employeeId));

      const toCreate = employees
        .filter(e => !existingSet.has(e.id))
        .map(e => ({
          employeeId: e.id,
          leaveTypeId: lt.id,
          year: targetYear,
          allocated: Number(lt.defaultBalance ?? 0),
          used: 0,
          pending: 0,
          carriedForward: 0,
        }));

      if (toCreate.length > 0) {
        await prisma.leaveBalance.createMany({ data: toCreate, skipDuplicates: true });
        created += toCreate.length;
      }
    }
  }

  logger.info(`[Leave CF] Provisioned ${created} new leave balance records for ${targetYear}.`);
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
          const pending   = Number((prev as any).pending ?? 0);
          const unused    = Math.max(0, allocated - used - pending);

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
            // Create new balance for this year — seed with default balance + carry-forward
            const defaultAlloc = Number(lt.defaultBalance ?? 0);
            await prisma.leaveBalance.create({
              data: {
                employeeId:     prev.employeeId,
                leaveTypeId:    lt.id,
                year:           currentYear,
                allocated:      defaultAlloc + carryDays,
                used:           0,
                pending:        0,
                carriedForward: carryDays,
              },
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
        case 'year-end-carry-forward': {
          const year = job.data?.targetYear ?? new Date().getFullYear();
          const provision = await provisionNewYearBalances(year);
          const carryForward = await processYearEndCarryForward(job.data?.targetYear);
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
