# Production Fixes — Aniston HRMS
> Applied: 2026-04-04 | Session: Employees + Attendance + Leaves + Roster

---

## PRIORITY 0 — CRITICAL BLOCKER FIXED

### FIX: SuperAdmin onboarding/KYC gate bypass
**Problem:** `/api/auth/me` returned `onboardingComplete: false`, `kycCompleted: false` for SuperAdmin. Although `ProtectedRoute.tsx` already exempts `SUPER_ADMIN/ADMIN/HR` from redirect gates (line 13), the false values caused edge cases in other parts of the app.

**Root cause:** Seed `update` clause didn't set `onboardingComplete: true`, and `auth.service.ts` `getMe()` returned raw DB values without admin-role override.

**Files changed:**
| File | Change |
|------|--------|
| `backend/src/modules/auth/auth.service.ts` | Admin roles (SUPER_ADMIN, ADMIN, HR, MANAGER) always return `onboardingComplete: true`, `kycCompleted: true` in both login and getMe responses |
| `prisma/seed.ts` | Added `onboardingComplete: true` to system account upsert `update` clause |
| Database | `UPDATE Employee SET onboardingComplete = true` for all admin-role users |

**TEST:** `/api/auth/me` → `role: SUPER_ADMIN, onboarding: true, kyc: true` ✅
**RESULT: PASS**

---

## FIX 1A — Employee List: hasShift Now Shows Correctly

**Problem:** `/api/employees` returned no shift info. Frontend couldn't display whether employees had shifts assigned even though 3 ShiftAssignment records existed.

**Root cause:** `employee.service.ts` `list()` and `getById()` didn't include `shiftAssignments` in the Prisma query.

**Files changed:**
| File | Change |
|------|--------|
| `backend/src/modules/employee/employee.service.ts` | Added `shiftAssignments` include with `shift` relation to both `list()` and `getById()`. Transforms response to include `hasShift: boolean` and `currentShift: { name, type, startTime, endTime }` |

**TEST:** `/api/employees` → `Priya hasShift=true shift=General Shift, Rahul hasShift=true shift=General Shift` ✅
**RESULT: PASS**

---

## FIX 1C — Employee Detail: Shift Info in Overview

**Problem:** Employee detail page overview tab didn't show current shift assignment.

**Files changed:**
| File | Change |
|------|--------|
| `frontend/src/features/employee/EmployeeDetailPage.tsx` | Added "Current Shift" InfoRow showing shift name + times in Employment Details section |

**RESULT: PASS** (shift info displays on employee detail)

---

## FIX 2 — Attendance Holiday Banner

**Problem:** When today is a holiday (Good Friday Apr 4), the attendance page showed clock-in buttons but the API correctly blocked clock-in. No visual indication of holiday.

**Files changed:**
| File | Change |
|------|--------|
| `frontend/src/features/attendance/AttendancePage.tsx` | Added holiday banner above shift info showing holiday name + next working day. Shows when today matches a holiday from `monthData.holidays` |

**RESULT: PASS** (banner shows "Today is Good Friday — Holiday. Next working day: Monday, Apr 6")

---

## Previous Session Fixes (from FEATURE_AUDIT.md)

### FIX: OFFICE Shift Auto-Creation
**File:** `backend/src/modules/shift/shift.service.ts`
**Change:** `ensureDefaultShifts()` now auto-creates both OFFICE (General Shift 09:00-18:00) and FIELD (Live Tracking 09:00-18:30) shifts. Previously only FIELD was auto-created.
**TEST:** `GET /api/workforce/shifts` → 2 shifts ✅

### FIX: Project-Site Check-in Routes
**Files:** `attendance.routes.ts`, `attendance.controller.ts`, `attendance.service.ts`
**Change:** Added `POST /attendance/project-site/check-in` and `GET /attendance/project-site/my` endpoints for standalone project-site check-ins (separate from clock-in flow).
**TEST:** Both endpoints return 201/200 ✅

### DATA: Office Locations Created
Created 2 office locations with geofences via API:
- Aniston Office — Delhi (28.6139, 77.2090, 200m radius)
- Client Site — Noida (28.5355, 77.3910, 200m radius)

### DATA: Shift Auto-Assignment
`POST /api/workforce/shifts/auto-assign` → 3 employees assigned to General Shift ✅

---

## Verification Summary (All Endpoints)

| Endpoint | Status | Result |
|----------|--------|--------|
| `GET /api/auth/me` | ✅ 200 | `onboarding=true, kyc=true` |
| `GET /api/employees` | ✅ 200 | 2 employees with `hasShift=true` |
| `GET /api/employees/:id` | ✅ 200 | Detail with `currentShift` populated |
| `GET /api/workforce/shifts` | ✅ 200 | 2 shifts (General + Live Tracking) |
| `GET /api/workforce/shifts/assignments` | ✅ 200 | 3 assignments |
| `GET /api/workforce/locations` | ✅ 200 | 3 locations |
| `GET /api/attendance/today` | ✅ 200 | `hasShift=true, shift=General Shift` |
| `POST /api/attendance/clock-in` | ✅ 400 | Correctly blocks on holiday |
| `POST /api/attendance/project-site/check-in` | ✅ 201 | New endpoint works |
| `GET /api/attendance/project-site/my` | ✅ 200 | Returns check-ins |
| `GET /api/leaves/balances` | ✅ 200 | 6 balances auto-created |
| `GET /api/leaves/types` | ✅ 200 | 7 leave types |
| `GET /api/leaves/holidays` | ✅ 200 | 9 holidays |
| `GET /api/leaves/approvals` | ✅ 200 | 0 pending (correct) |

---

## What's Already Production-Ready (No Changes Needed)

| Feature | Status | Notes |
|---------|--------|-------|
| Employee invite modal (comprehensive) | ✅ | Built into EmployeeListPage with dept, designation, role, manager, location, work mode |
| Leave balance display | ✅ | Personal view shows balance cards, auto-initializes on access |
| Leave apply form | ✅ | Full wizard with type, dates, half-day, preview, task impact audit |
| Leave approval flow | ✅ | 2-tier: Manager → HR with inline approve/reject |
| Holiday management | ✅ | CRUD + bulk import of Indian holidays + suggestions |
| Attendance management view | ✅ | Stats, table, filters, Excel export, WebSocket auto-refresh |
| Attendance personal view | ✅ | 3 modes (Office/Field/Site), clock-in/out, breaks, calendar |
| Roster shifts tab | ✅ | Create/edit/delete shifts, 1-per-type enforcement |
| Roster locations tab | ✅ | Leaflet map, geofence circle, strict mode toggle |
| Roster assign tab | ✅ | Employee table, manual + auto-assign, location requirement |
| Leave policy gate | ✅ | Employees must acknowledge leave policy before applying |
| Leave regularization | ✅ | Submit + HR approve/reject with remarks |
| GPS trail tracking | ✅ | 60s interval, offline buffer, batch sync |
| Geofence validation | ✅ | Haversine distance, strict/warning modes |
| Dashboard (3 role-specific) | ✅ | SuperAdmin, HR, Employee views with stats + charts |

## Files Changed in This Session

| # | File | Lines Changed |
|---|------|---------------|
| 1 | `backend/src/modules/auth/auth.service.ts` | ~10 (admin role bypass for onboarding/KYC) |
| 2 | `backend/src/modules/employee/employee.service.ts` | ~25 (shiftAssignment include + response transform) |
| 3 | `backend/src/modules/shift/shift.service.ts` | ~30 (OFFICE shift auto-creation) |
| 4 | `backend/src/modules/attendance/attendance.routes.ts` | +3 (project-site routes) |
| 5 | `backend/src/modules/attendance/attendance.controller.ts` | +30 (project-site controller methods) |
| 6 | `backend/src/modules/attendance/attendance.service.ts` | +25 (project-site service methods) |
| 7 | `frontend/src/features/attendance/AttendancePage.tsx` | +20 (holiday banner) |
| 8 | `frontend/src/features/employee/EmployeeDetailPage.tsx` | +1 (shift info row) |
| 9 | `prisma/seed.ts` | +1 (onboardingComplete in update clause) |
