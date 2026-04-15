import { Router } from 'express';
import { systemLogsController } from './system-logs.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';

const router = Router();

// All system-log routes require authentication + SUPER_ADMIN role
router.use(authenticate);
router.use(authorize('SUPER_ADMIN'));

router.get('/',            (req, res, next) => systemLogsController.getLogs(req, res, next));
router.get('/summary',     (req, res, next) => systemLogsController.getSummary(req, res, next));
router.get('/ai-service',  (req, res, next) => systemLogsController.getAiServiceLogs(req, res, next));
router.get('/download',    (req, res, next) => systemLogsController.downloadLogs(req, res, next));

export { router as systemLogsRouter };
