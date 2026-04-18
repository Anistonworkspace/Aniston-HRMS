import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { bulkResumeService } from './bulk-resume.service.js';
import { recruitmentService } from './recruitment.service.js';

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
      const upload = await bulkResumeService.getBulkUpload(req.params.uploadId as string, req.user!.organizationId);
      res.json({ success: true, data: upload });
    } catch (err) { next(err); }
  }

  async createApplication(req: Request, res: Response, next: NextFunction) {
    try {
      const { jobOpeningId } = z.object({ jobOpeningId: z.string().uuid('Invalid job opening ID') }).parse(req.body);
      const application = await recruitmentService.createApplicationFromBulkItem(
        req.params.itemId as string, jobOpeningId, req.user!.organizationId
      );
      res.status(201).json({ success: true, data: application, message: 'Application created' });
    } catch (err) { next(err); }
  }

  async deleteUpload(req: Request, res: Response, next: NextFunction) {
    try {
      await bulkResumeService.deleteUpload(req.params.uploadId as string, req.user!.organizationId);
      res.json({ success: true, message: 'Upload and all items deleted' });
    } catch (err) { next(err); }
  }

  async deleteItem(req: Request, res: Response, next: NextFunction) {
    try {
      await bulkResumeService.deleteItem(req.params.itemId as string, req.user!.organizationId);
      res.json({ success: true, message: 'Resume item deleted' });
    } catch (err) { next(err); }
  }
}

export const bulkResumeController = new BulkResumeController();
