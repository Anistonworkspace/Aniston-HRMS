import { Request, Response, NextFunction } from 'express';
import { salaryTemplateService } from './salary-template.service.js';
import {
  createSalaryTemplateSchema,
  updateSalaryTemplateSchema,
  applyTemplateSchema,
  saveAsTemplateSchema,
} from './salary-template.validation.js';

export class SalaryTemplateController {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createSalaryTemplateSchema.parse(req.body);
      const template = await salaryTemplateService.createTemplate(
        data, req.user!.organizationId, req.user!.userId
      );
      res.status(201).json({ success: true, data: template, message: 'Salary template created' });
    } catch (err) { next(err); }
  }

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const type = req.query.type as string | undefined;
      const templates = await salaryTemplateService.listTemplates(req.user!.organizationId, type);
      res.json({ success: true, data: templates });
    } catch (err) { next(err); }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const template = await salaryTemplateService.getTemplate(req.params.id as string, req.user!.organizationId);
      res.json({ success: true, data: template });
    } catch (err) { next(err); }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateSalaryTemplateSchema.parse(req.body);
      const template = await salaryTemplateService.updateTemplate(
        req.params.id as string, data, req.user!.organizationId, req.user!.userId
      );
      res.json({ success: true, data: template, message: 'Salary template updated' });
    } catch (err) { next(err); }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await salaryTemplateService.deleteTemplate(req.params.id as string, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: null, message: 'Salary template deleted' });
    } catch (err) { next(err); }
  }

  async applyToEmployees(req: Request, res: Response, next: NextFunction) {
    try {
      const data = applyTemplateSchema.parse(req.body);
      const result = await salaryTemplateService.applyTemplate(
        data, req.user!.organizationId, req.user!.userId
      );
      if ('requiresConfirmation' in result) {
        res.status(409).json({ success: false, data: result, error: { code: 'OVERWRITE_CONFIRMATION', message: result.message } });
        return;
      }
      res.json({ success: true, data: result, message: `Template applied to ${result.applied} employee(s)` });
    } catch (err) { next(err); }
  }

  async saveFromEmployee(req: Request, res: Response, next: NextFunction) {
    try {
      const data = saveAsTemplateSchema.parse(req.body);
      const template = await salaryTemplateService.saveAsTemplate(
        data, req.user!.organizationId, req.user!.userId
      );
      res.status(201).json({ success: true, data: template, message: 'Salary template saved from employee' });
    } catch (err) { next(err); }
  }
}

export const salaryTemplateController = new SalaryTemplateController();
