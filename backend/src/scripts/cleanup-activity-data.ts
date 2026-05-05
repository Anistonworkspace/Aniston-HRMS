/**
 * CLI script: manual activity data retention cleanup
 *
 * Usage:
 *   npm run activity:cleanup                 # Use ACTIVITY_RETENTION_DAYS from .env (default: 3)
 *   ACTIVITY_RETENTION_DAYS=7 npm run activity:cleanup
 *
 * Safe to run while the server is running — uses the same Prisma + StorageService
 * as the background worker, but does NOT acquire the Redis lock (manual runs are
 * assumed to be intentional and single-instance).
 */
import '../config/env.js'; // Load env first
import { runRetentionNow } from '../jobs/workers/activity-retention.worker.js';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';

async function main() {
  console.log(`[Cleanup] Activity data retention starting...`);
  console.log(`[Cleanup] Retention window: ${env.ACTIVITY_RETENTION_DAYS} day(s)`);
  console.log(`[Cleanup] Cutoff: entries older than ${new Date(Date.now() - env.ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()}`);

  const { logsDeleted, screenshotsDeleted, filesDeleted } = await runRetentionNow();

  console.log(`[Cleanup] ✅ Done`);
  console.log(`[Cleanup]   Activity logs deleted : ${logsDeleted}`);
  console.log(`[Cleanup]   Screenshots deleted   : ${screenshotsDeleted}`);
  console.log(`[Cleanup]   Files deleted on disk : ${filesDeleted}`);

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('[Cleanup] ❌ Fatal error:', err);
  prisma.$disconnect().finally(() => process.exit(1));
});
