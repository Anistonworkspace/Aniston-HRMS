import { Request, Response, NextFunction } from 'express';
import { backupService } from './backup.service.js';

export class BackupController {

  // GET /api/settings/backup/check — pre-flight binary availability
  async checkAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      const data = backupService.checkAvailability();
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }

  // GET /api/settings/backup?category=DATABASE|FILES&page=1&limit=20
  async listBackups(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const category = req.query.category as 'DATABASE' | 'FILES' | undefined;
      const result = await backupService.listBackups(req.user!.organizationId, page, limit, category);
      res.json({ success: true, ...result });
    } catch (err) { next(err); }
  }

  // GET /api/settings/backup/stats
  async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await backupService.getStats(req.user!.organizationId);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }

  // POST /api/settings/backup  body: { category: 'DATABASE' | 'FILES' }
  async createBackup(req: Request, res: Response, next: NextFunction) {
    try {
      const category: 'DATABASE' | 'FILES' = req.body?.category === 'FILES' ? 'FILES' : 'DATABASE';
      const backup = await backupService.createBackup(
        req.user!.organizationId,
        'MANUAL',
        req.user!.userId,
        category
      );
      res.status(201).json({ success: true, data: backup, message: `${category === 'FILES' ? 'Files' : 'Database'} backup created successfully` });
    } catch (err) { next(err); }
  }

  // GET /api/settings/backup/:id/download
  async downloadBackup(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { record, absolutePath } = await backupService.getBackupForDownload(id, req.user!.organizationId);

      // Content-Type depends on backup category
      const isFilesBackup = record.category === 'FILES';
      res.setHeader('Content-Type', isFilesBackup ? 'application/x-tar' : 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="${record.filename}"`);
      res.setHeader('Content-Length', record.sizeBytes?.toString() ?? '0');
      res.setHeader('Cache-Control', 'no-store');

      const fs = await import('fs');
      fs.createReadStream(absolutePath).pipe(res);
    } catch (err) { next(err); }
  }

  // POST /api/settings/backup/:id/restore  — works for DATABASE category
  async restoreBackup(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const result = await backupService.restoreBackup(id, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // POST /api/settings/backup/:id/restore-files  — FILES category restore
  async restoreFilesBackup(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const result = await backupService.restoreFilesBackup(id, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // POST /api/settings/backup/restore/upload — DB restore from uploaded .sql.gz
  async restoreFromUpload(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'No file uploaded' } });
      }
      const result = await backupService.restoreFromUpload(req.file.path, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // POST /api/settings/backup/restore-files/upload — Files restore from uploaded .tar.gz
  async restoreFilesFromUpload(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'No file uploaded' } });
      }
      const result = await backupService.restoreFilesFromUpload(req.file.path, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // DELETE /api/settings/backup/:id
  async deleteBackup(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      await backupService.deleteBackup(id, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, message: 'Backup deleted' });
    } catch (err) { next(err); }
  }
}

export const backupController = new BackupController();
