import { prisma } from '../../lib/prisma.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { aiService } from '../../services/ai.service.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
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

  async updateCycle(id: string, data: UpdateReviewCycleInput) {
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

  async updateGoal(id: string, data: UpdateGoalInput) {
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

  async listReviews(employeeId: string) {
    const reviews = await prisma.performanceReview.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
      include: { reviewCycle: { select: { name: true, type: true } } },
    });
    return reviews;
  }

  async createReview(data: CreateReviewInput, reviewerId: string, organizationId?: string) {
    const review = await prisma.performanceReview.create({
      data: {
        ...data,
        selfRating: data.selfRating || null,
        managerRating: data.managerRating || null,
        reviewerId,
        status: 'PENDING',
      },
    });

    if (organizationId) {
      await createAuditLog({
        userId: reviewerId,
        organizationId,
        entity: 'PerformanceReview',
        entityId: review.id,
        action: 'CREATE',
        newValue: { employeeId: data.employeeId, status: 'PENDING' },
      });
    }

    return review;
  }

  async updateReview(id: string, data: UpdateReviewInput, userId?: string, organizationId?: string) {
    const updateData: any = {};
    if (data.managerRating) updateData.managerRating = data.managerRating;
    if (data.managerComments) updateData.managerComments = data.managerComments;
    if (data.overallRating) updateData.overallRating = data.overallRating;
    if (data.status) updateData.status = data.status;
    if (data.strengths) updateData.strengths = data.strengths;
    if (data.improvements) updateData.improvements = data.improvements;
    if (data.status === 'REVIEWED') updateData.reviewedAt = new Date();

    const review = await prisma.performanceReview.update({ where: { id }, data: updateData });

    if (userId && organizationId) {
      await createAuditLog({
        userId,
        organizationId,
        entity: 'PerformanceReview',
        entityId: id,
        action: 'UPDATE',
        newValue: updateData,
      });
    }

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

  async generateReviewSummary(reviewId: string, organizationId: string) {
    const review = await prisma.performanceReview.findUnique({
      where: { id: reviewId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            designation: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
        reviewCycle: { select: { name: true, startDate: true, endDate: true } },
      },
    });
    if (!review) throw new NotFoundError('Performance review');

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
    const userPrompt = `Employee: ${review.employee.firstName} ${review.employee.lastName}\nDesignation: ${review.employee.designation?.name || 'N/A'}\nDepartment: ${review.employee.department?.name || 'N/A'}\nReview Cycle: ${review.reviewCycle?.name || 'N/A'}\nSelf Rating: ${review.selfRating || 'Not provided'}\nManager Rating: ${review.managerRating || 'Not provided'}\nOverall Rating: ${review.overallRating || 'Not provided'}\n\nGoals:\n${goals.map(g => `- ${g.title}: ${g.status} (Current: ${g.currentValue || 'N/A'}, Target: ${g.targetValue || 'N/A'})`).join('\n') || 'No goals set'}\n\nAttendance:\n${attendanceStats.map(a => `${a.status}: ${a._count.status} days`).join('\n') || 'No attendance data'}`;

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
