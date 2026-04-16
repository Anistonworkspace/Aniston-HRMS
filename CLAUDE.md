# Aniston HRMS — Project Reference

## What is this?
Enterprise-grade Human Resource Management System (HRMS) as a Progressive Web Application built for Aniston Technologies LLP. Replaces/improves on Zoho People with custom features.

## Tech Stack
- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS v3 + shadcn/ui + Redux Toolkit (RTK Query) + Framer Motion
- **Backend**: Node.js + Express + TypeScript + Prisma ORM + PostgreSQL 16 + Redis 7 + BullMQ + Socket.io
- **AI Service**: Python FastAPI (OCR with pytesseract, DeepSeek scoring, RAGFlow search) — integrated via Docker Compose
- **Mobile**: Capacitor (Android APK build) — `frontend/capacitor.config.ts`
- **Infra**: Docker Compose (postgres:16-alpine, redis:7-alpine, ai-service Python FastAPI) + GitHub Actions CI/CD

## Project Structure
```
Aniston-hrms/
├── frontend/          # React app (Vite + Capacitor)
├── backend/           # Express API
├── shared/            # Shared TypeScript types & permissions (@aniston/shared)
├── prisma/            # Prisma schema + seed + migrations
├── docker/            # docker-compose.yml
├── ai-service/        # Python FastAPI (OCR + scoring)
├── deploy/            # nginx.conf, deployment config
├── docs/              # Mega prompt & reference docs
└── .env               # Environment variables (not committed)
```

## How to Run
```bash
# 1. Start database services
cd docker && docker compose up -d

# 2. Start backend (from root)
npm run dev:backend

# 3. Start frontend (from root)
npm run dev:frontend

# Or both together:
npm run dev
```

## Key URLs
- Frontend: http://localhost:5173
- Backend API: http://localhost:4000
- API Docs (Swagger): http://localhost:4000/api/docs
- Health check: http://localhost:4000/api/health
- Walk-In Kiosk: http://localhost:5173/walk-in
- AI Service: http://localhost:8000/ai/health
- Prisma Studio: `npm run db:studio`
- Public Job Application: http://localhost:5173/apply/:token
- Application Tracker: http://localhost:5173/track/:uid
- WhatsApp UI: http://localhost:5173/whatsapp
- Invite Onboarding: http://localhost:5173/onboarding/invite/:token
- Android Install Guide: http://localhost:5173/download/android
- iOS Install Guide: http://localhost:5173/download/ios

## Login Credentials (Dev)
- Super Admin: `superadmin@anistonav.com` / `Superadmin@1234`
- Other users: Synced from Microsoft Teams (use SSO or assigned credentials)

## Architecture Decisions
1. **npm workspaces monorepo** — frontend, backend, shared packages
2. **Module pattern** on backend — all 40+ modules follow full MVC: controller/service/routes/validation in `backend/src/modules/<feature>/`
3. **RTK Query** for frontend API calls with auto-caching and tag-based invalidation
4. **Single Prisma schema** at `prisma/schema.prisma` — all models in one file (80+ models)
5. **RBAC** — 7 roles (SUPER_ADMIN, ADMIN, HR, MANAGER, EMPLOYEE, GUEST_INTERVIEWER, INTERN) with permission map in `shared/src/permissions.ts`
6. **Glassmorphism UI** — Monday.com-inspired layered design. CSS utilities in `frontend/src/styles/globals.css`
7. **Fonts**: Sora (headings), DM Sans (body), JetBrains Mono (data/numbers)
8. **File uploads** — Multer middleware at `backend/src/middleware/upload.middleware.ts` with type-specific handlers (uploadImage, uploadDocument, uploadResume)
9. **Real-time** — Socket.io server at `backend/src/sockets/index.ts`, client at `frontend/src/lib/socket.ts`
10. **Job queues** — BullMQ queues (email, notification, payroll) at `backend/src/jobs/`, workers auto-start with server
11. **Email** — Nodemailer with HTML templates via BullMQ email worker, SMTP config in env
12. **Encryption** — AES-256-GCM at `backend/src/utils/encryption.ts` for sensitive data (Aadhaar/PAN)
13. **Audit logging** — Centralized at `backend/src/utils/auditLogger.ts`, used in leave, payroll, performance, settings
14. **API docs** — Swagger UI at `/api/docs`, OpenAPI spec at `/api/docs.json`
15. **Testing** — Vitest + supertest, tests in `backend/src/**/__tests__/`, run with `npm run test --workspace=backend`
16. **PWA** — vite-plugin-pwa with `registerType: 'prompt'` + `injectManifest` strategy; update detection via `AppUpdateGuard`
17. **Android APK** — Capacitor build via GitHub Actions; APK served at `/downloads/aniston-hrms.apk`; nginx aliases to `downloads/apk-build/`
18. **Task Integration** — Jira, Asana, ClickUp integration via `task-integration` module with encrypted API keys
19. **`kycCompleted` is computed, not stored** — derived in `auth.service.ts` from `user.employee?.documentGate?.kycStatus === 'VERIFIED'` at JWT generation time. Changing `kycStatus` in DB takes effect on next token refresh. For immediate revocation, emit `kyc:status-changed` socket event and dispatch `setUser({ ...user, kycCompleted: false })` from AppShell listener.

## Backend Modules (40+)
All modules in `backend/src/modules/<name>/` follow MVC pattern. Notable modules:

| Module | Purpose |
|---|---|
| `agent` | Remote agent screenshots + activity monitoring |
| `ai-assistant` | Context-aware FAB chat, Redis conversation history |
| `ai-config` | Multi-provider AI config (OpenAI/DeepSeek/Anthropic/Gemini), AES-encrypted keys |
| `announcement` | Org-wide announcements + social wall |
| `asset` | Asset CRUD + assign/return workflow |
| `attendance` | 3-mode attendance (OFFICE/FIELD_SALES/PROJECT_SITE) |
| `auth` | JWT + refresh tokens + RBAC |
| `backup` | Database backup management |
| `branding` | Company branding (logo, colors, theme) |
| `component-master` | Salary component master definitions |
| `dashboard` | Stats + analytics aggregation |
| `document` | Document upload, verification, management |
| `document-ocr` | OCR extraction, AI verification, format validation |
| `employee` | Employee CRUD, profile, documents, audit |
| `employee-deletion` | Soft-delete workflow with approval |
| `employee-permissions` | Granular permission overrides per employee |
| `exit-access` | Exit/offboarding checklist + access revocation |
| `helpdesk` | Support tickets + comments |
| `holiday` | Holiday CRUD management |
| `intern` | Intern profile, mentor assignment, achievement letters |
| `invitation` | Token-based employee invites (72-hr TTL, email delivery) |
| `leave` | Leave types, balances, requests, approvals, settings, policies |
| `letter` | Letter templates + generation + assignments |
| `onboarding` | 7-step wizard + document gate + KYC |
| `payroll` | Indian statutory payroll (EPF/ESI/PT/TDS) + Excel export |
| `payroll-adjustment` | One-off payroll adjustments |
| `payroll-deletion` | Payroll record deletion with approval workflow |
| `performance` | Goals, review cycles, enterprise dashboard + task integration |
| `policy` | Company policy docs + acknowledgment tracking |
| `public-apply` | Public job application (AI MCQ, tracking, interview rounds) |
| `recruitment` | Job openings + Kanban pipeline + interview execution + scoring + offers + public application management |
| `report` | Reports + Excel/PDF exports |
| `salary-template` | Salary template CRUD + structure assignment |
| `settings` | Org settings, locations, audit logs, AI config |
| `shift` | Shift definitions + rotation patterns + assignments |
| `task-integration` | Jira/Asana/ClickUp integration for leave handover risk |
| `walkIn` | Walk-in kiosk (5-step form) + HR management |
| `whatsapp` | WhatsApp session, messages, OTP, conversations |

## New Backend Routes (Phase 6–9)
| Route prefix | Module | Notes |
|---|---|---|
| `POST /api/settings/ai-config` | ai-config | Upsert AI provider config (SUPER_ADMIN) |
| `GET /api/settings/ai-config` | ai-config | Get masked config |
| `POST /api/settings/ai-config/test` | ai-config | Test provider connection |
| `POST /api/invitations` | invitation | Create + email invite |
| `GET /api/invitations` | invitation | List org invitations |
| `GET /api/invitations/validate/:token` | invitation | Public token validation |
| `POST /api/invitations/accept/:token` | invitation | Accept invite, create employee |
| `POST /api/invitations/:id/resend` | invitation | Resend with new token |
| `POST /api/ai-assistant/chat` | ai-assistant | Chat with AI assistant |
| `GET /api/ai-assistant/history` | ai-assistant | Get conversation history |
| `DELETE /api/ai-assistant/history` | ai-assistant | Clear conversation |
| `GET /api/jobs/:token` | public-apply | Get public job details |
| `POST /api/jobs/:token/apply` | public-apply | Submit public application |
| `GET /api/jobs/track/:uid` | public-apply | Track application status |
| `POST /api/jobs/:id/interview-rounds` | public-apply | Create interview round |
| `POST /api/jobs/:id/schedule-interview` | public-apply | Schedule + AI message |
| `POST /api/jobs/:id/finalize` | public-apply | Finalize with weighted score |
| `GET /api/performance/summary/:id` | performance | Enterprise performance dashboard |
| `DELETE /api/payroll/:id` | payroll-deletion | Delete payroll record (with approval) |
| `GET /api/leave/settings` | leave | Leave settings per org |
| `PATCH /api/leave/settings` | leave | Update leave settings |
| `GET /api/onboarding/document-gate` | onboarding | Document gate status |
| `POST /api/intern` | intern | Create intern profile |
| `GET /api/intern/:id/letters` | intern | Get achievement letters |
| `GET /api/task-integration/config` | task-integration | Get integration config |
| `POST /api/task-integration/config` | task-integration | Save integration config |
| `GET /api/task-integration/tasks/:employeeId` | task-integration | Fetch tasks for employee |
| `GET /api/employee-permissions/:id` | employee-permissions | Get employee permission overrides |
| `POST /api/employee-permissions/:id` | employee-permissions | Set permission overrides |
| `POST /api/recruitment/:id/interview-rounds` | recruitment | Create interview round + AI questions |
| `POST /api/recruitment/:id/schedule-interview` | recruitment | Schedule interview + AI message preview |
| `POST /api/recruitment/:id/finalize` | recruitment | Finalize candidate with weighted score + hire/reject |

## Prisma Models (80+ total, key additions since Phase 8)
| Model | Purpose |
|---|---|
| `AiApiConfig` | Multi-provider AI config with AES-256-GCM encrypted API key |
| `EmployeeInvitation` | Token-based invite (72-hr TTL, PENDING/ACCEPTED/EXPIRED) |
| `JobApplicationQuestion` | AI-generated MCQ questions linked to a job opening |
| `PublicApplication` | Candidate submission via public apply form |
| `InterviewRound` | Interview round with AI questions, scores, scheduling |
| `InternProfile` | Intern-specific data (mentor, stipend, duration, college) |
| `InternAchievementLetter` | Generated letters for interns |
| `ExitChecklist` | Offboarding checklist per employee |
| `ExitChecklistItem` | Individual checklist items with completion status |
| `ExitAccessConfig` | Post-exit access revocation rules |
| `PayrollDeletionRequest` | Payroll deletion approval workflow |
| `PayrollAdjustment` | One-off salary adjustments (bonus, deduction) |
| `SalaryTemplate` | Reusable salary templates |
| `SalaryStructure` | Employee salary structure (linked to template) |
| `SalaryHistory` | Historical salary changes with change type |
| `Shift` | Shift definitions (MORNING/EVENING/NIGHT/FLEXIBLE) |
| `ShiftAssignment` | Employee shift assignments |
| `ShiftRotationPattern` | Rotation schedule patterns |
| `LeavePolicy` | Org-level leave policies |
| `LeavePolicyRule` | Per-type leave policy rules |
| `AttendancePolicy` | Org-level attendance policies |
| `OvertimeRequest` | Overtime requests + approvals |
| `TaskManagerConfig` | Jira/Asana/ClickUp credentials per org |
| `LeaveTaskAudit` | Leave → task impact audit records |
| `TaskIntegrationHealthLog` | Task integration health monitoring |
| `LeaveHandover` | Leave handover task assignments |
| `LeaveApprovalDecision` | Leave approval decision trail |
| `PermissionPreset` | Named permission presets (e.g., "Team Lead") |
| `PermissionOverride` | Per-employee permission overrides |
| `CompanyBranding` | Logo, colors, theme settings per org |
| `LetterTemplate` | Letter templates (OFFER/EXPERIENCE/etc.) |
| `Letter` | Generated letters with PDF path |
| `LetterAssignment` | Letters assigned to employees |
| `EmployeeDeletionRequest` | Employee soft-delete approval workflow |
| `DatabaseBackup` | Backup records (MANUAL/SCHEDULED/PRE_MIGRATION) |
| `DeviceSession` | Device session tracking (mobile/desktop) |
| `UserMFA` | MFA configuration per user |
| `LocationVisit` | Field sales GPS visit clustering |
| `AiKnowledgeBase` | RAG knowledge base entries |
| `EmployeeActivation` | Employee activation token tracking |
| `AgentScreenshot` | Remote monitoring screenshots |
| `ActivityLog` | Detailed activity logs |

## Key Files
| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | All database models (80+ models) |
| `shared/src/permissions.ts` | RBAC permissions map — consumed by both frontend & backend |
| `shared/src/enums.ts` | All enums shared across the app |
| `shared/src/types.ts` | API request/response TypeScript types |
| `backend/src/app.ts` | Express app setup, middleware, routes |
| `backend/src/middleware/auth.middleware.ts` | JWT auth + RBAC middleware |
| `backend/src/middleware/errorHandler.ts` | Global error handler with AppError classes |
| `backend/src/config/env.ts` | Zod-validated environment config |
| `frontend/src/app/api.ts` | RTK Query base API with 401 refresh interceptor |
| `frontend/src/app/store.ts` | Redux store configuration |
| `frontend/src/router/AppRouter.tsx` | All routes with lazy loading |
| `frontend/src/components/layout/AppShell.tsx` | Main layout (sidebar + topbar + content) |
| `frontend/src/styles/globals.css` | Tailwind utilities + glassmorphism classes |
| `backend/src/middleware/upload.middleware.ts` | Multer file upload middleware (image, document, resume) |
| `backend/src/modules/document/` | Document upload, verification, management (full MVC) |
| `backend/src/modules/document-ocr/` | OCR pipeline — extraction, AI verification, format validation |
| `backend/src/modules/walkIn/` | Walk-in candidate self-registration (public kiosk + HR management) |
| `backend/src/services/combined-pdf-processor.service.ts` | Combined multi-document PDF processing pipeline |
| `backend/src/services/document-processor.service.ts` | Single-document OCR + AI processing pipeline |
| `backend/src/utils/documentFormatValidator.ts` | Document format validation (Aadhaar/PAN/passport/etc.) |
| `backend/src/utils/payrollExcelExporter.ts` | Payroll Excel report generation (exceljs) |
| `backend/src/utils/attendanceExcelExporter.ts` | Attendance Excel report generation |
| `frontend/src/lib/fileUpload.ts` | Frontend file upload utility with progress tracking |
| `frontend/src/features/walkIn/` | Walk-in kiosk (5-step form) + HR management page |
| `frontend/src/features/recruitment/KanbanBoard.tsx` | Recruitment pipeline Kanban with drag-to-move |
| `frontend/src/features/attendance/FieldSalesView.tsx` | GPS trail tracking for field employees |
| `frontend/src/features/attendance/ProjectSiteView.tsx` | Project site photo check-in |
| `frontend/src/features/notifications/NotificationBell.tsx` | Real-time notification bell (Socket.io) |
| `frontend/src/features/kyc/KycGatePage.tsx` | Employee KYC submission — SEPARATE and COMBINED upload modes; re-upload banner on REUPLOAD_REQUIRED |
| `frontend/src/features/kyc/KycHrReviewPage.tsx` | HR review panel for KYC document verification |
| `backend/src/modules/onboarding/document-gate.service.ts` | KYC gate state machine — resetKycOnDocumentDeletion, checkDocumentSubmission, re-upload flag management |
| `frontend/src/features/performance/PerformancePage.tsx` | Enterprise performance dashboard with task integration |
| `frontend/src/features/leaves/LeavePage.tsx` | Leave management — employee apply + HR/Manager review panels |
| `frontend/src/features/app-update/AppUpdateGuard.tsx` | Forces app reload when new SW version detected |
| `frontend/src/features/pwa/AndroidInstallPage.tsx` | Android install guide (PWA one-tap + APK fallback) |
| `frontend/src/features/pwa/IosInstallPage.tsx` | iOS Safari install guide with browser detection |
| `frontend/src/features/pwa/DownloadPage.tsx` | Platform-detection download landing page |
| `frontend/src/features/intern/` | Intern portal (profile, achievements, mentor view) |
| `frontend/src/features/task-integration/` | Task manager integration UI (Jira/Asana/ClickUp config) |
| `frontend/src/features/my-documents/MyDocumentsPage.tsx` | Employee self-service document management |
| `frontend/src/components/pwa/PWAUpdatePrompt.tsx` | PWA update notification banner/modal |
| `backend/src/sockets/index.ts` | Socket.io server init, room management, emit helpers |
| `backend/src/jobs/queues.ts` | BullMQ job queues (email, notification, payroll) |
| `backend/src/utils/pdfGenerator.ts` | Salary slip PDF generation (pdfkit) |
| `backend/src/utils/excelExporter.ts` | Report Excel export (exceljs) |
| `backend/src/utils/encryption.ts` | AES-256-GCM encryption + Aadhaar/PAN masking |
| `backend/src/utils/auditLogger.ts` | Centralized audit logging for all modules |
| `backend/src/config/swagger.ts` | OpenAPI/Swagger configuration |
| `backend/Dockerfile` | Multi-stage production Docker build (non-root) |
| `.github/workflows/deploy.yml` | Full CI/CD — build frontend+backend, Android APK, Desktop Agent, deploy to EC2 |
| `deploy/nginx.conf` | Nginx config — SPA, API proxy, PWA headers, APK download, OTA updates |
| `backend/src/services/ai.service.ts` | Centralized AI service — routes chat/prompt/scoreResume to configured provider |
| `backend/src/modules/ai-config/` | AI API Configuration MVC — provider selector, encrypted key storage, test connection |
| `backend/src/modules/invitation/` | Employee invitation MVC — token creation, email delivery, invite-accept flow |
| `backend/src/modules/ai-assistant/` | AI Assistant MVC — context-aware FAB chat with Redis conversation history |
| `backend/src/modules/public-apply/` | Public job application MVC — AI MCQ generation, public form, tracking, interview rounds |
| `backend/src/modules/task-integration/` | Jira/Asana/ClickUp integration — task fetch, leave risk scoring, handover audit |
| `frontend/src/features/invitation/InviteAcceptPage.tsx` | Invite accept page — validates token, collects name/password, starts onboarding |
| `frontend/src/features/whatsapp/WhatsAppPage.tsx` | WhatsApp Web UI — chat list, message view, new chat |
| `frontend/src/features/public-apply/PublicApplyPage.tsx` | Public AI-enhanced job application form (public, no auth) |
| `frontend/src/features/public-apply/TrackApplicationPage.tsx` | Application status tracking by UID (public, no auth) |
| `frontend/src/features/recruitment/PublicApplicationDetailPage.tsx` | Full detail view for public applications — MCQ scores, interview rounds, finalization |
| `frontend/src/sw.ts` | Service worker — cache strategy, offline fallback, background sync |
| `frontend/index.html` | PWA prompt early capture (`window.__pwaInstallPrompt`) before React mounts |
| `frontend/capacitor.config.ts` | Capacitor config for Android APK build |

## Backend Module Pattern
Each module in `backend/src/modules/<name>/` has:
- `<name>.routes.ts` — Express router with auth middleware
- `<name>.controller.ts` — Request/response handling
- `<name>.service.ts` — Business logic + Prisma queries
- `<name>.validation.ts` — Zod schemas for request validation

## Database Commands
```bash
npm run db:generate    # Generate Prisma client
npm run db:push        # Push schema to DB (dev)
npm run db:migrate     # Create migration (production)
npm run db:seed        # Seed with sample data
npm run db:studio      # Open Prisma Studio GUI
```

## CI/CD Pipeline (deploy.yml)
Three parallel jobs:
1. **Build Android APK** — Capacitor + AGP 8.7.3 + Gradle 8.9 + minSdk 23; uploads APK to EC2 at `downloads/apk-build/`
2. **Build iOS IPA** — (placeholder, requires Apple Developer account)
3. **Build Desktop Agent** — Electron app build
4. **Build & Deploy** — lint → typecheck → test → build frontend+backend → SCP to EC2 → `pm2 reload` → `nginx -s reload`

**Nginx serves APK via** exact match alias:
```nginx
location = /downloads/aniston-hrms.apk {
    alias /home/ubuntu/Aniston-HRMS/downloads/apk-build/aniston-hrms.apk;
}
```

## Key Features (by phase)
### Phase 1 (Complete)
- Auth (JWT + refresh tokens + RBAC)
- Employee CRUD with documents & audit logging
- Dashboard with stats
- Glassmorphism layout shell
- Document upload/management module with file upload middleware

### Phase 2 (Complete)
- Attendance (3 modes: Office clock in/out, Field Sales GPS trail, Project Site photo check-in)
- Leave Management (types, balances, requests, approvals, holidays)
- Payroll (Indian statutory: EPF, ESI, PT, TDS; admin + employee views)

### Phase 3 (Complete)
- AI Service (OCR + DeepSeek scoring — integrated via Docker, fallback to mock when unavailable)
- Recruitment (job openings + Kanban pipeline + candidate detail + interview scoring + offer management)
- Self-onboarding portal (7-step wizard complete)
- Walk-in candidate self-registration kiosk (5-step form + HR management)

### Phase 4-5 (Complete)
- Performance management (goals + reviews — basic)
- Policies, announcements, social wall (functional)
- Reports & analytics (basic charts with Recharts)
- Helpdesk (tickets + comments — full MVC)
- Org chart (tree visualization)
- Settings (org, locations, audit logs)
- Profile page
- PWA offline support (configured with vite-plugin-pwa)
- PDF salary slip generation (pdfkit)
- Excel report export (exceljs)
- Holiday CRUD management
- Asset management (CRUD + assign/return workflow)
- CI/CD with GitHub Actions (lint, typecheck, build)

### Phase 6–8 (Complete) — AI Platform & Communication
- **AI API Configuration** (`/api/settings/ai-config`) — multi-provider support (OpenAI, DeepSeek, Anthropic, Gemini, Custom); AES-256-GCM encrypted key storage; Redis-cached active config; test-connection endpoint; Settings UI tab
- **Employee Invitation System** (`/api/invitations`) — token-based invite flow, 72-hour expiry, email delivery via BullMQ, invite-accept creates User + Employee + triggers onboarding, resend with new token
- **WhatsApp Web UI** (`/whatsapp`) — chat list, message view, new chat composer backed by existing WhatsApp module
- **AI Assistant** (`/api/ai-assistant`) — context-aware FAB panel, conversation history in Redis (per user/page), prompts routed through centralized AiService
- **AI Job Application Form** (`/apply/:token`) — AI-generated MCQ questions per job opening, public form (no auth), application tracking at `/track/:uid`; new Prisma models: `PublicApplication`, `JobApplicationQuestion`, `InterviewRound`
- **AI Interview Scheduling** — schedule interview endpoint with AI-generated message preview, integrated into public-apply module
- **AI Interview Execution & Scoring** — per-round question generation, scoring per answer, weighted final score calculation, candidate finalization
- **Admin Email Configuration** — `adminNotificationEmail` field on Organization, exposed in Settings UI

### Phase 9 (Complete) — Mobile, KYC, OCR, Performance & Leave Overhaul
- **Android APK** — Capacitor build pipeline in GitHub Actions; APK downloadable at `https://hr.anistonav.com/downloads/aniston-hrms.apk`; minSdk 23, compileSdk 35, AGP 8.7.3
- **PWA Android Install** — `AndroidInstallPage` with tab switcher: PWA one-tap (captures `beforeinstallprompt` early in `index.html` via `window.__pwaInstallPrompt`) + APK fallback with full instructions
- **PWA iOS Install** — `IosInstallPage` with Safari browser detection (`isAlreadyInSafari`); skips bridge step if already in Safari; shows "Open in Safari" if in-app browser (WhatsApp/Instagram/etc.)
- **PWA Update Guard** — `AppUpdateGuard` component detects new SW version via 4-path detection: `registration.waiting` on mount + `updatefound`+`statechange` + `visibilitychange` + 30s poll interval
- **KYC System** — Employee KYC submission (`KycGatePage`) with Aadhaar, PAN, bank details, passport photo + HR review panel (`KycHrReviewPage`) with OCR-powered auto-verify; `KycStatus` enum: `PENDING → SUBMITTED → PROCESSING → PENDING_HR_REVIEW → REUPLOAD_REQUIRED → VERIFIED / REJECTED`
- **Document OCR Pipeline** — Improved `document-ocr` module + `combined-pdf-processor.service.ts` for multi-document batch processing; `documentFormatValidator` for Aadhaar/PAN/passport format rules; AI-service `ocr.py` + `ocr_service.py` improvements
- **Performance Enterprise Dashboard** — `PerformancePage` major overhaul with employee performance summary, task risk scoring, OKR view, review cycle management; integrates with Jira/Asana/ClickUp via `task-integration` module
- **Task Integration** — `task-integration` module: Jira/Asana/ClickUp API key config (AES-encrypted), task fetch per employee, leave risk assessment (CRITICAL/HIGH/MEDIUM/LOW), handover generation, health logging
- **Leave Management Overhaul** — Intern role support, `LeavePolicy`/`LeavePolicyRule` models, leave settings API, applicable-employees scoping (ALL/PROBATION/CONFIRMED/INTERN/NOTICE_PERIOD), HR/Manager review panels
- **Intern Module** — `InternProfile` model + `intern` backend module; intern portal with mentor assignment, stipend tracking, achievement letter generation; INTERN role added to RBAC
- **Payroll Deletion** — `payroll-deletion` module with approval workflow; `PayrollDeletionRequest` model
- **Salary Templates** — `SalaryTemplate` + `SalaryStructure` models; `SalaryTemplatesPage` UI for template management
- **Shift Management** — `Shift`/`ShiftAssignment`/`ShiftRotationPattern` models; shift builder UI
- **Employee Permissions** — `PermissionPreset`/`PermissionOverride` models; per-employee granular permission overrides beyond role defaults
- **Exit/Offboarding** — `ExitChecklist`/`ExitChecklistItem`/`ExitAccessConfig` models; offboarding workflow
- **Company Branding** — `CompanyBranding` model; logo/color/theme customization per org
- **Letter Generator** — `LetterTemplate`/`Letter`/`LetterAssignment` models; offer/experience/NOC letter generation with PDF
- **Database Backup** — `DatabaseBackup` model + backup module (MANUAL/SCHEDULED/PRE_MIGRATION types)
- **MFA Support** — `UserMFA` model; TOTP-based 2FA infrastructure
- **Device Sessions** — `DeviceSession` model for multi-device session tracking
- **i18n** — Hindi (`hi.json`) + English (`en.json`) locale files; react-i18next integration

### Phase 10 (Complete) — Document Lifecycle, Recruitment Full-Cycle & Settings Hardening

#### KYC Document Deletion → Notification → Re-upload Flow
- **HR required reason on delete** — HR must enter a reason (required textarea) before deleting any document; Delete button disabled until filled; button label "Delete & Notify Employee"
- **Employee email notification** — `document-deleted` email template: red header, document details table, HR reason box, conditional guidance (combined PDF vs separate doc re-upload instructions), red CTA to dashboard
- **Immediate KYC gate revocation** — `resetKycOnDocumentDeletion` always sets `REUPLOAD_REQUIRED` regardless of current KYC status (removed PENDING exception); stores HR reason in `documentRejectReasons[docType]` JSON map; adds doc type to `reuploadDocTypes[]`
- **Real-time access revocation** — AppShell `kyc:status-changed` socket listener immediately dispatches `setUser({ ...user, kycCompleted: false })` to Redux (no wait for next token refresh) + shows error toast
- **Re-upload flow** — `checkDocumentSubmission` now clears the specific `docType` from `reuploadDocTypes[]` and deletes its rejection reason; advances gate to `SUBMITTED` when all flagged docs are re-uploaded; emits `kyc:status-changed` socket event on status change
- **CombinedUploadScreen re-upload banner** — orange `AlertTriangle` banner with HR reason shown when gate is `REUPLOAD_REQUIRED`; parent passes `reuploadDocTypes` + `documentRejectReasons` props
- **Physical file deletion** — `document.service remove()` calls `storageService.deleteFile()` after soft-delete (non-blocking, best-effort); `create()` also physically deletes and soft-deletes previous active doc of same type before inserting new
- **Soft-delete list filter** — `document.service list()` now includes `deletedAt: null` in base `where` clause — soft-deleted docs no longer leak into HR document list
- **`documentApi` mutation updated** — `deleteDocument` accepts `{ id: string; reason?: string }` and sends `reason` in request body

#### Recruitment Full-Cycle Completion
- **`PublicApplicationDetailPage`** — full detail view for public job applications: MCQ scores, interview rounds timeline, per-round question/answer scoring, candidate finalization workflow
- **`RecruitmentPage` overhaul** — expanded Kanban with integrated public application tracking, interview scheduling modal, offer management panel, pipeline overview stats
- **Interview execution backend** — `recruitment.service`: interview round creation, AI question generation per round, answer scoring, weighted final score calculation across rounds, candidate finalization with hire/reject decision
- **New recruitment routes** — `POST /api/recruitment/:id/interview-rounds`, `POST /api/recruitment/:id/schedule-interview`, `POST /api/recruitment/:id/finalize`
- **`publicApplyApi` RTK Query** — added endpoints for interview round management, per-round scoring, and finalization

#### Settings — Task Manager Integration UX Hardening
- **Read-only masked view** — saved API key shown as `•••••••••••• Saved` with lock icon by default; base URL displayed; no accidental edits
- **Edit-toggle pattern** — fields only editable after clicking "Edit" button; closing form clears API key from state (security — never stored in Redux)
- **Custom provider dual-auth** — custom task manager provider now sends both `X-API-Key` and `Authorization: Bearer <key>` headers for maximum compatibility with self-hosted instances

## Indian Payroll Compliance
- EPF: 12% of basic (employee + employer), basic capped at 15,000
- ESI: 0.75% employee + 3.25% employer, if gross <= 21,000
- Professional Tax: State-wise slabs
- TDS: Monthly based on annual projection, old/new regime

## 3 Attendance Modes
1. **OFFICE**: Geofence auto check-in/out via Mapbox + Haversine distance
2. **FIELD_SALES**: GPS trail every 60s, visit clustering (200m radius, >10min = stop), offline sync
3. **PROJECT_SITE**: Manual check-in with photo capture, site selection, GPS coordinates

## Conventions
- UUIDs for all primary keys
- Soft deletes (`deletedAt` column) on major entities
- All API responses use envelope: `{ success, data, error?, meta? }`
- Timestamps: `createdAt`, `updatedAt` on all models
- Employee codes: `EMP-001`, `EMP-002`, etc. (auto-generated)
- Currency: INR, formatted with Indian locale (`en-IN`)
- Enums: defined in BOTH `prisma/schema.prisma` AND `shared/src/enums.ts`
