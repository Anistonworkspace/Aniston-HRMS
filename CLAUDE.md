# Aniston HRMS — Project Reference

## What is this?
Enterprise-grade Human Resource Management System (HRMS) as a Progressive Web Application built for Aniston Technologies LLP. Replaces/improves on Zoho People with custom features.

## Tech Stack
- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS v3 + shadcn/ui + Redux Toolkit (RTK Query) + Framer Motion
- **Backend**: Node.js + Express + TypeScript + Prisma ORM + PostgreSQL 16 + Redis 7 + BullMQ + Socket.io
- **AI Service**: Python FastAPI (OCR with pytesseract, DeepSeek scoring, RAGFlow search) — planned
- **Infra**: Docker Compose (postgres:16-alpine, redis:7-alpine)

## Project Structure
```
Aniston-hrms/
├── frontend/          # React app (Vite)
├── backend/           # Express API
├── shared/            # Shared TypeScript types & permissions (@aniston/shared)
├── prisma/            # Prisma schema + seed
├── docker/            # docker-compose.yml
├── ai-service/        # Python FastAPI (future)
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
- Health check: http://localhost:4000/api/health
- Prisma Studio: `npm run db:studio`

## Login Credentials (Dev)
- Super Admin: `admin@aniston.in` / `Admin@123456`
- HR Manager: `hr@aniston.in` / `Hr@123456`
- Employee: `rahul@aniston.in` / `Employee@123`

## Architecture Decisions
1. **npm workspaces monorepo** — frontend, backend, shared packages
2. **Module pattern** on backend — each feature has controller/service/routes/validation in `backend/src/modules/<feature>/`
3. **RTK Query** for frontend API calls with auto-caching and tag-based invalidation
4. **Single Prisma schema** at `prisma/schema.prisma` — all models in one file
5. **RBAC** — 6 roles (SUPER_ADMIN, ADMIN, HR, MANAGER, EMPLOYEE, GUEST_INTERVIEWER) with permission map in `shared/src/permissions.ts`
6. **Glassmorphism UI** — Monday.com-inspired layered design. CSS utilities in `frontend/src/styles/globals.css`
7. **Fonts**: Sora (headings), DM Sans (body), JetBrains Mono (data/numbers)

## Key Files
| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | All database models (30+ models) |
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

## Key Features (by phase)
### Phase 1 (Complete)
- Auth (JWT + refresh tokens + RBAC)
- Employee CRUD with documents & audit logging
- Dashboard with stats
- Glassmorphism layout shell

### Phase 2 (In Progress)
- Attendance (3 modes: Office/Geofence, Field Sales/GPS, Project Site)
- Leave Management (types, balances, requests, approvals)
- Payroll (Indian statutory: EPF, ESI, PT, TDS)

### Phase 3 (Planned)
- AI Service (OCR, DeepSeek scoring, RAGFlow)
- Recruitment pipeline with Kanban
- Self-onboarding portal

### Phase 4-5 (Planned)
- Performance management
- Policies, announcements, social wall
- Reports & analytics
- PWA offline support
- Settings & configuration

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
