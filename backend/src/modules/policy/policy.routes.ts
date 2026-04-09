import { Router } from 'express';
import { policyController } from './policy.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';
import { uploadPolicy } from '../../middleware/upload.middleware.js';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('policy', 'read'), (req, res, next) =>
  policyController.list(req, res, next)
);

router.get('/:id', requirePermission('policy', 'read'), (req, res, next) =>
  policyController.getById(req, res, next)
);

// Secure stream (for viewer — no download)
router.get('/:id/stream', requirePermission('policy', 'read'), (req, res, next) =>
  policyController.stream(req, res, next)
);

// Controlled download
router.get('/:id/download', requirePermission('policy', 'read'), (req, res, next) =>
  policyController.download(req, res, next)
);

// File upload — field name "file" (PDF/DOC/DOCX)
router.post('/', requirePermission('policy', 'create'), uploadPolicy.single('file'), (req, res, next) =>
  policyController.create(req, res, next)
);

router.patch('/:id', requirePermission('policy', 'update'), uploadPolicy.single('file'), (req, res, next) =>
  policyController.update(req, res, next)
);

// Delete (soft)
router.delete('/:id', requirePermission('policy', 'delete'), (req, res, next) =>
  policyController.delete(req, res, next)
);

router.post('/:id/acknowledge', requirePermission('policy', 'read'), (req, res, next) =>
  policyController.acknowledge(req, res, next)
);

export { router as policyRouter };
