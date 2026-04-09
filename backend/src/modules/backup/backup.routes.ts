import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { backupController } from './backup.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { storageService, StorageFolder } from '../../services/storage.service.js';

const router = Router();

// Multer config for restore-upload (temp storage, validated before use)
const restoreUploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = storageService.getAbsoluteDir('tmp');
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ts = Date.now();
    cb(null, `restore-${ts}${path.extname(file.originalname)}`);
  },
});

const restoreUpload = multer({
  storage: restoreUploadStorage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB max restore file
  fileFilter: (_req, file, cb) => {
    const allowed = ['.gz', '.sql'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .sql.gz or .sql backup files are accepted'));
    }
  },
});

// All backup routes require authentication + SUPER_ADMIN role
router.use(authenticate);
router.use(authorize('SUPER_ADMIN'));

router.get('/', (req, res, next) => backupController.listBackups(req, res, next));
router.get('/stats', (req, res, next) => backupController.getStats(req, res, next));
router.post('/', (req, res, next) => backupController.createBackup(req, res, next));
router.get('/:id/download', (req, res, next) => backupController.downloadBackup(req, res, next));
router.post('/:id/restore', (req, res, next) => backupController.restoreBackup(req, res, next));
router.post('/restore/upload', restoreUpload.single('backup'), (req, res, next) => backupController.restoreFromUpload(req, res, next));
router.delete('/:id', (req, res, next) => backupController.deleteBackup(req, res, next));

export { router as backupRouter };
