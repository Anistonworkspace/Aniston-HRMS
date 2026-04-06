import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { logger } from '../../lib/logger.js';

const CONFIG_CACHE_KEY = 'task-config';
const CACHE_TTL = 3600;

interface TaskItem {
  externalTaskId: string;
  taskTitle: string;
  projectName?: string;
  priority?: string;
  dueDate?: Date | null;
  currentStatus?: string;
  blockerFlag?: boolean;
  backupAssigned?: boolean;
}

export class TaskIntegrationService {
  // ── Configuration Management ──

  async getConfig(organizationId: string) {
    const config = await prisma.taskManagerConfig.findFirst({
      where: { organizationId, isActive: true },
    });
    if (!config) return null;
    return {
      ...config,
      apiKeyEncrypted: '••••••••', // Never expose key
    };
  }

  async upsertConfig(
    organizationId: string,
    data: { provider: string; apiKey: string; baseUrl?: string; workspaceId?: string },
    updatedBy: string
  ) {
    const apiKeyEncrypted = encrypt(data.apiKey);

    const config = await prisma.taskManagerConfig.upsert({
      where: { organizationId_provider: { organizationId, provider: data.provider as any } },
      create: {
        organizationId,
        provider: data.provider as any,
        apiKeyEncrypted,
        baseUrl: data.baseUrl || null,
        workspaceId: data.workspaceId || null,
        updatedBy,
      },
      update: {
        apiKeyEncrypted,
        baseUrl: data.baseUrl || null,
        workspaceId: data.workspaceId || null,
        isActive: true,
        updatedBy,
      },
    });

    // Clear cache
    await redis.del(`${CONFIG_CACHE_KEY}:${organizationId}`).catch(() => {});

    await createAuditLog({
      userId: updatedBy,
      organizationId,
      entity: 'TaskManagerConfig',
      entityId: config.id,
      action: 'UPSERT',
      newValue: { provider: data.provider, baseUrl: data.baseUrl },
    });

    return { ...config, apiKeyEncrypted: '••••••••' };
  }

  async testConnection(organizationId: string) {
    const config = await prisma.taskManagerConfig.findFirst({
      where: { organizationId, isActive: true },
    });
    if (!config) throw new NotFoundError('Task manager configuration');

    const apiKey = decrypt(config.apiKeyEncrypted);
    const startTime = Date.now();

    try {
      const result = await this.callProviderHealth(config.provider, apiKey, config.baseUrl);
      const responseTime = Date.now() - startTime;

      await prisma.taskIntegrationHealthLog.create({
        data: {
          organizationId,
          provider: config.provider,
          status: 'HEALTHY',
          tokenValid: true,
          responseTimeMs: responseTime,
          checkedAt: new Date(),
        },
      });

      return { status: 'connected', provider: config.provider, responseTimeMs: responseTime };
    } catch (err: any) {
      const responseTime = Date.now() - startTime;

      await prisma.taskIntegrationHealthLog.create({
        data: {
          organizationId,
          provider: config.provider,
          status: 'ERROR',
          tokenValid: false,
          responseTimeMs: responseTime,
          notes: err.message?.substring(0, 500),
          checkedAt: new Date(),
        },
      });

      throw new BadRequestError(`Connection failed: ${err.message}`);
    }
  }

  // ── Leave Task Audit ──

  async auditTasksForLeave(
    organizationId: string,
    employeeId: string,
    startDate: Date,
    endDate: Date,
    leaveType: string
  ) {
    const config = await prisma.taskManagerConfig.findFirst({
      where: { organizationId, isActive: true },
    });

    // If no task manager configured, return empty audit
    if (!config) {
      return {
        integrationStatus: 'NOT_CONFIGURED',
        totalOpenTasks: 0,
        overdueTasks: 0,
        dueWithinLeave: 0,
        criticalTasks: 0,
        blockedTasks: 0,
        noBackupTasks: 0,
        riskScore: 0,
        riskLevel: 'LOW' as const,
        items: [],
        warnings: ['No task manager configured. Task impact assessment unavailable.'],
      };
    }

    let tasks: TaskItem[] = [];
    let integrationStatus = 'SUCCESS';
    let errorMessage: string | undefined;

    try {
      const apiKey = decrypt(config.apiKeyEncrypted);
      tasks = await this.fetchEmployeeTasks(config.provider, apiKey, config.baseUrl, employeeId, config.employeeMapping);
    } catch (err: any) {
      integrationStatus = 'ERROR';
      errorMessage = err.message;
      logger.warn(`[TaskAudit] Failed to fetch tasks for employee ${employeeId}: ${err.message}`);
    }

    // Calculate risk metrics
    const now = new Date();
    const openTasks = tasks;
    const overdueTasks = tasks.filter(t => t.dueDate && new Date(t.dueDate) < now);
    const dueWithinLeave = tasks.filter(t => {
      if (!t.dueDate) return false;
      const due = new Date(t.dueDate);
      return due >= startDate && due <= endDate;
    });
    const criticalTasks = tasks.filter(t =>
      t.priority?.toLowerCase() === 'critical' || t.priority?.toLowerCase() === 'highest' || t.priority?.toLowerCase() === 'urgent'
    );
    const blockedTasks = tasks.filter(t => t.blockerFlag);
    const noBackupTasks = tasks.filter(t => !t.backupAssigned);

    // Calculate risk score
    const riskResult = this.calculateRisk({
      totalOpen: openTasks.length,
      overdue: overdueTasks.length,
      dueWithinLeave: dueWithinLeave.length,
      critical: criticalTasks.length,
      blocked: blockedTasks.length,
      noBackup: noBackupTasks.length,
      leaveDays: Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
      leaveType,
    });

    // Build audit items from critical/due-within-leave tasks
    const auditItems = [...dueWithinLeave, ...criticalTasks, ...overdueTasks]
      .filter((t, i, arr) => arr.findIndex(x => x.externalTaskId === t.externalTaskId) === i)
      .slice(0, 20)
      .map(t => ({
        externalTaskId: t.externalTaskId,
        taskTitle: t.taskTitle,
        projectName: t.projectName,
        priority: t.priority,
        dueDate: t.dueDate,
        currentStatus: t.currentStatus,
        blockerFlag: t.blockerFlag || false,
        backupAssigned: t.backupAssigned || false,
        riskLevel: this.itemRiskLevel(t, startDate, endDate),
      }));

    return {
      integrationStatus,
      errorMessage,
      totalOpenTasks: openTasks.length,
      overdueTasks: overdueTasks.length,
      dueWithinLeave: dueWithinLeave.length,
      criticalTasks: criticalTasks.length,
      blockedTasks: blockedTasks.length,
      noBackupTasks: noBackupTasks.length,
      riskScore: riskResult.score,
      riskLevel: riskResult.level,
      riskExplanation: riskResult.explanation,
      items: auditItems,
      warnings: integrationStatus === 'ERROR'
        ? [`Task manager connection failed: ${errorMessage}. Proceeding without task impact data.`]
        : [],
    };
  }

  // ── Risk Engine ──

  private calculateRisk(input: {
    totalOpen: number;
    overdue: number;
    dueWithinLeave: number;
    critical: number;
    blocked: number;
    noBackup: number;
    leaveDays: number;
    leaveType: string;
  }) {
    let score = 0;

    // Base factors
    score += input.overdue * 15;
    score += input.dueWithinLeave * 20;
    score += input.critical * 25;
    score += input.blocked * 20;
    score += input.noBackup * 10;

    // Duration multiplier
    if (input.leaveDays > 5) score *= 1.5;
    else if (input.leaveDays > 3) score *= 1.2;

    // Leave type adjustment
    if (input.leaveType === 'SL' || input.leaveType === 'SICK') {
      score *= 0.6; // Reduce risk weight for sick leave
    }

    score = Math.round(Math.min(score, 100));

    let level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    let explanation: string;

    if (score <= 20) {
      level = 'LOW';
      explanation = 'No significant task impact. Leave can be approved without concerns.';
    } else if (score <= 45) {
      level = 'MEDIUM';
      explanation = 'Some tasks are due during leave period. Handover recommended.';
    } else if (score <= 70) {
      level = 'HIGH';
      explanation = 'Critical tasks or deadlines overlap with leave. Backup assignment required.';
    } else {
      level = 'CRITICAL';
      explanation = 'Major business risk. Multiple critical tasks, blockers, or urgent deadlines during leave.';
    }

    return { score, level, explanation };
  }

  private itemRiskLevel(task: TaskItem, leaveStart: Date, leaveEnd: Date): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (task.blockerFlag && task.priority?.toLowerCase() === 'critical') return 'CRITICAL';
    if (task.dueDate && new Date(task.dueDate) >= leaveStart && new Date(task.dueDate) <= leaveEnd) {
      if (task.priority?.toLowerCase() === 'critical' || task.priority?.toLowerCase() === 'highest') return 'HIGH';
      return 'MEDIUM';
    }
    if (task.dueDate && new Date(task.dueDate) < new Date()) return 'MEDIUM';
    return 'LOW';
  }

  // ── Provider Abstraction ──

  private async callProviderHealth(provider: string, apiKey: string, baseUrl?: string | null): Promise<boolean> {
    switch (provider) {
      case 'JIRA':
        return this.jiraHealth(apiKey, baseUrl!);
      case 'ASANA':
        return this.asanaHealth(apiKey);
      case 'CLICKUP':
        return this.clickupHealth(apiKey);
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  private async fetchEmployeeTasks(
    provider: string, apiKey: string, baseUrl: string | null | undefined,
    employeeId: string, employeeMapping: any
  ): Promise<TaskItem[]> {
    // Map internal employee ID to external task manager user ID
    const externalUserId = employeeMapping?.[employeeId] || employeeId;

    switch (provider) {
      case 'JIRA':
        return this.jiraFetchTasks(apiKey, baseUrl!, externalUserId);
      case 'ASANA':
        return this.asanaFetchTasks(apiKey, externalUserId);
      case 'CLICKUP':
        return this.clickupFetchTasks(apiKey, externalUserId);
      default:
        return [];
    }
  }

  // ── Jira Provider ──

  private async jiraHealth(apiKey: string, baseUrl: string): Promise<boolean> {
    const res = await fetch(`${baseUrl}/rest/api/3/myself`, {
      headers: { 'Authorization': `Basic ${apiKey}`, 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`Jira API returned ${res.status}`);
    return true;
  }

  private async jiraFetchTasks(apiKey: string, baseUrl: string, assigneeId: string): Promise<TaskItem[]> {
    const jql = `assignee=${assigneeId} AND status NOT IN (Done, Closed, Resolved) ORDER BY priority DESC, duedate ASC`;
    const res = await fetch(`${baseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=50&fields=summary,priority,duedate,status,issuetype,project`, {
      headers: { 'Authorization': `Basic ${apiKey}`, 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`Jira search failed: ${res.status}`);
    const data = await res.json();
    return (data.issues || []).map((issue: any) => ({
      externalTaskId: issue.key,
      taskTitle: issue.fields?.summary || '',
      projectName: issue.fields?.project?.name,
      priority: issue.fields?.priority?.name,
      dueDate: issue.fields?.duedate ? new Date(issue.fields.duedate) : null,
      currentStatus: issue.fields?.status?.name,
      blockerFlag: issue.fields?.issuetype?.name === 'Bug' && issue.fields?.priority?.name === 'Blocker',
    }));
  }

  // ── Asana Provider ──

  private async asanaHealth(apiKey: string): Promise<boolean> {
    const res = await fetch('https://app.asana.com/api/1.0/users/me', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`Asana API returned ${res.status}`);
    return true;
  }

  private async asanaFetchTasks(apiKey: string, assigneeId: string): Promise<TaskItem[]> {
    const res = await fetch(`https://app.asana.com/api/1.0/tasks?assignee=${assigneeId}&completed_since=now&opt_fields=name,due_on,projects.name,memberships.section.name`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`Asana fetch failed: ${res.status}`);
    const data = await res.json();
    return (data.data || []).map((task: any) => ({
      externalTaskId: task.gid,
      taskTitle: task.name,
      projectName: task.projects?.[0]?.name,
      dueDate: task.due_on ? new Date(task.due_on) : null,
      currentStatus: task.memberships?.[0]?.section?.name || 'Open',
    }));
  }

  // ── ClickUp Provider ──

  private async clickupHealth(apiKey: string): Promise<boolean> {
    const res = await fetch('https://api.clickup.com/api/v2/user', {
      headers: { 'Authorization': apiKey },
    });
    if (!res.ok) throw new Error(`ClickUp API returned ${res.status}`);
    return true;
  }

  private async clickupFetchTasks(apiKey: string, assigneeId: string): Promise<TaskItem[]> {
    // ClickUp requires team ID — simplified implementation
    const res = await fetch(`https://api.clickup.com/api/v2/team`, {
      headers: { 'Authorization': apiKey },
    });
    if (!res.ok) throw new Error(`ClickUp fetch failed: ${res.status}`);
    return []; // Would need team-specific implementation
  }

  // ── Persist Audit to DB ──

  async persistAudit(
    leaveRequestId: string,
    auditResult: any,
    provider?: string
  ) {
    const audit = await prisma.leaveTaskAudit.create({
      data: {
        leaveRequestId,
        integrationStatus: auditResult.integrationStatus || 'SUCCESS',
        totalOpenTasks: auditResult.totalOpenTasks || 0,
        overdueTasks: auditResult.overdueTasks || 0,
        dueWithinLeave: auditResult.dueWithinLeave || 0,
        criticalTasks: auditResult.criticalTasks || 0,
        blockedTasks: auditResult.blockedTasks || 0,
        noBackupTasks: auditResult.noBackupTasks || 0,
        riskScore: auditResult.riskScore || 0,
        riskLevel: auditResult.riskLevel || 'LOW',
        auditPayload: auditResult,
        provider: provider || null,
        errorMessage: auditResult.errorMessage || null,
        auditedAt: new Date(),
      },
    });

    // Create audit items
    if (auditResult.items?.length > 0) {
      await prisma.leaveTaskAuditItem.createMany({
        data: auditResult.items.map((item: any) => ({
          auditId: audit.id,
          externalTaskId: item.externalTaskId,
          taskTitle: item.taskTitle,
          projectName: item.projectName || null,
          priority: item.priority || null,
          dueDate: item.dueDate ? new Date(item.dueDate) : null,
          currentStatus: item.currentStatus || null,
          blockerFlag: item.blockerFlag || false,
          backupAssigned: item.backupAssigned || false,
          handoverNote: item.handoverNote || null,
          riskLevel: item.riskLevel || 'LOW',
          rawPayload: item,
        })),
      });
    }

    return audit;
  }

  // ── Integration Health Status ──

  async getHealthStatus(organizationId: string) {
    const config = await prisma.taskManagerConfig.findFirst({
      where: { organizationId, isActive: true },
    });

    if (!config) {
      return {
        configured: false,
        provider: null,
        lastCheck: null,
        status: 'NOT_CONFIGURED',
      };
    }

    const lastLog = await prisma.taskIntegrationHealthLog.findFirst({
      where: { organizationId },
      orderBy: { checkedAt: 'desc' },
    });

    return {
      configured: true,
      provider: config.provider,
      lastCheck: lastLog ? {
        status: lastLog.status,
        tokenValid: lastLog.tokenValid,
        responseTimeMs: lastLog.responseTimeMs,
        checkedAt: lastLog.checkedAt,
        mappingErrors: lastLog.mappingErrors,
        staleSyncFlag: lastLog.staleSyncFlag,
        failedCallsCount: lastLog.failedCallsCount,
        notes: lastLog.notes,
      } : null,
      status: lastLog?.status || 'UNKNOWN',
    };
  }
}

export const taskIntegrationService = new TaskIntegrationService();
