import { Router } from 'express';
import { letterController } from './letter.controller.js';
import { authenticate, requirePermission, authorize } from '../../middleware/auth.middleware.js';
import { uploadLetterPdf } from '../../middleware/upload.middleware.js';
import { Role } from '@aniston/shared';

const router = Router();

router.use(authenticate);

// Templates
router.get('/templates', requirePermission('letter', 'read'), (req, res, next) =>
  letterController.getTemplates(req, res, next)
);

// My letters (employee self-view)
router.get('/my', requirePermission('letter', 'read'), (req, res, next) =>
  letterController.getMyLetters(req, res, next)
);

// List all letters (HR/Admin view only — employees must use /my)
router.get('/', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) =>
  letterController.list(req, res, next)
);

// Get single letter
router.get('/:id', requirePermission('letter', 'read'), (req, res, next) =>
  letterController.getById(req, res, next)
);

// Secure stream (for viewer — no download)
router.get('/:id/stream', requirePermission('letter', 'read'), (req, res, next) =>
  letterController.stream(req, res, next)
);

// Controlled download
router.get('/:id/download', requirePermission('letter', 'read'), (req, res, next) =>
  letterController.download(req, res, next)
);

// Create letter (generates PDF + assigns to employee)
router.post('/', requirePermission('letter', 'create'), (req, res, next) =>
  letterController.create(req, res, next)
);

// Preview letter as PDF without saving to DB
router.post('/preview', requirePermission('letter', 'create'), (req, res, next) =>
  letterController.preview(req, res, next)
);

// Upload a pre-made PDF letter and assign to employee
router.post('/upload', requirePermission('letter', 'create'), uploadLetterPdf.single('file'), (req, res, next) =>
  letterController.uploadPdf(req, res, next)
);

// Assign letter to more employees
router.post('/:id/assign', requirePermission('letter', 'create'), (req, res, next) =>
  letterController.assign(req, res, next)
);

// Update assignment permissions
router.patch('/assignments/:assignmentId', requirePermission('letter', 'update'), (req, res, next) =>
  letterController.updateAssignment(req, res, next)
);

// Delete letter (soft)
router.delete('/:id', requirePermission('letter', 'delete'), (req, res, next) =>
  letterController.delete(req, res, next)
);

export { router as letterRouter };
