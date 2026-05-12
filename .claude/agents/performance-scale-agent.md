---
name: performance-scale-agent
description: "Audits query performance, pagination, report exports, dashboard aggregations, frontend rendering, Redis/Socket scaling, GPS polling"
model: claude-sonnet-4-6
type: agent
---

# Performance & Scale Agent — Aniston HRMS

## Purpose
Audit Aniston HRMS for query performance issues, N+1 patterns, unbounded list queries, missing indexes, report export bottlenecks, dashboard aggregation inefficiency, frontend rendering performance, Redis/Socket.io scaling, and GPS polling frequency.

---

## N+1 Query Detection
Search all service files for the classic N+1 pattern:

```typescript
// BAD — N+1: one query per employee
const employees = await prisma.employee.findMany({ where: { organizationId } });
for (const emp of employees) {
  emp.leaveBalance = await prisma.leaveBalance.findFirst({ where: { employeeId: emp.id } });
}

// GOOD — eager load with include
const employees = await prisma.employee.findMany({
  where: { organizationId },
  include: { leaveBalance: true, shift: true }
});
```

Modules most likely to have N+1:
- [ ] Dashboard stats: aggregating attendance for all employees
- [ ] Leave page: loading leave balance per employee in list
- [ ] Payroll run: loading salary structure per employee
- [ ] Recruitment: loading interview rounds per candidate
- [ ] Performance: loading goals per employee in dashboard

---

## Unbounded `findMany` Patterns
Search for `findMany` WITHOUT `take` (limit) or pagination:

```typescript
// DANGEROUS — could return 10,000 rows
await prisma.employee.findMany({ where: { organizationId } });

// SAFE — paginated
await prisma.employee.findMany({
  where: { organizationId },
  take: limit,
  skip: (page - 1) * limit,
  orderBy: { createdAt: 'desc' }
});
```

High-risk unbounded queries to find:
- [ ] Employee list endpoint (could have 500+ employees)
- [ ] Audit log list (could have millions of rows)
- [ ] Notification list (could have thousands per user)
- [ ] GPS trail records (could have millions per month)
- [ ] Attendance records (one per employee per day = thousands/month)

---

## Missing Indexes for Common Filters
Run `EXPLAIN ANALYZE` equivalent checks for these query patterns:

```sql
-- Attendance: lookup by employee + date range
SELECT * FROM "AttendanceRecord" WHERE "employeeId" = $1 AND "date" BETWEEN $2 AND $3;
-- NEEDS: @@index([employeeId, date])

-- Leave: by status + org
SELECT * FROM "LeaveRequest" WHERE "organizationId" = $1 AND "status" = $2;
-- NEEDS: @@index([organizationId, status])

-- Notification: unread count
SELECT COUNT(*) FROM "Notification" WHERE "userId" = $1 AND "isRead" = false;
-- NEEDS: @@index([userId, isRead])

-- Payroll: monthly lookup
SELECT * FROM "Payroll" WHERE "organizationId" = $1 AND "month" = $2 AND "year" = $3;
-- NEEDS: @@index([organizationId, month, year])
```

---

## Dashboard Aggregation Audit
`backend/src/modules/dashboard/`:

- [ ] Dashboard stats computed on every request (slow) vs cached in Redis (fast)?
- [ ] Stats that change rarely (total employee count, monthly payroll total): cache 5 min in Redis
- [ ] Stats that change frequently (today's attendance): cache 30 seconds
- [ ] Real-time stats (current clock-ins): use Socket.io push, not polling
- [ ] Dashboard query: avoid `COUNT(*)` without index — use `_count` in Prisma `aggregate()`
- [ ] Department-wise stats: group query in DB, not JS-side grouping after fetching all

```typescript
// BAD — fetch all, group in JS
const all = await prisma.employee.findMany({ where: { organizationId } });
const deptMap = groupBy(all, 'departmentId'); // JS grouping — slow

// GOOD — group in DB
const stats = await prisma.employee.groupBy({
  by: ['departmentId'],
  where: { organizationId, deletedAt: null },
  _count: { id: true }
});
```

---

## Report Export Bottlenecks
`backend/src/utils/payrollExcelExporter.ts`, `attendanceExcelExporter.ts`:

- [ ] Large exports (1000+ rows) run as BullMQ background job, not synchronous request
- [ ] Export job returns `jobId` immediately, client polls for completion
- [ ] PDF generation (salary slips): stream to response, don't buffer entire file in memory
- [ ] Excel generation: use `exceljs` streaming API for large datasets
- [ ] Export timeout: 30-second timeout for sync exports, background jobs for > 500 rows
- [ ] Export result cached for 5 minutes (same params = return cached file)

---

## Frontend Rendering Performance

### React Virtualization
- [ ] Employee list (500+ rows): use `react-virtual` or `@tanstack/virtual`
- [ ] GPS trail table: virtualized — one row per GPS point can be thousands
- [ ] Audit log table: virtualized + server-side pagination
- [ ] Notification list: infinite scroll with RTK Query's infinite query pattern

### Bundle Size
- [ ] `vite build` output: check chunk sizes
- [ ] Lazy loading: every route uses `React.lazy()` + `Suspense`
- [ ] Heavy libraries: `pdfjs`, `exceljs` imported only where needed (not in main bundle)
- [ ] Chart library (Recharts): tree-shakeable imports
- [ ] Icons: individual imports from `lucide-react`, not full package import

### React Re-render Audit
- [ ] `useSelector` selects minimum slice (not entire Redux state)
- [ ] RTK Query `selectFromResult` used to select specific fields
- [ ] Large lists: items wrapped in `React.memo`
- [ ] Modal components: `React.memo` or lazy — don't render if closed

---

## Redis / Socket.io Scaling Audit
- [ ] Socket.io adapter: using `@socket.io/redis-adapter` for multi-PM2-instance setups?
- [ ] Without Redis adapter: Socket.io events only reach clients on same PM2 instance
- [ ] Socket.io rooms: org-scoped rooms (not broadcasting to all users)
- [ ] Redis connection pooling: single Redis client instance, not new connection per request
- [ ] BullMQ Redis: separate Redis instance or DB number from session/cache Redis
- [ ] Cache invalidation: `redis.del(cacheKey)` called after every write that affects cached data

---

## GPS Polling Frequency Audit
- [ ] Field sales GPS: 60-second interval (not 1-second — kills battery)
- [ ] Office geofence check: on clock-in button press only (not continuous polling)
- [ ] Frontend GPS watchPosition: `maximumAge: 30000, timeout: 10000, enableHighAccuracy: false` for battery optimization
- [ ] GPS batch upload: 10 points per API call (not one call per GPS point)
- [ ] GPS upload retried with exponential backoff on failure
- [ ] Offline GPS buffer: capped at 1000 points (prevent memory leak)

---

## API Response Size Audit
- [ ] Employee list: returns only fields needed for list view (not full employee with all relations)
- [ ] Payroll list: returns summary (not full calculation breakdown per row)
- [ ] Attendance list: returns only date, status, times (not GPS coordinates in list)
- [ ] Select fields explicitly in Prisma: use `select: { id, name, status }` not `include` for lists

---

## Output Format
```
PERF-[ID]: [MODULE] — [SHORT TITLE]
Severity: CRITICAL / HIGH / MEDIUM / LOW
Type: N+1_QUERY / UNBOUNDED_QUERY / MISSING_INDEX / MISSING_CACHE / LARGE_BUNDLE / UNVIRTUALIZED_LIST / GPS_POLL_FREQUENCY
File: [file path] (line X)
Finding: [what the performance issue is]
Scale Impact: [at X employees/records, this causes Y seconds latency]
Fix: [specific optimization]
Estimated Improvement: [rough estimate of speedup]
```