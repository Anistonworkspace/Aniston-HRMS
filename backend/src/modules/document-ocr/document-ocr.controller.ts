import { Request, Response, NextFunction } from 'express';
import { documentOcrService } from './document-ocr.service.js';
import { updateOcrSchema } from './document-ocr.validation.js';

export class DocumentOcrController {
  /** Trigger OCR for a document */
  async triggerOcr(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await documentOcrService.triggerOcr(req.params.id, req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  /** Get OCR data for a document */
  async getOcr(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await documentOcrService.getOcrData(req.params.id);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }

  /** HR edits OCR extracted data */
  async updateOcr(req: Request, res: Response, next: NextFunction) {
    try {
      const body = updateOcrSchema.parse(req.body);
      const updated = await documentOcrService.updateOcrData(
        req.params.id, body, req.user!.userId, req.user!.organizationId
      );
      res.json({ success: true, data: updated });
    } catch (err) { next(err); }
  }

  /** Cross-validate all documents for an employee */
  async crossValidate(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await documentOcrService.crossValidateEmployee(
        req.params.employeeId, req.user!.organizationId
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  /** Get all OCR summaries for an employee */
  async getEmployeeSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await documentOcrService.getEmployeeOcrSummary(req.params.employeeId);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }

  /** Deep Re-check using gpt-4.1 directly (images only) */
  async deepRecheck(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await documentOcrService.deepRecheckDocument(
        req.params.id, req.user!.userId, req.user!.organizationId,
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }
}

export const documentOcrController = new DocumentOcrController();
