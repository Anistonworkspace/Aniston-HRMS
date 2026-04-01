import { Router } from 'express';
import { policyController } from './policy.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';
import { uploadDocument } from '../../middleware/upload.middleware.js';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('policy', 'read'), (req, res, next) =>
  policyController.list(req, res, next)
);

router.get('/:id', requirePermission('policy', 'read'), (req, res, next) =>
  policyController.getById(req, res, next)
);

// File upload — field name "file" (PDF/DOC/DOCX)
router.post('/', requirePermission('policy', 'create'), uploadDocument.single('file'), (req, res, next) =>
  policyController.create(req, res, next)
);

router.patch('/:id', requirePermission('policy', 'update'), uploadDocument.single('file'), (req, res, next) =>
  policyController.update(req, res, next)
);

router.post('/:id/acknowledge', requirePermission('policy', 'read'), (req, res, next) =>
  policyController.acknowledge(req, res, next)
);

export { router as policyRouter };
