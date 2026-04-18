import { Router } from 'express';
import { bulkResumeController } from './bulk-resume.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';
import { uploadBulkResumes } from '../../middleware/upload.middleware.js';

const router = Router();

router.use(authenticate);

router.post('/upload', requirePermission('recruitment', 'create'), (req, res, next) => {
  uploadBulkResumes(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: { message: err.message } });
    }
    bulkResumeController.upload(req, res, next);
  });
});

router.get('/', requirePermission('recruitment', 'read'), (req, res, next) =>
  bulkResumeController.list(req, res, next)
);

router.post('/:itemId/create-application', requirePermission('recruitment', 'create'), (req, res, next) =>
  bulkResumeController.createApplication(req, res, next)
);

router.get('/:uploadId', requirePermission('recruitment', 'read'), (req, res, next) =>
  bulkResumeController.getUpload(req, res, next)
);

router.delete('/items/:itemId', requirePermission('recruitment', 'delete'), (req, res, next) =>
  bulkResumeController.deleteItem(req, res, next)
);

router.delete('/uploads/:uploadId', requirePermission('recruitment', 'delete'), (req, res, next) =>
  bulkResumeController.deleteUpload(req, res, next)
);

export { router as bulkResumeRouter };
