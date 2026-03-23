import { prisma } from '../../lib/prisma.js';
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

  async createReview(data: CreateReviewInput, reviewerId: string) {
    const review = await prisma.performanceReview.create({
      data: {
        ...data,
        selfRating: data.selfRating || null,
        managerRating: data.managerRating || null,
        reviewerId,
        status: 'PENDING',
      },
    });
    return review;
  }

  async updateReview(id: string, data: UpdateReviewInput) {
    const updateData: any = {};
    if (data.managerRating) updateData.managerRating = data.managerRating;
    if (data.managerComments) updateData.managerComments = data.managerComments;
    if (data.overallRating) updateData.overallRating = data.overallRating;
    if (data.status) updateData.status = data.status;
    if (data.strengths) updateData.strengths = data.strengths;
    if (data.improvements) updateData.improvements = data.improvements;
    if (data.status === 'REVIEWED') updateData.reviewedAt = new Date();

    const review = await prisma.performanceReview.update({ where: { id }, data: updateData });
    return review;
  }
}

export const performanceService = new PerformanceService();
