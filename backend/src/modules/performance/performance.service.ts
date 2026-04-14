import { prisma } from '../../lib/prisma.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { aiService } from '../../services/ai.service.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { taskIntegrationService } from '../task-integration/task-integration.service.js';
import { calculateLeaveDisciplineScore, calculateWorkContinuityScore } from '../../utils/leavePerformance.js';
import type {
  CreateReviewCycleInput,
  UpdateReviewCycleInput,
  CreateGoalInput,
  UpdateGoalInput,
  CreateReviewInput,
  UpdateReviewInput,
} from './performance.validation.js';

export class PerformanceService {
  // ==================
  // REVIEW CYCLES
  // ==================

  async listCycles(organizationId: string) {
    const cycles = await prisma.reviewCycle.findMany({
      where: { organizationId },
      orderBy: { startDate: 'desc' },
      include: { _count: { select: { reviews: true, goals: true } } },
    });
    return cycles;
  }

  async createCycle(data: CreateReviewCycleInput, organizationId: string) {
    const cycle = await prisma.reviewCycle.create({
      data: {
        ...data,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        organizationId,
      },
    });
    return cycle;
  }

  async updateCycle(id: string, data: UpdateReviewCycleInput, organizationId: string) {
    const existing = await prisma.reviewCycle.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundError('Review cycle');
    const cycle = await prisma.reviewCycle.update({
      where: { id },
      data: { status: data.status },
    });
    return cycle;
  }

  // ==================
  // GOALS
  // ==================

  async listGoals(employeeId: string, organizationId: string) {
    const goals = await prisma.goal.findMany({
      where: { employeeId, organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return goals;
  }

  async createGoal(data: CreateGoalInput, organizationId: string) {
    const goal = await prisma.goal.create({
      data: {
        ...data,
        targetValue: data.targetValue || null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        organizationId,
      },
    });
    return goal;
  }

  async updateGoal(id: string, data: UpdateGoalInput, organizationId: string) {
    const existing = await prisma.goal.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundError('Goal');

    const updateData: any = {};
    if (data.status) updateData.status = data.status;
    if (data.currentValue !== undefined) updateData.currentValue = data.currentValue;
    if (data.status === 'COMPLETED') updateData.completedAt = new Date();

    const goal = await prisma.goal.update({ where: { id }, data: updateData });
    return goal;
  }

  // ==================
  // REVIEWS
  // ==================

  async listReviews(employeeId: string, organizationId: string) {
    // Verify employee belongs to org
    const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId } });
    if (!employee) throw new NotFoundError('Employee');
    const reviews = await prisma.performanceReview.findMany({
      where: { employeeId, reviewCycle: { organizationId } },
      orderBy: { createdAt: 'desc' },
      include: { reviewCycle: { select: { name: true, type: true } } },
    });
    return reviews;
  }

  async createReview(data: CreateReviewInput, reviewerId: string, organizationId: string) {
    const review = await prisma.performanceReview.create({
      data: {
        ...data,
        selfRating: data.selfRating || null,
        managerRating: data.managerRating || null,
        reviewerId,
        status: 'PENDING',
      },
    });

    await createAuditLog({
      userId: reviewerId,
      organizationId,
      entity: 'PerformanceReview',
      entityId: review.id,
      action: 'CREATE',
      newValue: { employeeId: data.employeeId, status: 'PENDING' },
    });

    return review;
  }

  async updateReview(id: string, data: UpdateReviewInput, userId: string, organizationId: string) {
    const existing = await prisma.performanceReview.findFirst({ where: { id, reviewCycle: { organizationId } } });
    if (!existing) throw new NotFoundError('Performance review');

    const updateData: any = {};
    if (data.managerRating) updateData.managerRating = data.managerRating;
    if (data.managerComments) updateData.managerComments = data.managerComments;
    if (data.overallRating) updateData.overallRating = data.overallRating;
    if (data.status) updateData.status = data.status;
    if (data.strengths) updateData.strengths = data.strengths;
    if (data.improvements) updateData.improvements = data.improvements;
    if (data.status === 'REVIEWED') updateData.reviewedAt = new Date();

    const review = await prisma.performanceReview.update({ where: { id }, data: updateData });

    await createAuditLog({
      userId,
      organizationId,
      entity: 'PerformanceReview',
      entityId: id,
      action: 'UPDATE',
      newValue: updateData,
    });

    return review;
  }

  // ==================
  // AI FEATURES
  // ==================

  async suggestGoals(employeeId: string, organizationId: string) {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        designation: { select: { name: true } },
        department: { select: { name: true } },
      },
    });
    if (!employee) throw new NotFoundError('Employee');

    const existingGoals = await prisma.goal.findMany({
      where: { employeeId, organizationId },
      select: { title: true, status: true },
    });

    const systemPrompt = 'You are a performance management expert. Suggest 5 SMART goals for this employee based on their role and department. Return JSON: { goals: [{ title: string, description: string, targetValue: string, metric: string, timeframe: string }] }';
    const userPrompt = `Employee: ${employee.firstName} ${employee.lastName}\nDesignation: ${employee.designation?.name || 'N/A'}\nDepartment: ${employee.department?.name || 'N/A'}\nExisting Goals: ${existingGoals.length > 0 ? existingGoals.map(g => `${g.title} (${g.status})`).join(', ') : 'None'}`;

    const result = await aiService.prompt(organizationId, systemPrompt, userPrompt);
    if (!result.success) throw new BadRequestError(result.error || 'AI goal suggestion failed');

    try {
      return JSON.parse(result.data!);
    } catch {
      return { rawResponse: result.data };
    }
  }

  // ==================
  // PERFORMANCE SUMMARY (Enterprise Dashboard)
  // ==================

  async getEmployeePerformanceSummary(employeeId: string, organizationId: string) {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const period = { start: yearStart, end: now };
    const currentYear = now.getFullYear();

    // Fetch employee info (for email to look up tasks)
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
      select: {
        id: true, firstName: true, lastName: true,
        user: { select: { email: true } },
        designation: { select: { name: true } },
        department: { select: { name: true } },
      },
    });
    if (!employee) throw new NotFoundError('Employee');

    // Run all fetches in parallel
    const [
      goals,
      reviews,
      leaveBalances,
      leaveCounts,
      taskResult,
      disciplineScore,
      continuityScore,
    ] = await Promise.all([
      prisma.goal.findMany({
        where: { employeeId, organizationId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.performanceReview.findMany({
        where: { employeeId, reviewCycle: { organizationId } },
        orderBy: { createdAt: 'desc' },
        include: { reviewCycle: { select: { name: true, type: true, status: true } } },
        take: 5,
      }),
      prisma.leaveBalance.findMany({
        where: { employeeId, year: currentYear },
        include: { leaveType: { select: { name: true, code: true, isPaid: true } } },
      }),
      prisma.leaveRequest.groupBy({
        by: ['status'],
        where: { employeeId, createdAt: { gte: yearStart } },
        _count: true,
        _sum: { days: true },
      }),
      taskIntegrationService.getTasksForEmployee(
        organizationId, employeeId, employee.user?.email
      ),
      calculateLeaveDisciplineScore(employeeId, period),
      calculateWorkContinuityScore(employeeId, period),
    ]);

    // ── Goal Stats ──
    const goalTotal = goals.length;
    const goalCompleted = goals.filter((g: any) => g.status === 'COMPLETED').length;
    const goalInProgress = goals.filter((g: any) => g.status === 'IN_PROGRESS').length;
    const goalNotStarted = goals.filter((g: any) => g.status === 'NOT_STARTED').length;
    const goalOnHold = goals.filter((g: any) => g.status === 'ON_HOLD').length;
    const goalCompletionRate = goalTotal > 0 ? Math.round((goalCompleted / goalTotal) * 100) : 100;

    // ── Task Stats (from Monday.com / external) ──
    const tasks = taskResult.tasks;
    const overdueTaskCount = tasks.filter((t: any) => t.dueDate && new Date(t.dueDate) < now).length;
    const blockedTaskCount = tasks.filter((t: any) => t.blockerFlag).length;
    const criticalTaskCount = tasks.filter((t: any) =>
      ['critical', 'urgent', 'highest'].includes((t.priority || '').toLowerCase())
    ).length;
    // Task health: start at 100, deduct for mismanagement signals
    let taskHealthScore = 100;
    taskHealthScore -= overdueTaskCount * 8;
    taskHealthScore -= blockedTaskCount * 6;
    taskHealthScore -= Math.min(criticalTaskCount * 4, 20); // cap critical penalty
    taskHealthScore = Math.max(0, Math.min(100, Math.round(taskHealthScore)));

    // ── Leave Stats ──
    const leavesByType = leaveBalances.map((lb: any) => ({
      typeId: lb.leaveTypeId,
      typeName: lb.leaveType?.name || '',
      typeCode: lb.leaveType?.code || '',
      isPaid: lb.leaveType?.isPaid ?? true,
      allocated: lb.allocated,
      used: Number(lb.used) || 0,
      pending: Number(lb.pending) || 0,
      carriedForward: Number(lb.carriedForward) || 0,
      remaining: Math.max(0, lb.allocated + (lb.carriedForward || 0) - (lb.used || 0) - (lb.pending || 0)),
    }));

    const totalAllocated = leavesByType.reduce((s: number, l: any) => s + l.allocated, 0);
    const totalUsed = leavesByType.reduce((s: number, l: any) => s + l.used, 0);
    const totalPending = leavesByType.reduce((s: number, l: any) => s + l.pending, 0);

    const approvedLeaveRequests = leaveCounts
      .filter((c: any) => ['APPROVED', 'APPROVED_WITH_CONDITION'].includes(c.status))
      .reduce((s: number, c: any) => s + c._count, 0);
    const pendingLeaveRequests = leaveCounts
      .filter((c: any) => c.status === 'PENDING')
      .reduce((s: number, c: any) => s + c._count, 0);
    const rejectedLeaveRequests = leaveCounts
      .filter((c: any) => c.status === 'REJECTED')
      .reduce((s: number, c: any) => s + c._count, 0);

    // ── Composite Performance Score ──
    // Weights: Goals 35%, Leave Discipline 25%, Work Continuity 15%, Task Health 25%
    const overallScore = Math.round(
      (goalCompletionRate * 0.35) +
      (disciplineScore * 0.25) +
      (continuityScore * 0.15) +
      (taskHealthScore * 0.25)
    );

    // ── Star Rating ──
    const rating =
      overallScore >= 90 ? 5 :
      overallScore >= 75 ? 4 :
      overallScore >= 60 ? 3 :
      overallScore >= 45 ? 2 : 1;

    const ratingLabel =
      rating === 5 ? 'Exceptional' :
      rating === 4 ? 'Above Average' :
      rating === 3 ? 'Meets Expectations' :
      rating === 2 ? 'Needs Improvement' : 'Unsatisfactory';

    // ── Recent Review ──
    const recentReview = reviews[0] || null;

    return {
      employee: {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`,
        designation: employee.designation?.name || null,
        department: employee.department?.name || null,
      },
      scores: {
        overall: overallScore,
        goalCompletion: goalCompletionRate,
        leaveDiscipline: disciplineScore,
        workContinuity: continuityScore,
        taskHealth: taskHealthScore,
      },
      rating,
      ratingLabel,
      goals: {
        total: goalTotal,
        completed: goalCompleted,
        inProgress: goalInProgress,
        notStarted: goalNotStarted,
        onHold: goalOnHold,
        completionRate: goalCompletionRate,
        items: goals.slice(0, 10),
      },
      tasks: {
        configured: taskResult.configured,
        provider: taskResult.provider,
        total: tasks.length,
        overdue: overdueTaskCount,
        blocked: blockedTaskCount,
        critical: criticalTaskCount,
        healthScore: taskHealthScore,
        items: tasks.slice(0, 20),
      },
      leaves: {
        totalAllocated,
        totalUsed,
        totalPending,
        approvedRequests: approvedLeaveRequests,
        pendingRequests: pendingLeaveRequests,
        rejectedRequests: rejectedLeaveRequests,
        byType: leavesByType,
      },
      recentReview: recentReview ? {
        cycleName: (recentReview as any).reviewCycle?.name,
        cycleType: (recentReview as any).reviewCycle?.type,
        selfRating: recentReview.selfRating ? Number(recentReview.selfRating) : null,
        managerRating: recentReview.managerRating ? Number(recentReview.managerRating) : null,
        overallRating: recentReview.overallRating ? Number(recentReview.overallRating) : null,
        status: recentReview.status,
      } : null,
      period: { start: yearStart.toISOString(), end: now.toISOString(), year: currentYear },
    };
  }

  async generateReviewSummary(reviewId: string, organizationId: string) {
    const review = await prisma.performanceReview.findUnique({
      where: { id: reviewId },
      include: {
        reviewCycle: { select: { name: true, startDate: true, endDate: true } },
      },
    });
    if (!review) throw new NotFoundError('Performance review');

    const employee = await prisma.employee.findUnique({
      where: { id: review.employeeId },
      select: { firstName: true, lastName: true, designation: { select: { name: true } }, department: { select: { name: true } } },
    });

    const goals = await prisma.goal.findMany({
      where: { employeeId: review.employeeId, organizationId },
      select: { title: true, status: true, currentValue: true, targetValue: true },
    });

    // Get attendance stats for the review period
    const attendanceStats = await prisma.attendanceRecord.groupBy({
      by: ['status'],
      where: {
        employeeId: review.employeeId,
        date: {
          gte: review.reviewCycle?.startDate || new Date(new Date().getFullYear(), 0, 1),
          lte: review.reviewCycle?.endDate || new Date(),
        },
      },
      _count: { status: true },
    });

    const systemPrompt = 'You are an HR manager writing a performance review summary. Based on the employee\'s goals, ratings, and attendance, generate a balanced, constructive review. Return JSON: { summary: string, strengths: string[], areasForImprovement: string[], developmentPlan: string[], overallAssessment: string }';
    const userPrompt = `Employee: ${employee?.firstName || 'N/A'} ${employee?.lastName || ''}\nDesignation: ${employee?.designation?.name || 'N/A'}\nDepartment: ${employee?.department?.name || 'N/A'}\nReview Cycle: ${review.reviewCycle?.name || 'N/A'}\nSelf Rating: ${review.selfRating || 'Not provided'}\nManager Rating: ${review.managerRating || 'Not provided'}\nOverall Rating: ${review.overallRating || 'Not provided'}\n\nGoals:\n${goals.map(g => `- ${g.title}: ${g.status} (Current: ${g.currentValue || 'N/A'}, Target: ${g.targetValue || 'N/A'})`).join('\n') || 'No goals set'}\n\nAttendance:\n${attendanceStats.map(a => `${a.status}: ${a._count.status} days`).join('\n') || 'No attendance data'}`;

    const result = await aiService.prompt(organizationId, systemPrompt, userPrompt, 2048);
    if (!result.success) throw new BadRequestError(result.error || 'AI review summary generation failed');

    try {
      return JSON.parse(result.data!);
    } catch {
      return { rawResponse: result.data };
    }
  }
}

export const performanceService = new PerformanceService();
