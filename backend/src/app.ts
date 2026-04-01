import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { swaggerSpec } from './config/swagger.js';
import swaggerUi from 'swagger-ui-express';
import { errorHandler } from './middleware/errorHandler.js';
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
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';

const app = express();

// Security
app.use(helmet());
app.use(cors({
  origin: env.NODE_ENV === 'development'
    ? [env.FRONTEND_URL, 'http://localhost:5173', 'http://localhost:5174']
    : [env.FRONTEND_URL, 'https://hr.anistonav.com'].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
}));

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
app.use('/api/auth/activate', rateLimiter({ windowMs: 15 * 60 * 1000, max: 20, keyPrefix: 'rl:activation' }));
app.use('/api/auth', rateLimiter({ windowMs: 15 * 60 * 1000, max: 200, keyPrefix: 'rl:auth' }));
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
app.use('/api/recruitment/bulk-resume', bulkResumeRouter);
app.use('/api/whatsapp', whatsAppRouter);
app.use('/api/settings/ai-config', aiConfigRouter);
app.use('/api/invitations', invitationRouter);
app.use('/api/ai-assistant', aiAssistantRouter);
app.use('/api/jobs', publicApplyRouter);
app.use('/api/exit-access', exitAccessRouter);
app.use('/api/employee-permissions', employeePermissionsRouter);

// Resolve uploads base — always relative to project root (handles both root + backend/ cwd)
const uploadsBase = process.cwd().replace(/[/\\]backend[/\\]?$/, '');
// Static file serving for uploads (KYC documents, photos, resumes, agent downloads)
// Serve at both /uploads and /api/uploads so nginx proxy and direct access both work
app.use('/uploads', express.static(path.join(uploadsBase, 'uploads')));
app.use('/uploads', express.static(path.join(uploadsBase, 'backend', 'uploads')));
app.use('/api/uploads', express.static(path.join(uploadsBase, 'uploads')));
app.use('/api/uploads', express.static(path.join(uploadsBase, 'backend', 'uploads')));

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
