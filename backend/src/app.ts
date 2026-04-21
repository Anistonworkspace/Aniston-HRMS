import path from 'path';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── BigInt JSON serialization fix ──────────────────────────────────────────────
// Prisma returns BigInt for schema fields declared as BigInt (e.g. sizeBytes).
// JSON.stringify throws "Do not know how to serialize a BigInt" by default.
// Patching toJSON on BigInt.prototype is the Node.js standard workaround and
// ensures res.json() never throws on BigInt values from Prisma queries.
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};
// ──────────────────────────────────────────────────────────────────────────────
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { swaggerSpec } from './config/swagger.js';
import swaggerUi from 'swagger-ui-express';
import { errorHandler } from './middleware/errorHandler.js';
import { authenticate } from './middleware/auth.middleware.js';
import { requestIdMiddleware, requestLogger } from './middleware/requestLogger.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { employeeRouter } from './modules/employee/employee.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { departmentRouter } from './modules/department/department.routes.js';
import { designationRouter } from './modules/designation/designation.routes.js';
import { attendanceRouter } from './modules/attendance/attendance.routes.js';
import { leaveRouter } from './modules/leave/leave.routes.js';
import { payrollRouter } from './modules/payroll/payroll.routes.js';
import { salaryTemplateRouter } from './modules/salary-template/salary-template.routes.js';
import { recruitmentRouter } from './modules/recruitment/recruitment.routes.js';
import { onboardingRouter } from './modules/onboarding/onboarding.routes.js';
import { performanceRouter } from './modules/performance/performance.routes.js';
import { policyRouter } from './modules/policy/policy.routes.js';
import { announcementRouter } from './modules/announcement/announcement.routes.js';
import { reportRouter } from './modules/report/report.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { helpdeskRouter } from './modules/helpdesk/helpdesk.routes.js';
import { walkInRouter } from './modules/walkIn/walkIn.routes.js';
import { shiftRouter } from './modules/shift/shift.routes.js';
import { agentRouter } from './modules/agent/agent.routes.js';
import { documentRouter } from './modules/document/document.routes.js';
import { holidayRouter } from './modules/holiday/holiday.routes.js';
import { assetRouter } from './modules/asset/asset.routes.js';
import { internRouter } from './modules/intern/intern.routes.js';
import { bulkResumeRouter } from './modules/recruitment/bulk-resume.routes.js';
import { whatsAppRouter } from './modules/whatsapp/whatsapp.routes.js';
import { aiConfigRouter } from './modules/ai-config/ai-config.routes.js';
import { invitationRouter } from './modules/invitation/invitation.routes.js';
import { aiAssistantRouter } from './modules/ai-assistant/ai-assistant.routes.js';
import { publicApplyRouter } from './modules/public-apply/public-apply.routes.js';
import { exitAccessRouter } from './modules/exit-access/exit-access.routes.js';
import { employeePermissionsRouter } from './modules/employee-permissions/employee-permissions.routes.js';
import { documentOcrRouter } from './modules/document-ocr/document-ocr.routes.js';
import { taskIntegrationRouter } from './modules/task-integration/task-integration.routes.js';
import { componentMasterRouter } from './modules/component-master/component-master.routes.js';
import { payrollAdjustmentRouter } from './modules/payroll-adjustment/payroll-adjustment.routes.js';
import { letterRouter } from './modules/letter/letter.routes.js';
import { brandingRouter } from './modules/branding/branding.routes.js';
import { backupRouter } from './modules/backup/backup.routes.js';
import { employeeDeletionRouter } from './modules/employee-deletion/employee-deletion.routes.js';
import { payrollDeletionRouter } from './modules/payroll-deletion/payroll-deletion.routes.js';
import { systemLogsRouter } from './modules/system-logs/system-logs.routes.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { getEmailWorkerHealth } from './jobs/workers/email.worker.js';
import { storageService } from './services/storage.service.js';

const app = express();

// Trust reverse proxy (Nginx) — required for accurate IP-based rate limiting
app.set('trust proxy', 1);

// Security
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        // Swagger UI loads its bundles from the same origin (express serves them)
        "'unsafe-inline'",
      ],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'", "data:"],
      connectSrc: [
        "'self'",
        // Socket.io WebSocket upgrade
        "ws://localhost:4000",
        "wss://hr.anistonav.com",
      ],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      ...(env.NODE_ENV === 'production' ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  hsts: env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  frameguard: { action: 'deny' },
  crossOriginEmbedderPolicy: false, // Allow embedding uploads in other origins
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow CDN-style file access
}));
app.use(cors({
  origin: env.NODE_ENV === 'development'
    ? [env.FRONTEND_URL, 'http://localhost:5173', 'http://localhost:5174']
    : [env.FRONTEND_URL, 'https://hr.anistonav.com'].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
}));

// Prevent caching of all API responses
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  next();
});

// Parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Logging
app.use(requestIdMiddleware);
app.use(requestLogger);

// Rate limiting — stricter limits on public endpoints first
app.use('/api/walk-in/register', rateLimiter({ windowMs: 60 * 1000, max: 5, keyPrefix: 'rl:walkin-reg' }));
app.use('/api/recruitment/apply', rateLimiter({ windowMs: 60 * 1000, max: 10, keyPrefix: 'rl:recruit-apply' }));
app.use('/api/jobs/form', rateLimiter({ windowMs: 60 * 1000, max: 10, keyPrefix: 'rl:public-apply' }));
app.use('/api/invitations/complete', rateLimiter({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'rl:invite-complete' }));
app.use('/api/invitations/validate', rateLimiter({ windowMs: 15 * 60 * 1000, max: 20, keyPrefix: 'rl:invite-validate' }));
app.use('/api/auth/activate', rateLimiter({ windowMs: 15 * 60 * 1000, max: 20, keyPrefix: 'rl:activation' }));
// Dedicated stricter limits for credential endpoints — must come before the general /api/auth limit
app.use('/api/auth/login', rateLimiter({ windowMs: 15 * 60 * 1000, max: 30, keyPrefix: 'rl:login' }));
app.use('/api/auth/forgot-password', rateLimiter({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: 'rl:forgot-pwd' }));
app.use('/api/auth/reset-password', rateLimiter({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: 'rl:reset-pwd' }));
// MFA verify: strict limit to prevent TOTP brute-force (5 attempts per 15 min)
app.use('/api/auth/mfa/verify', rateLimiter({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: 'rl:mfa-verify' }));
app.use('/api/auth', rateLimiter({ windowMs: 15 * 60 * 1000, max: 200, keyPrefix: 'rl:auth' }));
app.use('/api/onboarding/kyc', rateLimiter({ windowMs: 60 * 1000, max: 30, keyPrefix: 'rl:kyc-ops' }));
app.use('/api', rateLimiter({ windowMs: 60 * 1000, max: 100, keyPrefix: 'rl:api' }));

// API Documentation
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'Aniston HRMS API Docs',
  customCss: '.swagger-ui .topbar { display: none }',
}));
app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));

// Health check
app.get('/api/health', async (_req, res) => {
  let dbStatus = 'ok';
  let redisStatus = 'ok';

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = 'down';
  }

  try {
    await redis.ping();
  } catch {
    redisStatus = 'down';
  }

  // Email worker health
  const emailWorker = await getEmailWorkerHealth();

  const overallStatus = dbStatus === 'ok' && redisStatus === 'ok' ? 'ok' : 'degraded';

  res.status(overallStatus === 'ok' ? 200 : 503).json({
    success: overallStatus === 'ok',
    data: {
      status: overallStatus,
      service: 'Aniston HRMS API',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      dependencies: {
        database: dbStatus,
        redis: redisStatus,
        emailWorker: emailWorker.status,
      },
      emailQueue: {
        waiting: emailWorker.waiting,
        active: emailWorker.active,
        completed: emailWorker.completed,
        failed: emailWorker.failed,
      },
    },
  });
});

// Exit access check middleware (applied globally, self-activating for exiting employees)
import { checkExitAccess, checkEmployeePermissions } from './middleware/auth.middleware.js';

// Routes
app.use('/api/auth', authRouter);

// Apply exit access check globally for all subsequent routes
// Auth routes are exempt (above), exit-access routes handle their own auth
app.use('/api', checkExitAccess);
app.use('/api', checkEmployeePermissions);

app.use('/api/employees', employeeRouter);
app.use('/api/departments', departmentRouter);
app.use('/api/designations', designationRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/leaves', leaveRouter);
app.use('/api/payroll', payrollRouter);
app.use('/api/payroll-adjustments', payrollAdjustmentRouter);
app.use('/api/salary-templates', salaryTemplateRouter);
app.use('/api/salary-components', componentMasterRouter);
app.use('/api/recruitment/bulk-resume', bulkResumeRouter);
app.use('/api/recruitment', recruitmentRouter);
app.use('/api/onboarding', onboardingRouter);
app.use('/api/performance', performanceRouter);
app.use('/api/policies', policyRouter);
app.use('/api/announcements', announcementRouter);
app.use('/api/reports', reportRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/helpdesk', helpdeskRouter);
app.use('/api/walk-in', walkInRouter);
app.use('/api/workforce', shiftRouter);
app.use('/api/agent', agentRouter);
app.use('/api/documents', documentRouter);
app.use('/api/documents', documentOcrRouter);
app.use('/api/holidays', holidayRouter);
app.use('/api/assets', assetRouter);
app.use('/api/interns', internRouter);
app.use('/api/whatsapp', whatsAppRouter);
app.use('/api/settings/ai-config', aiConfigRouter);
app.use('/api/invitations', invitationRouter);
app.use('/api/ai-assistant', aiAssistantRouter);
app.use('/api/jobs', publicApplyRouter);
app.use('/api/exit-access', exitAccessRouter);
app.use('/api/employee-permissions', employeePermissionsRouter);
app.use('/api/task-integration', taskIntegrationRouter);
app.use('/api/letters', letterRouter);
app.use('/api/branding', brandingRouter);
app.use('/api/settings/backup', backupRouter);
app.use('/api/settings/system-logs', systemLogsRouter);
app.use('/api/employee-deletion-requests', employeeDeletionRouter);
app.use('/api/payroll-deletion-requests', payrollDeletionRouter);

// ── Native app downloads — APK served directly ────────────────────────────────
// Place aniston-hrms.apk in backend/downloads/ and it becomes available at
// https://hr.anistonav.com/downloads/aniston-hrms.apk
const downloadsRoot = path.resolve(__dirname, '../../downloads');
app.use('/downloads', express.static(downloadsRoot));

// ── App update bundles — OTA zip files for Capacitor ─────────────────────────
// Place bundle-X.X.X.zip in backend/app-updates/ and update manifest.json.
// AppUpdateGuard in the native app polls /api/app-updates/latest on launch.
const appUpdatesRoot = path.resolve(__dirname, '../../app-updates');
app.use('/app-updates', express.static(appUpdatesRoot));

// Returns latest version manifest for Capacitor OTA updates.
// manifest.json format: { version, url, mandatory, notes }
app.get('/api/app-updates/latest', (_req, res) => {
  const manifestPath = path.join(appUpdatesRoot, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return res.json({
      success: true,
      data: { version: '1.0.0', url: null, mandatory: false, notes: 'No update available' },
    });
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    res.json({ success: true, data: manifest });
  } catch {
    res.json({
      success: true,
      data: { version: '1.0.0', url: null, mandatory: false, notes: 'No update available' },
    });
  }
});

// Static file serving for uploads — managed through StorageService.
//
// Security model: files are stored under opaque, unguessable paths
// (UUID employee IDs + timestamp-random filenames). Browsers cannot send
// Authorization headers for <img src> or <a href> requests, so applying
// the Bearer-token authenticate middleware here would silently block all
// in-page image rendering and direct downloads. Production nginx already
// serves this directory without passing through Express auth.
//
// API-level auth (JWT-gated document/policy endpoints) protects access to
// the file *paths themselves* — a caller must be authenticated to learn
// which path a file lives at.
const uploadsRoot = storageService.getUploadsRoot();
app.use('/uploads', express.static(uploadsRoot));
app.use('/api/uploads', express.static(uploadsRoot));

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    data: null,
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  });
});

// Error handler
app.use(errorHandler);

export { app };
