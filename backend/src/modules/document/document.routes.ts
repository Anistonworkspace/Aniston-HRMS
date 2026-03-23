import { Router } from 'express';
import { authenticate, authorize, requirePermission } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { uploadDocument } from '../../middleware/upload.middleware.js';
import { documentController } from './document.controller.js';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('document', 'read'), documentController.list);
router.get('/:id', requirePermission('document', 'read'), documentController.getById);
router.post('/', requirePermission('document', 'create'), uploadDocument.single('file'), documentController.upload);
router.patch('/:id/verify', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), documentController.verify);
router.delete('/:id', requirePermission('document', 'delete'), documentController.remove);

export { router as documentRouter };
