import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { backupController } from './backup.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { storageService } from '../../services/storage.service.js';
import { Role } from '@aniston/shared';

const router = Router();

// ── Multer config for restore uploads (temp storage, validated before use) ──

function makeTempUpload(maxSizeMb: number, ...allowedExts: string[]) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, storageService.getAbsoluteDir('tmp')),
      filename: (_req, file, cb) => cb(null, `restore-${Date.now()}${path.extname(file.originalname)}`),
    }),
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (allowedExts.includes(ext)) cb(null, true);
      else cb(new Error(`Only ${allowedExts.join(' / ')} files are accepted`));
    },
  });
}

// DB restore: .sql.gz files (up to 500 MB)
const dbRestoreUpload = makeTempUpload(500, '.gz', '.sql');

// Files restore: .tar.gz files (up to 2 GB)
const filesRestoreUpload = makeTempUpload(2048, '.gz', '.tar');

// ── All backup routes require SUPER_ADMIN ────────────────────────────────────
router.use(authenticate);
router.use(authorize(Role.SUPER_ADMIN));

// Availability pre-flight check (no side effects — safe to call before backup)
router.get('/check', (req, res, next) => backupController.checkAvailability(req, res, next));

// Stats summary
router.get('/stats', (req, res, next) => backupController.getStats(req, res, next));

// List backups (supports ?category=DATABASE|FILES)
router.get('/', (req, res, next) => backupController.listBackups(req, res, next));

// Create backup — body: { category: 'DATABASE' | 'FILES' }
router.post('/', (req, res, next) => backupController.createBackup(req, res, next));

// Download backup file
router.get('/:id/download', (req, res, next) => backupController.downloadBackup(req, res, next));

// Restore DATABASE backup from stored file
router.post('/:id/restore', (req, res, next) => backupController.restoreBackup(req, res, next));

// Restore FILES backup from stored file
router.post('/:id/restore-files', (req, res, next) => backupController.restoreFilesBackup(req, res, next));

// Restore DATABASE from uploaded .sql.gz
router.post('/restore/upload', dbRestoreUpload.single('backup'), (req, res, next) => backupController.restoreFromUpload(req, res, next));

// Restore FILES from uploaded .tar.gz
router.post('/restore-files/upload', filesRestoreUpload.single('backup'), (req, res, next) => backupController.restoreFilesFromUpload(req, res, next));

// Delete backup
router.delete('/:id', (req, res, next) => backupController.deleteBackup(req, res, next));

export { router as backupRouter };
