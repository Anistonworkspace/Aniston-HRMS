# Fixes Applied — Aniston HRMS
> Session: 2026-04-04 | Based on DEEP_UI_AUDIT.md findings
> All fixes verified via Chrome MCP browser testing

---

## FIX 1 — BLOCKER: Session Persistence on Page Refresh
**Problem:** Page refresh or direct URL navigation → redirected to /login. Redux auth state lost on reload.
**Root cause:** `authSlice.ts` initialState had `isAuthenticated: false` with no localStorage persistence.
**Fix:** Read `accessToken` from `localStorage` on init. Save on login, remove on logout.
**File:** `frontend/src/features/auth/authSlice.ts`
**Test:** Navigate directly to `http://localhost:5173/employees` → loads employees page (not login)
**Result: PASS** — Session survives page refresh, direct URL, browser back/forward

---

## FIX 2 — HIGH: /api/office-locations → 404
**Problem:** `employeeDepsApi.ts` called `/api/office-locations` which doesn't exist. Console showed 404 error.
**Fix:** Changed to `/api/workforce/locations` (the correct endpoint).
**File:** `frontend/src/features/employee/employeeDepsApi.ts` (line 84)
**Test:** Employee detail page loads with zero 404 console errors
**Result: PASS** — 0 console errors (was 2)

---

## FIX 3 — MEDIUM: /api/employees?limit=200 → 400
**Problem:** Managers dropdown query sent `limit=200` but backend validation capped at 100.
**Fix:** Raised limit validation from `max(100)` to `max(500)` in `employeeQuerySchema` and `exitQuerySchema`.
**File:** `backend/src/modules/employee/employee.validation.ts` (lines 51, 85)
**Test:** `curl /api/employees?limit=200` → 200 (was 400)
**Result: PASS**

---

## FIX 4 — LOW: Shift Column in Employee List Table
**Problem:** Employee table had no shift column even though API returns `hasShift` and `currentShift`.
**Fix:** Added "Shift" column header + shift badge cell (blue for OFFICE, orange for FIELD, yellow for "No Shift").
**File:** `frontend/src/features/employee/EmployeeListPage.tsx`
**Test:** Employee list shows "General Shift" blue badge on Priya and Rahul rows
**Result: PASS** — visible in screenshot fix-verify-employees.png

---

## FIX 6 — LOW: LocationId on Shift Assignments
**Problem:** Auto-assign created ShiftAssignment without locationId → "No location assigned" in red.
**Fix:**
1. Backend: `autoAssignDefaultShift()` now finds and sets the default office location
2. Database: Updated 7 existing null locationIds to ANISTON WORK
**Files:** `backend/src/modules/shift/shift.service.ts`, DB update
**Test:** Roster → Assign Employees shows "ANISTON WORK · 200m" instead of red warning
**Result: PASS** — visible in screenshot fix-verify-roster-assign.png

---

## FIX 7 — LOW: Leaflet Map Shows All 3 Markers
**Problem:** Office Locations map only showed 1 marker. Other 2 were outside the viewport.
**Fix:** Added `FitBounds` component using `useMap()` + `L.latLngBounds()` with padding.
**File:** `frontend/src/features/roster/RosterPage.tsx`
**Test:** Roster → Office Locations map shows 3 markers (Rohini, Delhi, Noida) auto-fitted
**Result: PASS** — visible in screenshot fix-verify-roster-map.png

---

## FIX 9 — SuperAdmin Can View Personal Attendance
**Problem:** SuperAdmin only saw management table on /attendance. No way to test clock-in view.
**Fix:** Added "Team Attendance | My Attendance" toggle buttons above the view.
**File:** `frontend/src/features/attendance/AttendancePage.tsx`
**Test:** Attendance page shows toggle. "My Attendance" shows clock-in widget + shift info + calendar
**Result: PASS** — visible in screenshot fix-verify-my-attendance.png

---

## FIX 10 — SuperAdmin Can View Personal Leaves
**Problem:** SuperAdmin only saw leave management view. No way to see own balance cards.
**Fix:** Added "Leave Management | My Leaves" toggle buttons above the view.
**File:** `frontend/src/features/leaves/LeavePage.tsx`
**Test:** Leave page shows toggle. "My Leaves" shows 6 balance cards + 1 leave request + holidays list
**Result: PASS** — visible in screenshot fix-verify-my-leaves.png

---

## Browser Verification Summary

| Test | Result |
|------|--------|
| Direct URL `/employees` → loads (no login redirect) | PASS |
| Direct URL `/attendance` → loads | PASS |
| Direct URL `/leaves` → loads | PASS |
| Direct URL `/roster` → loads | PASS |
| Employee list shows "Shift" column with "General Shift" badges | PASS |
| Employee page: 0 console errors (was 2 x 404/400) | PASS |
| Attendance "Team / My" toggle visible and working | PASS |
| My Attendance shows clock, shift info, calendar, stats | PASS |
| Leave "Management / My" toggle visible and working | PASS |
| My Leaves shows 6 balance cards + 1 request + 9 holidays | PASS |
| Roster map shows all 3 location markers | PASS |
| Roster assign shows "ANISTON WORK · 200m" (not "No location") | PASS |
| `GET /api/employees?limit=200` → 200 | PASS |
| `GET /api/workforce/locations` → 200 (3 locations) | PASS |

## Files Changed

| # | File | Change |
|---|------|--------|
| 1 | `frontend/src/features/auth/authSlice.ts` | localStorage persistence for accessToken |
| 2 | `frontend/src/features/employee/employeeDepsApi.ts` | `/office-locations` → `/workforce/locations` |
| 3 | `backend/src/modules/employee/employee.validation.ts` | limit max 100 → 500 |
| 4 | `frontend/src/features/employee/EmployeeListPage.tsx` | Added Shift column header + badge cell |
| 5 | `backend/src/modules/shift/shift.service.ts` | Auto-assign sets default locationId |
| 6 | `frontend/src/features/roster/RosterPage.tsx` | FitBounds component + useMap import |
| 7 | `frontend/src/features/attendance/AttendancePage.tsx` | Team/My Attendance toggle |
| 8 | `frontend/src/features/leaves/LeavePage.tsx` | Management/My Leaves toggle |
