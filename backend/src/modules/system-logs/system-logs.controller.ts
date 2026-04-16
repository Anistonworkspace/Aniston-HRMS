import { Request, Response, NextFunction } from 'express';
import { systemLogsService } from './system-logs.service.js';
import { systemLogQuerySchema } from './system-logs.validation.js';

export class SystemLogsController {
  /** GET /api/settings/system-logs */
  async getLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const query  = systemLogQuerySchema.parse(req.query);
      const result = await systemLogsService.getLogs(query);
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/settings/system-logs/summary */
  async getSummary(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await systemLogsService.getSummary();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/settings/system-logs/ai-service */
  async getAiServiceLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const lines  = Math.min(parseInt(String(req.query.lines || '200'), 10) || 200, 1000);
      const result = await systemLogsService.getAiServiceLogs(lines);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/settings/system-logs/ai-health — live health check of the Python AI service */
  async getAiServiceHealth(_req: Request, res: Response, next: NextFunction) {
    try {
      const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
      const start = Date.now();
      try {
        const healthRes = await fetch(`${AI_URL}/ai/health`, {
          signal: AbortSignal.timeout(5000),
        });
        const latencyMs = Date.now() - start;
        if (healthRes.ok) {
          const body = await healthRes.json() as any;
          res.json({
            success: true,
            data: {
              status: 'online',
              latencyMs,
              service: body?.data?.service ?? 'Aniston AI Service',
              version: body?.data?.version ?? 'unknown',
              url: AI_URL,
            },
          });
        } else {
          res.json({
            success: true,
            data: { status: 'degraded', latencyMs, httpStatus: healthRes.status, url: AI_URL },
          });
        }
      } catch (fetchErr: any) {
        res.json({
          success: true,
          data: { status: 'offline', error: fetchErr.message, url: AI_URL },
        });
      }
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/settings/system-logs/download */
  async downloadLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const query  = systemLogQuerySchema.parse(req.query);
      const format = (req.query.format === 'json' ? 'json' : 'txt') as 'txt' | 'json';
      const content = await systemLogsService.buildDownload(query, format);

      const ext         = format === 'json' ? '.json' : '.txt';
      const contentType = format === 'json' ? 'application/json' : 'text/plain';
      const date        = new Date().toISOString().slice(0, 10);

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="system-logs-${date}${ext}"`);
      res.send(content);
    } catch (err) {
      next(err);
    }
  }
}

export const systemLogsController = new SystemLogsController();
