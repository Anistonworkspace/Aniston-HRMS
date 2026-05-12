---
name: observability-and-anomaly-detection
description: "Skill for observability analysis: structured logging, correlation IDs, health checks, cron monitoring, GPS anomaly detection, crash visibility, production triage"
type: skill
---

# Observability & Anomaly Detection Skill — Aniston HRMS

## When to Use
Use when asked to:
- Add structured logging to a module
- Implement health check improvements
- Set up GPS anomaly detection
- Debug production issues
- Add cron failure alerts

## Structured Logging Implementation

### Logger Setup (`backend/src/lib/logger.ts`)
```typescript
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'aniston-hrms' },
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: {
    paths: ['*.password', '*.aadhaar', '*.pan', '*.bankAccount', '*.token'],
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
```

### Correlation ID Middleware
```typescript
// backend/src/middleware/correlationId.middleware.ts
import { v4 as uuidv4 } from 'uuid';

export const correlationIdMiddleware = (req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || uuidv4();
  res.setHeader('x-correlation-id', req.correlationId);
  next();
};

// Usage in any controller/service:
logger.info({
  correlationId: req.correlationId,
  organizationId: req.user?.organizationId,
  userId: req.user?.id,
  module: 'leave',
  action: 'approve',
  resourceId: leaveId,
  message: 'Leave request approved',
});
```

### Service-Level Audit Logging
```typescript
// Always log state transitions
async approveLeave(id: string, approverId: string, employeeId: string) {
  const before = await prisma.leaveRequest.findUnique({ where: { id } });
  
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.leaveRequest.update({ where: { id }, data: { status: 'APPROVED' } });
    await tx.leaveBalance.update({ /* deduct */ });
    return updated;
  });
  
  // Structured audit log
  await auditLogger.log({
    action: 'LEAVE_APPROVED',
    actorId: approverId,
    organizationId: result.organizationId,
    targetId: id,
    targetType: 'LeaveRequest',
    before: { status: before?.status },
    after: { status: 'APPROVED' },
  });
  
  return result;
}
```

## Health Check Implementation

### Comprehensive Health Endpoint
```typescript
// backend/src/modules/health/health.controller.ts
export const healthCheck = async (req, res) => {
  const checks = await Promise.allSettled([
    checkDatabase(),
    checkRedis(),
    checkBullMq(),
    checkAiService(),
    checkDiskSpace(),
  ]);
  
  const results = {
    database: formatCheck(checks[0]),
    redis: formatCheck(checks[1]),
    bullmq: formatCheck(checks[2]),
    aiService: formatCheck(checks[3]),
    diskSpace: formatCheck(checks[4]),
  };
  
  const allOk = Object.values(results).every(c => c.status === 'ok');
  const anyDown = Object.values(results).some(c => c.status === 'down');
  
  const overallStatus = anyDown ? 'down' : (allOk ? 'ok' : 'degraded');
  
  return res.status(anyDown ? 503 : 200).json({
    success: true,
    data: {
      status: overallStatus,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks: results,
    }
  });
};

async function checkDatabase() {
  const start = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  return { status: 'ok', latency_ms: Date.now() - start };
}

async function checkRedis() {
  const start = Date.now();
  await redis.ping();
  return { status: 'ok', latency_ms: Date.now() - start };
}
```

## GPS Anomaly Detection

### Backend Detection Service
```typescript
// backend/src/modules/attendance/gps-anomaly.service.ts
export async function detectDailyAnomalies(organizationId: string, date: Date) {
  const fieldEmployees = await prisma.employee.findMany({
    where: { organizationId, attendanceMode: 'FIELD_SALES', deletedAt: null }
  });
  
  const anomalies = [];
  
  for (const employee of fieldEmployees) {
    const attendance = await prisma.attendanceRecord.findFirst({
      where: { employeeId: employee.id, date }
    });
    
    if (!attendance || attendance.checkInTime === null) continue;
    
    const gpsPoints = await prisma.locationVisit.findMany({
      where: { 
        employeeId: employee.id,
        createdAt: { gte: attendance.checkInTime, lte: attendance.checkOutTime || new Date() }
      },
      orderBy: { createdAt: 'asc' }
    });
    
    // Detect gaps > 20 minutes
    for (let i = 1; i < gpsPoints.length; i++) {
      const gapMs = gpsPoints[i].createdAt.getTime() - gpsPoints[i-1].createdAt.getTime();
      const gapMinutes = gapMs / 1000 / 60;
      
      if (gapMinutes > 20) {
        anomalies.push({
          employeeId: employee.id,
          employeeName: employee.name,
          date,
          gapStart: gpsPoints[i-1].createdAt,
          gapEnd: gpsPoints[i].createdAt,
          gapMinutes: Math.round(gapMinutes),
          type: 'GPS_TRAIL_GAP',
        });
      }
    }
  }
  
  // Store anomalies and notify HR
  if (anomalies.length > 0) {
    await notificationQueue.add('gps-anomalies', { organizationId, anomalies, date });
    logger.warn({ organizationId, anomalyCount: anomalies.length, message: 'GPS trail anomalies detected' });
  }
  
  return anomalies;
}
```

## BullMQ Failure Handler
```typescript
// backend/src/jobs/workers/emailWorker.ts
emailWorker.on('failed', (job, error) => {
  logger.error({
    module: 'email-worker',
    jobId: job?.id,
    jobName: job?.name,
    error: error.message,
    attempts: job?.attemptsMade,
    maxAttempts: job?.opts.attempts,
    message: 'Email job failed',
  });
  
  // If this is a final failure (no more retries):
  if (job && job.attemptsMade >= (job.opts.attempts || 3)) {
    // Alert admin (via a separate direct-email mechanism, not the failed queue)
    adminAlertService.sendAlert(`Email job permanently failed: ${job.name}`);
  }
});
```

## Production Triage Decision Tree
```
API errors spiking?
├── Check PM2: pm2 status — are workers running?
├── Check logs: pm2 logs --lines 100 | grep ERROR
├── Check DB: can you connect? SELECT 1?
└── Check Redis: redis-cli PING?

GPS not tracking?
├── Check foreground service running on device
├── Check OEM battery optimization
├── Check GPS gap logs in database
└── Check if Force Stop was used (gap = immediate, no gradual degradation)

Login failures?
├── Check auth logs for JWT_SECRET mismatch
├── Check rate limiter (429 Too Many Requests?)
├── Check DB for user record
└── Check session revocation flag

Email not sending?
├── Check BullMQ email queue: pending count?
├── Check SMTP credentials valid
├── Check emailWorker logs
└── Check BullMQ failed queue for stuck jobs
```