import { aiConfigService } from '../modules/ai-config/ai-config.service.js';
import { logger } from '../lib/logger.js';

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
 * if (result.success) logger.info(result.data);
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
      logger.debug(`[AiService] chat → provider=${config.provider} model=${config.modelName} orgId=${organizationId}`);
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
          signal: AbortSignal.timeout(30_000),
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
          signal: AbortSignal.timeout(30_000),
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
          signal: AbortSignal.timeout(30_000),
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

  async scanDocumentKyc(imageBase64: string, mimeType: string, docTypeHint?: string): Promise<AiResponse & {
    confidence?: number;
    escalated?: boolean;
  }> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { success: false, error: 'OPENAI_API_KEY not configured — KYC vision unavailable' };
    }

    try {
      const rawFirst = await this.callOpenAiKycVision(apiKey, 'gpt-4.1-mini', imageBase64, mimeType, false, docTypeHint);
      const parsed = JSON.parse(rawFirst.replace(/```json[\s\S]*?```|```/g, '').trim());
      // Support both old 'confidence' and new 'overall_confidence' field names
      const conf: number = typeof parsed.overall_confidence === 'number' ? parsed.overall_confidence
        : typeof parsed.confidence === 'number' ? parsed.confidence : 0;

      if (conf < 0.60) {
        // Low confidence on mini → escalate to full gpt-4.1 for better accuracy
        try {
          const rawEscalated = await this.callOpenAiKycVision(apiKey, 'gpt-4.1', imageBase64, mimeType, false, docTypeHint);
          const ep = JSON.parse(rawEscalated.replace(/```json[\s\S]*?```|```/g, '').trim());
          const epConf = typeof ep.overall_confidence === 'number' ? ep.overall_confidence
            : typeof ep.confidence === 'number' ? ep.confidence : conf;
          return {
            success: true,
            data: JSON.stringify({ ...ep, _model: 'gpt-4.1' }),
            confidence: epConf,
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

  // ── Deep Re-check (gpt-4.1 direct, no mini first) ────────────────────────────
  async deepScanDocumentKyc(imageBase64: string, mimeType: string, docTypeHint?: string): Promise<AiResponse & {
    confidence?: number;
    escalated?: boolean;
  }> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { success: false, error: 'OPENAI_API_KEY not configured — KYC vision unavailable' };
    }
    try {
      const raw = await this.callOpenAiKycVision(apiKey, 'gpt-4.1', imageBase64, mimeType, true, docTypeHint);
      const parsed = JSON.parse(raw.replace(/```json[\s\S]*?```|```/g, '').trim());
      const conf: number = typeof parsed.overall_confidence === 'number' ? parsed.overall_confidence
        : typeof parsed.confidence === 'number' ? parsed.confidence : 0;
      return {
        success: true,
        data: JSON.stringify({ ...parsed, _model: 'gpt-4.1' }),
        confidence: conf,
        escalated: false,
      };
    } catch (err: any) {
      return { success: false, error: `Deep KYC vision failed: ${err.message}` };
    }
  }

  /**
   * Compare two face images (passport photo vs Aadhaar card) to detect impersonation.
   * Returns { match, confidence, reason } — match=true means faces are the same person.
   */
  async compareFaces(
    photo1Base64: string, mime1: string,
    photo2Base64: string, mime2: string,
    organizationId?: string,
  ): Promise<{ match: boolean; confidence: number; reason: string }> {
    const orgId = organizationId || 'default';
    const config = await aiConfigService.getActiveConfigRaw(orgId);
    if (!config || !config.apiKey || config.provider !== 'OPENAI') {
      return { match: false, confidence: 0, reason: 'AI provider not configured for face comparison' };
    }
    const apiKey = config.apiKey;
    const model = config.modelName || 'gpt-4.1';
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const isOpenRouter = apiKey.startsWith('sk-or-v1-') || baseUrl.includes('openrouter');
    const resolvedModel = isOpenRouter ? 'openai/gpt-4o' : model;
    const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

    const PROMPT = `You are an anti-fraud face verification system for an Indian HR KYC process.
You will be shown two images. Image 1 is the employee's submitted passport photo. Image 2 is an identity document (Aadhaar card or similar) that contains a small photo of the holder.
Your task: Determine if both images show the SAME person.

Respond ONLY with compact JSON (no markdown):
{"match":true,"confidence":0.0,"reason":"one sentence explanation with specific visual evidence"}

Rules:
- match: true if same person (high confidence ≥ 0.7 needed), false if different or uncertain
- confidence: 0.0–1.0 how certain you are
- If Image 2 has no visible face (small/unclear photo on document), set match:false, confidence:0, reason:"No face visible in document photo"
- Focus on: face shape, eye distance, nose shape, jawline — ignore lighting and background differences
- Never guess — if confidence < 0.6, set match:false`;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          ...(isOpenRouter ? { 'HTTP-Referer': 'https://hr.anistonav.com', 'X-Title': 'Aniston HRMS KYC' } : {}),
        },
        body: JSON.stringify({
          model: resolvedModel,
          max_tokens: 200,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: `data:${mime1};base64,${photo1Base64}`, detail: 'high' } },
              { type: 'image_url', image_url: { url: `data:${mime2};base64,${photo2Base64}`, detail: 'high' } },
            ],
          }],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Face compare API ${res.status}`);
      const data = await res.json() as any;
      const raw = data.choices?.[0]?.message?.content || '';
      const clean = raw.replace(/```json\n?|```/g, '').trim();
      return JSON.parse(clean);
    } catch (err: any) {
      return { match: false, confidence: 0, reason: `Face comparison failed: ${err.message}` };
    }
  }

  private async callOpenAiKycVision(apiKey: string, model: string, imageBase64: string, mimeType: string, deepMode = false, docTypeHint?: string): Promise<string> {
    // Support OpenRouter (sk-or-v1-...) and direct OpenAI — auto-detected via key prefix or env
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const isOpenRouter = apiKey.startsWith('sk-or-v1-') || baseUrl.includes('openrouter');
    // OpenRouter uses namespaced model IDs; map gpt-4.1-* to supported equivalents
    const resolvedModel = isOpenRouter
      ? (model === 'gpt-4.1' ? 'openai/gpt-4o' : 'openai/gpt-4o-mini')
      : model;
    const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

    const DEEP_PREFIX = deepMode
      ? 'This is a deep forensic review. Apply maximum scrutiny to authenticity and tampering detection. Pay special attention to metadata consistency, print quality, digital artifacts, and any signs of selective editing around numbers or dates.\n\n'
      : '';

    const TYPE_HINT = docTypeHint && docTypeHint !== 'OTHER'
      ? `HR system has classified this as: ${docTypeHint.replace(/_/g, ' ')}. Apply validation rules for this type. If the visible content clearly belongs to a different type, use the correct type but note the discrepancy as a finding.\n\n`
      : '';

    const KYC_PROMPT = `${DEEP_PREFIX}${TYPE_HINT}You are an enterprise KYC document analyst for an Indian HR system. Analyze this document image and perform each applicable check yourself — report EXACTLY what you see with specific values.

Return ONLY compact JSON (no markdown, no explanation):
{"document_type":"AADHAAR|PAN|PASSPORT|PHOTO|RESIDENCE_PROOF|EXPERIENCE_LETTER|SALARY_SLIP|DEGREE_CERTIFICATE|TENTH_CERTIFICATE|TWELFTH_CERTIFICATE|BANK_PASSBOOK|CANCELLED_CHEQUE|PROFESSIONAL_CERTIFICATION|OTHER","overall_confidence":0.0,"extracted_fields":{"full_name":{"value":null,"confidence":0,"evidence":"exact name as printed"},"date_of_birth":{"value":null,"confidence":0,"evidence":"exact DOB as printed — ONLY the holder's birth date, never the document issue date"},"gender":{"value":null,"confidence":0,"evidence":""},"father_name":{"value":null,"confidence":0,"evidence":"exact father name as printed"},"document_number":{"value":null,"confidence":0,"evidence":"exact number as printed"},"address":{"value":null,"confidence":0,"evidence":""},"company_name":{"value":null,"confidence":0,"evidence":""},"designation":{"value":null,"confidence":0,"evidence":""},"joining_date":{"value":null,"confidence":0,"evidence":"employment start date only"},"leaving_date":{"value":null,"confidence":0,"evidence":""},"salary":{"gross":null,"net":null,"deductions":null,"confidence":0},"document_date":{"value":null,"confidence":0,"evidence":"date document was ISSUED — NOT the holder's DOB"}},"authenticity_checks":{"possible_digital_editing":{"result":"PASS","evidence":""},"screenshot_or_screen_photo":{"result":"PASS","evidence":""},"crop_or_missing_boundary":{"result":"PASS","evidence":""},"font_alignment_consistency":{"result":"PASS","evidence":""},"metadata_risk":{"result":"PASS","evidence":""}},"quality":{"result":"HIGH","readability_confidence":0,"blur_or_noise_note":""},"findings":[{"check":"","result":"PASS|WARNING|FAIL","severity":"INFO|WARN|ERROR","field":null,"detail":"specific value found: 'ABCDE1234F' — format valid","evidence":""}],"tampering_signals":[],"recommended_status":"NEEDS_HR_REVIEW","recommended_action":"","summary":"One-sentence verdict with specific evidence. State what is correct AND what (if anything) needs attention. Example: 'Aadhaar 1234 5678 9012 passes Verhoeff check, name SUNNY KUMAR MEHTA extracted cleanly, document appears genuine with consistent print quality.'","raw_text":"all visible text from document"}

RULES:
1. result: PASS (verified OK), WARNING (uncertain/needs attention), FAIL (definite problem found). Return null for fields you cannot read.
2. detail MUST contain the SPECIFIC value from this document — the actual number, name, or date you see. Never write generic text like "name found" — write "name 'SUNNY KUMAR MEHTA' extracted from line 2".
3. findings: return ONLY significant findings. Maximum 8. Include the ONE most important PASS finding (e.g. Aadhaar format pass, PAN format pass). Always include ALL WARNING and FAIL findings.
4. tampering_signals: list ONLY with actual visual evidence (pixel inconsistencies near specific fields, font substitution, edited stamp, composite image artifacts). Empty array if none found. Never speculate without visual evidence.
5. CRITICAL — date_of_birth is ONLY the document holder's date of birth (as printed on ID cards). document_date / issue_date is when the document was issued — these are COMPLETELY DIFFERENT fields. A 10th certificate shows graduation year, NOT the student's DOB — leave date_of_birth null for certificates.
6. Document-type-specific rules (CRITICAL — follow exactly):
   - PHOTO: assess face presence and image quality ONLY. Do NOT extract DOB, Aadhaar, PAN, address. Do NOT produce DOB findings. Maximum 3 findings.
   - RESIDENCE_PROOF: extract name and address ONLY. Bill/document date is NOT date-of-birth — leave date_of_birth null. Never produce DOB findings.
   - SALARY_SLIP: check name/company/month/gross/net arithmetic only. If gross-deductions present, verify arithmetic. Flag suspicious edits near amounts.
   - EXPERIENCE_LETTER/RELIEVING_LETTER: check name/company/designation/dates/letterhead. Flag font inconsistency near key fields.
   - DEGREE_CERTIFICATE/TENTH_CERTIFICATE/TWELFTH_CERTIFICATE: check student name/institution/year only. Leave date_of_birth null — the year printed is graduation year, not DOB.
   - BANK_STATEMENT/CANCELLED_CHEQUE: check account holder name and account number only. No DOB check.
   - VOTER_ID: extract name, EPIC number (format: 3 uppercase letters + 7 digits, e.g. ABC1234567), father/husband name, DOB, address. Verify EPIC format. Flag font inconsistency near name or EPIC number. Leave date_of_birth null if only partial year visible.
   - DRIVING_LICENSE: extract name, DL number, DOB, address, validity/expiry date. Flag if validity date (valid_upto / expiry_date field) is in the past — write the expiry date in expiry_date extracted field. Flag font anomalies near name or licence number.
   - PASSPORT: extract name, passport number (1 letter + 7 digits, e.g. A1234567), DOB, nationality, expiry date. Flag if expiry is within 6 months or already past — write the expiry date in expiry_date extracted field. Flag MRZ line inconsistency if visible.
7. For fields not applicable to this document type, set value:null confidence:0. Do not produce findings for inapplicable fields.
8. Never call a document fake on a single weak signal — use WARNING with specific evidence.
9. summary field is REQUIRED — always produce a concise one-sentence verdict with specific values found.
10. date_of_birth format: DD/MM/YYYY. overall_confidence = 0.0–1.0.`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...(isOpenRouter ? { 'HTTP-Referer': 'https://hr.anistonav.com', 'X-Title': 'Aniston HRMS KYC' } : {}),
      },
      body: JSON.stringify({
        model: resolvedModel,
        max_tokens: 1600,
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
      throw new Error(`KYC vision (${resolvedModel}@${isOpenRouter ? 'openrouter' : 'openai'}) ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const data = await res.json() as any;
    return data.choices?.[0]?.message?.content || '';
  }
}

export const aiService = new AiService();
