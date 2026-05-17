import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { env } from '../../config/env.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { emitToOrg, emitToUser, emitToAgent } from '../../sockets/index.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import type { ActivityEntry, ScreenshotMetadata } from './agent.validation.js';

const PAIR_PREFIX = 'agent-pair:';
const LIVE_VIEW_PREFIX = 'agent-live:';
const SCREENSHOT_INTERVAL_PREFIX = 'agent-screenshot-interval:';
// SEC-003: Include organizationId in the Redis ping key to prevent cross-org key collisions.
// Two employees with the same UUID in different orgs (theoretically impossible with UUID v4 but
// guarded anyway) or a future multi-region deployment sharing Redis would otherwise leak status.
// Key format: agent-ping:<organizationId>:<employeeId>
const AGENT_PING_PREFIX = 'agent-ping:';
const PAIR_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Safely parse JSON from Redis — returns null on failure instead of crashing */
function safeJsonParse<T = any>(data: string | null): T | null {
  if (!data) return null;
  try { return JSON.parse(data); }
  catch { return null; }
}

/**
 * Convert any Date to midnight-UTC anchored on the org's local calendar date.
 * e.g. 23:45 IST (18:15 UTC) on 2026-05-16 → 2026-05-16T00:00:00.000Z
 * Used for storing and querying ActivityLog.date and AgentScreenshot.date.
 */
function getOrgDateForTimestamp(ts: Date, timezone: string = 'Asia/Kolkata'): Date {
  const dateStr = ts.toLocaleDateString('en-CA', { timeZone: timezone }); // en-CA → YYYY-MM-DD
  return new Date(dateStr + 'T00:00:00.000Z');
}

/** Today's date at midnight in org timezone — shorthand for getOrgDateForTimestamp(new Date()) */
function getOrgToday(timezone: string = 'Asia/Kolkata'): Date {
  return getOrgDateForTimestamp(new Date(), timezone);
}

export class AgentService {
  async submitHeartbeat(employeeId: string, organizationId: string, activities: ActivityEntry[], userId: string) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    const today = getOrgToday(org?.timezone ?? 'Asia/Kolkata');

    // Update agentLastSeenAt on every heartbeat — tracks when agent was last active.
    // agentPairedAt is preserved (only set during verifyPairCode) — not overwritten here.
    await prisma.employee.updateMany({
      where: { id: employeeId, organizationId },
      data: { agentLastSeenAt: new Date() },
    });

    // CALC-001: Derive each entry's date from its own timestamp using the org timezone.
    // Previously all records used `today` (server clock at request time). When an agent buffers
    // entries from before midnight and syncs after midnight, all pre-midnight entries were
    // assigned today's date — causing multi-day idle/active totals to pile onto one day.
    const timezone = org?.timezone ?? 'Asia/Kolkata';
    const records = activities.map(a => {
      const entryTs = new Date(a.timestamp);
      return {
        employeeId,
        organizationId,
        date: getOrgDateForTimestamp(entryTs, timezone),
        timestamp: entryTs,
        activeApp: a.activeApp || null,
        activeWindow: a.activeWindow || null,
        activeUrl: a.activeUrl || null,
        category: a.category || null,
        // CALC-002: Per-entry idleSeconds can't exceed durationSeconds (the tracking interval).
        // An idle second value larger than the tick duration is always a bug from the agent.
        durationSeconds: a.durationSeconds,
        idleSeconds: Math.min(a.idleSeconds, a.durationSeconds),
        keystrokes: a.keystrokes,
        mouseClicks: a.mouseClicks,
        mouseDistance: a.mouseDistance,
      };
    });

    // FIX 2: Wrap createMany + attendanceRecord.updateMany in a single interactive $transaction
    // to prevent race conditions where attendance could be incremented without the activityLog
    // rows being committed (e.g., DB crash or agent retry between the two writes).
    const totalActiveSeconds = activities.reduce((sum, a) => sum + a.durationSeconds, 0);
    const activeMinutesIncrement = Math.round(totalActiveSeconds / 60);

    let inserted: { count: number };
    let scaledIncrement = 0;

    ({ inserted, scaledIncrement } = await prisma.$transaction(async (tx) => {
      const ins = await tx.activityLog.createMany({ data: records, skipDuplicates: true });

      // Only increment attendance active minutes for genuinely new records.
      // Skipping when count===0 prevents double-incrementing on agent retries where all
      // entries were already stored (skipDuplicates) but the previous HTTP response was lost.
      let scaled = 0;
      if (totalActiveSeconds > 0 && ins.count > 0) {
        // Scale increment proportionally if only some records were new (partial batch retry)
        scaled = ins.count === activities.length
          ? activeMinutesIncrement
          : Math.round((totalActiveSeconds * ins.count / activities.length) / 60);
        await tx.attendanceRecord.updateMany({
          where: { employeeId, date: today, checkOut: null },
          data: {
            activeMinutes: { increment: scaled },
            activityPulses: { increment: 1 },
          },
        });
      }

      return { inserted: ins, scaledIncrement: scaled };
    }));

    // Audit once per employee per day — SET NX is atomic; prevents duplicate logs on concurrent heartbeats
    const todayStr = today.toISOString().split('T')[0];
    const auditKey = `agent-heartbeat-audit:${organizationId}:${employeeId}:${todayStr}`;
    const wasSet = await redis.set(auditKey, '1', 'EX', 90000, 'NX');
    if (wasSet) {
      await createAuditLog({ userId, organizationId, entity: 'ActivityLog', entityId: employeeId, action: 'CREATE', newValue: { note: 'Activity monitoring started', date: todayStr } });
    }

    // Emit real-time agent status to org (so admin dashboard + live feed updates)
    const lastActivity = activities[activities.length - 1];
    // Aggregate keystrokes/clicks from the entire batch for this heartbeat
    const batchKeystrokes = activities.reduce((sum, a) => sum + a.keystrokes, 0);
    const batchClicks = activities.reduce((sum, a) => sum + a.mouseClicks, 0);

    // HIGH-005: Cache admin user IDs in Redis (5-minute TTL) so we don't query the DB on every
    // heartbeat. At 30s intervals with 10 agents, that's 20 DB queries/min just for admin IDs.
    const adminCacheKey = `agent-admins:${organizationId}`;
    let adminIds: string[];
    const cachedAdmins = await redis.get(adminCacheKey);
    if (cachedAdmins) {
      adminIds = safeJsonParse<string[]>(cachedAdmins) ?? [];
    } else {
      const admins = await prisma.user.findMany({
        where: { organizationId, role: { in: ['SUPER_ADMIN', 'ADMIN'] }, status: 'ACTIVE' },
        select: { id: true },
      });
      adminIds = admins.map(a => a.id);
      await redis.set(adminCacheKey, JSON.stringify(adminIds), 'EX', 300); // 5-minute TTL
    }

    // Scope heartbeat to admins only — employee window titles are sensitive data
    // and must not be broadcast to all org members. We emit per-admin to their
    // personal room; the frontend org-level listeners on admin sessions pick it up.
    const heartbeatPayload = {
      employeeId,
      activeApp: lastActivity?.activeApp || 'Unknown',
      activeWindow: lastActivity?.activeWindow || '',
      activeUrl: lastActivity?.activeUrl || '',
      category: lastActivity?.category || 'NEUTRAL',
      idleSeconds: lastActivity?.idleSeconds || 0,
      keystrokes: batchKeystrokes,
      mouseClicks: batchClicks,
      mouseDistance: activities.reduce((sum, a) => sum + a.mouseDistance, 0),
      durationSeconds: lastActivity?.durationSeconds || 0,
      timestamp: new Date().toISOString(),
    };
    for (const adminId of adminIds) {
      emitToUser(adminId, 'agent:heartbeat', heartbeatPayload);
    }
    // Emit to the employee's own session (userId is already in scope from the JWT context)
    emitToUser(userId, 'agent:connected', { isActive: true });

    // FIX 2: Return actual increment added (0 if no new records inserted on retry)
    return { recorded: activities.length, activeMinutesAdded: inserted.count > 0 ? scaledIncrement : 0 };
  }

  /**
   * FIX 1a: Lightweight ping — stores last-seen timestamp in Redis only (no DB insert).
   * The 15-minute TTL means a stale key auto-expires if the agent goes offline.
   * Also updates Employee.lastSeenAt so the admin list shows a human-readable "last seen" time.
   */
  async recordPing(employeeId: string, organizationId: string, userId: string) {
    const now = new Date().toISOString();

    // Write ping timestamp to Redis with 15-minute TTL (no DB row)
    // SEC-003: Key includes organizationId to prevent cross-org namespace collision
    await redis.set(`${AGENT_PING_PREFIX}${organizationId}:${employeeId}`, now, 'EX', 900);

    // Update agentLastSeenAt so the admin table shows accurate last-active time.
    // agentPairedAt is NOT touched here — it is set only once during verifyPairCode.
    await prisma.employee.updateMany({
      where: { id: employeeId, organizationId },
      data: { agentLastSeenAt: new Date() },
    });

    // HIGH-005: Use cached admin IDs — same cache as heartbeat (5-minute TTL)
    const adminCacheKey = `agent-admins:${organizationId}`;
    let pingAdminIds: string[];
    const cachedPingAdmins = await redis.get(adminCacheKey);
    if (cachedPingAdmins) {
      pingAdminIds = safeJsonParse<string[]>(cachedPingAdmins) ?? [];
    } else {
      const admins = await prisma.user.findMany({
        where: { organizationId, role: { in: ['SUPER_ADMIN', 'ADMIN'] }, status: 'ACTIVE' },
        select: { id: true },
      });
      pingAdminIds = admins.map(a => a.id);
      await redis.set(adminCacheKey, JSON.stringify(pingAdminIds), 'EX', 300);
    }
    for (const adminId of pingAdminIds) {
      emitToUser(adminId, 'agent:ping', { employeeId, timestamp: now });
    }

    return { ok: true, timestamp: now };
  }

  async saveScreenshot(employeeId: string, organizationId: string, imageUrl: string, metadata: ScreenshotMetadata, userId: string) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    const today = getOrgToday(org?.timezone ?? 'Asia/Kolkata');

    const screenshot = await prisma.agentScreenshot.create({
      data: {
        employeeId,
        organizationId,
        date: today,
        timestamp: metadata.timestamp ? new Date(metadata.timestamp) : new Date(),
        imageUrl,
        activeApp: metadata.activeApp || null,
        activeWindow: metadata.activeWindow || null,
      },
    });

    await createAuditLog({ userId, organizationId, entity: 'AgentScreenshot', entityId: screenshot.id, action: 'CREATE', newValue: { imageUrl, activeApp: metadata.activeApp } });
    return screenshot;
  }

  async getConfig(employeeId: string, organizationId?: string) {
    const org = organizationId
      ? await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } })
      : null;
    const today = getOrgToday(org?.timezone ?? 'Asia/Kolkata');

    const assignment = await prisma.shiftAssignment.findFirst({
      where: {
        employeeId,
        startDate: { lte: today },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      include: { shift: true },
    });

    const liveData = await redis.get(`${LIVE_VIEW_PREFIX}${employeeId}`);
    const liveMode = safeJsonParse(liveData);

    // Per-employee screenshot interval (set by admin), default 600s (10min)
    const storedInterval = await redis.get(`${SCREENSHOT_INTERVAL_PREFIX}${employeeId}`);
    const defaultScreenshotInterval = storedInterval ? parseInt(storedInterval, 10) : 600;

    return {
      enabled: true,
      shiftType: assignment?.shift?.shiftType || 'OFFICE',
      trackingIntervalSeconds: 30,
      screenshotIntervalSeconds: liveMode?.enabled ? (liveMode.intervalSeconds || 30) : defaultScreenshotInterval,
      syncIntervalMinutes: 5,
      idleThresholdSeconds: 300,
      screenshotsEnabled: true,
      inputTrackingEnabled: true,
      liveMode: liveMode?.enabled || false,
    };
  }

  async setLiveMode(employeeId: string, organizationId: string, enabled: boolean, intervalSeconds: number = 30, userId: string) {
    // C2: verify employee belongs to this org before writing to Redis
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundError('Employee');

    if (enabled) {
      // 8-hour TTL — covers a full work shift without cutting off mid-session.
      // Old 1hr TTL caused live streams to silently die for long monitoring sessions.
      await redis.set(`${LIVE_VIEW_PREFIX}${employeeId}`, JSON.stringify({ enabled, intervalSeconds }), 'EX', 28800);
    } else {
      await redis.del(`${LIVE_VIEW_PREFIX}${employeeId}`);
    }

    // Notify agent via socket so it picks up new screenshot interval immediately
    // (agent also polls /config every 5min as fallback)
    const user = await prisma.user.findFirst({
      where: { employee: { id: employeeId } },
      select: { id: true },
    });
    if (user) {
      // Use emitToAgent (room: agent:${userId}) not emitToUser (room: user:${userId}).
      // The desktop EXE joins the agent: room on registration; browser sessions join user:.
      emitToAgent(user.id, 'agent:config-update', { liveMode: enabled, intervalSeconds });
    }

    await createAuditLog({ userId, organizationId, entity: 'Employee', entityId: employeeId, action: enabled ? 'LIVE_MODE_ENABLED' : 'LIVE_MODE_DISABLED', newValue: { enabled, intervalSeconds } });

    return { enabled, intervalSeconds };
  }

  async getLiveMode(employeeId: string, organizationId: string) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundError('Employee');

    const data = await redis.get(`${LIVE_VIEW_PREFIX}${employeeId}`);
    return safeJsonParse(data) || { enabled: false, intervalSeconds: 600 };
  }

  async setScreenshotInterval(employeeId: string, organizationId: string, intervalSeconds: number, userId: string) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundError('Employee');

    // Store with 90-day TTL (outlasts typical config change cycles)
    await redis.set(`${SCREENSHOT_INTERVAL_PREFIX}${employeeId}`, String(intervalSeconds), 'EX', 7776000);

    // Notify agent to pick up new config
    const user = await prisma.user.findFirst({
      where: { employee: { id: employeeId } },
      select: { id: true },
    });
    if (user) {
      emitToAgent(user.id, 'agent:config-update', { screenshotIntervalSeconds: intervalSeconds });
    }

    await createAuditLog({ userId, organizationId, entity: 'Employee', entityId: employeeId, action: 'UPDATE', newValue: { screenshotIntervalSeconds: intervalSeconds } });
    return { employeeId, intervalSeconds };
  }

  async getScreenshotInterval(employeeId: string, organizationId: string) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundError('Employee');
    const stored = await redis.get(`${SCREENSHOT_INTERVAL_PREFIX}${employeeId}`);
    return { intervalSeconds: stored ? parseInt(stored, 10) : 600 };
  }

  async getActivityLogs(employeeId: string, date: string, organizationId: string) {
    // Validate employee belongs to this organization
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundError('Employee');

    const queryDate = new Date(date + 'T00:00:00.000Z');
    if (isNaN(queryDate.getTime())) throw new BadRequestError('Invalid date format');

    // FIX 1d: Exclude ping rows (durationSeconds=0) — pings are lightweight Redis-only writes
    // and should not pollute the activity log view or Excel export.
    const logs = await prisma.activityLog.findMany({
      where: { employeeId, date: queryDate, organizationId, durationSeconds: { gt: 0 } },
      orderBy: { timestamp: 'asc' },
      take: 2000,
      select: {
        id: true, employeeId: true, date: true, timestamp: true,
        activeApp: true, activeWindow: true, activeUrl: true, category: true,
        durationSeconds: true, idleSeconds: true,
        keystrokes: true, mouseClicks: true, mouseDistance: true,
      },
    });

    // Aggregate top apps
    const appMap = new Map<string, number>();
    let totalActive = 0, totalIdle = 0, totalKeystrokes = 0, totalClicks = 0, totalMouseDistance = 0;

    logs.forEach(l => {
      if (l.activeApp) {
        appMap.set(l.activeApp, (appMap.get(l.activeApp) || 0) + l.durationSeconds);
      }
      totalActive += l.durationSeconds;
      totalIdle += l.idleSeconds;
      totalKeystrokes += l.keystrokes;
      totalClicks += l.mouseClicks;
      totalMouseDistance += l.mouseDistance;
    });

    const topApps = [...appMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([app, seconds]) => ({ app, minutes: Math.round(seconds / 60) }));

    // Productivity score: percentage of tracked time spent on PRODUCTIVE apps (0–100)
    let productiveSeconds = 0, unproductiveSeconds = 0;
    logs.forEach(l => {
      if (l.category === 'PRODUCTIVE') productiveSeconds += l.durationSeconds;
      else if (l.category === 'UNPRODUCTIVE') unproductiveSeconds += l.durationSeconds;
    });
    const productivityScore = totalActive > 0
      ? Math.round((productiveSeconds / totalActive) * 100)
      : null;

    // CALC-002: Cap daily totals at physical maximums (86400s = 24h).
    // Without a cap, date-boundary bugs or malicious agents can produce values like "241h idle".
    const cappedActive = Math.min(totalActive, 86400);
    const cappedIdle = Math.min(totalIdle, 86400);
    const cappedProductive = Math.min(productiveSeconds, cappedActive);
    const cappedUnproductive = Math.min(unproductiveSeconds, cappedActive - cappedProductive);
    const cappedProductivityScore = cappedActive > 0
      ? Math.round((cappedProductive / cappedActive) * 100)
      : null;

    return {
      logs,
      summary: {
        totalActiveMinutes: Math.round(cappedActive / 60),
        totalIdleMinutes: Math.round(cappedIdle / 60),
        totalKeystrokes,
        totalClicks,
        totalMouseDistance,
        topApps,
        logCount: logs.length,
        productivityScore: cappedProductivityScore,
        productiveMinutes: Math.round(cappedProductive / 60),
        unproductiveMinutes: Math.round(cappedUnproductive / 60),
      },
    };
  }

  async getScreenshots(employeeId: string, date: string, organizationId: string) {
    // Validate employee belongs to this organization
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundError('Employee');

    const queryDate = new Date(date + 'T00:00:00.000Z');
    if (isNaN(queryDate.getTime())) throw new BadRequestError('Invalid date format');

    return prisma.agentScreenshot.findMany({
      where: { employeeId, date: queryDate, organizationId },
      orderBy: { timestamp: 'asc' },
      take: 500,
    });
  }

  async deleteScreenshot(screenshotId: string, organizationId: string, userId: string) {
    const screenshot = await prisma.agentScreenshot.findFirst({
      where: { id: screenshotId, organizationId },
      select: { id: true, imageUrl: true, employeeId: true },
    });
    if (!screenshot) throw new NotFoundError('Screenshot');

    await prisma.agentScreenshot.delete({ where: { id: screenshotId } });

    // Delete file (best-effort)
    if (screenshot.imageUrl) {
      try {
        const { storageService } = await import('../../services/storage.service.js');
        await storageService.deleteFile(screenshot.imageUrl);
      } catch {}
    }

    await createAuditLog({ userId, organizationId, entity: 'AgentScreenshot', entityId: screenshotId, action: 'DELETE', newValue: { screenshotId } });
    return { deleted: true };
  }

  async deleteActivityByDate(employeeId: string, date: string, organizationId: string, userId: string) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundError('Employee');

    const queryDate = new Date(date + 'T00:00:00.000Z');
    if (isNaN(queryDate.getTime())) throw new BadRequestError('Invalid date format');

    // Collect screenshot file paths before deletion (needed for physical file cleanup)
    const screenshots = await prisma.agentScreenshot.findMany({
      where: { employeeId, date: queryDate, organizationId },
      select: { id: true, imageUrl: true },
    });

    // MED-008: Wrap both deletes in a transaction so a crash between them doesn't leave
    // orphaned screenshot rows without log rows or vice versa.
    const { logsDeleted, screenshotsDeleted } = await prisma.$transaction(async (tx) => {
      const { count: logs } = await tx.activityLog.deleteMany({
        where: { employeeId, date: queryDate, organizationId },
      });
      const { count: shots } = await tx.agentScreenshot.deleteMany({
        where: { employeeId, date: queryDate, organizationId },
      });
      return { logsDeleted: logs, screenshotsDeleted: shots };
    });

    // Delete screenshot files (best-effort, non-blocking)
    for (const s of screenshots) {
      if (s.imageUrl) {
        try {
          const { storageService } = await import('../../services/storage.service.js');
          await storageService.deleteFile(s.imageUrl);
        } catch {}
      }
    }

    await createAuditLog({ userId, organizationId, entity: 'ActivityLog', entityId: employeeId, action: 'DELETE', newValue: { date, logsDeleted, screenshotsDeleted } });
    return { date, logsDeleted, screenshotsDeleted };
  }

  async getAgentStatus(employeeId: string, organizationId: string) {
    const now = new Date();
    // Agent syncs every 5 minutes — use 7-minute window (5min sync + 2min grace)
    // to prevent agents from flickering Offline between sync cycles.
    const thresholdAgo = new Date(now.getTime() - 7 * 60 * 1000);

    // FIX 1b: Check Redis ping key first — avoids DB query entirely for active agents
    // SEC-003: Key includes organizationId prefix
    const pingKey = await redis.get(`${AGENT_PING_PREFIX}${organizationId}:${employeeId}`);
    if (pingKey) {
      const pingTime = new Date(pingKey);
      if (pingTime > thresholdAgo) {
        return { isActive: true, lastHeartbeat: pingTime.toISOString() };
      }
    }

    // Check agentLastSeenAt on the employee record — updated on every ping/heartbeat.
    // This avoids a full activityLog table scan for recently-seen agents.
    const empRow = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
      select: { agentLastSeenAt: true },
    });
    if (empRow?.agentLastSeenAt && empRow.agentLastSeenAt > thresholdAgo) {
      return { isActive: true, lastHeartbeat: empRow.agentLastSeenAt.toISOString() };
    }

    // Final fallback: activityLog scan for agents that missed the agentLastSeenAt migration
    const lastLog = await prisma.activityLog.findFirst({
      where: { employeeId, organizationId, timestamp: { gte: thresholdAgo } },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    });

    const isActive = !!lastLog;

    return {
      isActive,
      lastHeartbeat: lastLog?.timestamp?.toISOString() || empRow?.agentLastSeenAt?.toISOString() || null,
    };
  }
  /**
   * Bug #9: Return per-employee activity summary for a given date in one query.
   * Replaces the N+1 pattern where each EmployeeRow called /activity/:id/:date separately.
   * Returns a map of employeeId → { logCount, totalActiveMinutes, totalIdleMinutes }.
   */
  async getActivityBulkSummary(organizationId: string, date: string) {
    const queryDate = new Date(date + 'T00:00:00.000Z');
    if (isNaN(queryDate.getTime())) throw new BadRequestError('Invalid date format');

    // FIX 1e: Exclude ping rows (durationSeconds=0) from bulk summary aggregations
    // MED-006: Scope to employees that are not soft-deleted to prevent stale entries in the list
    const [results, productiveResults] = await Promise.all([
      prisma.activityLog.groupBy({
        by: ['employeeId'],
        where: { organizationId, date: queryDate, durationSeconds: { gt: 0 }, employee: { deletedAt: null } },
        _count: { id: true },
        _sum: { durationSeconds: true, idleSeconds: true },
      }),
      prisma.activityLog.groupBy({
        by: ['employeeId'],
        where: { organizationId, date: queryDate, category: 'PRODUCTIVE', durationSeconds: { gt: 0 }, employee: { deletedAt: null } },
        _sum: { durationSeconds: true },
      }),
    ]);

    const productiveMap = new Map(productiveResults.map(r => [r.employeeId, r._sum.durationSeconds || 0]));

    const summaryMap: Record<string, { logCount: number; totalActiveMinutes: number; totalIdleMinutes: number; productivityScore: number | null }> = {};
    for (const r of results) {
      // CALC-002: Cap at 86400s (24h) to guard against date-boundary accumulation bugs.
      const totalSeconds = Math.min(r._sum.durationSeconds || 0, 86400);
      const totalIdleSeconds = Math.min(r._sum.idleSeconds || 0, 86400);
      const productiveSeconds = Math.min(productiveMap.get(r.employeeId) || 0, totalSeconds);
      summaryMap[r.employeeId] = {
        logCount: r._count.id,
        totalActiveMinutes: Math.round(totalSeconds / 60),
        totalIdleMinutes: Math.round(totalIdleSeconds / 60),
        productivityScore: totalSeconds > 0 ? Math.round((productiveSeconds / totalSeconds) * 100) : null,
      };
    }
    return summaryMap;
  }

  // ===================== ENTERPRISE AGENT SETUP =====================

  private generateCode(): string {
    let code = 'ANST-';
    for (let i = 0; i < 4; i++) code += PAIR_CHARS[crypto.randomInt(PAIR_CHARS.length)];
    return code;
  }

  /**
   * Generate a permanent pairing code for an employee. Stored in DB, not Redis.
   * If a code already exists, returns the existing one.
   */
  async generatePermanentCode(employeeId: string, organizationId: string, userId: string) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      select: { id: true, agentPairingCode: true, firstName: true, lastName: true, employeeCode: true },
    });
    if (!employee) throw new NotFoundError('Employee');

    if (employee.agentPairingCode) {
      return { code: employee.agentPairingCode, isNew: false };
    }

    // Generate unique code with retry on collision
    let code: string;
    let attempts = 0;
    while (true) {
      code = this.generateCode();
      const existing = await prisma.employee.findUnique({ where: { agentPairingCode: code } });
      if (!existing) break;
      attempts++;
      if (attempts > 10) throw new BadRequestError('Failed to generate unique code. Please try again.');
    }

    await prisma.employee.update({
      where: { id: employeeId },
      data: { agentPairingCode: code },
    });

    await createAuditLog({
      userId, organizationId, entity: 'Employee', entityId: employeeId,
      action: 'UPDATE', newValue: { agentPairingCode: code, action: 'generate_agent_code' },
    });

    return { code, isNew: true };
  }

  /**
   * Regenerate a new code for an employee (replaces old one).
   * The old code is saved to AgentPairingCodeHistory before being replaced.
   */
  async regenerateCode(employeeId: string, organizationId: string, userId: string) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
    });
    if (!employee) throw new NotFoundError('Employee');

    // Generate unique code before the transaction (findUnique not available in interactive tx)
    let code: string;
    let attempts = 0;
    while (true) {
      code = this.generateCode();
      const existing = await prisma.employee.findUnique({ where: { agentPairingCode: code } });
      if (!existing) break;
      attempts++;
      if (attempts > 10) throw new BadRequestError('Failed to generate unique code. Please try again.');
    }

    // BUG-007: Wrap history save + code update in a single transaction — without this,
    // a crash between the two writes leaves the history saved but the code not updated,
    // or the code updated but the history entry missing.
    await prisma.$transaction(async (tx) => {
      if (employee.agentPairingCode) {
        await tx.agentPairingCodeHistory.create({
          data: {
            employeeId,
            organizationId,
            code: employee.agentPairingCode,
            isConnected: !!employee.agentPairedAt,
            connectedAt: employee.agentPairedAt || null,
            revokedAt: new Date(),
          },
        });
      }
      await tx.employee.update({
        where: { id: employeeId },
        data: { agentPairingCode: code, agentPairedAt: null, agentLastSeenAt: null },
      });
    });

    // FIX 4: Revoke outstanding agent tokens for this employee by writing a Redis flag.
    // The auth middleware checks this flag on every agent request and returns 401 if set.
    // TTL = 90 days (matches agent JWT max lifetime).
    await redis.set(`revoked:agent:${employeeId}`, Date.now().toString(), 'EX', 90 * 24 * 3600);

    await createAuditLog({
      userId, organizationId, entity: 'Employee', entityId: employeeId,
      action: 'UPDATE', newValue: { agentPairingCode: code, action: 'regenerate_agent_code' },
    });

    return { code, isNew: false };
  }

  /**
   * Get all pairing code history for an employee (current + historical).
   */
  async getCodeHistory(employeeId: string, organizationId: string) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      select: { id: true, agentPairingCode: true, agentPairedAt: true, agentLastSeenAt: true },
    });
    if (!employee) throw new NotFoundError('Employee');

    const history = await prisma.agentPairingCodeHistory.findMany({
      where: { employeeId, organizationId },
      orderBy: { createdAt: 'desc' },
    });

    // If agentPairingCode is null on the employee row (e.g. data was migrated or partially reset),
    // fall back to the most recent history entry so the modal never incorrectly shows "No code generated yet".
    const latestHistoryCode = history.length > 0 ? history[0].code : null;
    const effectiveCurrentCode = employee.agentPairingCode ?? latestHistoryCode;

    return {
      currentCode: effectiveCurrentCode,
      currentCodeConnected: !!employee.agentPairedAt,
      currentCodeLastSeen: employee.agentLastSeenAt?.toISOString() || null,
      history,
    };
  }

  /**
   * Delete an unused historical pairing code entry.
   * Connected codes cannot be deleted (agent may still hold valid tokens issued from that code).
   * FIX 3: employeeId is derived from the DB record — not trusted from request body.
   */
  async deleteHistoryCode(historyId: string, organizationId: string, userId: string) {
    // Look up entry by id + organizationId only — no body-supplied employeeId
    const entry = await prisma.agentPairingCodeHistory.findFirst({
      where: { id: historyId, organizationId },
    });
    if (!entry) throw new NotFoundError('Code history entry');
    if (entry.isConnected) {
      throw new BadRequestError('Cannot delete a code that was used to connect an agent — the agent may still be using tokens issued from this code.');
    }

    // FIX 3: Use entry.employeeId from DB (not from request body) for audit log
    await prisma.agentPairingCodeHistory.delete({ where: { id: historyId } });
    await createAuditLog({
      userId, organizationId, entity: 'Employee', entityId: entry.employeeId,
      action: 'DELETE', newValue: { deletedCode: entry.code, action: 'delete_unused_agent_code' },
    });
    return { deleted: true };
  }

  /**
   * Get all employees with their agent status (for admin Agent Setup tab).
   */
  async getEmployeesWithAgentStatus(organizationId: string) {
    const employees = await prisma.employee.findMany({
      where: { organizationId, deletedAt: null, isSystemAccount: false },
      select: {
        id: true, firstName: true, lastName: true, employeeCode: true, avatar: true,
        workMode: true, agentPairingCode: true, agentPairedAt: true, agentLastSeenAt: true,
        department: { select: { name: true } },
        user: { select: { email: true } },
      },
      orderBy: { firstName: 'asc' },
    });

    // FIX 1c: Check Redis ping keys first — employees with fresh pings skip DB entirely
    // 7-minute threshold: agent syncs every 5min, +2min grace to avoid false Offline flickers
    const activeThreshold = new Date(Date.now() - 7 * 60 * 1000);

    // Fetch all Redis ping keys in parallel
    // SEC-003: Key includes organizationId prefix
    const pingValues = await Promise.all(
      employees.map(emp => redis.get(`${AGENT_PING_PREFIX}${organizationId}:${emp.id}`))
    );
    const redisPingMap = new Map<string, Date>();
    employees.forEach((emp, i) => {
      const val = pingValues[i];
      if (val) redisPingMap.set(emp.id, new Date(val));
    });

    // Only query DB for employees without a fresh Redis ping
    const employeesNeedingDb = employees.filter(emp => {
      const pingTime = redisPingMap.get(emp.id);
      return !pingTime || pingTime <= activeThreshold;
    });

    const heartbeatMap = new Map<string, Date | null>();
    if (employeesNeedingDb.length > 0) {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentLogs = await prisma.activityLog.groupBy({
        by: ['employeeId'],
        where: {
          organizationId,
          employeeId: { in: employeesNeedingDb.map(e => e.id) },
          timestamp: { gte: oneDayAgo },
        },
        _max: { timestamp: true },
      });
      recentLogs.forEach(r => heartbeatMap.set(r.employeeId, r._max.timestamp));
    }

    return employees.map(emp => {
      const pingTime = redisPingMap.get(emp.id);
      const dbHeartbeat = heartbeatMap.get(emp.id) || null;
      // Prefer Redis ping if available and fresh
      const lastHeartbeatDate = pingTime && pingTime > activeThreshold
        ? pingTime
        : dbHeartbeat;
      const isActive = !!lastHeartbeatDate && new Date(lastHeartbeatDate) > activeThreshold;
      return {
        ...emp,
        email: emp.user?.email || null,
        department: emp.department?.name || null,
        agentStatus: { isActive, lastHeartbeat: lastHeartbeatDate?.toISOString() || null },
      };
    });
  }

  /**
   * Bulk generate codes for all employees without one.
   */
  async bulkGenerateCodes(organizationId: string, userId: string) {
    const employees = await prisma.employee.findMany({
      where: { organizationId, deletedAt: null, isSystemAccount: false, agentPairingCode: null },
      select: { id: true },
    });

    const BATCH_SIZE = 10;
    let generated = 0;
    for (let i = 0; i < employees.length; i += BATCH_SIZE) {
      const batch = employees.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(emp => this.generatePermanentCode(emp.id, organizationId, userId)));
      generated += batch.length;
    }

    return { generated, total: employees.length };
  }

  // ===================== ACTIVITY EXCEL EXPORT =====================

  /**
   * Export activity logs for a single employee + date as an Excel workbook.
   * Returns a Buffer suitable for streaming directly as a download response.
   */
  async exportActivityExcel(employeeId: string, organizationId: string, date: string, userId: string): Promise<Buffer> {
    const queryDate = new Date(date + 'T00:00:00.000Z');
    if (isNaN(queryDate.getTime())) throw new BadRequestError('Invalid date format');

    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      select: { firstName: true, lastName: true, employeeCode: true },
    });
    if (!employee) throw new NotFoundError('Employee');

    // DATA-001: Exclude ping rows (durationSeconds=0) — same filter as getActivityLogs view
    const logs = await prisma.activityLog.findMany({
      where: { employeeId, date: queryDate, organizationId, durationSeconds: { gt: 0 } },
      orderBy: { timestamp: 'asc' },
    });

    const screenshots = await prisma.agentScreenshot.findMany({
      where: { employeeId, date: queryDate, organizationId },
      orderBy: { timestamp: 'asc' },
      select: { timestamp: true, activeApp: true, activeWindow: true, imageUrl: true },
    });

    const BRAND = '4F46E5';
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Aniston HRMS';
    wb.created = new Date();

    // ── Sheet 1: Activity Log ─────────────────────────────────────────────────
    const logSheet = wb.addWorksheet('Activity Log', { views: [{ state: 'frozen', ySplit: 1 }] });
    logSheet.columns = [
      { header: 'Time', key: 'time', width: 12 },
      { header: 'Application', key: 'app', width: 28 },
      { header: 'Window Title', key: 'window', width: 40 },
      { header: 'Category', key: 'category', width: 14 },
      { header: 'Duration (s)', key: 'duration', width: 14 },
      { header: 'Idle (s)', key: 'idle', width: 12 },
      { header: 'Keystrokes', key: 'keys', width: 12 },
      { header: 'Clicks', key: 'clicks', width: 10 },
    ];
    logSheet.getRow(1).eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
      cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    logSheet.getRow(1).height = 24;

    logs.forEach((l, i) => {
      const row = logSheet.addRow({
        time: new Date(l.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' }),
        app: l.activeApp || '',
        window: l.activeWindow || '',
        category: l.category || 'NEUTRAL',
        duration: l.durationSeconds,
        idle: l.idleSeconds,
        keys: l.keystrokes,
        clicks: l.mouseClicks,
      });
      if (i % 2 === 1) {
        row.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8F7FF' } }; });
      }
      const catCell = row.getCell('category');
      if (l.category === 'PRODUCTIVE') catCell.font = { color: { argb: '059669' }, bold: true };
      else if (l.category === 'UNPRODUCTIVE') catCell.font = { color: { argb: 'DC2626' }, bold: true };
    });

    // ── Sheet 2: Summary ─────────────────────────────────────────────────────
    const sumSheet = wb.addWorksheet('Summary');
    const totalActive = logs.reduce((s, l) => s + l.durationSeconds, 0);
    const totalIdle = logs.reduce((s, l) => s + l.idleSeconds, 0);
    const productive = logs.filter(l => l.category === 'PRODUCTIVE').reduce((s, l) => s + l.durationSeconds, 0);
    const unproductive = logs.filter(l => l.category === 'UNPRODUCTIVE').reduce((s, l) => s + l.durationSeconds, 0);
    const score = totalActive > 0 ? Math.round((productive / totalActive) * 100) : 0;

    const summaryData = [
      ['Employee', `${employee.firstName} ${employee.lastName} (${employee.employeeCode})`],
      ['Date', date],
      ['Total Activity Entries', logs.length],
      ['Active Time (min)', Math.round(totalActive / 60)],
      ['Idle Time (min)', Math.round(totalIdle / 60)],
      ['Productive Time (min)', Math.round(productive / 60)],
      ['Unproductive Time (min)', Math.round(unproductive / 60)],
      ['Productivity Score', `${score}%`],
      ['Total Keystrokes', logs.reduce((s, l) => s + l.keystrokes, 0)],
      ['Total Clicks', logs.reduce((s, l) => s + l.mouseClicks, 0)],
      ['Screenshots Captured', screenshots.length],
    ];
    summaryData.forEach(([label, value]) => {
      const row = sumSheet.addRow([label, value]);
      row.getCell(1).font = { bold: true };
    });
    sumSheet.getColumn(1).width = 28;
    sumSheet.getColumn(2).width = 36;

    // ── Sheet 3: Top Apps ─────────────────────────────────────────────────────
    const appSheet = wb.addWorksheet('Top Apps', { views: [{ state: 'frozen', ySplit: 1 }] });
    appSheet.columns = [
      { header: 'Application', key: 'app', width: 30 },
      { header: 'Time (min)', key: 'minutes', width: 14 },
      { header: 'Category', key: 'cat', width: 16 },
    ];
    appSheet.getRow(1).eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
      cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
      cell.alignment = { horizontal: 'center' };
    });
    const appMap = new Map<string, { seconds: number; category: string }>();
    logs.forEach(l => {
      if (!l.activeApp) return;
      const existing = appMap.get(l.activeApp) || { seconds: 0, category: l.category || 'NEUTRAL' };
      existing.seconds += l.durationSeconds;
      appMap.set(l.activeApp, existing);
    });
    [...appMap.entries()].sort((a, b) => b[1].seconds - a[1].seconds).forEach(([app, data]) => {
      appSheet.addRow({ app, minutes: Math.round(data.seconds / 60), cat: data.category });
    });

    await createAuditLog({ userId, organizationId, entity: 'ActivityLog', entityId: employeeId, action: 'EXPORT', newValue: { date, format: 'xlsx' } });
    const raw = await wb.xlsx.writeBuffer();
    return Buffer.from(raw);
  }

  // ===================== LEGACY PAIRING (backward compat) =====================

  /**
   * @deprecated Use generatePermanentCode instead. Kept for backward compat.
   */
  async generatePairCode(userId: string, employeeId: string, organizationId: string) {
    const code = this.generateCode();
    await redis.set(`${PAIR_PREFIX}${code}`, JSON.stringify({ userId, employeeId, organizationId }), 'EX', 300);
    return { code, expiresIn: 300 };
  }

  /**
   * Verify a pairing code. Checks DB (permanent) first, then Redis (legacy).
   */
  async verifyPairCode(code: string) {
    // 1. Check DB for permanent code
    // SEC-002: Use findFirst with deletedAt: null — findUnique on agentPairingCode would match
    // soft-deleted employees, allowing a deleted employee's code to issue a valid JWT.
    const employee = await prisma.employee.findFirst({
      where: { agentPairingCode: code, deletedAt: null },
      include: { user: { select: { id: true, email: true, role: true } }, organization: { select: { id: true } } },
    });

    if (employee && employee.user) {
      // Verify user is active before issuing token
      const fullUser = await prisma.user.findUnique({ where: { id: employee.user.id }, select: { status: true } });
      if (fullUser?.status !== 'ACTIVE') throw new BadRequestError('User account is not active. Contact your administrator.');

      // FIX 4: Clear any revocation flag when a new pairing is established.
      // This allows re-pairing after a code regeneration without false 401s.
      await redis.del(`revoked:agent:${employee.id}`);

      // Mark as paired
      await prisma.employee.update({
        where: { id: employee.id },
        data: { agentPairedAt: new Date() },
      });

      // FIX 8: Include isAgent: true in JWT payload so auth middleware can enforce revocation
      const accessToken = jwt.sign(
        { userId: employee.user.id, email: employee.user.email, role: employee.user.role, organizationId: employee.organizationId, employeeId: employee.id, isAgent: true },
        env.JWT_SECRET,
        { expiresIn: '30d' }
      );

      const refreshToken = jwt.sign(
        { userId: employee.user.id, organizationId: employee.organizationId, employeeId: employee.id, type: 'agent-refresh', isAgent: true },
        env.JWT_SECRET,
        { expiresIn: '90d' }
      );

      return {
        accessToken,
        refreshToken,
        user: { email: employee.user.email, firstName: employee.firstName, lastName: employee.lastName },
      };
    }

    // 2. Fallback: check Redis (legacy temporary codes)
    const data = await redis.get(`${PAIR_PREFIX}${code}`);
    if (!data) throw new BadRequestError('Invalid or expired pairing code. Please check with your admin.');

    const parsed = safeJsonParse<{ userId: string; employeeId: string; organizationId: string }>(data);
    if (!parsed) throw new BadRequestError('Invalid pairing data. Please regenerate the code.');
    const { userId, employeeId, organizationId } = parsed;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { employee: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!user) throw new NotFoundError('User');

    // FIX 8: Include isAgent: true in JWT so auth middleware applies revocation check
    const accessToken = jwt.sign(
      { userId, email: user.email, role: user.role, organizationId, employeeId, isAgent: true },
      env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    const refreshToken = jwt.sign(
      { userId, organizationId, employeeId, type: 'agent-refresh', isAgent: true },
      env.JWT_SECRET,
      { expiresIn: '90d' }
    );

    await redis.del(`${PAIR_PREFIX}${code}`);
    // FIX 4: Clear any revocation flag for this employee on successful legacy pairing
    await redis.del(`revoked:agent:${employeeId}`);

    return {
      accessToken,
      refreshToken,
      user: { email: user.email, firstName: user.employee?.firstName, lastName: user.employee?.lastName },
    };
  }

  // ===================== EMPLOYEE REPORT (FIX 7) =====================

  /**
   * FIX 7: Per-employee productivity report over a date range.
   * Returns daily breakdowns, per-day scores/grades, overall summary, and top apps.
   * Excludes ping rows (durationSeconds = 0).
   */
  async getEmployeeReport(employeeId: string, organizationId: string, from: string, to: string) {
    // Validate employee belongs to org
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, employeeCode: true },
    });
    if (!employee) throw new NotFoundError('Employee');

    const fromDate = new Date(from + 'T00:00:00.000Z');
    const toDate = new Date(to + 'T00:00:00.000Z');
    // Include all logs up to (and including) the to-date
    const toDatePlusOne = new Date(toDate.getTime() + 24 * 60 * 60 * 1000);

    const logs = await prisma.activityLog.findMany({
      where: {
        employeeId,
        organizationId,
        timestamp: { gte: fromDate, lt: toDatePlusOne },
        durationSeconds: { gt: 0 }, // Exclude ping rows
      },
      orderBy: { timestamp: 'asc' },
      select: {
        date: true,
        timestamp: true,
        activeApp: true,
        category: true,
        durationSeconds: true,
        idleSeconds: true,
      },
    });

    // Group logs by date string (YYYY-MM-DD)
    const byDate = new Map<string, typeof logs>();
    for (const log of logs) {
      const dateStr = log.date instanceof Date
        ? log.date.toISOString().split('T')[0]
        : String(log.date).split('T')[0];
      if (!byDate.has(dateStr)) byDate.set(dateStr, []);
      byDate.get(dateStr)!.push(log);
    }

    // Compute per-day metrics
    // CALC-003: Use camelCase names matching the frontend AgentReportDay TypeScript type.
    const days: Array<{
      date: string;
      activeMinutes: number;
      idleMinutes: number;
      productiveMinutes: number;
      unproductiveMinutes: number;
      productivityScore: number | null;
      score: number;
      grade: string;
    }> = [];

    for (const [date, dayLogs] of byDate.entries()) {
      // CALC-002: Cap per-day totals at 86400s to guard against date-boundary accumulation bugs.
      const rawActiveSecs = dayLogs.reduce((s, l) => s + l.durationSeconds, 0);
      const rawIdleSecs = dayLogs.reduce((s, l) => s + l.idleSeconds, 0);
      const activeSecs = Math.min(rawActiveSecs, 86400);
      const idleSecs = Math.min(rawIdleSecs, 86400);
      const rawProductiveSecs = dayLogs.filter(l => l.category === 'PRODUCTIVE').reduce((s, l) => s + l.durationSeconds, 0);
      const rawUnproductiveSecs = dayLogs.filter(l => l.category === 'UNPRODUCTIVE').reduce((s, l) => s + l.durationSeconds, 0);
      const productiveSecs = Math.min(rawProductiveSecs, activeSecs);
      const unproductiveSecs = Math.min(rawUnproductiveSecs, activeSecs - productiveSecs);

      const activeMins = activeSecs / 60;
      const idleMins = idleSecs / 60;
      const productiveMins = productiveSecs / 60;
      const unproductiveMins = unproductiveSecs / 60;

      const activeRatio = (activeMins + idleMins) > 0 ? activeMins / (activeMins + idleMins) : 0;
      const productiveRatio = activeMins > 0 ? productiveMins / activeMins : 0;
      const rawScore = (activeRatio * 60) + (productiveRatio * 40);
      const score = Math.min(100, Math.max(0, Math.round(rawScore)));
      const productivityScore = activeSecs > 0 ? Math.round((productiveSecs / activeSecs) * 100) : null;

      const grade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B+' : score >= 60 ? 'B' : score >= 50 ? 'C' : 'D';

      days.push({
        date,
        activeMinutes: Math.round(activeMins),
        idleMinutes: Math.round(idleMins),
        productiveMinutes: Math.round(productiveMins),
        unproductiveMinutes: Math.round(unproductiveMins),
        productivityScore,
        score,
        grade,
      });
    }

    // Sort days chronologically
    days.sort((a, b) => a.date.localeCompare(b.date));

    // Overall summary
    const totalActiveMins = days.reduce((s, d) => s + d.activeMinutes, 0);
    const totalIdleMins = days.reduce((s, d) => s + d.idleMinutes, 0);
    const totalProductiveMins = days.reduce((s, d) => s + d.productiveMinutes, 0);
    const totalUnproductiveMins = days.reduce((s, d) => s + d.unproductiveMinutes, 0);
    const daysWithData = days.length;
    const averageDailyScore = daysWithData > 0
      ? Math.round(days.reduce((s, d) => s + d.score, 0) / daysWithData)
      : 0;
    const overallGrade = averageDailyScore >= 90 ? 'A+' : averageDailyScore >= 80 ? 'A' : averageDailyScore >= 70 ? 'B+' : averageDailyScore >= 60 ? 'B' : averageDailyScore >= 50 ? 'C' : 'D';

    // Top apps (all logs in range, aggregate durationSeconds by app)
    const appMap = new Map<string, number>();
    for (const log of logs) {
      if (!log.activeApp) continue;
      appMap.set(log.activeApp, (appMap.get(log.activeApp) || 0) + log.durationSeconds);
    }
    const totalAppSeconds = [...appMap.values()].reduce((s, v) => s + v, 0);
    const topApps = [...appMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([app, seconds]) => ({
        app,
        minutes: Math.round(seconds / 60),
        percentage: totalAppSeconds > 0 ? Math.round((seconds / totalAppSeconds) * 100) : 0,
      }));

    return {
      employee: {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`,
        code: employee.employeeCode,
      },
      from,
      to,
      days,
      summary: {
        totalActiveMins,
        totalIdleMins,
        totalProductiveMins,
        totalUnproductiveMins,
        averageDailyScore,
        grade: overallGrade,
        daysWithData,
      },
      topApps,
    };
  }

  /** BUG-003: Return server-configured retention window so frontend uses the real value. */
  getRetentionConfig() {
    return {
      activityRetentionDays: env.ACTIVITY_RETENTION_DAYS,
    };
  }
}

export const agentService = new AgentService();
