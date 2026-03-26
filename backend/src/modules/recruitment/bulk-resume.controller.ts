import { Request, Response, NextFunction } from 'express';
import { bulkResumeService } from './bulk-resume.service.js';

export class BulkResumeController {
  async upload(req: Request, res: Response, next: NextFunction) {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ success: false, error: { message: 'No files uploaded' } });
      }
      const { jobOpeningId } = req.body;
      if (!jobOpeningId) {
        return res.status(400).json({ success: false, error: { message: 'jobOpeningId is required' } });
      }
      const result = await bulkResumeService.uploadBulkResumes(
        files, jobOpeningId, req.user!.userId, req.user!.organizationId
      );
      res.status(201).json({ success: true, data: result, message: `${files.length} resumes uploaded for processing` });
    } catch (err) { next(err); }
  }

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const uploads = await bulkResumeService.listBulkUploads(req.user!.organizationId);
      res.json({ success: true, data: uploads });
    } catch (err) { next(err); }
  }

  async getUpload(req: Request, res: Response, next: NextFunction) {
    try {
      const upload = await bulkResumeService.getBulkUpload(req.params.uploadId);
      res.json({ success: true, data: upload });
    } catch (err) { next(err); }
  }

  async createApplication(req: Request, res: Response, next: NextFunction) {
    try {
      const { jobOpeningId } = req.body;
      const application = await bulkResumeService.createApplicationFromItem(req.params.itemId, jobOpeningId);
      res.status(201).json({ success: true, data: application, message: 'Application created' });
    } catch (err) { next(err); }
  }
}

export const bulkResumeController = new BulkResumeController();
