import { Request, Response, NextFunction } from 'express';
import { backupService } from './backup.service.js';

export class BackupController {

  async listBackups(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const result = await backupService.listBackups(req.user!.organizationId, page, limit);
      res.json({ success: true, ...result });
    } catch (err) { next(err); }
  }

  async createBackup(req: Request, res: Response, next: NextFunction) {
    try {
      const backup = await backupService.createBackup(
        req.user!.organizationId,
        'MANUAL',
        req.user!.userId
      );
      res.status(201).json({ success: true, data: backup, message: 'Backup created successfully' });
    } catch (err) { next(err); }
  }

  async downloadBackup(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { record, absolutePath } = await backupService.getBackupForDownload(
        id,
        req.user!.organizationId
      );

      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="${record.filename}"`);
      res.setHeader('Content-Length', record.sizeBytes?.toString() ?? '0');
      res.setHeader('Cache-Control', 'no-store');

      const fs = await import('fs');
      fs.createReadStream(absolutePath).pipe(res);
    } catch (err) { next(err); }
  }

  async restoreBackup(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await backupService.restoreBackup(
        id,
        req.user!.organizationId,
        req.user!.userId
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async restoreFromUpload(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'No file uploaded' } });
      }
      const result = await backupService.restoreFromUpload(
        req.file.path,
        req.user!.organizationId,
        req.user!.userId
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async deleteBackup(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await backupService.deleteBackup(id, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, message: 'Backup deleted' });
    } catch (err) { next(err); }
  }

  async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await backupService.getStats(req.user!.organizationId);
      res.json({ success: true, data: stats });
    } catch (err) { next(err); }
  }
}

export const backupController = new BackupController();
