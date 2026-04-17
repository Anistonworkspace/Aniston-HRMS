import { Request, Response, NextFunction } from 'express';
import { componentMasterService } from './component-master.service.js';
import { createComponentSchema, updateComponentSchema, reorderComponentsSchema } from './component-master.validation.js';

export class ComponentMasterController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const type = req.query.type as string | undefined;
      const components = await componentMasterService.listComponents(req.user!.organizationId, type);
      res.json({ success: true, data: components });
    } catch (err) { next(err); }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const component = await componentMasterService.getComponent(req.params.id, req.user!.organizationId);
      res.json({ success: true, data: component });
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createComponentSchema.parse(req.body);
      const component = await componentMasterService.createComponent(data, req.user!.organizationId, req.user!.userId);
      res.status(201).json({ success: true, data: component, message: 'Component created' });
    } catch (err) { next(err); }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateComponentSchema.parse(req.body);
      const component = await componentMasterService.updateComponent(req.params.id, data, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: component, message: 'Component updated' });
    } catch (err) { next(err); }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await componentMasterService.deleteComponent(req.params.id, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, message: 'Component deleted' });
    } catch (err) { next(err); }
  }

  async reorder(req: Request, res: Response, next: NextFunction) {
    try {
      const { components } = reorderComponentsSchema.parse(req.body);
      await componentMasterService.reorderComponents(components, req.user!.organizationId);
      res.json({ success: true, message: 'Components reordered' });
    } catch (err) { next(err); }
  }

  async toggleActive(req: Request, res: Response, next: NextFunction) {
    try {
      const component = await componentMasterService.toggleActive(req.params.id, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: component, message: `Component ${component.isActive ? 'activated' : 'deactivated'}` });
    } catch (err) { next(err); }
  }

  async seedDefaults(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await componentMasterService.seedDefaults(req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: result, message: `${result.seeded} default components seeded` });
    } catch (err) { next(err); }
  }

  async cleanupLegacyDefaults(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await componentMasterService.cleanupLegacyDefaults(req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: result, message: `${result.deleted} legacy default component(s) removed` });
    } catch (err) { next(err); }
  }
}

export const componentMasterController = new ComponentMasterController();
