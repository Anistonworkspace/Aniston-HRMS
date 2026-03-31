import { createServer } from 'http';
import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { initSocketServer } from './sockets/index.js';
import { startEmailWorker } from './jobs/workers/email.worker.js';
import { startNotificationWorker } from './jobs/workers/notification.worker.js';
import { whatsAppService } from './modules/whatsapp/whatsapp.service.js';

const server = createServer(app);

async function main() {
  try {
    // Test database connection
    await prisma.$connect();
    logger.info('✅ Database connected');

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
