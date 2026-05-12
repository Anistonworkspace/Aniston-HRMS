import { createServer } from 'http';
import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { initSocketServer } from './sockets/index.js';
import { startEmailWorker } from './jobs/workers/email.worker.js';
import { startNotificationWorker } from './jobs/workers/notification.worker.js';
import { startAttendanceCronWorker } from './jobs/workers/attendance-cron.worker.js';
import { startPayrollWorker } from './jobs/workers/payroll.worker.js';
import { startBackupWorker } from './jobs/workers/backup.worker.js';
import { startLeaveCarryForwardWorker } from './jobs/workers/leave-carryforward.worker.js';
import { startActivityRetentionWorker } from './jobs/workers/activity-retention.worker.js';
import { leaveCarryForwardQueue } from './jobs/queues.js';
import { whatsAppService } from './modules/whatsapp/whatsapp.service.js';
import { initDefaultLeaveSettings } from './lib/dbInit.js';

const server = createServer(app);

/**
 * P1-05: Leave carry-forward catch-up mechanism.
 * If the server/worker was down on April 1, this queues a catch-up job on next
 * startup during the April 1–5 window, provided the Redis flag confirms it
 * hasn't already run this year.
 */
async function checkLeaveCarryForwardCatchUp() {
  try {
    const now = new Date();
    const month = now.getMonth() + 1; // 1-indexed
    const day = now.getDate();
    // Only act within the April 1–5 catch-up window (Indian FY start)
    if (month === 4 && day >= 1 && day <= 5) {
      const yearKey = `leave:carryforward:ran:${now.getFullYear()}`;
      const alreadyRan = await redis.get(yearKey);
      if (!alreadyRan) {
        logger.warn('[LeaveCarryForward] Catch-up triggered on startup — carry-forward may have been missed');
        await leaveCarryForwardQueue.add(
          'carry-forward-catchup',
          { triggeredBy: 'startup-catchup', year: now.getFullYear() },
          { priority: 1 }
        );
        logger.info(`[LeaveCarryForward] Catch-up job enqueued for FY ${now.getFullYear()}`);
      } else {
        logger.info('[LeaveCarryForward] Carry-forward already ran this year — no catch-up needed');
      }
    }
  } catch (err) {
    logger.warn('[LeaveCarryForward] Startup catch-up check failed:', err);
  }
}

async function main() {
  try {
    // Test database connection
    await prisma.$connect();
    logger.info('✅ Database connected');

    // Fix any stale default leave settings (SL/EL must be same-day)
    await initDefaultLeaveSettings();

    // Recover KYC gates that were stuck in PROCESSING before the last shutdown/crash.
    // Runs deferred so it doesn't block the server from accepting requests.
    setTimeout(async () => {
      try {
        const { recoverStaleProcessingKyc } = await import('./services/kyc-recovery.service.js');
        await recoverStaleProcessingKyc();
      } catch (err: any) {
        logger.warn('[KYC Recovery] Startup recovery encountered an error:', err?.message);
      }
    }, 5_000);

    // Enforce Cancelled Cheque requirement: flag all VERIFIED employees who haven't uploaded one.
    // Idempotent — only acts on VERIFIED gates where CANCELLED_CHEQUE is missing; safe on every restart.
    setTimeout(async () => {
      try {
        const { documentGateService } = await import('./modules/onboarding/document-gate.service.js');
        const result = await documentGateService.enforceCancelledChequeRequirement();
        if (result.enforced > 0) {
          logger.info(`[Startup] Cancelled Cheque enforcement: ${result.enforced} employees flagged for re-upload, ${result.skipped} already compliant`);
        }
      } catch (err: any) {
        logger.warn('[Startup] Cancelled Cheque enforcement failed:', err?.message);
      }
    }, 15_000);

    // Initialize Socket.io
    initSocketServer(server);

    // Start BullMQ workers
    startEmailWorker();
    startNotificationWorker();
    // Resume worker auto-starts on import
    await import('./jobs/workers/resume.worker.js');
    logger.info('✅ Resume worker started');
    // Document OCR worker
    await import('./jobs/workers/document-ocr.worker.js');
    logger.info('✅ Document OCR worker started');
    await import('./jobs/workers/document-digest.worker.js');
    logger.info('✅ Document digest worker started');
    // Payroll worker (process payroll runs + bulk email slips)
    startPayrollWorker();
    // Attendance cron worker (auto-close stale + auto-mark absent)
    startAttendanceCronWorker();
    // Database backup cron worker (scheduled every 2 days)
    startBackupWorker();
    logger.info('✅ Database backup worker started');
    // Leave carry-forward cron worker (runs April 1 — Indian FY start)
    startLeaveCarryForwardWorker();
    // Catch-up: if server was down on April 1, queue carry-forward now (April 1–5 window)
    await checkLeaveCarryForwardCatchUp();
    // Activity data retention worker (daily purge — default 3-day window)
    startActivityRetentionWorker();

    server.listen(env.PORT, () => {
      logger.info(`🚀 Aniston HRMS API running on port ${env.PORT}`);
      logger.info(`   Environment: ${env.NODE_ENV}`);
      logger.info(`   Frontend URL: ${env.FRONTEND_URL}`);
      logger.info(`   Health check: ${env.API_URL}/api/health`);

      // Signal PM2 that the app is ready (enables zero-downtime restarts with wait_ready: true)
      if (process.send) {
        process.send('ready');
      }

      // Auto-reconnect WhatsApp in background (non-blocking)
      whatsAppService.autoReconnect().catch(() => {});
    });
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown — destroy WhatsApp client (preserves session) before closing
async function shutdown(signal: string) {
  logger.info(`[Server] ${signal} received. Shutting down gracefully...`);

  // Force exit after 10 seconds (matches kill_timeout in ecosystem.config.cjs)
  const forceExit = setTimeout(() => {
    logger.warn('[Server] Force shutdown after timeout');
    process.exit(1);
  }, 10000);
  // Allow the process to exit even if the timer is the only thing keeping it alive
  forceExit.unref();

  try {
    await whatsAppService.destroy();
  } catch { /* ignore */ }

  server.close(async () => {
    logger.info('[Server] HTTP server closed');
    await prisma.$disconnect().catch(() => {});
    clearTimeout(forceExit);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main();
