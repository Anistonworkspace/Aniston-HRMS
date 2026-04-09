import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { prisma } from '../../lib/prisma.js';
import { storageService, StorageFolder } from '../../services/storage.service.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { logger } from '../../lib/logger.js';
import { NotFoundError, BadRequestError, ForbiddenError } from '../../middleware/errorHandler.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseDatabaseUrl(url: string) {
  const match = url.match(/^postgresql?:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
  if (!match) throw new Error('Could not parse DATABASE_URL');
  const [, user, password, host, port, database] = match;
  return { user, password, host, port, database };
}

function buildBackupFilename(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', 'T').slice(0, 19);
  return `backup_${ts}.sql.gz`;
}

// ─── BackupService ───────────────────────────────────────────────────────────

export class BackupService {

  // ── List ──────────────────────────────────────────────────────────────────

  async listBackups(organizationId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where = { organizationId, deletedAt: null };

    const [backups, total] = await Promise.all([
      prisma.databaseBackup.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.databaseBackup.count({ where }),
    ]);

    // Build summary stats
    const stats = await this.getStats(organizationId);

    return {
      backups,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
      stats,
    };
  }

  async getStats(organizationId: string) {
    const where = { organizationId, deletedAt: null };
    const total = await prisma.databaseBackup.count({ where });

    const latest = await prisma.databaseBackup.findFirst({
      where: { ...where, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
    });

    // Next scheduled: every 2 days from last completed backup
    let nextScheduled: Date | null = null;
    if (latest) {
      nextScheduled = new Date(latest.createdAt.getTime() + 2 * 24 * 60 * 60 * 1000);
    }

    return {
      totalBackups: total,
      lastBackupAt: latest?.createdAt ?? null,
      lastBackupSize: latest?.sizeBytes?.toString() ?? null,
      nextScheduledAt: nextScheduled,
    };
  }

  // ── Create Backup ─────────────────────────────────────────────────────────

  async createBackup(
    organizationId: string,
    type: 'MANUAL' | 'SCHEDULED',
    createdById?: string
  ) {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new BadRequestError('DATABASE_URL is not configured');

    let conn: { user: string; password: string; host: string; port: string; database: string };
    try {
      conn = parseDatabaseUrl(dbUrl);
    } catch {
      throw new BadRequestError('Could not parse DATABASE_URL. Ensure it follows postgresql://user:pass@host:port/db format.');
    }

    const filename = buildBackupFilename();
    const backupDir = storageService.getAbsoluteDir(StorageFolder.BACKUPS);
    const gzPath = path.join(backupDir, filename);
    const relPath = storageService.buildUrl(StorageFolder.BACKUPS, filename);

    // Create DB record first (status=IN_PROGRESS)
    const record = await prisma.databaseBackup.create({
      data: {
        filename,
        filePath: relPath,
        type,
        status: 'IN_PROGRESS',
        organizationId,
        createdById: createdById ?? null,
      },
    });

    try {
      await this.runPgDump(conn, gzPath);

      const stat = fs.statSync(gzPath);

      await prisma.databaseBackup.update({
        where: { id: record.id },
        data: {
          status: 'COMPLETED',
          sizeBytes: BigInt(stat.size),
        },
      });

      if (createdById) {
        await createAuditLog({
          userId: createdById,
          organizationId,
          entity: 'DatabaseBackup',
          entityId: record.id,
          action: 'CREATE',
          newValue: { filename, type, sizeBytes: stat.size },
        });
      }

      logger.info(`[Backup] ✅ Backup completed: ${filename} (${stat.size} bytes)`);

      return await prisma.databaseBackup.findUnique({ where: { id: record.id } });
    } catch (err: any) {
      // Mark failed
      await prisma.databaseBackup.update({
        where: { id: record.id },
        data: { status: 'FAILED', notes: String(err?.message || err).slice(0, 500) },
      });
      // Remove partial file if it exists
      try { if (fs.existsSync(gzPath)) fs.unlinkSync(gzPath); } catch { /* ignore */ }
      logger.error(`[Backup] ❌ Backup failed: ${err.message}`);
      throw new BadRequestError(`Backup failed: ${err.message}`);
    }
  }

  private async runPgDump(
    conn: { user: string; password: string; host: string; port: string; database: string },
    outputGzPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        PGPASSWORD: conn.password,
      };

      const pgDump = spawn(
        'pg_dump',
        [
          '--host', conn.host,
          '--port', conn.port,
          '--username', conn.user,
          '--dbname', conn.database,
          '--format', 'plain',
          '--no-password',
          '--verbose',
        ],
        { env }
      );

      const gzip = createGzip({ level: 6 });
      const output = fs.createWriteStream(outputGzPath);

      pgDump.stdout.pipe(gzip).pipe(output);

      const stderrChunks: Buffer[] = [];
      pgDump.stderr.on('data', (chunk) => stderrChunks.push(chunk));

      pgDump.on('close', (code) => {
        if (code === 0) {
          output.on('finish', () => resolve());
          output.on('error', reject);
        } else {
          const errMsg = Buffer.concat(stderrChunks).toString().slice(0, 500);
          reject(new Error(`pg_dump exited with code ${code}: ${errMsg}`));
        }
      });

      pgDump.on('error', (err) => {
        reject(new Error(`pg_dump spawn failed: ${err.message}. Ensure pg_dump is installed on the server.`));
      });
    });
  }

  // ── Download Backup ───────────────────────────────────────────────────────

  async getBackupForDownload(id: string, organizationId: string) {
    const record = await prisma.databaseBackup.findFirst({
      where: { id, organizationId, deletedAt: null, status: 'COMPLETED' },
    });
    if (!record) throw new NotFoundError('Backup not found or not available for download');

    const absolutePath = storageService.resolvePath(record.filePath);
    if (!fs.existsSync(absolutePath)) {
      throw new BadRequestError('Backup file not found on disk. It may have been manually deleted.');
    }

    return { record, absolutePath };
  }

  // ── Restore Backup ────────────────────────────────────────────────────────

  async restoreBackup(id: string, organizationId: string, restoredById: string) {
    const record = await prisma.databaseBackup.findFirst({
      where: { id, organizationId, deletedAt: null, status: 'COMPLETED' },
    });
    if (!record) throw new NotFoundError('Backup not found or not eligible for restore');

    const absolutePath = storageService.resolvePath(record.filePath);
    if (!fs.existsSync(absolutePath)) {
      throw new BadRequestError('Backup file not found on disk');
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new BadRequestError('DATABASE_URL is not configured');

    let conn: { user: string; password: string; host: string; port: string; database: string };
    try {
      conn = parseDatabaseUrl(dbUrl);
    } catch {
      throw new BadRequestError('Could not parse DATABASE_URL');
    }

    logger.warn(`[Backup] ⚠️  Restore initiated by ${restoredById} from backup ${record.filename}`);

    await createAuditLog({
      userId: restoredById,
      organizationId,
      entity: 'DatabaseBackup',
      entityId: record.id,
      action: 'RESTORE',
      newValue: { filename: record.filename, restoredAt: new Date().toISOString() },
    });

    await this.runRestore(conn, absolutePath);

    logger.info(`[Backup] ✅ Restore completed from ${record.filename}`);
    return { success: true, message: `Database restored from ${record.filename}` };
  }

  private async runRestore(
    conn: { user: string; password: string; host: string; port: string; database: string },
    gzPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Validate file is gzip before restoring
      const buf = Buffer.alloc(3);
      const fd = fs.openSync(gzPath, 'r');
      fs.readSync(fd, buf, 0, 3, 0);
      fs.closeSync(fd);
      const isGzip = buf[0] === 0x1f && buf[1] === 0x8b;
      if (!isGzip) {
        return reject(new Error('Invalid backup file: not a gzip-compressed SQL dump'));
      }

      const env = { ...process.env, PGPASSWORD: conn.password };

      // zcat → psql pipeline: decompress then pipe to psql
      const zcat = spawn('gzip', ['-dc', gzPath], { env });
      const psql = spawn(
        'psql',
        [
          '--host', conn.host,
          '--port', conn.port,
          '--username', conn.user,
          '--dbname', conn.database,
          '--no-password',
        ],
        { env }
      );

      zcat.stdout.pipe(psql.stdin);

      const stderrChunks: Buffer[] = [];
      psql.stderr.on('data', (chunk) => stderrChunks.push(chunk));
      zcat.on('error', reject);

      psql.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          const errMsg = Buffer.concat(stderrChunks).toString().slice(0, 500);
          reject(new Error(`psql restore exited with code ${code}: ${errMsg}`));
        }
      });

      psql.on('error', (err) => {
        reject(new Error(`psql spawn failed: ${err.message}. Ensure psql is installed on the server.`));
      });
    });
  }

  // ── Restore from Upload ───────────────────────────────────────────────────

  async restoreFromUpload(
    uploadedFilePath: string,
    organizationId: string,
    restoredById: string
  ) {
    // Validate it's gzip-compressed
    const buf = Buffer.alloc(3);
    const fd = fs.openSync(uploadedFilePath, 'r');
    fs.readSync(fd, buf, 0, 3, 0);
    fs.closeSync(fd);

    const isGzip = buf[0] === 0x1f && buf[1] === 0x8b;
    if (!isGzip) {
      fs.unlinkSync(uploadedFilePath);
      throw new BadRequestError('Invalid file: must be a gzip-compressed SQL backup (.sql.gz)');
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new BadRequestError('DATABASE_URL is not configured');

    const conn = parseDatabaseUrl(dbUrl);

    logger.warn(`[Backup] ⚠️  Restore from upload initiated by ${restoredById}`);

    await createAuditLog({
      userId: restoredById,
      organizationId,
      entity: 'DatabaseBackup',
      entityId: 'uploaded',
      action: 'RESTORE_UPLOAD',
      newValue: { restoredAt: new Date().toISOString() },
    });

    await this.runRestore(conn, uploadedFilePath);

    // Clean up temp upload
    try { fs.unlinkSync(uploadedFilePath); } catch { /* ignore */ }

    logger.info('[Backup] ✅ Restore from upload completed');
    return { success: true, message: 'Database restored from uploaded backup file' };
  }

  // ── Delete Backup ─────────────────────────────────────────────────────────

  async deleteBackup(id: string, organizationId: string, deletedById: string) {
    const record = await prisma.databaseBackup.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!record) throw new NotFoundError('Backup not found');

    // Remove file from disk
    const absolutePath = storageService.resolvePath(record.filePath);
    try {
      if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
    } catch (err: any) {
      logger.warn(`[Backup] Could not delete file ${absolutePath}: ${err.message}`);
    }

    // Soft-delete the record
    await prisma.databaseBackup.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'DELETED' },
    });

    await createAuditLog({
      userId: deletedById,
      organizationId,
      entity: 'DatabaseBackup',
      entityId: id,
      action: 'DELETE',
      newValue: { filename: record.filename },
    });

    logger.info(`[Backup] 🗑️  Backup deleted: ${record.filename}`);
    return { success: true };
  }

  // ── Retention Cleanup ─────────────────────────────────────────────────────

  async applyRetentionPolicy(organizationId: string, keepCount = 10) {
    const completed = await prisma.databaseBackup.findMany({
      where: { organizationId, deletedAt: null, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
    });

    const toDelete = completed.slice(keepCount);
    for (const record of toDelete) {
      try {
        const absPath = storageService.resolvePath(record.filePath);
        if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
        await prisma.databaseBackup.update({
          where: { id: record.id },
          data: { deletedAt: new Date(), status: 'DELETED' },
        });
        logger.info(`[Backup] 🗑️  Retention cleanup: deleted ${record.filename}`);
      } catch (err: any) {
        logger.warn(`[Backup] Retention cleanup failed for ${record.filename}: ${err.message}`);
      }
    }
  }
}

export const backupService = new BackupService();
