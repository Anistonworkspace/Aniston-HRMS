# ATTENDANCE MANAGEMENT — FULL AUDIT V2
> Audited: 2026-04-06 | Senior FullStack (20yr) + QA (30yr) perspective
> Every file read line-by-line. Every data flow traced. Every button checked.

---

## CRITICAL ISSUES (Must Fix)

### ISSUE 1: clockIn/clockOut mutation type missing `deviceType` field
**Severity: CRITICAL** | **File:** `attendanceApi.ts` lines 36, 41

The RTK Query mutation types for `clockIn` and `clockOut` do NOT include `deviceType`:
```typescript
// Line 36 — missing deviceType
clockIn: builder.mutation<any, { latitude?: number; longitude?: number; source?: string; siteName?: string; notes?: string }>
// Line 41 — missing deviceType
clockOut: builder.mutation<any, { latitude?: number; longitude?: number }>
```

But `AttendancePage.tsx` lines 495, 498 send `deviceType`:
```typescript
await clockIn({ ...coords, source: 'MANUAL_APP', deviceType }).unwrap();
await clockOut({ ...coords, deviceType }).unwrap();
```

**Impact:** TypeScript may strip the field or throw compile warning. At runtime the field IS sent (RTK Query passes body as-is), but this is a type contract violation.

**Fix:** Add `deviceType?: 'mobile' | 'desktop'` to both mutation type definitions.

---

### ISSUE 2: `notCheckedIn` count calculation is wrong in `getAllAttendance`
**Severity: HIGH** | **File:** `attendance.service.ts` line 777

```typescript
const notCheckedIn = totalEmployees - presentCount - absentCount - onLeaveCount;
```

This does NOT subtract `HALF_DAY`, `HOLIDAY`, `WEEKEND`, or `WORK_FROM_HOME` counts. If employees have these statuses, `notCheckedIn` becomes artificially inflated.

**Example:** 3 employees, 1 PRESENT, 1 HALF_DAY, 1 not checked in → `notCheckedIn = 3 - 1 - 0 - 0 = 2` (should be 1).

**Impact:** Stats card "Not Checked In" on management view shows wrong number.

**Fix:** Count all statuses with records, then subtract from total:
```typescript
const withRecords = records.length; // all employees who have any attendance record
const notCheckedIn = Math.max(0, totalEmployees - withRecords);
```

---

### ISSUE 3: Backend allows clock-in when `deviceType` is undefined
**Severity: HIGH** | **File:** `attendance.service.ts` lines 59-61

```typescript
if (data.deviceType === 'desktop' && data.source !== 'MANUAL_HR') {
  throw new BadRequestError('Attendance can only be marked from a mobile device...');
}
```

If `deviceType` is `undefined` (old clients, API calls without it), the check `=== 'desktop'` is `false`, allowing the clock-in from any device. This completely bypasses the mobile-only enforcement.

**Fix:** Require `deviceType` to be present, or default to blocking:
```typescript
if (data.source !== 'MANUAL_HR' && data.deviceType !== 'mobile') {
  throw new BadRequestError('Attendance can only be marked from a mobile device.');
}
```

---

## MEDIUM ISSUES

### ISSUE 4: ProjectSiteView uses hardcoded sites instead of API
**Severity: MEDIUM** | **File:** `ProjectSiteView.tsx` lines 7-13

Sites are hardcoded as `SAMPLE_SITES` array:
```typescript
const SAMPLE_SITES = [
  'Construction Site A — Noida Sector 62',
  'Client Office — Gurgaon',
  'Warehouse — Manesar',
  'Branch Office — Dwarka',
  'Event Venue — CP',
];
```

But there are 3 real office locations in the DB (ANISTON WORK, Aniston Office - Delhi, Client Site - Noida). The dropdown should fetch from `/api/workforce/locations`.

**Impact:** Users see fake site names instead of real configured locations.

**Fix:** Replace with `useGetLocationsQuery()` from workforceApi and map locations to dropdown options.

---

### ISSUE 5: ProjectSiteView photo capture is simulated
**Severity: MEDIUM** | **File:** `ProjectSiteView.tsx` line 29

```typescript
setPhotoUrl(`https://storage.aniston.in/uploads/site-photo-${Date.now()}.jpg`);
```

This generates a fake URL instead of actually capturing a photo from the device camera.

**Impact:** No real photo evidence is stored for project site check-ins.

**Fix:** Use `<input type="file" accept="image/*" capture="environment">` for mobile camera, or a file picker for desktop.

---

### ISSUE 6: Export button on EmployeeAttendanceDetailPage uses hardcoded localhost
**Severity: MEDIUM** | **File:** `EmployeeAttendanceDetailPage.tsx` line 266

```typescript
href={`${import.meta.env.VITE_API_URL || 'http://localhost:4000/api'}/attendance/export?...`}
```

Falls back to `http://localhost:4000/api` which only works in dev. In production this will break if `VITE_API_URL` env var is not set.

**Fix:** Use relative URL `/api/attendance/export?...` as fallback instead of absolute localhost.

---

### ISSUE 7: Export link opens in new tab without auth token
**Severity: MEDIUM** | **File:** `EmployeeAttendanceDetailPage.tsx` line 264-267

The Export button uses `<a href=... target="_blank">` which opens a new tab. But the `/attendance/export` endpoint requires authentication (JWT Bearer token). A direct link in a new tab does NOT include the Authorization header — the request will fail with 401.

**Impact:** Clicking Export will show "Unauthorized" error in the new tab.

**Fix:** Use `fetch()` with Authorization header, then create a blob URL to download:
```typescript
const handleExport = async () => {
  const res = await fetch(`/api/attendance/export?...`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'attendance.xlsx'; a.click();
};
```

---

## LOW ISSUES

### ISSUE 8: Summary weekends count doesn't exclude holidays falling on Sunday
**Severity: LOW** | **File:** `attendance.service.ts` lines 646-650

The `getMyAttendance` function counts ALL Sundays as weekends, even if a Sunday is also a holiday. This could result in both `summary.holidays` and `summary.weekends` counting the same day.

**Impact:** Minor stat inaccuracy in monthly summary.

---

### ISSUE 9: FieldSalesView has no Leaflet map — shows GPS stats only
**Severity: LOW** | **File:** `FieldSalesView.tsx`

The Field Sales view shows GPS point count, distance traveled, and accuracy — but NO visual map. The map is only shown on the `EmployeeAttendanceDetailPage` (for HR viewing an employee's trail).

**Impact:** Field employees can't see their own trail on a map while tracking. They only see numeric stats.

---

### ISSUE 10: Calendar legend in compact view only shows codes without descriptions
**Severity: LOW** | **File:** `EmployeeAttendanceDetailPage.tsx` lines 530-534

The compact calendar legend shows just `P A HD L WFH WO H` without text descriptions. New users may not know what these codes mean.

**Impact:** Minor UX confusion for first-time users. The expand modal DOES show full descriptions.

---

## WORKING CORRECTLY (No Issues Found)

| Component | Status | Verified |
|-----------|--------|----------|
| `useState` import in AttendancePage.tsx | PASS | Line 1: `import { useState, ... }` |
| Team/My Attendance toggle | PASS | Lines 42-57: Toggle buttons with state |
| CommandCenter import | PASS | Imported from `./components/CommandCenter` (separate file) |
| AnimatePresence + motion import in detail page | PASS | Line 3 |
| Maximize2 + X import | PASS | Line 7 |
| showCalendarModal state declared | PASS | Line 72 |
| Calendar modal JSX tags matched | PASS | All open/close tags verified |
| employeeId in scope for buttons | PASS | From `useParams` at line 68 |
| navigate imported | PASS | From `react-router-dom` at line 2 |
| Sunday-only weekend logic (frontend) | PASS | `dayOfWeek === 0` |
| Sunday-only weekend logic (backend) | PASS | Cron: line 169, service: lines 647, 1166 |
| Holiday display from API | PASS | holidays array returned and rendered |
| Clock-in geolocation request | PASS | 5s timeout, graceful fallback |
| Clock-in holiday blocking | PASS | Backend checks Holiday table |
| Break start/end | PASS | Correct API calls |
| WebSocket auto-refresh | PASS | Listens for attendance events |
| Date picker on management view | PASS | Changes query date |
| Status filter dropdown | PASS | Filters by PRESENT/ABSENT/etc |
| Pagination | PASS | Works on management table |
| Calendar month navigation | PASS | Prev/Next/Today buttons |
| Calendar date click → detail update | PASS | Left panel refreshes |
| Compact calendar sizing | PASS | max-w-xs, no aspect-square |
| Calendar expand modal | PASS | Full-size with aspect-square cells |
| Stale Saturday WEEKEND data | PASS | Deleted in FIX 1 |

---

## PRIORITY FIX ORDER

| # | Issue | Severity | Effort | Impact |
|---|-------|----------|--------|--------|
| 1 | Add `deviceType` to clockIn/clockOut mutation types | CRITICAL | 2 min | Fixes TypeScript type contract |
| 2 | Fix `notCheckedIn` count calculation | HIGH | 3 min | Correct stats display |
| 3 | Fix deviceType bypass when undefined | HIGH | 2 min | Enforce mobile-only properly |
| 4 | Replace hardcoded sites with API fetch | MEDIUM | 10 min | Show real locations |
| 5 | Fix Export button auth (use fetch + blob) | MEDIUM | 5 min | Export actually works |
| 6 | Fix Export URL fallback (remove localhost) | MEDIUM | 1 min | Production-safe |
| 7 | Replace simulated photo capture | MEDIUM | 10 min | Real photo evidence |
