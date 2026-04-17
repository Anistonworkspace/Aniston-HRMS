import { createServer } from 'http';
import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { initSocketServer } from './sockets/index.js';
import { startEmailWorker } from './jobs/workers/email.worker.js';
import { startNotificationWorker } from './jobs/workers/notification.worker.js';
import { startAttendanceCronWorker } from './jobs/workers/attendance-cron.worker.js';
import { startPayrollWorker } from './jobs/workers/payroll.worker.js';
import { startBackupWorker } from './jobs/workers/backup.worker.js';
import { startLeaveCarryForwardWorker } from './jobs/workers/leave-carryforward.worker.js';
import { whatsAppService } from './modules/whatsapp/whatsapp.service.js';
import { initDefaultLeaveSettings } from './lib/dbInit.js';

const server = createServer(app);

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

    server.listen(env.PORT, () => {
      logger.info(`🚀 Aniston HRMS API running on port ${env.PORT}`);
      logger.info(`   Environment: ${env.NODE_ENV}`);
      logger.info(`   Frontend URL: ${env.FRONTEND_URL}`);
      logger.info(`   Health check: ${env.API_URL}/api/health`);

      // Auto-reconnect WhatsApp in background (non-blocking)
      whatsAppService.autoReconnect().catch(() => {});
    });
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown — destroy WhatsApp client (preserves session) before closing
async function shutdown() {
  logger.info('Shutting down gracefully...');
  try {
    await whatsAppService.destroy();
  } catch { /* ignore */ }
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main();
