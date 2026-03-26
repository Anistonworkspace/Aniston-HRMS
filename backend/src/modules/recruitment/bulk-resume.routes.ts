import { Router } from 'express';
import { bulkResumeController } from './bulk-resume.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Ensure upload dir exists
const uploadDir = path.join(process.cwd(), 'uploads', 'resumes', 'bulk');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `resume-${uniqueSuffix}${ext}`);
  },
});

const uploadResumes = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and DOC/DOCX files are allowed'));
    }
  },
}).array('resumes', 50); // max 50 files

const router = Router();

router.use(authenticate);

router.post('/upload', requirePermission('recruitment', 'create'), (req, res, next) => {
  uploadResumes(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: { message: err.message } });
    }
    bulkResumeController.upload(req, res, next);
  });
});

router.get('/', requirePermission('recruitment', 'read'), (req, res, next) =>
  bulkResumeController.list(req, res, next)
);

router.get('/:uploadId', requirePermission('recruitment', 'read'), (req, res, next) =>
  bulkResumeController.getUpload(req, res, next)
);

router.post('/:itemId/create-application', requirePermission('recruitment', 'create'), (req, res, next) =>
  bulkResumeController.createApplication(req, res, next)
);

router.delete('/:uploadId', requirePermission('recruitment', 'delete'), (req, res, next) =>
  bulkResumeController.deleteUpload(req, res, next)
);

router.delete('/items/:itemId', requirePermission('recruitment', 'delete'), (req, res, next) =>
  bulkResumeController.deleteItem(req, res, next)
);

export { router as bulkResumeRouter };
