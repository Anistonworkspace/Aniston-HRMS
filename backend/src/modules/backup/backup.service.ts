import { execSync } from 'child_process';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { createGzip } from 'zlib';
import { prisma } from '../../lib/prisma.js';
import { storageService, StorageFolder } from '../../services/storage.service.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { logger } from '../../lib/logger.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';

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
  if (!match) throw new Error('Could not parse DATABASE_URL');
  const [, user, password, host, port, database] = match;
  return { user, password, host, port, database };
}

function buildDbBackupFilename(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `db_backup_${ts}.sql.gz`;
}

function buildFilesBackupFilename(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
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

    // Next scheduled = 7 days after the most recent successful backup (either category)
    const scheduleIntervalMs = 7 * 24 * 60 * 60 * 1000;
    let nextScheduledAt: Date | null = null;
    const latestEither = latestDb && latestFiles
      ? (latestDb.createdAt > latestFiles.createdAt ? latestDb : latestFiles)
      : (latestDb ?? latestFiles);
    if (latestEither) {
      nextScheduledAt = new Date(latestEither.createdAt.getTime() + scheduleIntervalMs);
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

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new BadRequestError('DATABASE_URL is not configured');

    let conn: ReturnType<typeof parseDatabaseUrl>;
    try { conn = parseDatabaseUrl(dbUrl); }
    catch { throw new BadRequestError('Could not parse DATABASE_URL. Use: postgresql://user:pass@host:port/db'); }

    const filename = buildDbBackupFilename();
    const backupDir = storageService.getAbsoluteDir(StorageFolder.BACKUPS);
    const gzPath = path.join(backupDir, filename);
    const relPath = storageService.buildUrl(StorageFolder.BACKUPS, filename);

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

  private _runPgDump(
    src: PgToolSource,
    conn: ReturnType<typeof parseDatabaseUrl>,
    outputGzPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
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
        // docker exec -e PGPASSWORD=... <container> pg_dump <args>
        cmd = src.dockerPath;
        args = ['exec', '-e', `PGPASSWORD=${conn.password}`, src.container, 'pg_dump', ...pgDumpArgs];
      }

      const pgDump = spawn(cmd, args, { env });

      const gzip = createGzip({ level: 6 });
      const output = fs.createWriteStream(outputGzPath);
      pgDump.stdout.pipe(gzip).pipe(output);

      const stderrChunks: Buffer[] = [];
      pgDump.stderr.on('data', (chunk) => stderrChunks.push(chunk));

      pgDump.on('close', (code) => {
        if (code === 0) {
          output.on('finish', resolve);
          output.on('error', reject);
        } else {
          const errMsg = Buffer.concat(stderrChunks).toString().slice(0, 500);
          reject(new Error(`pg_dump exited with code ${code}: ${errMsg}`));
        }
      });

      pgDump.on('error', (err) => {
        reject(new Error(`pg_dump spawn failed: ${err.message}`));
      });
    });
  }

  // ── Files Backup ──────────────────────────────────────────────────────────

  private async _createFilesBackup(
    organizationId: string,
    type: BackupType,
    createdById?: string
  ) {
    const filename = buildFilesBackupFilename();
    const backupDir = storageService.getAbsoluteDir(StorageFolder.BACKUPS);
    const tarPath = path.join(backupDir, filename);
    const relPath = storageService.buildUrl(StorageFolder.BACKUPS, filename);

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

    await tar.create({ gzip: true, file: outputTarPath, cwd: uploadsRoot }, entries);
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

    await this._runPsqlRestore(psqlSrc, conn, absolutePath);
    logger.info(`[Backup] ✅ DB restore completed from ${record.filename}`);
    return { success: true, message: `Database restored from ${record.filename}` };
  }

  private _runPsqlRestore(
    src: PgToolSource,
    conn: ReturnType<typeof parseDatabaseUrl>,
    gzPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Validate gzip magic bytes before attempting restore
      const buf = Buffer.alloc(2);
      const fd = fs.openSync(gzPath, 'r');
      fs.readSync(fd, buf, 0, 2, 0);
      fs.closeSync(fd);
      if (!(buf[0] === 0x1f && buf[1] === 0x8b)) {
        return reject(new Error('Invalid backup file: not a gzip-compressed SQL dump'));
      }

      const env = { ...process.env, PGPASSWORD: conn.password };

      const psqlArgs = [
        '--host', conn.host, '--port', conn.port,
        '--username', conn.user, '--dbname', conn.database, '--no-password',
      ];

      let psqlCmd: string;
      let psqlCmdArgs: string[];
      if (src.method === 'local') {
        psqlCmd = src.path;
        psqlCmdArgs = psqlArgs;
      } else {
        psqlCmd = src.dockerPath;
        psqlCmdArgs = ['exec', '-i', '-e', `PGPASSWORD=${conn.password}`, src.container, 'psql', ...psqlArgs];
      }

      // gzip -dc decompresses to stdout, piped to psql stdin
      const zcatProc = spawn('gzip', ['-dc', gzPath], { env });
      const psqlProc = spawn(psqlCmd, psqlCmdArgs, { env });

      zcatProc.stdout.pipe(psqlProc.stdin);

      const stderrChunks: Buffer[] = [];
      psqlProc.stderr.on('data', (c) => stderrChunks.push(c));
      zcatProc.on('error', reject);

      psqlProc.on('close', (code) => {
        if (code === 0) resolve();
        else {
          const msg = Buffer.concat(stderrChunks).toString().slice(0, 500);
          reject(new Error(`psql exited with code ${code}: ${msg}`));
        }
      });
      psqlProc.on('error', (err) => reject(new Error(`psql spawn failed: ${err.message}`)));
    });
  }

  // ── Restore Database from Upload ──────────────────────────────────────────

  async restoreFromUpload(uploadedFilePath: string, organizationId: string, restoredById: string) {
    const buf = Buffer.alloc(2);
    const fd = fs.openSync(uploadedFilePath, 'r');
    fs.readSync(fd, buf, 0, 2, 0);
    fs.closeSync(fd);

    if (!(buf[0] === 0x1f && buf[1] === 0x8b)) {
      try { fs.unlinkSync(uploadedFilePath); } catch { /* ignore */ }
      throw new BadRequestError('Invalid file: must be a gzip-compressed SQL backup (.sql.gz)');
    }

    const psqlSrc = resolvePsql();
    if (!psqlSrc) {
      try { fs.unlinkSync(uploadedFilePath); } catch { /* ignore */ }
      throw new BadRequestError('psql not found locally or via Docker. Install postgresql-client or set PSQL_PATH env var.');
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new BadRequestError('DATABASE_URL is not configured');
    const conn = parseDatabaseUrl(dbUrl);

    logger.warn(`[Backup] ⚠️  DB restore from upload by ${restoredById}`);
    await createAuditLog({
      userId: restoredById, organizationId,
      entity: 'DatabaseBackup', entityId: 'uploaded', action: 'RESTORE_UPLOAD',
      newValue: { restoredAt: new Date().toISOString() },
    });

    await this._runPsqlRestore(psqlSrc, conn, uploadedFilePath);
    try { fs.unlinkSync(uploadedFilePath); } catch { /* ignore */ }
    logger.info('[Backup] ✅ DB restore from upload completed');
    return { success: true, message: 'Database restored from uploaded backup file' };
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

    await this._runFilesExtract(absolutePath);
    logger.info(`[Backup] ✅ Files restore completed from ${record.filename}`);
    return { success: true, message: `Uploaded files restored from ${record.filename}` };
  }

  async restoreFilesFromUpload(uploadedFilePath: string, organizationId: string, restoredById: string) {
    // Validate gzip magic bytes (tar.gz starts with 0x1f 0x8b)
    const buf = Buffer.alloc(2);
    const fd = fs.openSync(uploadedFilePath, 'r');
    fs.readSync(fd, buf, 0, 2, 0);
    fs.closeSync(fd);

    if (!(buf[0] === 0x1f && buf[1] === 0x8b)) {
      try { fs.unlinkSync(uploadedFilePath); } catch { /* ignore */ }
      throw new BadRequestError('Invalid file: must be a gzip-compressed tar archive (.tar.gz)');
    }

    logger.warn(`[Backup] ⚠️  Files restore from upload by ${restoredById}`);
    await createAuditLog({
      userId: restoredById, organizationId,
      entity: 'DatabaseBackup', entityId: 'uploaded', action: 'RESTORE_FILES_UPLOAD',
      newValue: { restoredAt: new Date().toISOString() },
    });

    await this._runFilesExtract(uploadedFilePath);
    try { fs.unlinkSync(uploadedFilePath); } catch { /* ignore */ }
    logger.info('[Backup] ✅ Files restore from upload completed');
    return { success: true, message: 'Uploaded files restored from archive' };
  }

  private async _runFilesExtract(tarPath: string): Promise<void> {
    const tar = await import('tar');
    const uploadsRoot = storageService.getUploadsRoot();

    // Anti-zip-slip: filter out absolute paths and parent directory traversals.
    // The tar package strips absolute paths by default; we add explicit check.
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

  // ── Retention ─────────────────────────────────────────────────────────────

  async applyRetentionPolicy(organizationId: string, keepCount = 15) {
    for (const category of ['DATABASE', 'FILES'] as const) {
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
    }
  }
}

export const backupService = new BackupService();
