import { aiConfigService } from '../modules/ai-config/ai-config.service.js';

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiResponse {
  success: boolean;
  data?: string;
  error?: string;
}

/**
 * Centralized AI Service — all AI calls throughout the application
 * go through this service. It reads the active provider config from
 * `AiApiConfig` (Redis-cached for 60 s) and routes to the correct API.
 *
 * Supported providers: OPENAI, DEEPSEEK, ANTHROPIC, GEMINI, CUSTOM.
 *
 * Never instantiate this class directly — use the exported singleton `aiService`.
 *
 * @example
 * const result = await aiService.prompt(orgId, 'You are HR.', 'Summarize this resume...');
 * if (result.success) console.log(result.data);
 */
export class AiService {
  /**
   * Send a chat completion request using the org's configured AI provider.
   *
   * @param organizationId - The org whose `AiApiConfig` should be used.
   * @param messages - Array of chat messages in `{ role, content }` format.
   * @param maxTokens - Maximum tokens for the response (default 1024).
   * @returns `{ success: true, data: string }` or `{ success: false, error: string }`.
   */
  async chat(organizationId: string, messages: AiChatMessage[], maxTokens = 1024): Promise<AiResponse> {
    const config = await aiConfigService.getActiveConfigRaw(organizationId);

    if (!config) {
      return {
        success: false,
        error: 'No AI provider configured. Please go to Settings → AI API Config and add your API key to enable AI features.',
      };
    }

    if (!config.apiKey) {
      return {
        success: false,
        error: 'AI provider is selected but no API key is configured. Please go to Settings → AI API Config to enter your API key.',
      };
    }

    try {
      const text = await this.callProvider(config.provider, config.apiKey, config.modelName, config.baseUrl, messages, maxTokens);
      return { success: true, data: text };
    } catch (err: any) {
      const message = err.message || 'Unknown AI provider error';
      // Provide actionable guidance for common errors
      if (message.includes('401') || message.includes('Unauthorized') || message.includes('invalid_api_key')) {
        return { success: false, error: `Invalid API key for ${config.provider}. Please update your key in Settings → AI API Config.` };
      }
      if (message.includes('429') || message.includes('rate limit')) {
        return { success: false, error: `AI provider rate limit exceeded. Please wait a moment and try again.` };
      }
      return { success: false, error: `AI request failed: ${message}` };
    }
  }

  /**
   * Single-turn prompt convenience method. Wraps `chat()` with a system + user message pair.
   *
   * @param organizationId - The org whose `AiApiConfig` should be used.
   * @param systemPrompt - Instruction context placed in the `system` role.
   * @param userPrompt - The actual user question or content.
   * @param maxTokens - Maximum tokens for the response (default 1024).
   * @returns `{ success: true, data: string }` or `{ success: false, error: string }`.
   */
  async prompt(organizationId: string, systemPrompt: string, userPrompt: string, maxTokens = 1024): Promise<AiResponse> {
    const result = await this.chat(organizationId, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], maxTokens);
    return result;
  }

  /**
   * Score a resume against a job description using the org's AI provider.
   *
   * The AI is instructed to return a structured JSON object:
   * ```json
   * {
   *   "score": 0-100,
   *   "skills": string[],
   *   "experience": string,
   *   "strengths": string[],
   *   "weaknesses": string[],
   *   "recommendation": "STRONG_FIT | GOOD_FIT | PARTIAL_FIT | POOR_FIT"
   * }
   * ```
   * Callers should `JSON.parse(result.data)` after checking `result.success`.
   *
   * @param organizationId - The org whose `AiApiConfig` should be used.
   * @param resumeText - Raw extracted text from the candidate's resume.
   * @param jobDescription - Full job description text.
   * @returns `{ success: true, data: jsonString }` or `{ success: false, error: string }`.
   */
  async scoreResume(organizationId: string, resumeText: string, jobDescription: string): Promise<AiResponse> {
    const systemPrompt = `You are an expert HR recruiter AI. Score the candidate's resume against the job description.
Return ONLY a JSON object with these fields:
{
  "score": <number 0-100>,
  "skills": [<extracted skills array>],
  "experience": "<brief experience summary>",
  "strengths": [<top 3 strengths>],
  "weaknesses": [<top 3 gaps>],
  "recommendation": "<STRONG_FIT | GOOD_FIT | PARTIAL_FIT | POOR_FIT>"
}`;

    const userPrompt = `JOB DESCRIPTION:\n${jobDescription}\n\nRESUME:\n${resumeText}`;
    return this.prompt(organizationId, systemPrompt, userPrompt, 800);
  }

  /**
   * Scan a KYC document image using the org's AI provider vision capability.
   * Sends the raw image (base64) to the AI and asks it to extract all fields,
   * classify the document type, and generate HR validation pointers.
   *
   * Supported providers with vision: OPENAI (gpt-4o), ANTHROPIC (claude-3+), GEMINI.
   * DEEPSEEK falls back to text-only enhancement (no image reading).
   *
   * @param organizationId - The org whose `AiApiConfig` should be used.
   * @param imageBase64 - Base64-encoded image bytes.
   * @param mimeType - MIME type of the image (e.g. "image/jpeg", "image/png").
   * @returns JSON string with document_type, extracted_fields, validation_pointers, etc.
   */
  async scanDocument(organizationId: string, imageBase64: string, mimeType: string): Promise<AiResponse> {
    const config = await aiConfigService.getActiveConfigRaw(organizationId);
    if (!config?.apiKey) {
      return { success: false, error: 'No AI provider configured' };
    }

    try {
      const text = await this.callProviderVision(
        config.provider, config.apiKey, config.modelName, config.baseUrl, imageBase64, mimeType,
      );
      return { success: true, data: text };
    } catch (err: any) {
      return { success: false, error: `Vision scan failed: ${err.message}` };
    }
  }

  private async callProviderVision(
    provider: string,
    apiKey: string,
    modelName: string,
    baseUrl: string | null,
    imageBase64: string,
    mimeType: string,
  ): Promise<string> {
    const VISION_SYSTEM = `You are a KYC document scanner for an Indian HR system. Analyze this document image carefully.
Return ONLY valid compact JSON (no markdown, no explanation):
{"document_type":"AADHAAR|PAN|PASSPORT|TENTH_CERTIFICATE|TWELFTH_CERTIFICATE|DEGREE|BANK_PASSBOOK|EXPERIENCE_LETTER|OFFER_LETTER|PROFESSIONAL_CERTIFICATION|OTHER","confidence":0.95,"extracted_fields":{"name":"","date_of_birth":"","document_number":"","father_name":"","mother_name":"","gender":"","address":"","issuing_authority":"","issue_date":"","expiry_date":"","account_number":"","ifsc_code":"","bank_name":""},"raw_text":"all visible text from document","validation_pointers":["what HR should verify"],"suspicious_indicators":[],"quality_note":"brief image quality assessment"}`;

    switch (provider) {
      case 'OPENAI':
      case 'CUSTOM': {
        const url = provider === 'OPENAI'
          ? 'https://api.openai.com/v1/chat/completions'
          : baseUrl?.includes('/v1')
            ? `${baseUrl.replace(/\/+$/, '')}/chat/completions`
            : `${baseUrl}/v1/chat/completions`;
        const visionModel = modelName?.includes('gpt-4') ? modelName : 'gpt-4o';
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: visionModel,
            max_tokens: 1000,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: VISION_SYSTEM },
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
              ],
            }],
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw new Error(`OpenAI vision ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const data = await res.json() as any;
        return data.choices?.[0]?.message?.content || '';
      }

      case 'ANTHROPIC': {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: modelName,
            max_tokens: 1000,
            system: VISION_SYSTEM,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
                { type: 'text', text: 'Analyze this KYC document and return JSON as instructed.' },
              ],
            }],
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw new Error(`Anthropic vision ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const data = await res.json() as any;
        return data.content?.[0]?.text || '';
      }

      case 'GEMINI': {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                { text: VISION_SYSTEM },
                { inlineData: { mimeType, data: imageBase64 } },
              ],
            }],
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw new Error(`Gemini vision ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const data = await res.json() as any;
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }

      case 'DEEPSEEK':
      default:
        throw new Error(`Provider ${provider} does not support image vision scanning`);
    }
  }

  private async callProvider(
    provider: string,
    apiKey: string,
    modelName: string,
    baseUrl: string | null,
    messages: AiChatMessage[],
    maxTokens: number
  ): Promise<string> {
    switch (provider) {
      case 'OPENAI':
      case 'DEEPSEEK':
      case 'CUSTOM': {
        const url = provider === 'OPENAI'
          ? 'https://api.openai.com/v1/chat/completions'
          : provider === 'DEEPSEEK'
          ? 'https://api.deepseek.com/v1/chat/completions'
          : baseUrl?.endsWith('/v1') || baseUrl?.endsWith('/v1/')
            ? `${baseUrl.replace(/\/+$/, '')}/chat/completions`
            : `${baseUrl}/v1/chat/completions`;

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ model: modelName, messages, max_tokens: maxTokens }),
        });

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`${provider} API error ${res.status}: ${errBody.slice(0, 300)}`);
        }

        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
      }

      case 'ANTHROPIC': {
        // Anthropic requires system message separate from messages
        const systemMsg = messages.find(m => m.role === 'system')?.content || '';
        const chatMsgs = messages.filter(m => m.role !== 'system');

        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: modelName,
            max_tokens: maxTokens,
            system: systemMsg,
            messages: chatMsgs,
          }),
        });

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`Anthropic API error ${res.status}: ${errBody.slice(0, 300)}`);
        }

        const data = await res.json();
        return data.content?.[0]?.text || '';
      }

      case 'GEMINI': {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

        // Convert chat messages to Gemini format
        const contents = messages
          .filter(m => m.role !== 'system')
          .map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          }));

        // Prepend system instruction to first user message
        const systemMsg = messages.find(m => m.role === 'system')?.content;
        if (systemMsg && contents.length > 0) {
          contents[0].parts[0].text = `${systemMsg}\n\n${contents[0].parts[0].text}`;
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents }),
        });

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`Gemini API error ${res.status}: ${errBody.slice(0, 300)}`);
        }

        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }

      default:
        throw new Error(`Unsupported AI provider: ${provider}`);
    }
  }

  // ─── KYC Vision — uses server-level OPENAI_API_KEY only ──────────────────────
  // Never reads from DB config. Uses gpt-4.1-mini first; escalates to gpt-4.1
  // when confidence < 0.60. Uses detail:"high" for accurate Indian doc field reads.
  // ──────────────────────────────────────────────────────────────────────────────

  async scanDocumentKyc(imageBase64: string, mimeType: string): Promise<AiResponse & {
    confidence?: number;
    escalated?: boolean;
  }> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { success: false, error: 'OPENAI_API_KEY not configured — KYC vision unavailable' };
    }

    try {
      const rawFirst = await this.callOpenAiKycVision(apiKey, 'gpt-4.1-mini', imageBase64, mimeType);
      const parsed = JSON.parse(rawFirst.replace(/```json[\s\S]*?```|```/g, '').trim());
      const conf: number = typeof parsed.confidence === 'number' ? parsed.confidence : 0;

      if (conf < 0.60) {
        // Low confidence on mini → escalate to full gpt-4.1 for better accuracy
        try {
          const rawEscalated = await this.callOpenAiKycVision(apiKey, 'gpt-4.1', imageBase64, mimeType);
          const ep = JSON.parse(rawEscalated.replace(/```json[\s\S]*?```|```/g, '').trim());
          return {
            success: true,
            data: JSON.stringify({ ...ep, _model: 'gpt-4.1' }),
            confidence: typeof ep.confidence === 'number' ? ep.confidence : conf,
            escalated: true,
          };
        } catch {
          // Escalation failed — return the mini result as-is
        }
      }

      return {
        success: true,
        data: JSON.stringify({ ...parsed, _model: 'gpt-4.1-mini' }),
        confidence: conf,
        escalated: false,
      };
    } catch (err: any) {
      return { success: false, error: `KYC vision failed: ${err.message}` };
    }
  }

  private async callOpenAiKycVision(apiKey: string, model: string, imageBase64: string, mimeType: string): Promise<string> {
    const KYC_PROMPT = `You are a KYC document analyst for an Indian HR system. Analyze this document image and extract all visible fields.
Return ONLY compact JSON (no markdown, no explanation):
{"document_type":"AADHAAR|PAN|PASSPORT|TENTH_CERTIFICATE|TWELFTH_CERTIFICATE|DEGREE|BANK_PASSBOOK|EXPERIENCE_LETTER|OFFER_LETTER|PROFESSIONAL_CERTIFICATION|OTHER","confidence":0.0,"extracted_fields":{"name":null,"date_of_birth":null,"document_number":null,"father_name":null,"mother_name":null,"gender":null,"address":null,"issuing_authority":null,"issue_date":null,"expiry_date":null,"account_number":null,"ifsc_code":null,"bank_name":null},"raw_text":"all visible text","validation_pointers":["specific items HR should verify"],"suspicious_indicators":[],"quality_note":"image quality assessment"}
Rules: Do NOT guess. Return null for unclear fields. date_of_birth → DD/MM/YYYY. confidence = 0.0–1.0 based on how well ALL key fields were readable. Aadhaar = 12 digits. PAN = 5 letters+4 digits+letter.`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: KYC_PROMPT },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}`, detail: 'high' } },
          ],
        }],
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      throw new Error(`OpenAI KYC vision (${model}) ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const data = await res.json() as any;
    return data.choices?.[0]?.message?.content || '';
  }
}

export const aiService = new AiService();
