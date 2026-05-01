import { execSync } from 'child_process';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { createGzip, createGunzip } from 'zlib';
import { prisma } from '../../lib/prisma.js';
import { storageService, StorageFolder } from '../../services/storage.service.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { logger } from '../../lib/logger.js';
import { NotFoundError, BadRequestError, AppError } from '../../middleware/errorHandler.js';

// ─── Binary Detection ─────────────────────────────────────────────────────────
// Supports PG_DUMP_PATH / PSQL_PATH env vars for explicit absolute paths,
// then falls back to PATH lookup + well-known install locations.

const COMMON_PATHS: Record<string, { unix: string[]; win: string[] }> = {
  pg_dump: {
    unix: [
      '/usr/bin/pg_dump',
      '/usr/local/bin/pg_dump',
      '/usr/local/pgsql/bin/pg_dump',
      '/opt/homebrew/bin/pg_dump',
      '/opt/homebrew/opt/postgresql@16/bin/pg_dump',
      '/opt/homebrew/opt/postgresql@17/bin/pg_dump',
      '/usr/lib/postgresql/17/bin/pg_dump',
      '/usr/lib/postgresql/16/bin/pg_dump',
      '/usr/lib/postgresql/15/bin/pg_dump',
      '/usr/lib/postgresql/14/bin/pg_dump',
    ],
    win: [
      'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe',
      'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
      'C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe',
      'C:\\Program Files\\PostgreSQL\\14\\bin\\pg_dump.exe',
    ],
  },
  psql: {
    unix: [
      '/usr/bin/psql',
      '/usr/local/bin/psql',
      '/usr/local/pgsql/bin/psql',
      '/opt/homebrew/bin/psql',
      '/opt/homebrew/opt/postgresql@16/bin/psql',
      '/opt/homebrew/opt/postgresql@17/bin/psql',
      '/usr/lib/postgresql/17/bin/psql',
      '/usr/lib/postgresql/16/bin/psql',
      '/usr/lib/postgresql/15/bin/psql',
      '/usr/lib/postgresql/14/bin/psql',
    ],
    win: [
      'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe',
      'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe',
      'C:\\Program Files\\PostgreSQL\\15\\bin\\psql.exe',
      'C:\\Program Files\\PostgreSQL\\14\\bin\\psql.exe',
    ],
  },
};

function findBinary(name: 'pg_dump' | 'psql', envVarName: string): string | null {
  // 1. Explicit env var
  const envPath = process.env[envVarName];
  if (envPath) {
    if (fs.existsSync(envPath)) return envPath;
    logger.warn(`[Backup] ${envVarName}="${envPath}" set but file not found on disk`);
  }

  // 2. System PATH lookup (which / where)
  try {
    const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`;
    const result = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }).trim();
    const firstLine = result.split('\n')[0].trim();
    if (firstLine && fs.existsSync(firstLine)) return firstLine;
  } catch { /* not in PATH */ }

  // 3. Common install locations
  const candidates = process.platform === 'win32'
    ? COMMON_PATHS[name].win
    : COMMON_PATHS[name].unix;
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

export function findPgDump(): string | null {
  return findBinary('pg_dump', 'PG_DUMP_PATH');
}

export function findPsql(): string | null {
  return findBinary('psql', 'PSQL_PATH');
}

// ─── Docker fallback detection ────────────────────────────────────────────────
// When pg_dump/psql are not installed locally (common in Docker-based dev),
// fall back to running the binary inside the PostgreSQL container via `docker exec`.

function findDocker(): string | null {
  try {
    const cmd = process.platform === 'win32' ? 'where docker' : 'which docker';
    const result = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }).trim();
    // Use forward slashes for cross-platform compatibility with spawn()
    const firstLine = result.split('\n')[0].trim().replace(/\\/g, '/');
    if (firstLine && fs.existsSync(firstLine)) return firstLine;
  } catch { /* docker not in PATH */ }
  // Common Docker Desktop on Windows
  const winPath = 'C:/Program Files/Docker/Docker/resources/bin/docker.exe';
  if (process.platform === 'win32' && fs.existsSync(winPath)) return winPath;
  return null;
}

export function getDockerContainerName(): string {
  return process.env.PG_DOCKER_CONTAINER || 'aniston-postgres';
}

type PgToolSource =
  | { method: 'local'; path: string }
  | { method: 'docker'; dockerPath: string; container: string };

export function resolvePgDump(): PgToolSource | null {
  const local = findPgDump();
  if (local) return { method: 'local', path: local };

  const docker = findDocker();
  if (docker) return { method: 'docker', dockerPath: docker, container: getDockerContainerName() };

  return null;
}

export function resolvePsql(): PgToolSource | null {
  const local = findPsql();
  if (local) return { method: 'local', path: local };

  const docker = findDocker();
  if (docker) return { method: 'docker', dockerPath: docker, container: getDockerContainerName() };

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDatabaseUrl(url: string) {
  const match = url.match(/^postgresql?:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
  if (!match) throw new BadRequestError('Could not parse DATABASE_URL — expected format: postgresql://user:password@host:port/database');
  const [, user, password, host, port, database] = match;
  return { user, password, host, port, database };
}

function buildDbBackupFilename(): string {
  // Include milliseconds (.slice(0,23)) so two rapid backups never produce the same filename
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
  return `db_backup_${ts}.sql.gz`;
}

function buildFilesBackupFilename(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
  return `files_backup_${ts}.tar.gz`;
}

type BackupCategory = 'DATABASE' | 'FILES';
type BackupType = 'MANUAL' | 'SCHEDULED';

// ─── BackupService ────────────────────────────────────────────────────────────

export class BackupService {

  // ── Availability Check ────────────────────────────────────────────────────

  checkAvailability() {
    const pgDumpSrc = resolvePgDump();
    const psqlSrc = resolvePsql();

    const describeSource = (src: PgToolSource | null, toolName: string, envVar: string) => {
      if (!src) {
        return {
          available: false,
          path: null,
          method: null as string | null,
          envVar,
          hint: `${toolName} not found locally or via Docker. Install postgresql-client, set ${envVar} env var, or set PG_DOCKER_CONTAINER to your PostgreSQL container name (default: aniston-postgres).`,
        };
      }
      return {
        available: true,
        path: src.method === 'local' ? src.path : `docker exec ${src.container} ${toolName}`,
        method: src.method,
        envVar,
        hint: null,
      };
    };

    return {
      pgDump: describeSource(pgDumpSrc, 'pg_dump', 'PG_DUMP_PATH'),
      psql: describeSource(psqlSrc, 'psql', 'PSQL_PATH'),
    };
  }

  // ── List ──────────────────────────────────────────────────────────────────

  async listBackups(organizationId: string, page = 1, limit = 20, category?: BackupCategory) {
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = { organizationId, deletedAt: null };
    if (category) where.category = category;

    const [backups, total] = await Promise.all([
      prisma.databaseBackup.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.databaseBackup.count({ where }),
    ]);

    const stats = await this.getStats(organizationId);

    return {
      backups,
      meta: {
        page, limit, total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
      stats,
    };
  }

  async getStats(organizationId: string) {
    const baseWhere = { organizationId, deletedAt: null };

    const [totalDb, totalFiles, latestDb, latestFiles] = await Promise.all([
      prisma.databaseBackup.count({ where: { ...baseWhere, category: 'DATABASE' } }),
      prisma.databaseBackup.count({ where: { ...baseWhere, category: 'FILES' } }),
      prisma.databaseBackup.findFirst({
        where: { ...baseWhere, category: 'DATABASE', status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.databaseBackup.findFirst({
        where: { ...baseWhere, category: 'FILES', status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Next scheduled = next daily backup at 02:00 UTC
    const now = new Date();
    const nextScheduledAt = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 2, 0, 0, 0
    ));
    if (nextScheduledAt <= now) {
      nextScheduledAt.setUTCDate(nextScheduledAt.getUTCDate() + 1);
    }

    return {
      totalBackups: totalDb + totalFiles,
      totalDbBackups: totalDb,
      totalFilesBackups: totalFiles,
      lastDbBackupAt: latestDb?.createdAt ?? null,
      lastDbBackupSize: latestDb?.sizeBytes?.toString() ?? null,
      lastFilesBackupAt: latestFiles?.createdAt ?? null,
      lastFilesBackupSize: latestFiles?.sizeBytes?.toString() ?? null,
      nextScheduledAt,
    };
  }

  // ── Create Backup (router) ────────────────────────────────────────────────

  async createBackup(
    organizationId: string,
    type: BackupType,
    createdById?: string,
    category: BackupCategory = 'DATABASE'
  ) {
    if (category === 'FILES') {
      return this._createFilesBackup(organizationId, type, createdById);
    }
    return this._createDatabaseBackup(organizationId, type, createdById);
  }

  // ── Database Backup ───────────────────────────────────────────────────────

  private async _createDatabaseBackup(
    organizationId: string,
    type: BackupType,
    createdById?: string
  ) {
    // Pre-flight: resolve pg_dump — local binary or via Docker exec
    const pgDumpSrc = resolvePgDump();
    if (!pgDumpSrc) {
      throw new BadRequestError(
        'pg_dump not found locally or via Docker. ' +
        'Options: (1) Install postgresql-client. ' +
        '(2) Set PG_DUMP_PATH env var to absolute path. ' +
        '(3) Set PG_DOCKER_CONTAINER to your PostgreSQL container name (default: aniston-postgres) — Docker must be running.'
      );
    }

    // Concurrent guard — prevent two simultaneous DB backups for the same org
    const inProgress = await prisma.databaseBackup.findFirst({
      where: { organizationId, category: 'DATABASE', status: 'IN_PROGRESS', deletedAt: null },
    });
    if (inProgress) throw new BadRequestError('A database backup is already in progress. Please wait for it to complete.');

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new BadRequestError('DATABASE_URL is not configured');

    let conn: ReturnType<typeof parseDatabaseUrl>;
    try { conn = parseDatabaseUrl(dbUrl); }
    catch { throw new BadRequestError('Could not parse DATABASE_URL. Use: postgresql://user:pass@host:port/db'); }

    const filename = buildDbBackupFilename();
    const backupDir = storageService.getAbsoluteDir(StorageFolder.BACKUPS);
    const gzPath = path.join(backupDir, filename);
    const relPath = storageService.buildUrl(StorageFolder.BACKUPS, filename);

    // Disk space pre-check (requires ~500 MB free minimum)
    this._checkDiskSpace(backupDir);

    const record = await prisma.databaseBackup.create({
      data: { filename, filePath: relPath, category: 'DATABASE', type, status: 'IN_PROGRESS', organizationId, createdById: createdById ?? null },
    });

    try {
      await this._runPgDump(pgDumpSrc, conn, gzPath);
      const stat = fs.statSync(gzPath);

      await prisma.databaseBackup.update({
        where: { id: record.id },
        data: { status: 'COMPLETED', sizeBytes: BigInt(stat.size) },
      });

      if (createdById) {
        await createAuditLog({
          userId: createdById, organizationId,
          entity: 'DatabaseBackup', entityId: record.id, action: 'CREATE',
          newValue: { filename, type, category: 'DATABASE', sizeBytes: stat.size },
        });
      }

      const srcDesc = pgDumpSrc.method === 'docker' ? `docker exec ${pgDumpSrc.container}` : pgDumpSrc.path;
      logger.info(`[Backup] ✅ DB backup completed: ${filename} (${stat.size} bytes) via ${srcDesc}`);
      return prisma.databaseBackup.findUnique({ where: { id: record.id } });
    } catch (err: any) {
      await prisma.databaseBackup.update({
        where: { id: record.id },
        data: { status: 'FAILED', notes: String(err?.message ?? err).slice(0, 500) },
      });
      try { if (fs.existsSync(gzPath)) fs.unlinkSync(gzPath); } catch { /* ignore */ }
      logger.error(`[Backup] ❌ DB backup failed: ${err.message}`);
      throw new BadRequestError(`Backup failed: ${err.message}`);
    }
  }

  private async _runPgDump(
    src: PgToolSource,
    conn: ReturnType<typeof parseDatabaseUrl>,
    outputGzPath: string
  ): Promise<void> {
    // For docker exec: write PGPASSWORD to a temp file so it doesn't appear in `ps aux`
    let envFilePath: string | null = null;

    try {
      const env = { ...process.env, PGPASSWORD: conn.password };

      const pgDumpArgs = [
        '--host', conn.host,
        '--port', conn.port,
        '--username', conn.user,
        '--dbname', conn.database,
        '--format', 'plain',
        '--no-password',
        '--verbose',
      ];

      // Build the actual spawn command: local binary OR docker exec
      let cmd: string;
      let args: string[];
      if (src.method === 'local') {
        cmd = src.path;
        args = pgDumpArgs;
      } else {
        // Write PGPASSWORD to a temp env file — avoids password appearing in `ps aux`
        envFilePath = path.join(os.tmpdir(), `pgpass-dump-${process.pid}-${Date.now()}.env`);
        fs.writeFileSync(envFilePath, `PGPASSWORD=${conn.password}\n`, { mode: 0o600 });
        cmd = src.dockerPath;
        args = ['exec', '--env-file', envFilePath, src.container, 'pg_dump', ...pgDumpArgs];
      }

      await new Promise<void>((resolve, reject) => {
        let resolved = false;
        const done = (err?: Error) => {
          if (resolved) return;
          resolved = true;
          if (err) reject(err);
          else resolve();
        };

        const pgDump = spawn(cmd, args, { env });
        const gzip = createGzip({ level: 6 });
        const output = fs.createWriteStream(outputGzPath);
        pgDump.stdout.pipe(gzip).pipe(output);

        const stderrChunks: Buffer[] = [];
        pgDump.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

        // Resolve once the output file is fully written
        output.on('finish', () => done());
        output.on('error', (err) => done(err));

        pgDump.on('close', (code) => {
          if (code !== 0) {
            const errMsg = Buffer.concat(stderrChunks).toString().slice(0, 500);
            done(new Error(`pg_dump exited with code ${code}: ${errMsg || 'No error details available'}`));
          }
          // If code=0, the stream finish event will resolve — don't resolve here to avoid races
        });

        pgDump.on('error', (err) => {
          done(new Error(`pg_dump spawn failed: ${err.message}. Ensure ${src.method === 'docker' ? 'Docker is running and container "' + src.container + '" is up' : 'pg_dump is installed and accessible'}.`));
        });

        // Safety timeout: 15 minutes max for a backup
        const timeout = setTimeout(() => {
          done(new Error('pg_dump timed out after 15 minutes. The database may be too large or unreachable.'));
          try { pgDump.kill(); } catch { /* ignore */ }
        }, 15 * 60 * 1000);
        output.on('finish', () => clearTimeout(timeout));
        output.on('error', () => clearTimeout(timeout));
      });
    } finally {
      if (envFilePath) {
        try { fs.unlinkSync(envFilePath); } catch { /* ignore */ }
      }
    }
  }

  // ── Files Backup ──────────────────────────────────────────────────────────

  private async _createFilesBackup(
    organizationId: string,
    type: BackupType,
    createdById?: string
  ) {
    // Concurrent guard — prevent two simultaneous Files backups for the same org
    const inProgress = await prisma.databaseBackup.findFirst({
      where: { organizationId, category: 'FILES', status: 'IN_PROGRESS', deletedAt: null },
    });
    if (inProgress) throw new BadRequestError('A files backup is already in progress. Please wait for it to complete.');

    const filename = buildFilesBackupFilename();
    const backupDir = storageService.getAbsoluteDir(StorageFolder.BACKUPS);
    const tarPath = path.join(backupDir, filename);
    const relPath = storageService.buildUrl(StorageFolder.BACKUPS, filename);

    // Disk space pre-check (requires ~500 MB free minimum)
    this._checkDiskSpace(backupDir);

    const record = await prisma.databaseBackup.create({
      data: { filename, filePath: relPath, category: 'FILES', type, status: 'IN_PROGRESS', organizationId, createdById: createdById ?? null },
    });

    try {
      await this._runFilesArchive(tarPath);
      const stat = fs.statSync(tarPath);

      await prisma.databaseBackup.update({
        where: { id: record.id },
        data: { status: 'COMPLETED', sizeBytes: BigInt(stat.size) },
      });

      if (createdById) {
        await createAuditLog({
          userId: createdById, organizationId,
          entity: 'DatabaseBackup', entityId: record.id, action: 'CREATE',
          newValue: { filename, type, category: 'FILES', sizeBytes: stat.size },
        });
      }

      logger.info(`[Backup] ✅ Files backup completed: ${filename} (${stat.size} bytes)`);
      return prisma.databaseBackup.findUnique({ where: { id: record.id } });
    } catch (err: any) {
      await prisma.databaseBackup.update({
        where: { id: record.id },
        data: { status: 'FAILED', notes: String(err?.message ?? err).slice(0, 500) },
      });
      try { if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath); } catch { /* ignore */ }
      logger.error(`[Backup] ❌ Files backup failed: ${err.message}`);
      throw new BadRequestError(`Files backup failed: ${err.message}`);
    }
  }

  // Disk space guard — logs a warning and throws if < 500 MB free on the backup volume
  private _checkDiskSpace(dir: string, minFreeMB = 500): void {
    try {
      if (process.platform === 'win32') return; // df not available on Windows dev
      const out = execSync(`df -B1 "${dir}"`, { encoding: 'utf8', timeout: 5000 });
      const lines = out.trim().split('\n');
      const parts = lines[lines.length - 1].trim().split(/\s+/);
      const freeBytes = parseInt(parts[3], 10); // "Available" column from df -B1
      if (!isNaN(freeBytes)) {
        const freeMB = Math.floor(freeBytes / 1024 / 1024);
        logger.info(`[Backup] Disk space check: ${freeMB}MB free on backup volume`);
        if (freeMB < minFreeMB) {
          throw new BadRequestError(
            `Insufficient disk space: ${freeMB}MB free, at least ${minFreeMB}MB required. Free up space before running a backup.`
          );
        }
      }
    } catch (err: any) {
      if (err instanceof BadRequestError) throw err;
      logger.warn(`[Backup] Disk space check skipped: ${err.message}`);
    }
  }

  private async _runFilesArchive(outputTarPath: string): Promise<void> {
    // Dynamic import works reliably with both CJS (tar) and ESM context
    const tar = await import('tar');
    const uploadsRoot = storageService.getUploadsRoot();

    // Exclude backups/ and tmp/ — backups would cause infinite recursion; tmp/ is ephemeral
    const excluded = new Set(['backups', 'tmp']);

    let entries: string[] = [];
    if (fs.existsSync(uploadsRoot)) {
      entries = fs.readdirSync(uploadsRoot).filter((e) => !excluded.has(e));
    }

    if (entries.length === 0) {
      // Create a minimal valid tar.gz with a placeholder so the file is not empty/corrupt
      const tmpDir = storageService.getAbsoluteDir('tmp');
      const placeholder = path.join(tmpDir, `.backup_placeholder_${Date.now()}`);
      fs.writeFileSync(placeholder, 'no files');
      try {
        await tar.create({ gzip: true, file: outputTarPath, cwd: tmpDir }, [path.basename(placeholder)]);
      } finally {
        try { fs.unlinkSync(placeholder); } catch { /* ignore */ }
      }
      return;
    }

    try {
      await tar.create({ gzip: true, file: outputTarPath, cwd: uploadsRoot }, entries);
    } catch (err) {
      // Clean up any partial archive written before the failure
      try { if (fs.existsSync(outputTarPath)) fs.unlinkSync(outputTarPath); } catch { /* ignore */ }
      throw err;
    }
  }

  // ── Download ──────────────────────────────────────────────────────────────

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

  // ── Restore Database ──────────────────────────────────────────────────────

  async restoreBackup(id: string, organizationId: string, restoredById: string) {
    const record = await prisma.databaseBackup.findFirst({
      where: { id, organizationId, deletedAt: null, status: 'COMPLETED', category: 'DATABASE' },
    });
    if (!record) throw new NotFoundError('Database backup not found or not eligible for restore');

    const absolutePath = storageService.resolvePath(record.filePath);
    if (!fs.existsSync(absolutePath)) throw new BadRequestError('Backup file not found on disk');

    const psqlSrc = resolvePsql();
    if (!psqlSrc) {
      throw new BadRequestError(
        'psql not found locally or via Docker. Install postgresql-client, set PSQL_PATH env var, or set PG_DOCKER_CONTAINER.'
      );
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new BadRequestError('DATABASE_URL is not configured');
    const conn = parseDatabaseUrl(dbUrl);

    logger.warn(`[Backup] ⚠️  DB restore initiated by ${restoredById} from ${record.filename}`);
    await createAuditLog({
      userId: restoredById, organizationId,
      entity: 'DatabaseBackup', entityId: record.id, action: 'RESTORE',
      newValue: { filename: record.filename, restoredAt: new Date().toISOString() },
    });

    try {
      await this._runPsqlRestore(psqlSrc, conn, absolutePath);
    } catch (err: any) {
      logger.error(`[Backup] ❌ DB restore failed from ${record.filename}: ${err.message}`);
      throw new AppError(`Database restore failed: ${err.message}`, 500, 'RESTORE_FAILED');
    }
    logger.info(`[Backup] ✅ DB restore completed from ${record.filename}`);
    return { success: true, message: `Database restored from ${record.filename}` };
  }

  private async _runPsqlRestore(
    src: PgToolSource,
    conn: ReturnType<typeof parseDatabaseUrl>,
    gzPath: string
  ): Promise<void> {
    // For docker exec: write PGPASSWORD to a temp file so it doesn't appear in `ps aux`
    let envFilePath: string | null = null;

    try {
      // Validate gzip magic bytes before attempting restore
      const buf = Buffer.alloc(2);
      const fd = fs.openSync(gzPath, 'r');
      fs.readSync(fd, buf, 0, 2, 0);
      fs.closeSync(fd);
      if (!(buf[0] === 0x1f && buf[1] === 0x8b)) {
        throw new BadRequestError('Invalid backup file: not a gzip-compressed SQL dump');
      }

      const env = { ...process.env, PGPASSWORD: conn.password };

      const psqlArgs = [
        '--host', conn.host, '--port', conn.port,
        '--username', conn.user, '--dbname', conn.database, '--no-password',
        '--single-transaction', // wrap entire restore in one transaction — partial failure rolls back cleanly
      ];

      let psqlCmd: string;
      let psqlCmdArgs: string[];
      if (src.method === 'local') {
        psqlCmd = src.path;
        psqlCmdArgs = psqlArgs;
      } else {
        // Write PGPASSWORD to a temp env file — avoids password appearing in `ps aux`
        envFilePath = path.join(os.tmpdir(), `pgpass-restore-${process.pid}-${Date.now()}.env`);
        fs.writeFileSync(envFilePath, `PGPASSWORD=${conn.password}\n`, { mode: 0o600 });
        psqlCmd = src.dockerPath;
        psqlCmdArgs = ['exec', '-i', '--env-file', envFilePath, src.container, 'psql', ...psqlArgs];
      }

      // Use Node.js built-in zlib.createGunzip() — works on all platforms (Windows/Linux/macOS)
      // without requiring the gzip binary to be installed.
      await new Promise<void>((resolve, reject) => {
        const readStream = fs.createReadStream(gzPath);
        const gunzip = createGunzip();
        const psqlProc = spawn(psqlCmd, psqlCmdArgs, { env, stdio: ['pipe', 'pipe', 'pipe'] });

        readStream.pipe(gunzip).pipe(psqlProc.stdin!);

        const stderrChunks: Buffer[] = [];
        psqlProc.stderr.on('data', (c) => stderrChunks.push(c));

        let aborted = false;
        const abort = (err: Error) => {
          if (aborted) return;
          aborted = true;
          try { readStream.destroy(); } catch { /* ignore */ }
          try { gunzip.destroy(); } catch { /* ignore */ }
          try { psqlProc.kill(); } catch { /* ignore */ }
          reject(err);
        };
        readStream.on('error', abort);
        gunzip.on('error', abort);

        psqlProc.on('close', (code) => {
          if (code === 0) resolve();
          else {
            const msg = Buffer.concat(stderrChunks).toString().slice(0, 500);
            reject(new Error(`psql exited with code ${code}: ${msg}`));
          }
        });
        psqlProc.on('error', (err) => reject(new Error(`psql spawn failed: ${err.message}`)));
      });
    } finally {
      if (envFilePath) {
        try { fs.unlinkSync(envFilePath); } catch { /* ignore */ }
      }
    }
  }

  // ── Restore Database from Upload ──────────────────────────────────────────

  async restoreFromUpload(uploadedFilePath: string, organizationId: string, restoredById: string) {
    try {
      const buf = Buffer.alloc(2);
      const fd = fs.openSync(uploadedFilePath, 'r');
      fs.readSync(fd, buf, 0, 2, 0);
      fs.closeSync(fd);
      if (!(buf[0] === 0x1f && buf[1] === 0x8b)) {
        throw new BadRequestError('Invalid file: must be a gzip-compressed SQL backup (.sql.gz)');
      }

      const psqlSrc = resolvePsql();
      if (!psqlSrc) throw new BadRequestError('psql not found locally or via Docker. Install postgresql-client or set PSQL_PATH env var.');

      const dbUrl = process.env.DATABASE_URL;
      if (!dbUrl) throw new BadRequestError('DATABASE_URL is not configured');
      const conn = parseDatabaseUrl(dbUrl);

      logger.warn(`[Backup] ⚠️  DB restore from upload by ${restoredById}`);
      await createAuditLog({
        userId: restoredById, organizationId,
        entity: 'DatabaseBackup', entityId: 'uploaded', action: 'RESTORE_UPLOAD',
        newValue: { restoredAt: new Date().toISOString() },
      });

      try {
        await this._runPsqlRestore(psqlSrc, conn, uploadedFilePath);
      } catch (err: any) {
        logger.error(`[Backup] ❌ DB restore from upload failed: ${err.message}`);
        throw new AppError(`Database restore failed: ${err.message}`, 500, 'RESTORE_FAILED');
      }

      logger.info('[Backup] ✅ DB restore from upload completed');
      return { success: true, message: 'Database restored from uploaded backup file' };
    } finally {
      // Always remove temp file — covers all code paths (validation error, DB error, network error, success)
      try { if (fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath); } catch { /* ignore */ }
    }
  }

  // ── Restore Files ─────────────────────────────────────────────────────────

  async restoreFilesBackup(id: string, organizationId: string, restoredById: string) {
    const record = await prisma.databaseBackup.findFirst({
      where: { id, organizationId, deletedAt: null, status: 'COMPLETED', category: 'FILES' },
    });
    if (!record) throw new NotFoundError('Files backup not found or not eligible for restore');

    const absolutePath = storageService.resolvePath(record.filePath);
    if (!fs.existsSync(absolutePath)) throw new BadRequestError('Backup file not found on disk');

    logger.warn(`[Backup] ⚠️  Files restore initiated by ${restoredById} from ${record.filename}`);
    await createAuditLog({
      userId: restoredById, organizationId,
      entity: 'DatabaseBackup', entityId: record.id, action: 'RESTORE_FILES',
      newValue: { filename: record.filename, restoredAt: new Date().toISOString() },
    });

    try {
      await this._runFilesExtract(absolutePath);
    } catch (err: any) {
      logger.error(`[Backup] ❌ Files restore failed from ${record.filename}: ${err.message}`);
      throw new AppError(`Files restore failed: ${err.message}`, 500, 'RESTORE_FAILED');
    }
    logger.info(`[Backup] ✅ Files restore completed from ${record.filename}`);
    return { success: true, message: `Uploaded files restored from ${record.filename}` };
  }

  async restoreFilesFromUpload(uploadedFilePath: string, organizationId: string, restoredById: string) {
    try {
      // Validate gzip magic bytes (tar.gz starts with 0x1f 0x8b)
      const buf = Buffer.alloc(2);
      const fd = fs.openSync(uploadedFilePath, 'r');
      fs.readSync(fd, buf, 0, 2, 0);
      fs.closeSync(fd);
      if (!(buf[0] === 0x1f && buf[1] === 0x8b)) {
        throw new BadRequestError('Invalid file: must be a gzip-compressed tar archive (.tar.gz)');
      }

      logger.warn(`[Backup] ⚠️  Files restore from upload by ${restoredById}`);
      await createAuditLog({
        userId: restoredById, organizationId,
        entity: 'DatabaseBackup', entityId: 'uploaded', action: 'RESTORE_FILES_UPLOAD',
        newValue: { restoredAt: new Date().toISOString() },
      });

      try {
        await this._runFilesExtract(uploadedFilePath);
      } catch (err: any) {
        logger.error(`[Backup] ❌ Files restore from upload failed: ${err.message}`);
        throw new AppError(`Files restore failed: ${err.message}`, 500, 'RESTORE_FAILED');
      }

      logger.info('[Backup] ✅ Files restore from upload completed');
      return { success: true, message: 'Uploaded files restored from archive' };
    } finally {
      // Always remove temp file — covers all code paths (validation error, extract error, audit error, success)
      try { if (fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath); } catch { /* ignore */ }
    }
  }

  private async _runFilesExtract(tarPath: string): Promise<void> {
    const tar = await import('tar');
    const uploadsRoot = storageService.getUploadsRoot();

    // Anti-zip-slip: filter out absolute paths and parent directory traversals.
    // The tar package strips absolute paths by default; we add explicit check.
    try {
      await tar.extract({
        file: tarPath,
        cwd: uploadsRoot,
        filter: (entryPath: string) => {
          const normalized = path.normalize(entryPath);
          if (path.isAbsolute(normalized) || normalized.startsWith('..')) {
            logger.warn(`[Backup] ⚠️  Skipping suspicious archive entry: ${entryPath}`);
            return false;
          }
          // Prevent overwriting backup files themselves
          const topLevel = normalized.split(path.sep)[0];
          if (topLevel === 'backups' || topLevel === 'tmp') return false;
          return true;
        },
      });
    } catch (err: any) {
      throw new Error(`Failed to extract archive: ${err.message}`);
    }
  }

  // ── Delete Backup ─────────────────────────────────────────────────────────

  async deleteBackup(id: string, organizationId: string, deletedById: string) {
    const record = await prisma.databaseBackup.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!record) throw new NotFoundError('Backup not found');

    const absolutePath = storageService.resolvePath(record.filePath);
    try {
      if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
    } catch (err: any) {
      logger.warn(`[Backup] Could not delete file ${absolutePath}: ${err.message}`);
    }

    await prisma.databaseBackup.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'DELETED' },
    });

    await createAuditLog({
      userId: deletedById, organizationId,
      entity: 'DatabaseBackup', entityId: id, action: 'DELETE',
      newValue: { filename: record.filename },
    });

    logger.info(`[Backup] 🗑️  Backup deleted: ${record.filename}`);
    return { success: true };
  }

  // ── Stuck Backup Cleanup ──────────────────────────────────────────────────
  // Called on server/worker startup. Resets any IN_PROGRESS records older than
  // 60 minutes to FAILED — they were interrupted by a crash or restart.

  async cleanupStuckBackups() {
    // pg_dump has a 15-min hard timeout; allow 60 min before declaring stuck
    // (handles retries, slow disks, and large databases on server restart)
    const staleThreshold = new Date(Date.now() - 60 * 60 * 1000);
    const stuck = await prisma.databaseBackup.findMany({
      where: { status: 'IN_PROGRESS', createdAt: { lt: staleThreshold } },
      select: { id: true, filename: true },
    });
    if (stuck.length === 0) return;
    await prisma.databaseBackup.updateMany({
      where: { id: { in: stuck.map((b) => b.id) } },
      data: {
        status: 'FAILED',
        notes: 'Backup interrupted — server restarted while backup was in progress.',
      },
    });
    logger.warn(`[Backup] Cleaned up ${stuck.length} stuck IN_PROGRESS backup(s) on startup`);
  }

  // ── Retention ─────────────────────────────────────────────────────────────

  async applyRetentionPolicy(organizationId: string, keepCount = 15) {
    for (const category of ['DATABASE', 'FILES'] as const) {
      // Purge oldest COMPLETED records beyond keepCount (removes file + soft-deletes row)
      const completed = await prisma.databaseBackup.findMany({
        where: { organizationId, deletedAt: null, status: 'COMPLETED', category },
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
          logger.info(`[Backup] 🗑️  Retention: deleted ${record.filename}`);
        } catch (err: any) {
          logger.warn(`[Backup] Retention cleanup failed for ${record.filename}: ${err.message}`);
        }
      }

      // Purge FAILED records older than 7 days — no file on disk, just DB row cleanup
      const failedCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const failedToDelete = await prisma.databaseBackup.findMany({
        where: { organizationId, deletedAt: null, status: 'FAILED', category, createdAt: { lt: failedCutoff } },
        select: { id: true, filename: true },
      });
      if (failedToDelete.length > 0) {
        await prisma.databaseBackup.updateMany({
          where: { id: { in: failedToDelete.map((b) => b.id) } },
          data: { deletedAt: new Date() },
        });
        logger.info(`[Backup] 🗑️  Retention: soft-deleted ${failedToDelete.length} stale FAILED record(s)`);
      }
    }
  }
}

export const backupService = new BackupService();
