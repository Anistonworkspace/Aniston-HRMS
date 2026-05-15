import { createReadStream, writeFileSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { logsDirectory } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import type { SystemLogQuery } from './system-logs.validation.js';

// ── Redaction ─────────────────────────────────────────────────────────────────
// These key patterns are masked before sending log data to the client.
const SENSITIVE_KEY = /password|passwordhash|pass|secret|token|apikey|api_key|authorization|cookie|jwt|bearer|credential|smtppass|smtp_pass|encryptionkey|encryption_key/i;
const REDACTED = '[REDACTED]';

function redactDeep(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redactDeep);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    result[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactDeep(v);
  }
  return result;
}

// ── Source detection ──────────────────────────────────────────────────────────
function deriveSource(entry: Record<string, unknown>): string {
  const msg  = String(entry.message || '').toLowerCase();
  const svc  = String(entry.service  || '').toLowerCase();

  if (msg.includes('[email') || msg.includes('email worker') || msg.includes('smtp'))  return 'email';
  if (msg.includes('[ocr')  || msg.includes('ocr')  || msg.includes('kyc'))            return 'kyc';
  if (msg.includes('[backup') || msg.includes('backup'))                               return 'backup';
  if (msg.includes('[auth')   || msg.includes('jwt') || msg.includes('login'))         return 'auth';
  if (msg.includes('[payroll') || msg.includes('payroll'))                             return 'payroll';
  if (msg.includes('[whatsapp') || msg.includes('whatsapp'))                           return 'whatsapp';
  if (msg.includes('[worker') || msg.includes('worker') || msg.includes('queue') ||
      msg.includes('bullmq') || msg.includes('bull'))                                  return 'jobs';
  if (msg.includes('[agent') || msg.includes('agent screenshot'))                      return 'agent';
  if (msg.includes('[invitation') || msg.includes('invite'))                           return 'auth';
  if ((entry as any).method || msg.includes(' 2') || msg.includes(' 3') || msg.includes(' 4') || msg.includes(' 5'))
                                                                                       return 'api';
  if (svc.includes('ai') || msg.includes('ai-service') || msg.includes('deepseek'))   return 'ai';

  return 'backend';
}

// ── Log entry shape returned to client ───────────────────────────────────────
export interface LogEntry {
  id:          string;
  timestamp:   string;
  level:       string;
  message:     string;
  service:     string;
  source:      string;
  requestId?:  string;
  userId?:     string;
  stack?:      string;
  meta?:       Record<string, unknown>;
}

// ── File reading ──────────────────────────────────────────────────────────────
async function readLogFileFiltered(
  filePath: string,
  query: SystemLogQuery,
): Promise<LogEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: LogEntry[] = [];
    let lineIdx = 0;

    try {
      const rl = readline.createInterface({
        input: createReadStream(filePath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });

      rl.on('line', (raw) => {
        if (!raw.trim()) return;
        lineIdx++;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return; // skip non-JSON (e.g. console lines accidentally in file)
        }

        // ── Level filter ──────────────────────────────────────────────────
        if (query.level) {
          const entryLevel = String(parsed.level || '').toLowerCase();
          if (entryLevel !== query.level) return;
        }

        // ── Date range filter ─────────────────────────────────────────────
        const ts = new Date(parsed.timestamp as string);
        if (query.dateFrom && ts < new Date(query.dateFrom)) return;
        if (query.dateTo   && ts > new Date(query.dateTo))   return;

        // ── Search filter ─────────────────────────────────────────────────
        if (query.search) {
          const needle = query.search.toLowerCase();
          const inMsg   = String(parsed.message || '').toLowerCase().includes(needle);
          const inStack = String(parsed.stack   || '').toLowerCase().includes(needle);
          const inMeta  = JSON.stringify(parsed).toLowerCase().includes(needle);
          if (!inMsg && !inStack && !inMeta) return;
        }

        // ── Source filter ─────────────────────────────────────────────────
        const source = deriveSource(parsed);
        if (query.source && source !== query.source) return;

        // ── Redact & project ──────────────────────────────────────────────
        const safe = redactDeep(parsed) as Record<string, unknown>;
        const { timestamp, level, message, service, stack, requestId, userId, ...rest } = safe;

        entries.push({
          id:         `${path.basename(filePath)}:${lineIdx}`,
          timestamp:  String(timestamp || new Date().toISOString()),
          level:      String(level || 'info').toLowerCase(),
          message:    String(message || ''),
          service:    String(service || 'aniston-hrms-api'),
          source,
          requestId:  requestId ? String(requestId) : undefined,
          userId:     userId    ? String(userId)    : undefined,
          stack:      stack     ? String(stack)     : undefined,
          meta:       Object.keys(rest).length > 0 ? rest as Record<string, unknown> : undefined,
        });
      });

      rl.on('close', () => resolve(entries));
      rl.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

// ── Summary ───────────────────────────────────────────────────────────────────
function buildSummary(entries: LogEntry[]) {
  const errorCount = entries.filter(e => e.level === 'error').length;
  const warnCount  = entries.filter(e => e.level === 'warn').length;
  const infoCount  = entries.filter(e => e.level === 'info').length;
  const debugCount = entries.filter(e => e.level === 'debug').length;
  const sources    = [...new Set(entries.map(e => e.source))].sort();

  // latest entry (already sorted desc by the time this is called)
  const lastUpdated = entries[0]?.timestamp ?? null;

  return { total: entries.length, errorCount, warnCount, infoCount, debugCount, sources, lastUpdated };
}

// ── Service ───────────────────────────────────────────────────────────────────
export class SystemLogsService {

  // Returns sorted+paginated results plus a summary for the full filtered set
  async getLogs(query: SystemLogQuery) {
    const files = await this.resolveLogFiles();
    let all: LogEntry[] = [];

    for (const f of files) {
      try {
        const batch = await readLogFileFiltered(f, query);
        all = all.concat(batch);
      } catch {
        // skip unreadable files gracefully
      }
    }

    // Sort
    all.sort((a, b) => {
      const diff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      return query.sort === 'asc' ? diff : -diff;
    });

    const total     = all.length;
    const start     = (query.page - 1) * query.limit;
    const pageData  = all.slice(start, start + query.limit);
    const summary   = buildSummary(all);

    return {
      data: pageData,
      meta: {
        page:       query.page,
        limit:      query.limit,
        total,
        totalPages: Math.ceil(total / query.limit) || 1,
        hasNext:    start + query.limit < total,
        hasPrev:    query.page > 1,
      },
      summary,
    };
  }

  // Lightweight summary-only call (no pagination)
  async getSummary() {
    const files = await this.resolveLogFiles();
    let all: LogEntry[] = [];

    for (const f of files) {
      try {
        const batch = await readLogFileFiltered(f, { page: 1, limit: 1_000_000, sort: 'desc' });
        all = all.concat(batch);
      } catch {
        // skip
      }
    }

    all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return buildSummary(all);
  }

  // Proxy AI-service logs from the Python FastAPI container
  async getAiServiceLogs(lines = 200): Promise<{ available: boolean; logs: unknown[]; error?: string }> {
    const safeLines = Math.min(Math.max(lines, 1), 1000);
    const base = env.AI_SERVICE_URL ?? 'http://localhost:8000';
    const key  = env.AI_SERVICE_API_KEY;

    try {
      const headers: Record<string, string> = {};
      if (key) headers['X-API-Key'] = key;

      const res = await fetch(`${base}/ai/logs?lines=${safeLines}`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        return { available: false, logs: [], error: `AI service returned HTTP ${res.status}` };
      }

      const body = (await res.json()) as { data?: unknown[] };
      return { available: true, logs: body.data ?? [] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { available: false, logs: [], error: msg };
    }
  }

  // Stream filtered logs as downloadable content
  async buildDownload(query: SystemLogQuery, format: 'txt' | 'json'): Promise<string> {
    // Download up to 10 000 entries ignoring pagination
    const result = await this.getLogs({ ...query, page: 1, limit: 10_000 });

    if (format === 'json') {
      return JSON.stringify(result.data, null, 2);
    }

    return result.data
      .map(e => {
        const meta  = e.meta  ? ` | ${JSON.stringify(e.meta)}`  : '';
        const stack = e.stack ? `\n  ${e.stack.replace(/\n/g, '\n  ')}` : '';
        return `[${e.timestamp}] [${e.level.toUpperCase().padEnd(5)}] [${e.source.padEnd(10)}] ${e.message}${meta}${stack}`;
      })
      .join('\n');
  }

  // Delete log entries within a date range by rewriting the log files in place.
  async deleteLogs(dateFrom: Date, dateTo: Date): Promise<{ deletedCount: number; filesModified: number }> {
    const files = await this.resolveLogFiles();
    let totalDeleted = 0;
    let filesModified = 0;

    const fromMs = dateFrom.getTime();
    // Include entire dateTo day by setting to end-of-day
    const toMs = new Date(dateTo).setHours(23, 59, 59, 999);

    for (const filePath of files) {
      const kept: string[] = [];
      let removed = 0;

      await new Promise<void>((resolve, reject) => {
        const rl = readline.createInterface({
          input: createReadStream(filePath, { encoding: 'utf8' }),
          crlfDelay: Infinity,
        });
        rl.on('line', (raw) => {
          if (!raw.trim()) return;
          let parsed: Record<string, unknown>;
          try { parsed = JSON.parse(raw); } catch { kept.push(raw); return; }
          const tsMs = new Date(parsed.timestamp as string).getTime();
          if (tsMs >= fromMs && tsMs <= toMs) { removed++; }
          else { kept.push(raw); }
        });
        rl.on('close', resolve);
        rl.on('error', reject);
      });

      if (removed > 0) {
        writeFileSync(filePath, kept.join('\n') + (kept.length > 0 ? '\n' : ''), 'utf8');
        totalDeleted += removed;
        filesModified++;
      }
    }

    return { deletedCount: totalDeleted, filesModified };
  }

  // ── Internals ───────────────────────────────────────────────────────────────
  private async resolveLogFiles(): Promise<string[]> {
    try {
      const names = await readdir(logsDirectory);
      const logNames = names.filter(n => /^app.*\.log$/.test(n));

      const withMtime = await Promise.all(
        logNames.map(async n => {
          const full = path.join(logsDirectory, n);
          const s = await stat(full);
          return { path: full, mtime: s.mtimeMs };
        }),
      );

      return withMtime
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 5)
        .map(f => f.path);
    } catch {
      return [];
    }
  }
}

export const systemLogsService = new SystemLogsService();
