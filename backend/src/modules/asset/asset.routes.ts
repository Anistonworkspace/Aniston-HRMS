import { Router } from 'express';
import { assetController } from './asset.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

// Employee: Get my assigned assets (no special permission needed)
router.get('/my', (req, res, next) => assetController.getMyAssets(req, res, next));

// Stats (HR+)
router.get('/stats', requirePermission('asset', 'read'), (req, res, next) =>
  assetController.getStats(req, res, next)
);

// Exit checklist routes (HR+) — must be before /:id to avoid conflicts
router.get('/exit-checklist/:employeeId', requirePermission('asset', 'manage'), (req, res, next) =>
  assetController.getExitChecklist(req, res, next)
);
router.patch('/exit-checklist/:employeeId/item', requirePermission('asset', 'manage'), (req, res, next) =>
  assetController.markChecklistItem(req, res, next)
);

// Employee assets (HR+)
router.get('/employee/:employeeId', requirePermission('asset', 'read'), (req, res, next) =>
  assetController.getEmployeeAssets(req, res, next)
);

// Return asset assignment
router.patch('/assignments/:id/return', requirePermission('asset', 'manage'), (req, res, next) =>
  assetController.returnAsset(req, res, next)
);

// Asset CRUD
router.get('/', requirePermission('asset', 'read'), (req, res, next) =>
  assetController.list(req, res, next)
);

router.get('/:id', requirePermission('asset', 'read'), (req, res, next) =>
  assetController.getById(req, res, next)
);

router.post('/', requirePermission('asset', 'create'), (req, res, next) =>
  assetController.create(req, res, next)
);

router.patch('/:id', requirePermission('asset', 'update'), (req, res, next) =>
  assetController.update(req, res, next)
);

router.post('/:id/assign', requirePermission('asset', 'manage'), (req, res, next) =>
  assetController.assign(req, res, next)
);

router.get('/:id/assignments', requirePermission('asset', 'read'), (req, res, next) =>
  assetController.getAssignments(req, res, next)
);

export { router as assetRouter };
