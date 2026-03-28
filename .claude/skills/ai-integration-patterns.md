# AI Integration Patterns

## Current Provider
- Type: CUSTOM
- Base URL: https://openrouter.ai/api/v1
- Model: openrouter/free (llama-3.3-70b-instruct:free)
- Config stored in: AiApiConfig Prisma model (encrypted API key)

## AiService Usage
Import: `import { aiService } from '../../services/ai.service.js'`
Methods:
- `aiService.chat(messages, orgId)` — multi-turn conversation
- `aiService.prompt(systemPrompt, userMessage, orgId)` — single prompt
- `aiService.scoreResume(resumeText, jobDescription, orgId)` — resume scoring

## AI Contexts (for AI Assistant FAB)
- `admin` — Settings page, general admin questions
- `hr-recruitment` — Recruitment page, candidate evaluation
- `hr-general` — Employee management, HR operations
- `hr-interview` — Interview tasks, question generation
- `hr-policies` — Policy creation and management

## Adding New AI Context
1. Add context type to AI assistant module
2. Create system prompt in backend/src/modules/ai-assistant/
3. Register in frontend AiAssistantPanel component
4. Add page-level context prop where FAB renders
