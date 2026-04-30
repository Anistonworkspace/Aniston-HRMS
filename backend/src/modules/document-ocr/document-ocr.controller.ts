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
      const data = await documentOcrService.getOcrData(req.params.id, req.user!.organizationId);
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
      const data = await documentOcrService.getEmployeeOcrSummary(req.params.employeeId, req.user!.organizationId);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }

  /** Bulk-trigger OCR for all documents belonging to an employee */
  async triggerAllForEmployee(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await documentOcrService.triggerAllForEmployee(
        req.params.employeeId, req.user!.organizationId,
      );
      res.json({ success: true, data: result });
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

  /** Reprocess: force-run full OCR pipeline on an existing document */
  async reprocessDocument(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await documentOcrService.reprocessDocument(
        req.params.id, req.user!.userId, req.user!.organizationId,
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  /** Get OCR verification history for a document */
  async getOcrHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const history = await documentOcrService.getOcrHistory(req.params.id, req.user!.organizationId);
      res.json({ success: true, data: history });
    } catch (err) { next(err); }
  }

  /** Org-wide bulk OCR trigger — queues all pending employees' documents */
  async orgBulkTrigger(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await documentOcrService.orgBulkTrigger(req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  /** HR approves an individual document */
  async hrApproveDocument(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await documentOcrService.hrApproveDocument(
        req.params.id, req.user!.userId, req.user!.organizationId,
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  /** HR rejects an individual document with a reason */
  async hrRejectDocument(req: Request, res: Response, next: NextFunction) {
    try {
      const { reason } = req.body;
      if (!reason?.trim()) {
        res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Rejection reason is required' } });
        return;
      }
      const result = await documentOcrService.hrRejectDocument(
        req.params.id, reason, req.user!.userId, req.user!.organizationId,
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  /** Run face comparison for an employee */
  async compareFaces(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await documentOcrService.compareFacesForEmployee(
        req.params.employeeId, req.user!.organizationId,
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }
}

export const documentOcrController = new DocumentOcrController();
