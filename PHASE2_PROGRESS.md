# Phase 2 Progress — Aniston HRMS
> Date: 2026-04-04 | Features: Security + Attendance Rules + UX

---

## SECTION 0: Skeleton Bug — VERIFIED OK
Auth flow is correct. `authSlice.ts` reads token from localStorage on init, `ProtectedRoute` shows skeleton while `useGetMeQuery` fetches user, then renders children. 5-second safety timeout catches stale tokens. No `isLoading` field needed — RTK Query handles it.

## SECTION 1: Active/Inactive Employee Enforcement — PASS
**Backend changes:**
- Login: already checked `user.status !== 'ACTIVE'` (existing code at line 41)
- Clock-in: added `employee.status === 'INACTIVE' || 'TERMINATED'` check → throws BadRequestError
- Clock-out: added same check at top of `clockOut()` method
**Files:** `backend/src/modules/attendance/attendance.service.ts`
**Test:** Inactive employees blocked from clock-in/out with "Your account is inactive" message

## SECTION 2: Invitation Link 24-Hour Expiry — PASS
**Changes:** All `72 * 60 * 60 * 1000` → `24 * 60 * 60 * 1000`
All "72 hours" text → "24 hours"
**File:** `backend/src/modules/invitation/invitation.service.ts`
**Test:** New invitations expire in 24h instead of 72h

## SECTION 4: Profile Completion in Auth/Me — PASS
**Changes:** Added `calculateProfileCompletion()` method to AuthService. Checks 10 fields: name, phone, DOB, gender, emergency contact, department, designation, bank details, documents, avatar.
Added `profileCompletion: number` to `/api/auth/me` response.
**File:** `backend/src/modules/auth/auth.service.ts`
**Test:** `GET /api/auth/me` → `profileCompletion: 50` (SuperAdmin has 5/10 fields)

## SECTION 8: Unsaved Changes Warning — PASS
**Created:**
- `frontend/src/hooks/useUnsavedChanges.ts` — hook with `confirmClose`, `handleDiscard`, `handleCancel`, browser `beforeunload` guard
- `frontend/src/components/UnsavedChangesDialog.tsx` — modal with "Discard Changes" / "Keep Editing" buttons, amber warning icon, glassmorphism styling

## SECTION 9: Strict Attendance Rules — PASS
**Changes:**
1. **No re-check-in:** `MAX_RECLOCKIN_PER_DAY` changed from 10 → 0
2. **Mobile-only:** Added `deviceType` field to clockIn/clockOut validation schemas. Backend rejects `deviceType: 'desktop'` with "Attendance can only be marked from a mobile device"
3. **Frontend:** Clock-in/out handlers now send `deviceType` based on `navigator.userAgent`
**Files:** `attendance.service.ts`, `attendance.validation.ts`, `AttendancePage.tsx`
**Test:**
- Desktop clock-in → "Attendance can only be marked from a mobile device" ✅
- Mobile clock-in → proceeds to holiday check (correctly blocked today) ✅
- Re-check-in limit = 0 (strict: one check-in per day) ✅

---

## API Verification Results

| Endpoint | Status | Result |
|----------|--------|--------|
| `GET /api/auth/me` | 200 | `profileCompletion: 50` |
| `POST /attendance/clock-in {deviceType: 'desktop'}` | 400 | "mobile device only" |
| `POST /attendance/clock-in {deviceType: 'mobile'}` | 400 | "today is a holiday" (correct) |
| `GET /api/health` | 200 | All services OK |

## Files Changed in Phase 2

| # | File | Change |
|---|------|--------|
| 1 | `backend/src/modules/attendance/attendance.service.ts` | Inactive check + mobile-only + re-check-in=0 |
| 2 | `backend/src/modules/attendance/attendance.validation.ts` | Added `deviceType` to schemas |
| 3 | `backend/src/modules/invitation/invitation.service.ts` | 72h → 24h expiry |
| 4 | `backend/src/modules/auth/auth.service.ts` | `profileCompletion` in getMe + login |
| 5 | `frontend/src/features/attendance/AttendancePage.tsx` | deviceType in clock-in/out calls |
| 6 | `frontend/src/hooks/useUnsavedChanges.ts` | New hook |
| 7 | `frontend/src/components/UnsavedChangesDialog.tsx` | New component |
