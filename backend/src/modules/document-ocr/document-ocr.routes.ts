import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { documentOcrController } from './document-ocr.controller.js';

const router = Router();
router.use(authenticate);
router.use(authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR));

// Trigger OCR for a document
router.post('/:id/ocr', (req, res, next) =>
  documentOcrController.triggerOcr(req, res, next),
);

// Get OCR data for a document
router.get('/:id/ocr', (req, res, next) =>
  documentOcrController.getOcr(req, res, next),
);

// Update/edit OCR data
router.patch('/:id/ocr', (req, res, next) =>
  documentOcrController.updateOcr(req, res, next),
);

// Cross-validate all documents for an employee
router.post('/ocr/cross-validate/:employeeId', (req, res, next) =>
  documentOcrController.crossValidate(req, res, next),
);

// Bulk-trigger OCR for all documents of an employee (skips already-processed ones)
router.post('/ocr/employee/:employeeId/trigger-all', (req, res, next) =>
  documentOcrController.triggerAllForEmployee(req, res, next),
);

// Get all OCR summaries for an employee
router.get('/ocr/employee/:employeeId', (req, res, next) =>
  documentOcrController.getEmployeeSummary(req, res, next),
);

// Deep Re-check: reprocess with gpt-4.1 (images only, HR/ADMIN/SUPER_ADMIN)
router.post('/:id/ocr/deep-recheck', (req, res, next) =>
  documentOcrController.deepRecheck(req, res, next),
);

export { router as documentOcrRouter };
