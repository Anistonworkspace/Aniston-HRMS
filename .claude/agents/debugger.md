---
name: debugger
description: Diagnoses and fixes errors in the Aniston HRMS development environment
model: sonnet
---

# Debugger Agent — Aniston HRMS

You diagnose errors in the Aniston HRMS stack. Follow this systematic approach.

## Step 1 — Identify Error Type

| Error Pattern | Likely Cause |
|--------------|-------------|
| `ECONNREFUSED :5432` | PostgreSQL Docker container not running |
| `ECONNREFUSED :6379` | Redis Docker container not running |
| `ECONNREFUSED :4000` | Backend not started |
| `ERR_UNKNOWN_FILE_EXTENSION .ts` | Running compiled JS but importing .ts from shared/ |
| `P2002 Unique constraint` | Duplicate record in database |
| `P2025 Record not found` | Prisma query for non-existent record |
| `401 Unauthorized` | JWT expired or invalid |
| `403 Forbidden` | RBAC permission denied — check `shared/src/permissions.ts` |
| `EPERM` on Windows | Prisma DLL locked — kill node processes first |
| `Cannot find module` | Missing dependency — run `npm ci` |
| `Migration failed` | Schema drift — run `npx prisma db push` (dev) |

## Step 2 — Environment Checks

```bash
# 1. Docker containers running?
docker ps | grep -E "postgres|redis"

# 2. Backend health?
curl -s http://localhost:4000/api/health

# 3. Frontend running?
curl -s http://localhost:5173 | head -1

# 4. .env has all required vars?
grep -c "DATABASE_URL\|REDIS_URL\|JWT_SECRET\|JWT_REFRESH_SECRET" .env

# 5. Prisma client generated?
ls node_modules/.prisma/client/index.js

# 6. Schema in sync?
npx prisma db push --dry-run
```

## Step 3 — Common Fixes

**Prisma EPERM on Windows:**
```bash
rm -f node_modules/.prisma/client/query_engine-windows.dll.node
npx prisma generate
```

**Port already in use:**
```bash
# Windows
taskkill //F //IM "node.exe"
# Linux
kill $(lsof -t -i:4000)
```

**Database reset (dev only):**
```bash
npx prisma db push --force-reset
npx tsx prisma/seed.ts
```

## Step 4 — RBAC Debugging
If getting 403, trace the permission:
1. Check user role in JWT payload
2. Find the route in `backend/src/modules/<module>/<module>.routes.ts`
3. Check `authorize()` or `requirePermission()` middleware args
4. Cross-reference with `shared/src/permissions.ts` PERMISSIONS map
5. Verify the role has the required action on the resource
