import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../middleware/errorHandler.js';
import type { ActivityEntry, ScreenshotMetadata } from './agent.validation.js';

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

    return {
      enabled: true,
      shiftType: assignment?.shift?.shiftType || 'OFFICE',
      trackingIntervalSeconds: 30,
      screenshotIntervalMinutes: 10,
      syncIntervalMinutes: 5,
      idleThresholdSeconds: 300, // 5 min
      screenshotsEnabled: true,
      inputTrackingEnabled: true,
    };
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const lastLog = await prisma.activityLog.findFirst({
      where: { employeeId, date: today },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    });

    return {
      isActive: !!lastLog,
      lastHeartbeat: lastLog?.timestamp || null,
    };
  }
}

export const agentService = new AgentService();
