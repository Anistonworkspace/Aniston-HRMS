import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { env } from '../../config/env.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { emitToOrg, emitToUser } from '../../sockets/index.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import type { ActivityEntry, ScreenshotMetadata } from './agent.validation.js';

const PAIR_PREFIX = 'agent-pair:';
const LIVE_VIEW_PREFIX = 'agent-live:';
const PAIR_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Safely parse JSON from Redis — returns null on failure instead of crashing */
function safeJsonParse<T = any>(data: string | null): T | null {
  if (!data) return null;
  try { return JSON.parse(data); }
  catch { return null; }
}

/** Get today's date at midnight in the organization's timezone (defaults to Asia/Kolkata) */
function getOrgToday(timezone: string = 'Asia/Kolkata'): Date {
  // Format current time in org timezone to get the correct local date
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-CA', { timeZone: timezone }); // en-CA gives YYYY-MM-DD
  const localDate = new Date(dateStr + 'T00:00:00.000Z');
  return localDate;
}

export class AgentService {
  async submitHeartbeat(employeeId: string, organizationId: string, activities: ActivityEntry[], userId: string) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    const today = getOrgToday(org?.timezone ?? 'Asia/Kolkata');

    const records = activities.map(a => ({
      employeeId,
      organizationId,
      date: today,
      timestamp: new Date(a.timestamp),
      activeApp: a.activeApp || null,
      activeWindow: a.activeWindow || null,
      activeUrl: a.activeUrl || null,
      category: a.category || null,
      durationSeconds: a.durationSeconds,
      idleSeconds: a.idleSeconds,
      keystrokes: a.keystrokes,
      mouseClicks: a.mouseClicks,
      mouseDistance: a.mouseDistance,
    }));

    await prisma.activityLog.createMany({ data: records });

    // Audit once per employee per day — SET NX is atomic; prevents duplicate logs on concurrent heartbeats
    const todayStr = today.toISOString().split('T')[0];
    const auditKey = `agent-heartbeat-audit:${organizationId}:${employeeId}:${todayStr}`;
    const wasSet = await redis.set(auditKey, '1', 'NX', 'EX', 90000);
    if (wasSet) {
      await createAuditLog({ userId, organizationId, entity: 'ActivityLog', entityId: employeeId, action: 'CREATE', newValue: { note: 'Activity monitoring started', date: todayStr } });
    }

    // Also update attendance record active minutes.
    // Use Math.ceil so that any sub-minute active period (e.g. 30s = 0.5min) counts as 1min
    // instead of rounding to 0 — prevents losing activity data for short heartbeat batches.
    const totalActiveSeconds = activities.reduce((sum, a) => sum + a.durationSeconds, 0);
    const activeMinutesIncrement = Math.ceil(totalActiveSeconds / 60);
    if (totalActiveSeconds > 0) {
      await prisma.attendanceRecord.updateMany({
        where: { employeeId, organizationId, date: today, checkOut: null },
        data: {
          activeMinutes: { increment: activeMinutesIncrement },
          activityPulses: { increment: 1 },
        },
      });
    }

    // Emit real-time agent status to org (so admin dashboard + live feed updates)
    const lastActivity = activities[activities.length - 1];
    // Aggregate keystrokes/clicks from the entire batch for this heartbeat
    const batchKeystrokes = activities.reduce((sum, a) => sum + a.keystrokes, 0);
    const batchClicks = activities.reduce((sum, a) => sum + a.mouseClicks, 0);

    emitToOrg(organizationId, 'agent:heartbeat', {
      employeeId,
      activeApp: lastActivity?.activeApp || 'Unknown',
      activeWindow: lastActivity?.activeWindow || '',
      activeUrl: lastActivity?.activeUrl || '',
      category: lastActivity?.category || 'NEUTRAL',
      idleSeconds: lastActivity?.idleSeconds || 0,
      keystrokes: batchKeystrokes,
      mouseClicks: batchClicks,
      durationSeconds: lastActivity?.durationSeconds || 0,
      timestamp: new Date().toISOString(),
    });
    // Emit to the employee's own session (userId is already in scope from the JWT context)
    emitToUser(userId, 'agent:connected', { isActive: true });

    return { recorded: activities.length, activeMinutesAdded: activeMinutesIncrement };
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
    // Get employee's current shift assignment to determine tracking config
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

    // Check if live mode is enabled by admin
    const liveData = await redis.get(`${LIVE_VIEW_PREFIX}${employeeId}`);
    const liveMode = safeJsonParse(liveData);

    return {
      enabled: true,
      shiftType: assignment?.shift?.shiftType || 'OFFICE',
      trackingIntervalSeconds: 30,
      screenshotIntervalSeconds: liveMode?.enabled ? (liveMode.intervalSeconds || 30) : 600, // 10min default, or live interval
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
      emitToUser(user.id, 'agent:config-update', { liveMode: enabled, intervalSeconds });
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

  async getActivityLogs(employeeId: string, date: string, organizationId: string) {
    // Validate employee belongs to this organization
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundError('Employee');

    const queryDate = new Date(date + 'T00:00:00.000Z');
    if (isNaN(queryDate.getTime())) throw new BadRequestError('Invalid date format');

    const logs = await prisma.activityLog.findMany({
      where: { employeeId, date: queryDate, organizationId },
      orderBy: { timestamp: 'asc' },
    });

    // Aggregate top apps
    const appMap = new Map<string, number>();
    let totalActive = 0, totalIdle = 0, totalKeystrokes = 0, totalClicks = 0;

    logs.forEach(l => {
      if (l.activeApp) {
        appMap.set(l.activeApp, (appMap.get(l.activeApp) || 0) + l.durationSeconds);
      }
      totalActive += l.durationSeconds;
      totalIdle += l.idleSeconds;
      totalKeystrokes += l.keystrokes;
      totalClicks += l.mouseClicks;
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

    return {
      logs,
      summary: {
        totalActiveMinutes: Math.round(totalActive / 60),
        totalIdleMinutes: Math.round(totalIdle / 60),
        totalKeystrokes,
        totalClicks,
        topApps,
        logCount: logs.length,
        productivityScore,         // 0–100, null if no data
        productiveMinutes: Math.round(productiveSeconds / 60),
        unproductiveMinutes: Math.round(unproductiveSeconds / 60),
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
    });
  }

  async getAgentStatus(employeeId: string, organizationId: string) {
    const now = new Date();
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);

    const lastLog = await prisma.activityLog.findFirst({
      where: { employeeId, organizationId },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    });

    // Agent is "active" only if last heartbeat was within 2 minutes
    const isActive = !!lastLog && new Date(lastLog.timestamp) > twoMinutesAgo;

    return {
      isActive,
      lastHeartbeat: lastLog?.timestamp?.toISOString() || null,
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

    const [results, productiveResults] = await Promise.all([
      prisma.activityLog.groupBy({
        by: ['employeeId'],
        where: { organizationId, date: queryDate },
        _count: { id: true },
        _sum: { durationSeconds: true, idleSeconds: true },
      }),
      prisma.activityLog.groupBy({
        by: ['employeeId'],
        where: { organizationId, date: queryDate, category: 'PRODUCTIVE' },
        _sum: { durationSeconds: true },
      }),
    ]);

    const productiveMap = new Map(productiveResults.map(r => [r.employeeId, r._sum.durationSeconds || 0]));

    const summaryMap: Record<string, { logCount: number; totalActiveMinutes: number; totalIdleMinutes: number; productivityScore: number | null }> = {};
    for (const r of results) {
      const totalSeconds = r._sum.durationSeconds || 0;
      const productiveSeconds = productiveMap.get(r.employeeId) || 0;
      summaryMap[r.employeeId] = {
        logCount: r._count.id,
        totalActiveMinutes: Math.round(totalSeconds / 60),
        totalIdleMinutes: Math.round((r._sum.idleSeconds || 0) / 60),
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
   */
  async regenerateCode(employeeId: string, organizationId: string, userId: string) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
    });
    if (!employee) throw new NotFoundError('Employee');

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
      data: { agentPairingCode: code, agentPairedAt: null },
    });

    await createAuditLog({
      userId, organizationId, entity: 'Employee', entityId: employeeId,
      action: 'UPDATE', newValue: { agentPairingCode: code, action: 'regenerate_agent_code' },
    });

    return { code, isNew: false };
  }

  /**
   * Get all employees with their agent status (for admin Agent Setup tab).
   */
  async getEmployeesWithAgentStatus(organizationId: string) {
    const employees = await prisma.employee.findMany({
      where: { organizationId, deletedAt: null, isSystemAccount: false },
      select: {
        id: true, firstName: true, lastName: true, employeeCode: true, avatar: true,
        workMode: true, agentPairingCode: true, agentPairedAt: true,
        department: { select: { name: true } },
        user: { select: { email: true } },
      },
      orderBy: { firstName: 'asc' },
    });

    // Batch lookup: find last heartbeat per employee (within last 24h for "last seen")
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

    const recentLogs = await prisma.activityLog.groupBy({
      by: ['employeeId'],
      where: { organizationId, timestamp: { gte: oneDayAgo } },
      _max: { timestamp: true },
    });

    const heartbeatMap = new Map(recentLogs.map(r => [r.employeeId, r._max.timestamp]));

    return employees.map(emp => {
      const lastHeartbeat = heartbeatMap.get(emp.id) || null;
      const isActive = !!lastHeartbeat && new Date(lastHeartbeat) > twoMinutesAgo;
      return {
        ...emp,
        email: emp.user?.email || null,
        department: emp.department?.name || null,
        agentStatus: { isActive, lastHeartbeat: lastHeartbeat?.toISOString() || null },
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

    const logs = await prisma.activityLog.findMany({
      where: { employeeId, date: queryDate, organizationId },
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
    const employee = await prisma.employee.findUnique({
      where: { agentPairingCode: code },
      include: { user: { select: { id: true, email: true, role: true } }, organization: { select: { id: true } } },
    });

    if (employee && employee.user) {
      // Verify user is active before issuing token
      const fullUser = await prisma.user.findUnique({ where: { id: employee.user.id }, select: { status: true } });
      if (fullUser?.status !== 'ACTIVE') throw new BadRequestError('User account is not active. Contact your administrator.');

      // Mark as paired
      await prisma.employee.update({
        where: { id: employee.id },
        data: { agentPairedAt: new Date() },
      });

      const accessToken = jwt.sign(
        { userId: employee.user.id, email: employee.user.email, role: employee.user.role, organizationId: employee.organizationId, employeeId: employee.id },
        env.JWT_SECRET,
        { expiresIn: '30d' }
      );

      const refreshToken = jwt.sign(
        { userId: employee.user.id, organizationId: employee.organizationId, employeeId: employee.id, type: 'agent-refresh' },
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

    const accessToken = jwt.sign(
      { userId, email: user.email, role: user.role, organizationId, employeeId },
      env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    await redis.del(`${PAIR_PREFIX}${code}`);

    return {
      accessToken,
      user: { email: user.email, firstName: user.employee?.firstName, lastName: user.employee?.lastName },
    };
  }
}

export const agentService = new AgentService();
