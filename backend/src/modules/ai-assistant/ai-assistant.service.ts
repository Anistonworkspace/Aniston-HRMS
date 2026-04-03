import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { aiService } from '../../services/ai.service.js';
import { NotFoundError } from '../../middleware/errorHandler.js';

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
    context: 'admin' | 'hr-recruitment' | 'hr-general' | 'policy'
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
      const errorMsg = result.error || 'AI service encountered an error.';
      // Return the error as a friendly assistant message (not a crash)
      return {
        reply: errorMsg,
        suggestions: [
          'Go to Settings → AI API Config',
          'How do I configure the AI provider?',
        ],
      };
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

  /**
   * Get conversation history from Redis.
   */
  async getHistory(userId: string, context: string) {
    const historyKey = `${CONVERSATION_PREFIX}${userId}:${context}`;
    const rawHistory = await redis.get(historyKey);
    const history: ChatMessage[] = rawHistory ? JSON.parse(rawHistory) : [];
    return history;
  }

  /**
   * Add a knowledge base document.
   */
  async addKnowledgeDoc(organizationId: string, userId: string, title: string, content: string) {
    const doc = await prisma.aiKnowledgeBase.create({
      data: {
        organizationId,
        title,
        content,
        addedBy: userId,
      },
    });
    return doc;
  }

  /**
   * List all knowledge base documents for an organization.
   */
  async getKnowledgeDocs(organizationId: string) {
    const docs = await prisma.aiKnowledgeBase.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return docs;
  }

  /**
   * Delete a knowledge base document.
   */
  async deleteKnowledgeDoc(organizationId: string, id: string) {
    const doc = await prisma.aiKnowledgeBase.findFirst({
      where: { id, organizationId },
    });
    if (!doc) {
      throw new NotFoundError('Knowledge document');
    }
    await prisma.aiKnowledgeBase.delete({ where: { id } });
    return { deleted: true };
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
      } else if (context === 'policy') {
        const org = await prisma.organization.findFirst({
          where: { id: organizationId },
          select: { name: true },
        });
        const orgName = org?.name || 'your organization';

        const policies = await prisma.policy.findMany({
          where: { organizationId, isActive: true },
          select: { title: true, content: true, category: true },
        });
        const policyText = policies.map(p => `## ${p.title} (${p.category})\n${p.content}`).join('\n\n---\n\n');

        basePrompt = `You are an HR policy expert for ${orgName}. Answer employee questions about company policies accurately and helpfully. Always cite the specific policy section when answering. If the answer is not in the policies, say so clearly.\nToday's date: ${new Date().toLocaleDateString('en-IN')}.\n\nCOMPANY POLICIES:\n${policyText || 'No policies configured yet.'}`;
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
      const knowledgeItems = await prisma.aiKnowledgeBase.findMany({
        where: { organizationId },
        take: 5,
      });
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
    if (context === 'policy') {
      return [
        'What is the leave policy?',
        'How many casual leaves do I get?',
        'What are the office timings?',
        'Explain the sandwich rule',
        'What happens if I take leave on 1st-10th?',
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
