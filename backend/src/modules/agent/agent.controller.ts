import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Request, Response, NextFunction } from 'express';
import { agentService } from './agent.service.js';
import { heartbeatSchema, screenshotMetadataSchema, generateCodeSchema, setLiveModeSchema, dateParamSchema } from './agent.validation.js';
import { storageService, StorageFolder } from '../../services/storage.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// downloads/ lives at project root — 4 levels up from backend/dist/modules/agent/
const DOWNLOADS_ROOT = path.resolve(__dirname, '../../../../downloads');
// CI/CD SCP preserves the artifact directory name, so the exe lands in agent/agent-build/
const AGENT_EXE_PATH = path.join(DOWNLOADS_ROOT, 'agent', 'agent-build', 'aniston-agent-setup.exe');

export class AgentController {
  async submitHeartbeat(req: Request, res: Response, next: NextFunction) {
    try {
      const { activities } = heartbeatSchema.parse(req.body);
      const result = await agentService.submitHeartbeat(
        req.user!.employeeId!,
        req.user!.organizationId,
        activities,
        req.user!.userId
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async uploadScreenshot(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, error: { code: 'FILE_REQUIRED', message: 'No file uploaded' } });
        return;
      }

      const metadata = screenshotMetadataSchema.parse(req.body);
      const imageUrl = storageService.buildUrl(StorageFolder.AGENT_SCREENSHOTS, req.file.filename);

      const screenshot = await agentService.saveScreenshot(
        req.user!.employeeId!,
        req.user!.organizationId,
        imageUrl,
        metadata,
        req.user!.userId
      );
      res.status(201).json({ success: true, data: screenshot });
    } catch (err) { next(err); }
  }

  async getConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const config = await agentService.getConfig(req.user!.employeeId!, req.user!.organizationId);
      res.json({ success: true, data: config });
    } catch (err) { next(err); }
  }

  // Bug #9: Single query returns summaries for ALL employees — eliminates N+1 from EmployeeRow
  async getActivityBulkSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const date = req.query.date as string;
      if (!date) {
        res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'date query param required (YYYY-MM-DD)' } });
        return;
      }
      dateParamSchema.parse(date);
      const result = await agentService.getActivityBulkSummary(req.user!.organizationId, date);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async getActivityLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const { employeeId, date } = req.params;
      dateParamSchema.parse(date);
      const result = await agentService.getActivityLogs(
        employeeId as string,
        date as string,
        req.user!.organizationId
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async getScreenshots(req: Request, res: Response, next: NextFunction) {
    try {
      const { employeeId, date } = req.params;
      dateParamSchema.parse(date);
      const screenshots = await agentService.getScreenshots(
        employeeId as string,
        date as string,
        req.user!.organizationId
      );
      res.json({ success: true, data: screenshots });
    } catch (err) { next(err); }
  }

  async getStatus(req: Request, res: Response, next: NextFunction) {
    try {
      // Management users (SUPER_ADMIN/ADMIN) may have no linked employee record.
      // Return inactive status rather than querying with undefined employeeId (which would
      // match the most-recent log across the org — a data leak).
      if (!req.user!.employeeId) {
        res.json({ success: true, data: { isActive: false, lastHeartbeat: null } });
        return;
      }
      const status = await agentService.getAgentStatus(req.user!.employeeId, req.user!.organizationId);
      res.json({ success: true, data: status });
    } catch (err) { next(err); }
  }

  // Admin: check a specific employee's agent status
  async getEmployeeStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const employeeId = Array.isArray(req.params.employeeId) ? req.params.employeeId[0] : req.params.employeeId;
      const status = await agentService.getAgentStatus(employeeId, req.user!.organizationId);
      res.json({ success: true, data: status });
    } catch (err) { next(err); }
  }

  // Check whether the agent installer exe is available for download
  async getDownloadStatus(_req: Request, res: Response, next: NextFunction) {
    try {
      const available = existsSync(AGENT_EXE_PATH);
      res.json({
        success: true,
        data: {
          available,
          downloadUrl: available ? '/downloads/aniston-agent-setup.exe' : null,
          filename: 'aniston-agent-setup.exe',
        },
      });
    } catch (err) { next(err); }
  }
  async generatePairCode(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await agentService.generatePairCode(
        req.user!.userId,
        req.user!.employeeId!,
        req.user!.organizationId
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async setLiveMode(req: Request, res: Response, next: NextFunction) {
    try {
      const { employeeId, enabled, intervalSeconds } = setLiveModeSchema.parse(req.body);
      const result = await agentService.setLiveMode(employeeId, req.user!.organizationId, enabled, intervalSeconds, req.user!.userId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async getLiveMode(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await agentService.getLiveMode(req.params.employeeId as string, req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async verifyPairCode(req: Request, res: Response, next: NextFunction) {
    try {
      const { code } = req.body;
      if (!code) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Pairing code is required' } });
      const result = await agentService.verifyPairCode(code);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // ===== Enterprise Agent Setup (Admin) =====

  async getAgentSetupList(req: Request, res: Response, next: NextFunction) {
    try {
      const employees = await agentService.getEmployeesWithAgentStatus(req.user!.organizationId);
      res.json({ success: true, data: employees });
    } catch (err) { next(err); }
  }

  async generateSetupCode(req: Request, res: Response, next: NextFunction) {
    try {
      const { employeeId } = generateCodeSchema.parse(req.body);
      const result = await agentService.generatePermanentCode(employeeId, req.user!.organizationId, req.user!.userId);
      res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async regenerateSetupCode(req: Request, res: Response, next: NextFunction) {
    try {
      const { employeeId } = generateCodeSchema.parse(req.body);
      const result = await agentService.regenerateCode(employeeId, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async bulkGenerateCodes(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await agentService.bulkGenerateCodes(req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async exportActivity(req: Request, res: Response, next: NextFunction) {
    try {
      const { employeeId, date } = req.params;
      dateParamSchema.parse(date);
      const buffer = await agentService.exportActivityExcel(employeeId, req.user!.organizationId, date, req.user!.userId);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="activity-${employeeId}-${date}.xlsx"`);
      res.send(buffer);
    } catch (err) { next(err); }
  }

  async setScreenshotInterval(req: Request, res: Response, next: NextFunction) {
    try {
      const { employeeId, intervalSeconds } = req.body;
      if (!employeeId || !intervalSeconds) {
        res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'employeeId and intervalSeconds required' } });
        return;
      }
      const validIntervals = [60, 300, 600, 900, 1800, 3600];
      if (!validIntervals.includes(Number(intervalSeconds))) {
        res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'intervalSeconds must be one of: 60, 300, 600, 900, 1800, 3600' } });
        return;
      }
      const result = await agentService.setScreenshotInterval(employeeId, req.user!.organizationId, Number(intervalSeconds), req.user!.userId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async getScreenshotInterval(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await agentService.getScreenshotInterval(req.params.employeeId, req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async deleteActivityByDate(req: Request, res: Response, next: NextFunction) {
    try {
      const { employeeId, date } = req.params;
      dateParamSchema.parse(date);
      const result = await agentService.deleteActivityByDate(
        employeeId,
        date,
        req.user!.organizationId,
        req.user!.userId
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }
}

export const agentController = new AgentController();
