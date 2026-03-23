import { Request, Response, NextFunction } from 'express';
import { documentService } from './document.service.js';
import { createDocumentSchema, verifyDocumentSchema, documentQuerySchema } from './document.validation.js';

export class DocumentController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = documentQuerySchema.parse(req.query);
      const result = await documentService.list(query, req.user!.organizationId);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) { next(err); }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const doc = await documentService.getById(req.params.id);
      res.json({ success: true, data: doc });
    } catch (err) { next(err); }
  }

  async upload(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createDocumentSchema.parse(req.body);
      const fileUrl = req.file ? `/uploads/${req.file.filename}` : '';
      if (!fileUrl) {
        res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded' } });
        return;
      }
      const doc = await documentService.create(data, fileUrl, req.user!.userId);
      res.status(201).json({ success: true, data: doc, message: 'Document uploaded' });
    } catch (err) { next(err); }
  }

  async verify(req: Request, res: Response, next: NextFunction) {
    try {
      const { status, rejectionReason } = verifyDocumentSchema.parse(req.body);
      const doc = await documentService.verify(req.params.id, status, req.user!.userId, rejectionReason);
      res.json({ success: true, data: doc, message: `Document ${status.toLowerCase()}` });
    } catch (err) { next(err); }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await documentService.remove(req.params.id);
      res.json({ success: true, data: null, message: 'Document deleted' });
    } catch (err) { next(err); }
  }
}

export const documentController = new DocumentController();
