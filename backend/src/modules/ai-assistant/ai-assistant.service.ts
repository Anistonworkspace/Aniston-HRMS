import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { aiService } from '../../services/ai.service.js';

const CONVERSATION_PREFIX = 'ai-assistant:';
const CONVERSATION_TTL = 86400; // 24 hours

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class AiAssistantService {
  /**
   * Chat with the AI assistant.
   */
  async chat(
    organizationId: string,
    userId: string,
    message: string,
    context: 'admin' | 'hr-recruitment' | 'hr-general'
  ) {
    // Get conversation history from Redis
    const historyKey = `${CONVERSATION_PREFIX}${userId}:${context}`;
    const rawHistory = await redis.get(historyKey);
    const history: ChatMessage[] = rawHistory ? JSON.parse(rawHistory) : [];

    // Build system prompt with live data context
    const systemPrompt = await this.buildSystemPrompt(organizationId, context);

    // Construct messages for the AI
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...history.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
      { role: 'user' as const, content: message },
    ];

    // Call AI
    const result = await aiService.chat(organizationId, messages, 1024);

    if (!result.success) {
      return { reply: result.error || 'AI service is not configured. Go to Settings → API Integrations.', suggestions: [] };
    }

    // Update history (keep last 20 messages)
    history.push({ role: 'user', content: message });
    history.push({ role: 'assistant', content: result.data! });
    const trimmedHistory = history.slice(-20);
    await redis.setex(historyKey, CONVERSATION_TTL, JSON.stringify(trimmedHistory));

    // Generate suggestions
    const suggestions = this.generateSuggestions(context);

    return { reply: result.data, suggestions };
  }

  /**
   * Clear conversation history.
   */
  async clearHistory(userId: string, context: string) {
    await redis.del(`${CONVERSATION_PREFIX}${userId}:${context}`);
    return { cleared: true };
  }

  private async buildSystemPrompt(organizationId: string, context: string): Promise<string> {
    let basePrompt = `You are an AI assistant for Aniston HRMS, an enterprise Human Resource Management System. You help HR professionals, administrators, and managers with their daily tasks. Be concise, professional, and data-aware. Answer in a helpful, structured way. Use bullet points for lists. Current date: ${new Date().toLocaleDateString('en-IN')}.`;

    // Fetch live data to inject
    try {
      if (context === 'admin') {
        const [empCount, deptCount, pendingLeaves, activeUsers] = await Promise.all([
          prisma.employee.count({ where: { organizationId, deletedAt: null, status: 'ACTIVE' } }),
          prisma.department.count({ where: { organizationId } }),
          prisma.leaveRequest.count({ where: { employee: { organizationId }, status: 'PENDING' } }),
          prisma.user.count({ where: { organizationId, status: 'ACTIVE' } }),
        ]);

        basePrompt += `\n\nOrganization context:
- Active employees: ${empCount}
- Departments: ${deptCount}
- Pending leave requests: ${pendingLeaves}
- Active user accounts: ${activeUsers}

You can answer questions about system configuration, employee data summaries, reports, pending approvals, and general HRMS management.`;
      } else if (context === 'hr-recruitment') {
        const [openJobs, totalApps, walkIns] = await Promise.all([
          prisma.jobOpening.count({ where: { organizationId, status: 'OPEN' } }),
          prisma.application.count({ where: { organizationId } }),
          prisma.walkInCandidate.count({ where: { organizationId, status: 'WAITING' } }),
        ]);

        basePrompt += `\n\nRecruitment context:
- Open job positions: ${openJobs}
- Total applications: ${totalApps}
- Walk-in candidates waiting: ${walkIns}

You can answer questions about recruitment pipeline, candidate status, interview scheduling, AI screening scores, and hiring workflows.`;
      } else {
        const [empCount, pendingLeaves, todayAttendance] = await Promise.all([
          prisma.employee.count({ where: { organizationId, deletedAt: null } }),
          prisma.leaveRequest.count({ where: { employee: { organizationId }, status: 'PENDING' } }),
          prisma.attendanceRecord.count({
            where: {
              employee: { organizationId },
              date: new Date(new Date().toISOString().split('T')[0]),
            },
          }),
        ]);

        basePrompt += `\n\nHR context:
- Total employees: ${empCount}
- Pending leave requests: ${pendingLeaves}
- Today's attendance records: ${todayAttendance}

You can answer questions about leave balances, attendance, employee information, and general HR queries.`;
      }
    } catch {
      // If DB queries fail, continue with base prompt
    }

    // Inject knowledge base content if any
    try {
      const knowledgeItems = await prisma.$queryRaw<any[]>`
        SELECT title, content FROM "AiKnowledgeBase" WHERE "organizationId" = ${organizationId} LIMIT 5
      `;
      if (knowledgeItems?.length > 0) {
        basePrompt += '\n\nOrganization knowledge base:\n';
        for (const item of knowledgeItems) {
          basePrompt += `- ${item.title}: ${item.content.slice(0, 500)}\n`;
        }
      }
    } catch {
      // AiKnowledgeBase table may not exist yet — skip
    }

    return basePrompt;
  }

  private generateSuggestions(context: string): string[] {
    if (context === 'admin') {
      return [
        'How many employees joined this month?',
        'Which departments have pending leave approvals?',
        'Show me the system health overview',
      ];
    }
    if (context === 'hr-recruitment') {
      return [
        'How many candidates are in interview stage?',
        "What's the average AI score for recent applications?",
        'Generate a summary of today\'s interviews',
      ];
    }
    return [
      'Show me today\'s attendance summary',
      'Which employees have low leave balances?',
      'What are the upcoming holidays?',
    ];
  }
}

export const aiAssistantService = new AiAssistantService();
