import { Router } from 'express';
import { agentController } from './agent.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { uploadAgent } from '../../middleware/upload.middleware.js';
import { rateLimiter } from '../../middleware/rateLimiter.js';
import { Role } from '@aniston/shared';

const router = Router();

// Public: agent pairing verification (no auth — agent uses pairing code)
// Strict rate limit: 10 attempts per 15 min per IP — 32^4 = 1M codes, this caps brute-force at ~960/day
router.post('/pair/verify',
  rateLimiter({ windowMs: 15 * 60_000, max: 10, keyPrefix: 'pair-verify', keyFn: (req) => req.ip || 'unknown' }),
  (req, res, next) => agentController.verifyPairCode(req, res, next)
);

router.use(authenticate);

// Authenticated: generate pairing code — requires HR/ADMIN/SUPER_ADMIN role
// Employees must not be able to generate their own codes (privilege escalation)
router.post('/pair/generate', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) => agentController.generatePairCode(req, res, next));

// Per-employee rate limiter for agent data ingestion (keyed by JWT userId, not IP — agents may share NAT)
const agentDataLimiter = rateLimiter({
  windowMs: 60_000,
  max: 60,
  keyPrefix: 'agent-data',
  keyFn: (req) => `agent-data:${req.user?.userId || req.ip}`,
});

// Agent-only guard — prevents browser sessions from hitting agent data endpoints
const agentOnly = (req: any, res: any, next: any) => {
  if (!req.user?.isAgent) {
    return res.status(403).json({ success: false, error: { code: 'AGENT_REQUIRED', message: 'This endpoint requires an agent token' } });
  }
  next();
};

// Agent endpoints (employee sends data from desktop agent)
router.post('/heartbeat', agentOnly, agentDataLimiter, (req, res, next) => agentController.submitHeartbeat(req, res, next));
// FIX 1a: Lightweight ping — stores last-seen in Redis only, no DB insert
router.post('/ping', agentOnly, agentDataLimiter, (req, res, next) => agentController.ping(req, res, next));
router.post('/screenshot', agentOnly, agentDataLimiter, uploadAgent.single('screenshot'), (req, res, next) => agentController.uploadScreenshot(req, res, next));
router.get('/config', (req, res, next) => agentController.getConfig(req, res, next));
router.get('/config/retention', (req, res, next) => agentController.getRetentionConfig(req, res, next));
router.get('/status', (req, res, next) => agentController.getStatus(req, res, next));

// Admin: check any employee's agent status
router.get(
  '/status/:employeeId',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => agentController.getEmployeeStatus(req, res, next)
);

// Live mode control (SUPER_ADMIN, ADMIN only)
router.post('/live-mode', authorize(Role.SUPER_ADMIN, Role.ADMIN), (req, res, next) => agentController.setLiveMode(req, res, next));
router.get('/live-mode/:employeeId', authorize(Role.SUPER_ADMIN, Role.ADMIN), (req, res, next) => agentController.getLiveMode(req, res, next));

// Download status — check whether installer exe is available
router.get('/download/status', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) => agentController.getDownloadStatus(req, res, next));

// Enterprise Agent Setup (Admin/HR)
const setupAuth = authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR);
router.get('/setup/employees', setupAuth, (req, res, next) => agentController.getAgentSetupList(req, res, next));
router.post('/setup/generate-code', setupAuth, (req, res, next) => agentController.generateSetupCode(req, res, next));
router.post('/setup/regenerate-code', setupAuth, (req, res, next) => agentController.regenerateSetupCode(req, res, next));
// FIX 5: Rate-limit bulk-generate — this is a heavy operation that calls generatePermanentCode
// for every employee without a code. Limit to 5 requests per 15 minutes per user.
const bulkGenerateLimiter = rateLimiter({
  windowMs: 15 * 60_000,
  max: 5,
  keyPrefix: 'bulk-generate',
  keyFn: (req) => `bulk-generate:${req.user?.userId || req.ip}`,
});
router.post('/setup/bulk-generate', setupAuth, bulkGenerateLimiter, (req, res, next) => agentController.bulkGenerateCodes(req, res, next));
router.get('/setup/code-history/:employeeId', setupAuth, (req, res, next) => agentController.getCodeHistory(req, res, next));
router.delete('/setup/code-history/:historyId', setupAuth, (req, res, next) => agentController.deleteHistoryCode(req, res, next));

// HR/Admin view endpoints

// Bug #9: Bulk summary — one query replaces N per-employee queries from EmployeeRow list
// IMPORTANT: these static-segment routes must come before /:employeeId/:date to avoid path collision
router.get(
  '/activity/bulk-summary',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => agentController.getActivityBulkSummary(req, res, next)
);

// Excel export — must come before /:employeeId/:date to avoid route shadowing
router.get(
  '/activity/export/:employeeId/:date',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => agentController.exportActivity(req, res, next)
);

router.get(
  '/activity/:employeeId/:date',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => agentController.getActivityLogs(req, res, next)
);

router.get(
  '/screenshots/:employeeId/:date',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => agentController.getScreenshots(req, res, next)
);

// Delete a single screenshot by ID (admin only — must come after the /:employeeId/:date route)
router.delete(
  '/screenshots/:screenshotId',
  authorize(Role.SUPER_ADMIN, Role.ADMIN),
  (req, res, next) => agentController.deleteScreenshot(req, res, next)
);

// Admin: set screenshot interval for an employee
router.post('/screenshot-interval', authorize(Role.SUPER_ADMIN, Role.ADMIN), (req, res, next) => agentController.setScreenshotInterval(req, res, next));
router.get('/screenshot-interval/:employeeId', authorize(Role.SUPER_ADMIN, Role.ADMIN), (req, res, next) => agentController.getScreenshotInterval(req, res, next));

// Admin: delete all activity data for a specific date
router.delete('/activity/:employeeId/:date', authorize(Role.SUPER_ADMIN, Role.ADMIN), (req, res, next) => agentController.deleteActivityByDate(req, res, next));

// FIX 7: Employee productivity report over a date range
// GET /api/agent/report/:employeeId?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get(
  '/report/:employeeId',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => agentController.getReport(req, res, next)
);

export { router as agentRouter };
