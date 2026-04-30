import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { documentOcrController } from './document-ocr.controller.js';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';

const router = Router();
router.use(authenticate);
router.use(authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR));

// ── Redis-backed rate limiters ────────────────────────────────────────────────
// Uses Redis SET NX EX so limits survive process restarts and work across
// multiple backend replicas (unlike in-memory Maps which are per-process).
// Key format: ocr:rl:<prefix>:<entityId>
// ─────────────────────────────────────────────────────────────────────────────

function ocrRateLimit(
  cooldownMs: number,
  keyPrefix: string,
  keyFn: (req: Request) => string,
  messageFn?: (waitSec: number) => string,
) {
  const ttlSec = Math.ceil(cooldownMs / 1000);
  return async (req: Request, res: Response, next: NextFunction) => {
    const redisKey = `ocr:rl:${keyPrefix}:${keyFn(req)}`;
    try {
      // SET NX EX: sets key only if it does not exist; returns 'OK' on success, null if already set
      const result = await redis.set(redisKey, '1', 'EX', ttlSec, 'NX');
      if (result === null) {
        // Key exists — rate limited; get remaining TTL for accurate wait message
        const ttl = await redis.ttl(redisKey);
        const waitSec = Math.max(1, ttl);
        const message = messageFn
          ? messageFn(waitSec)
          : `Please wait ${waitSec}s before re-triggering OCR for this document.`;
        res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message } });
        return;
      }
    } catch (err: any) {
      // Redis unavailable — fail open (allow request) so OCR still works without Redis
      logger.warn(`[OCR rate limit] Redis error, failing open: ${err.message}`);
    }
    next();
  };
}
// ─────────────────────────────────────────────────────────────────────────────

// Trigger OCR for a document (max once per 3 minutes per document)
router.post('/:id/ocr',
  ocrRateLimit(3 * 60_000, 'trigger', (r) => r.params.id),
  (req, res, next) => documentOcrController.triggerOcr(req, res, next),
);

// Get OCR data for a document
router.get('/:id/ocr', (req, res, next) =>
  documentOcrController.getOcr(req, res, next),
);

// Update/edit OCR data
router.patch('/:id/ocr', (req, res, next) =>
  documentOcrController.updateOcr(req, res, next),
);

// Cross-validate all documents for an employee
router.post('/ocr/cross-validate/:employeeId', (req, res, next) =>
  documentOcrController.crossValidate(req, res, next),
);

// Bulk-trigger OCR for all documents of an employee (max once per 5 minutes per employee)
router.post('/ocr/employee/:employeeId/trigger-all',
  ocrRateLimit(
    5 * 60_000,
    'bulk',
    (r) => r.params.employeeId,
    (waitSec) => `Please wait ${waitSec}s before re-triggering bulk OCR for this employee.`,
  ),
  (req, res, next) => documentOcrController.triggerAllForEmployee(req, res, next),
);

// Get all OCR summaries for an employee
router.get('/ocr/employee/:employeeId', (req, res, next) =>
  documentOcrController.getEmployeeSummary(req, res, next),
);

// Deep Re-check: reprocess with gpt-4.1 (max once per 10 minutes per document)
router.post('/:id/ocr/deep-recheck',
  ocrRateLimit(10 * 60_000, 'deeprecheck', (r) => r.params.id),
  (req, res, next) => documentOcrController.deepRecheck(req, res, next),
);

// Reprocess: re-run full OCR pipeline on an existing document (max once per 5 minutes)
router.post('/:id/ocr/reprocess',
  ocrRateLimit(5 * 60_000, 'reprocess', (r) => r.params.id),
  (req, res, next) => documentOcrController.reprocessDocument(req, res, next),
);

export { router as documentOcrRouter };
