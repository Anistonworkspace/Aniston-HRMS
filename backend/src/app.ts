import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
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

const app = express();

// Security
app.use(helmet());
app.use(cors({
  origin: env.FRONTEND_URL,
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

// Rate limiting
app.use('/api/auth', rateLimiter({ windowMs: 15 * 60 * 1000, max: 50, keyPrefix: 'rl:auth' }));
app.use('/api', rateLimiter({ windowMs: 60 * 1000, max: 100, keyPrefix: 'rl:api' }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      service: 'Aniston HRMS API',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    },
  });
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/employees', employeeRouter);
app.use('/api/departments', departmentRouter);
app.use('/api/designations', designationRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/leaves', leaveRouter);
app.use('/api/payroll', payrollRouter);
app.use('/api/recruitment', recruitmentRouter);
app.use('/api/onboarding', onboardingRouter);

// Static file serving for uploads (dev only)
app.use('/uploads', express.static('uploads'));

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
