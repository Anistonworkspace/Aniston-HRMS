import { Router } from 'express';
import { brandingController } from './branding.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';
import { uploadBranding } from '../../middleware/upload.middleware.js';

const router = Router();

router.use(authenticate);

// Get branding for current organization
router.get('/', requirePermission('policy', 'read'), (req, res, next) =>
  brandingController.get(req, res, next)
);

// Update branding text fields (company name, address)
router.patch('/', requirePermission('policy', 'create'), (req, res, next) =>
  brandingController.upsert(req, res, next)
);

// Upload logo
router.post('/logo', requirePermission('policy', 'create'), uploadBranding.single('file'), (req, res, next) =>
  brandingController.uploadLogo(req, res, next)
);

// Upload signature
router.post('/signature', requirePermission('policy', 'create'), uploadBranding.single('file'), (req, res, next) =>
  brandingController.uploadSignature(req, res, next)
);

// Upload stamp
router.post('/stamp', requirePermission('policy', 'create'), uploadBranding.single('file'), (req, res, next) =>
  brandingController.uploadStamp(req, res, next)
);

export { router as brandingRouter };
