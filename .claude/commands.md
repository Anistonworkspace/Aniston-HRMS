# Quick Commands Reference

## Development
- `npm run dev` — Start both backend + frontend
- `npm run dev:backend` — Start backend only (port 4000)
- `npm run dev:frontend` — Start frontend only (port 5173)

## Database
- `npm run db:generate` — Regenerate Prisma client after schema changes
- `npm run db:push` — Push schema changes to DB (dev mode only)
- `npm run db:migrate` — Create proper migration (production)
- `npm run db:seed` — Seed with sample data
- `npm run db:studio` — Open Prisma Studio GUI

## Docker
- `cd docker && docker compose up -d` — Start all services (PostgreSQL, Redis, AI Service)
- `cd docker && docker compose down` — Stop services
- `cd docker && docker compose down -v` — Stop + delete data volumes

## AI Service
- `cd ai-service && pip install -r requirements.txt && uvicorn app.main:app --reload`

## Android APK
- `cd frontend && npx cap sync android` — Sync web assets to Android
- `cd frontend/android && ./gradlew assembleRelease` — Build release APK

## Desktop Agent (Electron)
- `cd agent-desktop && npm run dev` — Start in dev mode
- `cd agent-desktop && npm run build` — Build EXE

## Adding a New Backend Module
1. Create `backend/src/modules/<name>/` with 4 files:
   - `<name>.routes.ts`
   - `<name>.controller.ts`
   - `<name>.service.ts`
   - `<name>.validation.ts`
2. Register routes in `backend/src/app.ts`
3. Add Prisma models in `prisma/schema.prisma`
4. Run `npm run db:push` and `npm run db:generate`

## Adding a New Frontend Feature
1. Create `frontend/src/features/<name>/` with:
   - `<name>Api.ts` (RTK Query endpoints)
   - Page components
2. Add routes in `frontend/src/router/AppRouter.tsx`
3. Add nav item in `frontend/src/components/layout/Sidebar.tsx`

## Backend Modules & Route Paths (49 modules)
| Module | Route Path | Description |
|--------|-----------|-------------|
| agent | `/api/agent` | Desktop agent heartbeat, screenshots, activity monitoring |
| ai-assistant | `/api/ai-assistant` | Context-aware FAB chat with Redis conversation history |
| ai-config | `/api/settings/ai-config` | Multi-provider AI config (OpenAI/DeepSeek/Anthropic/Gemini) |
| announcement | `/api/announcements` | Org-wide announcements + social wall |
| asset | `/api/assets` | Asset CRUD + assign/return workflow |
| attendance | `/api/attendance` | 3-mode attendance (Office/Field Sales/Project Site) |
| auth | `/api/auth` | JWT + refresh tokens + RBAC |
| backup | `/api/backup` | Database backup management |
| branding | `/api/branding` | Company logo, colors, theme customization |
| component-master | `/api/component-master` | Salary component master definitions |
| crash-report | `/api/crash-reports` | Native app crash report ingestion |
| dashboard | `/api/dashboard` | Stats + analytics aggregation |
| department | `/api/departments` | Department management |
| designation | `/api/designations` | Designation/title management |
| document | `/api/documents` | Document upload, verification, management |
| document-ocr | `/api/documents` | OCR extraction, AI verification, format validation |
| employee | `/api/employees` | Employee CRUD, profile, documents, audit |
| employee-deletion | `/api/employee-deletion` | Soft-delete workflow with approval |
| employee-permissions | `/api/employee-permissions` | Granular permission overrides per employee |
| exit | `/api/exit` | Exit/offboarding workflow |
| exit-access | `/api/exit-access` | Exit checklist + access revocation |
| helpdesk | `/api/helpdesk` | Support tickets + comments |
| holiday | `/api/holidays` | Holiday CRUD management |
| intern | `/api/intern` | Intern profile, mentor, stipend, achievement letters |
| invitation | `/api/invitations` | Token-based employee invites (72-hr TTL) |
| leave | `/api/leaves` | Leave types, balances, requests, approvals, policies |
| letter | `/api/letters` | Letter templates + generation + assignments |
| notifications | `/api/notifications` | In-app + push notification management |
| onboarding | `/api/onboarding` | 7-step wizard + document gate + KYC |
| payroll | `/api/payroll` | Indian statutory payroll (EPF/ESI/PT/TDS) |
| payroll-adjustment | `/api/payroll-adjustments` | One-off payroll adjustments |
| payroll-deletion | `/api/payroll-deletion-requests` | Payroll deletion with approval workflow |
| performance | `/api/performance` | Goals, review cycles, enterprise dashboard |
| policy | `/api/policies` | Company policy docs + acknowledgment |
| profile-edit-request | `/api/profile-edit-requests` | Employee profile edit approval workflow |
| public-apply | `/api/jobs` | Public job application, AI MCQ, tracking |
| recruitment | `/api/recruitment` | Job openings + Kanban + interviews + offers |
| report | `/api/reports` | Reports + Excel/PDF exports |
| salary-template | `/api/salary-templates` | Salary template CRUD + structure assignment |
| saved-location | `/api/saved-locations` | Employee home/work GPS coord approval |
| settings | `/api/settings` | Org settings, locations, audit logs |
| shift | `/api/workforce` | Shift definitions + rotation + assignments |
| system-logs | `/api/system-logs` | System event log viewer |
| task-integration | `/api/task-integration` | Jira/Asana/ClickUp integration |
| walkIn | `/api/walk-in` | Walk-in kiosk (5-step form) + HR management |
| whatsapp | `/api/whatsapp` | WhatsApp session, messages, OTP |

## Frontend Features (41 features)
| Feature folder | Page / Purpose |
|---|---|
| `activity` | Activity Tracking Page — desktop agent monitoring |
| `ai-assistant` | AI FAB chat panel |
| `announcements` | Social wall + announcements |
| `app-update` | PWA update guard |
| `assets` | Asset management |
| `attendance` | 3-mode attendance (Office/Field/Site) |
| `auth` | Login, JWT, session |
| `bulk-email` | Bulk email sending |
| `dashboard` | Dashboard home |
| `documents` | Document management |
| `employee` | Employee CRUD + profile |
| `exit` | Exit/offboarding |
| `helpdesk` | Support tickets |
| `hiring` | Hiring pipeline |
| `intern` | Intern portal |
| `interviews` | Interview management |
| `invitation` | Invite accept page |
| `jobs` | Public job listing |
| `kyc` | KYC submission + HR review |
| `leaves` | Leave management |
| `my-documents` | Employee self-service documents |
| `notifications` | Notification bell + list |
| `onboarding` | 7-step onboarding wizard |
| `orgChart` | Org chart tree visualization |
| `payroll` | Payroll + salary slips |
| `performance` | Performance reviews + OKRs |
| `permissions` | Per-employee permission overrides |
| `policies` | Company policies |
| `privacy` | Privacy / consent |
| `profile` | Employee profile page |
| `public-apply` | Public job application + tracking |
| `pwa` | Android/iOS install guides + download |
| `recruitment` | Recruitment Kanban pipeline |
| `reports` | Analytics + exports |
| `roster` | Shift roster + GPS visit locations |
| `settings` | Org settings + AI config |
| `task-integration` | Jira/Asana/ClickUp config UI |
| `walkIn` | Walk-in kiosk |
| `whatsapp` | WhatsApp Web UI |
| `workforce` | Shift builder + assignments |

## Key URLs (Development)
- Frontend: http://localhost:5173
- Backend API: http://localhost:4000
- Swagger Docs: http://localhost:4000/api/docs
- Health check: http://localhost:4000/api/health
- Prisma Studio: `npm run db:studio`
- Walk-In Kiosk: http://localhost:5173/walk-in
- AI Service: http://localhost:8000/ai/health
- Public Job Apply: http://localhost:5173/apply/:token
- Application Tracker: http://localhost:5173/track/:uid
- WhatsApp UI: http://localhost:5173/whatsapp
- Invite Onboarding: http://localhost:5173/onboarding/invite/:token
- Android Install Guide: http://localhost:5173/download/android
- iOS Install Guide: http://localhost:5173/download/ios

## Production
- Frontend + API: https://hr.anistonav.com
- APK download: https://hr.anistonav.com/downloads/aniston-hrms.apk

## IMPORTANT — No Worktrees
NEVER use `isolation: "worktree"` or `git worktree add` in this project.
ALL changes must be made directly in the main working tree so they appear
in VS Code Source Control as a single unified diff.