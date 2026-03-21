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
