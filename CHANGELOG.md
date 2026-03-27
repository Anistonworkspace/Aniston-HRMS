# Changelog

All notable changes to Aniston HRMS are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased] — 2026-03-27

### Phase 8 — Admin Email Configuration
#### Added
- `adminNotificationEmail` field on the `Organization` Prisma model for org-wide notification routing.
- Settings UI field (Super Admin only) to view and update the admin notification email address.
- Backend: `PATCH /api/settings` now accepts and persists `adminNotificationEmail`.

---

### Phase 7 — AI Interview Execution & Scoring
#### Added
- Interview round management endpoints under `POST /api/jobs/:id/interview-rounds`.
- AI-generated question set per round using the org's configured AI provider via `AiService.prompt()`.
- Per-answer scoring system: each response receives an AI-evaluated score.
- Weighted final score calculation across all rounds when finalizing a candidate.
- `POST /api/jobs/:id/finalize` endpoint — applies weighted scoring and updates `PublicApplication` status to `FINALIZED`.
- `InterviewRound` Prisma model: stores round label, questions, answers, scores, scheduled time, and interviewer.

---

### Phase 6 — AI Interview Scheduling
#### Added
- `POST /api/jobs/:id/schedule-interview` endpoint — persists scheduled date/time and generates an AI-authored candidate invitation message preview.
- Integration with the `public-apply` module: scheduling updates the linked `PublicApplication` record and `InterviewRound`.
- AI message preview surface on the frontend candidate detail panel.

---

### Phase 5 — AI Job Application Form
#### Added
- `PublicApplication` Prisma model: stores candidate details, per-question responses, status, UID, and weighted score.
- `JobApplicationQuestion` Prisma model: AI-generated MCQ questions linked to a `JobOpening`.
- `InterviewRound` Prisma model (introduced here, extended in Phase 7).
- `public-apply` backend module (full MVC at `backend/src/modules/public-apply/`):
  - `GET /api/jobs/:token` — public job details (no auth).
  - `POST /api/jobs/:token/apply` — submit application with MCQ responses.
  - `GET /api/jobs/track/:uid` — public application status tracker.
- Frontend public routes (no auth):
  - `/apply/:token` — `PublicApplyPage` with AI MCQ form.
  - `/track/:uid` and `/track` — `TrackApplicationPage` for status lookup by UID.
- AI MCQ generation: on first public apply page load, questions are generated via `AiService` and cached on the `JobOpening`.

---

### Phase 4 — AI Assistant
#### Added
- `ai-assistant` backend module (full MVC at `backend/src/modules/ai-assistant/`):
  - `POST /api/ai-assistant/chat` — sends user message with page context; returns AI reply.
  - `GET /api/ai-assistant/history` — retrieves per-user conversation history from Redis.
  - `DELETE /api/ai-assistant/history` — clears conversation history.
- Conversation history stored in Redis with per-user, per-page key (TTL: 1 hour).
- Context-aware system prompts that vary based on the current frontend page/module.
- `AiAssistantPanel` floating action button (FAB) component added to `AppShell` — available on all protected pages.
- Routes through the centralized `AiService` so the assistant automatically uses the org's configured provider.

---

### Phase 3 — AI API Configuration
#### Added
- `AiApiConfig` Prisma model: per-org AI provider config with AES-256-GCM encrypted API key, provider enum (`OPENAI | DEEPSEEK | ANTHROPIC | GEMINI | CUSTOM`), model name, optional base URL, active flag.
- `ai-config` backend module (full MVC at `backend/src/modules/ai-config/`):
  - `GET /api/settings/ai-config` — returns masked config (last 4 chars of key visible).
  - `POST /api/settings/ai-config` — upsert provider config; encrypts key before save; deactivates other providers.
  - `POST /api/settings/ai-config/test` — sends a test prompt and returns latency + provider response.
- Redis cache for active config (60 s TTL) to avoid repeated DB + decrypt calls on every AI request.
- Centralized `AiService` singleton at `backend/src/services/ai.service.ts`:
  - `chat(organizationId, messages, maxTokens)` — routes to the org's active provider.
  - `prompt(organizationId, systemPrompt, userPrompt, maxTokens)` — convenience single-turn wrapper.
  - `scoreResume(organizationId, resumeText, jobDescription)` — structured JSON resume scoring.
  - Supports OpenAI, DeepSeek, Anthropic, Gemini, and custom OpenAI-compatible endpoints.
- Frontend Settings page — new "API Integrations" tab (SUPER_ADMIN only): provider selector dropdown, API key input (masked), model name field, base URL field (for CUSTOM), test-connection button with latency display.

---

### Phase 2 — WhatsApp Web UI
#### Added
- Frontend `/whatsapp` route — `WhatsAppPage` with three-panel layout: contact/chat list, message thread view, new-chat composer.
- Sidebar navigation item for WhatsApp (visible to HR and above).
- Backend chat and contacts endpoints in the existing `whatsapp` module (`backend/src/modules/whatsapp/`):
  - `GET /api/whatsapp/chats` — list active chats.
  - `GET /api/whatsapp/chats/:chatId/messages` — paginated message history.
  - `POST /api/whatsapp/chats/:chatId/send` — send message.
  - `GET /api/whatsapp/contacts` — search/list contacts.
- Real-time message updates pushed via Socket.io room `whatsapp:<orgId>`.

---

### Phase 1 — Employee Invitation System
#### Added
- `EmployeeInvitation` Prisma model: stores invite token (UUID), email, mobile number, status (`PENDING | ACCEPTED | EXPIRED`), expiry timestamp (72 hours), inviter ID, and accepted-at timestamp.
- `invitation` backend module (full MVC at `backend/src/modules/invitation/`):
  - `POST /api/invitations` — create invitation, send email via BullMQ `employee-invite` template.
  - `GET /api/invitations` — paginated list with inviter email denormalization and live expiry flag.
  - `GET /api/invitations/validate/:token` — public token validation (returns org info for accept page).
  - `POST /api/invitations/accept/:token` — create `User` + `Employee` in a transaction; mark invitation `ACCEPTED`; generate onboarding token in Redis (7-day TTL).
  - `POST /api/invitations/:id/resend` — regenerate token, extend expiry 72 hours, resend email.
- Frontend:
  - `/onboarding/invite/:token` — `InviteAcceptPage`: validates token, collects first name, last name, email, phone, password; on success redirects to `/onboarding/:onboardingToken`.
  - Employee list page — "Invite Employee" button (HR/Admin) opens invite modal; "Invitations" tab shows sent invitations with status badges.
- Audit log entry on invitation create.

---

## Earlier Phases (summary)

### Phases 1–5 — Core Platform
See PROGRESS notes in `PROGRESS.md` and feature descriptions in `CLAUDE.md` (Key Features by Phase).

Key deliverables included:
- Auth (JWT + refresh tokens), Employee CRUD, Dashboard
- Attendance (3 modes: Office geofence, Field Sales GPS, Project Site photo)
- Leave management, Payroll (Indian statutory: EPF/ESI/PT/TDS)
- AI-assisted Recruitment (OCR + DeepSeek scoring), Self-onboarding wizard, Walk-in kiosk
- Performance, Policies, Announcements, Helpdesk, Org Chart, Reports
- Asset management, Holiday management, Org settings, PWA
- PDF salary slips (pdfkit), Excel exports (exceljs)
- CI/CD via GitHub Actions
