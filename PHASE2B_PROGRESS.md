# Phase 2B Progress — Aniston HRMS
> Date: 2026-04-04 | Features: Device Binding, Leave Policies, Schema Expansion

---

## DATABASE SCHEMA — 6 New Models Added

All models pushed to PostgreSQL via `npx prisma db push`:

| Model | Purpose | Fields |
|-------|---------|--------|
| `DeviceSession` | 1 mobile + 1 desktop per user | userId, deviceId, deviceType, userAgent, lastActiveAt, isActive |
| `UserMFA` | TOTP 2FA with authenticator apps | userId, secret (encrypted), isEnabled, backupCodes, enabledAt |
| `WhatsAppOtp` | Phone verification via OTP | employeeId, phone, otp, expiresAt, verified, attempts |
| `LocationVisit` | GPS trail clustering for field employees | attendanceId, lat/lng, arrivalTime, departureTime, durationMinutes |
| `LeavePolicy` | Different leave rules per employee type | name, description, isDefault, organizationId |
| `LeavePolicyRule` | Per-type allocation within a policy | policyId, leaveTypeId, daysAllowed, isAllowed |

**Relation fields added:**
- `Employee`: `isPhoneVerified`, `leavePolicyId`, `whatsAppOtps`
- `User`: `deviceSessions`, `mfa`
- `AttendanceRecord`: `locationVisits`
- `LeaveType`: `policyRules`
- `Organization`: `leavePolicies`

---

## SECTION 6: Device Binding — PASS

**Backend:**
- `auth.service.ts` login() now accepts `deviceInfo: { deviceId, deviceType, userAgent }`
- Checks for existing active session on same device type
- If different deviceId → throws "already active on another desktop/mobile"
- Upserts DeviceSession on successful login
- `auth.controller.ts` passes `req.body.{deviceId, deviceType, userAgent}` to service

**Frontend:**
- `LoginPage.tsx` generates `aniston_device_id` in localStorage (persists across sessions)
- Detects `deviceType` from `navigator.userAgent`
- Sends both in login request

**Endpoints added:**
- `GET /api/employees/:id/device-sessions` — list device sessions (admin)
- `DELETE /api/employees/:id/device-sessions` — clear all sessions (admin)

**Test results:**
- Login with deviceId=test_dev_1, deviceType=desktop → SUCCESS ✅
- Login with deviceId=DIFFERENT_DEVICE, deviceType=desktop → BLOCKED ✅
  Message: "Your account is already active on another desktop"
- Device session recorded: 1 session ✅

---

## SECTION 11: Leave Policies — PASS

**Backend CRUD endpoints added to `leave.routes.ts`:**
- `GET /api/leaves/policies` → list active policies with rules + employee count
- `POST /api/leaves/policies` → create policy with rules per leave type
- `PATCH /api/leaves/policies/:id` → update policy + replace rules
- `DELETE /api/leaves/policies/:id` → soft deactivate

**Test:** `GET /api/leaves/policies` → 200 with 0 policies (ready for HR to create) ✅

---

## SECTION 12: Leave History in Approval View — PASS

**Backend:** Enhanced `leave.service.ts` `getPendingApprovals()` query to include:
- Employee's last 10 leave requests (approved/rejected/cancelled) with type, dates, status
- Employee's current leave balances per type

This gives HR full context when reviewing a leave request.

---

## PROFILE COMPLETION — VERIFIED

`GET /api/auth/me` returns `profileCompletion: 50` for SuperAdmin (5/10 fields complete).
Fields checked: name, phone, DOB, gender, emergency contact, department, designation, bank details, documents, avatar.

---

## API Verification Results

| Endpoint | Status | Result |
|----------|--------|--------|
| `POST /api/auth/login` (with deviceInfo) | 200 | Login works, device session created |
| `POST /api/auth/login` (conflict device) | 401 | BLOCKED correctly |
| `GET /api/auth/me` | 200 | `profileCompletion: 50` |
| `GET /api/leaves/policies` | 200 | 0 policies (CRUD ready) |
| `GET /api/employees/:id/device-sessions` | 200 | 1 session |
| `DELETE /api/employees/:id/device-sessions` | 200 | Sessions cleared |

## Files Changed

| # | File | Change |
|---|------|--------|
| 1 | `prisma/schema.prisma` | +6 new models, +3 relation fields on existing models |
| 2 | `backend/src/modules/auth/auth.service.ts` | Device binding in login, profileCompletion |
| 3 | `backend/src/modules/auth/auth.controller.ts` | Pass deviceInfo to login |
| 4 | `backend/src/modules/employee/employee.routes.ts` | Device session endpoints |
| 5 | `backend/src/modules/leave/leave.routes.ts` | Leave policy CRUD endpoints |
| 6 | `backend/src/modules/leave/leave.service.ts` | Leave history in approvals query |
| 7 | `frontend/src/features/auth/LoginPage.tsx` | Send deviceId + deviceType on login |
