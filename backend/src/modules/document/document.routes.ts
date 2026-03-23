import { Router } from 'express';
import { authenticate, authorize, requirePermission } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { uploadDocument } from '../../middleware/upload.middleware.js';
import { documentController } from './document.controller.js';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('document', 'read'), (req, res, next) =>
  documentController.list(req, res, next)
);
router.get('/:id', requirePermission('document', 'read'), (req, res, next) =>
  documentController.getById(req, res, next)
);
router.post('/', requirePermission('document', 'create'), uploadDocument.single('file'), (req, res, next) =>
  documentController.upload(req, res, next)
);
router.patch('/:id/verify', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) =>
  documentController.verify(req, res, next)
);
router.delete('/:id', requirePermission('document', 'delete'), (req, res, next) =>
  documentController.remove(req, res, next)
);

export { router as documentRouter };
