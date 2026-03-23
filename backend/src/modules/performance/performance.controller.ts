import { Request, Response, NextFunction } from 'express';
import { performanceService } from './performance.service.js';
import {
  createReviewCycleSchema,
  updateReviewCycleSchema,
  createGoalSchema,
  updateGoalSchema,
  createReviewSchema,
  updateReviewSchema,
} from './performance.validation.js';

export class PerformanceController {
  // ==================
  // REVIEW CYCLES
  // ==================

  async listCycles(req: Request, res: Response, next: NextFunction) {
    try {
      const cycles = await performanceService.listCycles(req.user!.organizationId);
      res.json({ success: true, data: cycles });
    } catch (err) {
      next(err);
    }
  }

  async createCycle(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createReviewCycleSchema.parse(req.body);
      const cycle = await performanceService.createCycle(data, req.user!.organizationId);
      res.status(201).json({ success: true, data: cycle, message: 'Review cycle created' });
    } catch (err) {
      next(err);
    }
  }

  async updateCycle(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateReviewCycleSchema.parse(req.body);
      const cycle = await performanceService.updateCycle(req.params.id, data);
      res.json({ success: true, data: cycle });
    } catch (err) {
      next(err);
    }
  }

  // ==================
  // GOALS
  // ==================

  async listGoals(req: Request, res: Response, next: NextFunction) {
    try {
      const employeeId = (req.query.employeeId as string) || req.user!.employeeId;
      const goals = await performanceService.listGoals(employeeId!, req.user!.organizationId);
      res.json({ success: true, data: goals });
    } catch (err) {
      next(err);
    }
  }

  async createGoal(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createGoalSchema.parse(req.body);
      const goal = await performanceService.createGoal(data, req.user!.organizationId);
      res.status(201).json({ success: true, data: goal, message: 'Goal created' });
    } catch (err) {
      next(err);
    }
  }

  async updateGoal(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateGoalSchema.parse(req.body);
      const goal = await performanceService.updateGoal(req.params.id, data);
      res.json({ success: true, data: goal });
    } catch (err) {
      next(err);
    }
  }

  // ==================
  // REVIEWS
  // ==================

  async listReviews(req: Request, res: Response, next: NextFunction) {
    try {
      const employeeId = (req.query.employeeId as string) || req.user!.employeeId;
      const reviews = await performanceService.listReviews(employeeId!);
      res.json({ success: true, data: reviews });
    } catch (err) {
      next(err);
    }
  }

  async createReview(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createReviewSchema.parse(req.body);
      const review = await performanceService.createReview(data, req.user!.userId);
      res.status(201).json({ success: true, data: review, message: 'Review submitted' });
    } catch (err) {
      next(err);
    }
  }

  async updateReview(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateReviewSchema.parse(req.body);
      const review = await performanceService.updateReview(req.params.id, data);
      res.json({ success: true, data: review });
    } catch (err) {
      next(err);
    }
  }
}

export const performanceController = new PerformanceController();
