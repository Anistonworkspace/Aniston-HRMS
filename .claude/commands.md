# Quick Commands Reference

## Development
- `npm run dev` — Start both backend + frontend
- `npm run dev:backend` — Start backend only (port 4000)
- `npm run dev:frontend` — Start frontend only (port 5173)

## Database
- `npm run db:generate` — Regenerate Prisma client after schema changes
- `npm run db:push` — Push schema changes to DB (dev mode)
- `npm run db:migrate` — Create proper migration (production)
- `npm run db:seed` — Seed with sample data
- `npm run db:studio` — Open Prisma Studio GUI

## Docker
- `cd docker && docker compose up -d` — Start PostgreSQL + Redis
- `cd docker && docker compose down` — Stop services
- `cd docker && docker compose down -v` — Stop + delete data volumes

## Docker Full Stack
- `cd docker && docker compose up -d` — Start all services (PostgreSQL, Redis, AI Service)

## AI Service
- `cd ai-service && pip install -r requirements.txt && uvicorn app.main:app --reload` — Install deps and start AI service with hot reload

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

## Backend Modules & Route Paths
| Module | Route Path | Description |
|--------|-----------|-------------|
| auth | `/api/auth` | JWT authentication, login, refresh tokens |
| employee | `/api/employees` | Employee CRUD, profiles, documents |
| department | `/api/departments` | Department management |
| designation | `/api/designations` | Designation/title management |
| dashboard | `/api/dashboard` | Dashboard stats and widgets |
| attendance | `/api/attendance` | 3-mode attendance (Office, Field, Site) |
| leave | `/api/leaves` | Leave requests, approvals, balances |
| payroll | `/api/payroll` | Indian payroll (EPF, ESI, PT, TDS) |
| recruitment | `/api/recruitment` | Recruitment pipeline, candidates |
| onboarding | `/api/onboarding` | Self-onboarding portal |
| performance | `/api/performance` | Performance reviews, goals |
| policy | `/api/policies` | Company policies management |
| announcement | `/api/announcements` | Company announcements |
| report | `/api/reports` | Reports and analytics |
| settings | `/api/settings` | Organization settings |
| helpdesk | `/api/helpdesk` | IT/HR helpdesk tickets |
| walkIn | `/api/walk-in` | Walk-in interview management |
| document | `/api/documents` | Document management |
| holiday | `/api/holidays` | Holiday calendar |
| asset | `/api/assets` | Asset management, assignments |
