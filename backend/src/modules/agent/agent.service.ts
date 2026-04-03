import crypto from 'crypto';
import jwt from 'jsonwebtoken';
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

export class AgentService {
  async submitHeartbeat(employeeId: string, organizationId: string, activities: ActivityEntry[]) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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

    // Also update attendance record active minutes
    const totalActiveSeconds = activities.reduce((sum, a) => sum + a.durationSeconds, 0);
    const activeMinutesIncrement = Math.round(totalActiveSeconds / 60);

    if (activeMinutesIncrement > 0) {
      await prisma.attendanceRecord.updateMany({
        where: { employeeId, date: today, checkOut: null },
        data: {
          activeMinutes: { increment: activeMinutesIncrement },
          activityPulses: { increment: 1 },
        },
      });
    }

    // Emit real-time agent status to org (so admin dashboard + live feed updates)
    const lastActivity = activities[activities.length - 1];
    emitToOrg(organizationId, 'agent:heartbeat', {
      employeeId,
      activeApp: lastActivity?.activeApp || 'Unknown',
      activeWindow: lastActivity?.activeWindow || '',
      activeUrl: lastActivity?.activeUrl || '',
      category: lastActivity?.category || 'NEUTRAL',
      idleSeconds: lastActivity?.idleSeconds || 0,
      timestamp: new Date().toISOString(),
    });
    // Emit to the employee's own session (so their browser widget updates)
    const user = await prisma.user.findFirst({ where: { employee: { id: employeeId } }, select: { id: true } });
    if (user) emitToUser(user.id, 'agent:connected', { isActive: true });

    return { recorded: activities.length, activeMinutesAdded: activeMinutesIncrement };
  }

  async saveScreenshot(employeeId: string, organizationId: string, imageUrl: string, metadata: ScreenshotMetadata) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return prisma.agentScreenshot.create({
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
  }

  async getConfig(employeeId: string) {
    // Get employee's current shift assignment to determine tracking config
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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
    const liveMode = liveData ? JSON.parse(liveData) : null;

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

  async setLiveMode(employeeId: string, enabled: boolean, intervalSeconds: number = 30) {
    if (enabled) {
      await redis.set(`${LIVE_VIEW_PREFIX}${employeeId}`, JSON.stringify({ enabled, intervalSeconds }), 'EX', 3600); // 1hr max
    } else {
      await redis.del(`${LIVE_VIEW_PREFIX}${employeeId}`);
    }
    return { enabled, intervalSeconds };
  }

  async getLiveMode(employeeId: string) {
    const data = await redis.get(`${LIVE_VIEW_PREFIX}${employeeId}`);
    return data ? JSON.parse(data) : { enabled: false, intervalSeconds: 600 };
  }

  async getActivityLogs(employeeId: string, date: string, organizationId: string) {
    const queryDate = new Date(date);
    queryDate.setHours(0, 0, 0, 0);

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

    return {
      logs,
      summary: {
        totalActiveMinutes: Math.round(totalActive / 60),
        totalIdleMinutes: Math.round(totalIdle / 60),
        totalKeystrokes,
        totalClicks,
        topApps,
        logCount: logs.length,
      },
    };
  }

  async getScreenshots(employeeId: string, date: string, organizationId: string) {
    const queryDate = new Date(date);
    queryDate.setHours(0, 0, 0, 0);

    return prisma.agentScreenshot.findMany({
      where: { employeeId, date: queryDate, organizationId },
      orderBy: { timestamp: 'asc' },
    });
  }

  async getAgentStatus(employeeId: string) {
    const now = new Date();
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);

    const lastLog = await prisma.activityLog.findFirst({
      where: { employeeId },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    });

    // Agent is "active" only if last heartbeat was within 2 minutes
    const isActive = !!lastLog && new Date(lastLog.timestamp) > twoMinutesAgo;

    return {
      isActive,
      lastHeartbeat: lastLog?.timestamp || null,
    };
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

    return { code };
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
        agentStatus: { isActive, lastHeartbeat },
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

    let generated = 0;
    for (const emp of employees) {
      await this.generatePermanentCode(emp.id, organizationId, userId);
      generated++;
    }

    return { generated, total: employees.length };
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

      return {
        accessToken,
        user: { email: employee.user.email, firstName: employee.firstName, lastName: employee.lastName },
      };
    }

    // 2. Fallback: check Redis (legacy temporary codes)
    const data = await redis.get(`${PAIR_PREFIX}${code}`);
    if (!data) throw new BadRequestError('Invalid or expired pairing code. Please check with your admin.');

    const { userId, employeeId, organizationId } = JSON.parse(data);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { employee: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!user) throw new NotFoundError('User');

    const accessToken = jwt.sign(
      { userId, email: user.email, role: user.role, organizationId, employeeId },
      env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    await redis.del(`${PAIR_PREFIX}${code}`);

    return {
      accessToken,
      user: { email: user.email, firstName: user.employee?.firstName, lastName: user.employee?.lastName },
    };
  }
}

export const agentService = new AgentService();
