import { prisma } from '../lib/prisma.js';

interface PeriodRange {
  start: Date;
  end: Date;
}

/**
 * Leave Discipline Score (0-100)
 * Measures: notice compliance, correct leave type usage, timely communication
 * Does NOT penalize: sick leave count, total leave days taken
 */
export async function calculateLeaveDisciplineScore(employeeId: string, period: PeriodRange): Promise<number> {
  let score = 100;

  const leaves = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      status: { in: ['APPROVED', 'APPROVED_WITH_CONDITION', 'REJECTED'] },
      createdAt: { gte: period.start, lte: period.end },
    },
    include: { leaveType: { select: { code: true, noticeDays: true } } },
  });

  for (const leave of leaves) {
    const isSick = leave.leaveType?.code?.toUpperCase() === 'SL';

    // Short notice penalty (skip for sick leave)
    if (!isSick && leave.noticeHours !== null && leave.noticeHours < 24) {
      score -= 5;
    }

    // Cancelled-after-approval penalty
    if (leave.status === 'CANCELLED') {
      score -= 3;
    }
  }

  // Excessive frequency penalty (more than 8 leave requests in period, excluding sick)
  const nonSickCount = leaves.filter(l => l.leaveType?.code?.toUpperCase() !== 'SL').length;
  if (nonSickCount > 8) {
    score -= (nonSickCount - 8) * 2;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Work Continuity Score (0-100)
 * Measures: handover completion, backup assignment, dependency disruption
 * Does NOT penalize: leave frequency, leave type
 */
export async function calculateWorkContinuityScore(employeeId: string, period: PeriodRange): Promise<number> {
  let score = 100;

  const leaves = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      status: { in: ['APPROVED', 'APPROVED_WITH_CONDITION'] },
      createdAt: { gte: period.start, lte: period.end },
    },
    select: {
      id: true,
      riskLevel: true,
      backupEmployeeId: true,
      handoverNotes: true,
      leaveType: { select: { code: true } },
    },
  });

  for (const leave of leaves) {
    const isSick = leave.leaveType?.code?.toUpperCase() === 'SL';
    const isHighRisk = leave.riskLevel === 'HIGH' || leave.riskLevel === 'CRITICAL';

    // No backup on high-risk leave (skip for sick leave - more lenient)
    if (isHighRisk && !leave.backupEmployeeId && !isSick) {
      score -= 15;
    }

    // No handover notes on high-risk leave
    if (isHighRisk && !leave.handoverNotes && !isSick) {
      score -= 10;
    }

    // Check for handover records
    const handoverCount = await prisma.leaveHandover.count({
      where: { leaveRequestId: leave.id },
    });

    if (isHighRisk && handoverCount === 0 && !isSick) {
      score -= 5;
    }
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Task Responsibility Score (0-100)
 * Measures: overdue tasks before leave, unmanaged deadlines, unresolved blockers
 * Does NOT penalize: leave type
 */
export async function calculateTaskResponsibilityScore(employeeId: string, period: PeriodRange): Promise<number> {
  let score = 100;

  const audits = await prisma.leaveTaskAudit.findMany({
    where: {
      leaveRequest: {
        employeeId,
        status: { in: ['APPROVED', 'APPROVED_WITH_CONDITION'] },
        createdAt: { gte: period.start, lte: period.end },
      },
    },
    select: {
      overdueTasks: true,
      criticalTasks: true,
      blockedTasks: true,
      dueWithinLeave: true,
      noBackupTasks: true,
    },
  });

  for (const audit of audits) {
    // Overdue tasks at leave start
    score -= audit.overdueTasks * 5;

    // Critical tasks unmanaged during leave
    score -= audit.criticalTasks * 5;

    // Blocked tasks left unresolved
    score -= audit.blockedTasks * 3;

    // Tasks due during leave without backup
    if (audit.noBackupTasks > 0 && audit.dueWithinLeave > 0) {
      score -= audit.noBackupTasks * 3;
    }
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Full Leave Performance Summary
 */
export async function getLeavePerformanceSummary(employeeId: string, period: PeriodRange) {
  const [disciplineScore, continuityScore, responsibilityScore] = await Promise.all([
    calculateLeaveDisciplineScore(employeeId, period),
    calculateWorkContinuityScore(employeeId, period),
    calculateTaskResponsibilityScore(employeeId, period),
  ]);

  const overallScore = Math.round((disciplineScore + continuityScore + responsibilityScore) / 3);

  // Leave stats for context
  const leaveStats = await prisma.leaveRequest.groupBy({
    by: ['status'],
    where: {
      employeeId,
      createdAt: { gte: period.start, lte: period.end },
    },
    _count: true,
  });

  const totalLeaves = leaveStats.reduce((sum, s) => sum + s._count, 0);
  const approvedLeaves = leaveStats
    .filter(s => ['APPROVED', 'APPROVED_WITH_CONDITION'].includes(s.status))
    .reduce((sum, s) => sum + s._count, 0);

  return {
    scores: {
      discipline: disciplineScore,
      continuity: continuityScore,
      responsibility: responsibilityScore,
      overall: overallScore,
    },
    stats: {
      totalRequests: totalLeaves,
      approved: approvedLeaves,
    },
    period: {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
    },
  };
}
