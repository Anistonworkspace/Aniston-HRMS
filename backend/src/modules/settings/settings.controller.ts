import { Request, Response, NextFunction } from 'express';
import { settingsService } from './settings.service.js';

const p = (v: string | string[]) => (Array.isArray(v) ? v[0] : v);
import { updateOrganizationSchema, createLocationSchema, updateLocationSchema, auditLogQuerySchema, teamsConfigSchema } from './settings.validation.js';

export class SettingsController {
  async getOrganization(req: Request, res: Response, next: NextFunction) {
    try {
      const org = await settingsService.getOrganization(req.user!.organizationId);
      res.json({ success: true, data: org });
    } catch (err) {
      next(err);
    }
  }

  async updateOrganization(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateOrganizationSchema.parse(req.body);
      const org = await settingsService.updateOrganization(req.user!.organizationId, data);
      res.json({ success: true, data: org, message: 'Organization updated' });
    } catch (err) {
      next(err);
    }
  }

  async listLocations(req: Request, res: Response, next: NextFunction) {
    try {
      const locations = await settingsService.listLocations(req.user!.organizationId);
      res.json({ success: true, data: locations });
    } catch (err) {
      next(err);
    }
  }

  async createLocation(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createLocationSchema.parse(req.body);
      const location = await settingsService.createLocation(data, req.user!.organizationId);
      res.status(201).json({ success: true, data: location, message: 'Location added' });
    } catch (err) {
      next(err);
    }
  }

  async updateLocation(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateLocationSchema.parse(req.body);
      const location = await settingsService.updateLocation(p(req.params.id), data, req.user!.organizationId);
      res.json({ success: true, data: location });
    } catch (err) {
      next(err);
    }
  }

  async deleteLocation(req: Request, res: Response, next: NextFunction) {
    try {
      await settingsService.deleteLocation(p(req.params.id), req.user!.organizationId);
      res.json({ success: true, data: null, message: 'Location deleted' });
    } catch (err) {
      next(err);
    }
  }

  async listAuditLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const query = auditLogQuerySchema.parse(req.query);
      const result = await settingsService.listAuditLogs(query, req.user!.organizationId);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) {
      next(err);
    }
  }

  async getSystemInfo(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = settingsService.getSystemInfo();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async getEmailConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const config = await settingsService.getEmailConfig(req.user!.organizationId);
      res.json({ success: true, data: config });
    } catch (err) {
      next(err);
    }
  }

  async saveEmailConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const { host, port, user, pass, fromAddress, fromName, emailDomain, authMethod, tenantId, clientId, clientSecret, senderEmail, payrollEmail } = req.body;
      await settingsService.saveEmailConfig(req.user!.organizationId, {
        authMethod: authMethod || 'smtp',
        host, port: port ? Number(port) : undefined, user, pass,
        fromAddress, fromName, emailDomain,
        tenantId, clientId, clientSecret, senderEmail,
        payrollEmail,
      }, req.user!.userId);
      res.json({ success: true, message: 'Email configuration saved' });
    } catch (err) {
      next(err);
    }
  }

  async testEmailConnection(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await settingsService.testEmailConnection(req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async testAdminNotificationEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await settingsService.testAdminNotificationEmail(req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async getTeamsConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const config = await settingsService.getTeamsConfig(req.user!.organizationId);
      res.json({ success: true, data: config });
    } catch (err) {
      next(err);
    }
  }

  async saveTeamsConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const data = teamsConfigSchema.parse(req.body);
      await settingsService.saveTeamsConfig(req.user!.organizationId, data, req.user!.userId);
      res.json({ success: true, message: 'Microsoft Teams configuration saved' });
    } catch (err) {
      next(err);
    }
  }

  async testTeamsConnection(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await settingsService.testTeamsConnection(req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async syncTeamsEmployees(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await settingsService.syncEmployeesFromTeams(req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: result, message: `Imported ${result.imported} employees, skipped ${result.skipped}` });
    } catch (err) {
      next(err);
    }
  }

  async listDocumentTemplates(req: Request, res: Response, next: NextFunction) {
    try {
      const templates = await settingsService.listDocumentTemplates(req.user!.organizationId);
      res.json({ success: true, data: templates });
    } catch (err) {
      next(err);
    }
  }

  async upsertDocumentTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const { id, label, key, isDefault, required } = req.body;
      const template = await settingsService.upsertDocumentTemplate(req.user!.organizationId, { id, label, key, isDefault, required });
      res.json({ success: true, data: template });
    } catch (err) {
      next(err);
    }
  }

  async deleteDocumentTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      await settingsService.deleteDocumentTemplate(req.params.id, req.user!.organizationId);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }

  async getAccountActivity(req: Request, res: Response, next: NextFunction) {
    try {
      const role = (req.query.role as string)?.toUpperCase();
      if (role !== 'HR' && role !== 'EMPLOYEE') {
        res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'role must be HR or EMPLOYEE' } });
        return;
      }
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
      const result = await settingsService.getAccountActivity({
        role: role as 'HR' | 'EMPLOYEE',
        page,
        limit,
        organizationId: req.user!.organizationId,
      });
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) {
      next(err);
    }
  }

  async deleteActivityLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const { ids, fromDate, toDate } = req.body;
      const result = await settingsService.deleteActivityLogs({
        organizationId: req.user!.organizationId,
        ids: Array.isArray(ids) ? ids : undefined,
        fromDate: fromDate ? new Date(fromDate) : undefined,
        toDate: toDate ? new Date(toDate) : undefined,
      });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
}

export const settingsController = new SettingsController();
