import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { env } from '../../config/env.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { emitToOrg, emitToUser } from '../../sockets/index.js';
import type { ActivityEntry, ScreenshotMetadata } from './agent.validation.js';

const PAIR_PREFIX = 'agent-pair:';
const LIVE_VIEW_PREFIX = 'agent-live:';

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
  /**
   * Generate a pairing code for agent authentication (no password needed).
   * Code is stored in Redis with 5-minute TTL.
   */
  async generatePairCode(userId: string, employeeId: string, organizationId: string) {
    // Generate 8-char code: ANST-XXXX
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars (0/O, 1/I)
    let code = 'ANST-';
    for (let i = 0; i < 4; i++) code += chars[crypto.randomInt(chars.length)];

    // Store in Redis: code → { userId, employeeId, organizationId }
    await redis.set(`${PAIR_PREFIX}${code}`, JSON.stringify({ userId, employeeId, organizationId }), 'EX', 300); // 5 min TTL

    return { code, expiresIn: 300 };
  }

  /**
   * Verify a pairing code and return JWT tokens for the agent.
   */
  async verifyPairCode(code: string) {
    const data = await redis.get(`${PAIR_PREFIX}${code}`);
    if (!data) throw new BadRequestError('Invalid or expired pairing code. Generate a new one from the HRMS portal.');

    const { userId, employeeId, organizationId } = JSON.parse(data);

    // Get user info for token
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { employee: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!user) throw new NotFoundError('User');

    // Generate long-lived agent token (30 days)
    const accessToken = jwt.sign(
      { userId, email: user.email, role: user.role, organizationId, employeeId },
      env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Delete used code
    await redis.del(`${PAIR_PREFIX}${code}`);

    return {
      accessToken,
      user: {
        email: user.email,
        firstName: user.employee?.firstName,
        lastName: user.employee?.lastName,
      },
    };
  }
}

export const agentService = new AgentService();
