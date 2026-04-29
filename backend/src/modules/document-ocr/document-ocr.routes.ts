import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { documentOcrController } from './document-ocr.controller.js';

const router = Router();
router.use(authenticate);
router.use(authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR));

// ── Per-document in-memory rate limiters ──────────────────────────────────────
// Prevents HR from burning API credits by repeatedly re-triggering OCR on the
// same document. Keys are documentId strings; values are last-triggered timestamps.
// The Map is bounded by eviction once it exceeds 5 000 entries (low-traffic HR system).
const ocrTriggerTracker = new Map<string, number>();
const deepRecheckTracker = new Map<string, number>();
const bulkTriggerTracker = new Map<string, number>();

function evictOldEntries(map: Map<string, number>, maxSize: number, ttlMs: number) {
  if (map.size <= maxSize) return;
  const cutoff = Date.now() - ttlMs;
  for (const [k, v] of map) {
    if (v < cutoff) map.delete(k);
    if (map.size <= maxSize) break;
  }
}

function ocrRateLimit(cooldownMs: number, tracker: Map<string, number>, keyFn: (req: Request) => string) {
  return (req: Request, res: Response, next: NextFunction) => {
    evictOldEntries(tracker, 5_000, cooldownMs * 10);
    const key = keyFn(req);
    const last = tracker.get(key) || 0;
    const elapsed = Date.now() - last;
    if (elapsed < cooldownMs) {
      const waitSec = Math.ceil((cooldownMs - elapsed) / 1000);
      res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: `Please wait ${waitSec}s before re-triggering OCR for this document.` },
      });
      return;
    }
    tracker.set(key, Date.now());
    next();
  };
}
// ─────────────────────────────────────────────────────────────────────────────

// Trigger OCR for a document (max once per 3 minutes per document)
router.post('/:id/ocr',
  ocrRateLimit(3 * 60_000, ocrTriggerTracker, (r) => r.params.id),
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

// Bulk-trigger OCR for all documents of an employee (max once per 30 minutes per employee)
router.post('/ocr/employee/:employeeId/trigger-all',
  ocrRateLimit(30 * 60_000, bulkTriggerTracker, (r) => r.params.employeeId),
  (req, res, next) => documentOcrController.triggerAllForEmployee(req, res, next),
);

// Get all OCR summaries for an employee
router.get('/ocr/employee/:employeeId', (req, res, next) =>
  documentOcrController.getEmployeeSummary(req, res, next),
);

// Deep Re-check: reprocess with gpt-4.1 (max once per 10 minutes per document)
router.post('/:id/ocr/deep-recheck',
  ocrRateLimit(10 * 60_000, deepRecheckTracker, (r) => r.params.id),
  (req, res, next) => documentOcrController.deepRecheck(req, res, next),
);

export { router as documentOcrRouter };
