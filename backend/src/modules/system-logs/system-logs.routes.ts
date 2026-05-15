import { Router } from 'express';
import { systemLogsController } from './system-logs.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';

const router = Router();

// All system-log routes require authentication + SUPER_ADMIN role
router.use(authenticate);
router.use(authorize(Role.SUPER_ADMIN));

router.get('/',            (req, res, next) => systemLogsController.getLogs(req, res, next));
router.delete('/',         (req, res, next) => systemLogsController.deleteLogs(req, res, next));
router.get('/summary',     (req, res, next) => systemLogsController.getSummary(req, res, next));
router.get('/ai-service',  (req, res, next) => systemLogsController.getAiServiceLogs(req, res, next));
router.get('/download',    (req, res, next) => systemLogsController.downloadLogs(req, res, next));
router.get('/ai-health',   (req, res, next) => systemLogsController.getAiServiceHealth(req, res, next));

export { router as systemLogsRouter };
