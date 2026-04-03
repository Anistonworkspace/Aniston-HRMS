# Security Audit Report — Aniston HRMS
**Date:** 2026-04-03
**Scope:** Invitation token system, onboarding flow, document upload middleware
**Auditor:** Claude Security Auditor Agent (Sonnet 4.6)

---

## Executive Summary

Nine distinct security issues were found across the invitation token system, onboarding flow, and upload middleware. Two are CRITICAL, two HIGH, three MEDIUM, and two LOW. The most serious problems are: the invitation token is a UUID stored in plaintext (trivially brute-forceable and leakable via DB breach), and the legacy public onboarding completion endpoint has no rate limiting and no mandatory step-completion check. The other issues compound these risks or create independent attack surfaces.

---

## CRITICAL

### CRITICAL-1
**File:** `prisma/schema.prisma:1781` / `backend/src/modules/invitation/invitation.service.ts:67-78` / `invitation.service.ts:552`

**Current state:** The `EmployeeInvitation.inviteToken` column is declared as `String @unique @default(uuid())`. The token is stored verbatim — there is no hashing step anywhere in the invitation service. `createInvitation` relies on the Prisma schema default (UUID v4). `resendInvitation` (line 552) calls `crypto.randomUUID()` inline, which also produces a UUID. Both paths produce 122-bit UUID tokens stored as plaintext.

**Risk:** A single read of the `EmployeeInvitation` table — via SQL injection, compromised DB backup, insider access, or ORM misconfiguration — exposes every live invite token in usable form. An attacker can immediately open the invite URL, set an arbitrary password, and create an authenticated employee account with the pre-assigned role (EMPLOYEE, MANAGER, HR, etc.), bypassing all HR oversight. UUID v4 is also less entropic than a 256-bit random token, making offline guessing more feasible than it should be.

**Fix:**
1. Generate tokens with `randomBytes(32).toString('hex')` (256-bit) in the service layer before calling `prisma.create`. Remove `@default(uuid())` from the schema field.
2. Store only a SHA-256 hash of the token (`inviteTokenHash`) in the database. Rename the column accordingly and update the `@unique` constraint to the hash column.
3. On `validateToken` and `completeInvitation`, hash the inbound token and query by hash.

```typescript
// invitation.service.ts — createInvitation and resendInvitation
import { randomBytes, createHash } from 'crypto';

const rawToken = randomBytes(32).toString('hex'); // 256-bit entropy
const tokenHash = createHash('sha256').update(rawToken).digest('hex');

await prisma.employeeInvitation.create({
  data: { ..., inviteTokenHash: tokenHash },
});
// Return rawToken to build the email URL; never store it.

// validateToken / completeInvitation — lookup by hash
const tokenHash = createHash('sha256').update(token).digest('hex');
const invitation = await prisma.employeeInvitation.findUnique({
  where: { inviteTokenHash: tokenHash },
});
```

---

### CRITICAL-2
**File:** `backend/src/modules/onboarding/onboarding.routes.ts:19-25` / `backend/src/modules/onboarding/onboarding.service.ts:179-193` / `backend/src/app.ts` (absence of rate-limit entries for `/api/onboarding`)

**Current state:** The legacy public onboarding endpoints (`GET /api/onboarding/status/:token`, `PATCH /api/onboarding/step/:token/:step`, `POST /api/onboarding/complete/:token`) require no authentication and have no dedicated rate-limit entries in `app.ts`. They fall through to the general API limiter of 100 req/min. The `complete()` handler (lines 179-193 of `onboarding.service.ts`) calls `prisma.employee.update({ data: { status: 'ACTIVE', onboardingComplete: true } })` without checking whether any step data has actually been saved — it only verifies that the Redis token exists and has not expired.

**Risk:** An attacker who discovers or brute-forces a valid Redis token (64-hex characters; Redis scan is not directly exposed, but tokens flow through email URLs which may be logged) can issue a single POST to `/api/onboarding/complete/:token` and immediately set an employee to `ACTIVE` with `onboardingComplete: true`, bypassing KYC, document gate, password creation, and all other wizard steps. At 100 req/min and a 7-day TTL window, the token space is enormous but the lack of any per-endpoint limit means automated tooling faces no meaningful friction.

**Fix:**
1. Add rate limits in `app.ts` before the general `/api` rule:
   ```typescript
   app.use('/api/onboarding/status', rateLimiter({ windowMs: 15 * 60 * 1000, max: 30, keyPrefix: 'rl:onboard-status' }));
   app.use('/api/onboarding/step', rateLimiter({ windowMs: 60 * 1000, max: 20, keyPrefix: 'rl:onboard-step' }));
   app.use('/api/onboarding/complete', rateLimiter({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: 'rl:onboard-complete' }));
   ```
2. In the `complete()` method, enforce that mandatory steps have been completed before activating the employee:
   ```typescript
   async complete(token: string) {
     const data = await getTokenData(token);
     if (!data) throw new BadRequestError('Invalid token');
     const REQUIRED_STEPS = [1, 2]; // password + personal details at minimum
     for (const step of REQUIRED_STEPS) {
       if (!data.stepData[`step${step}`]) {
         throw new BadRequestError(`Step ${step} must be completed before finishing onboarding`);
       }
     }
     // ... rest of handler
   }
   ```
3. Consider deprecating the legacy token-based public flow entirely in favour of the authenticated `/my-step`/`/my-complete` endpoints, which the invitation system already routes new users through (auto-login on `completeInvitation`).

---

## HIGH

### HIGH-1
**File:** `backend/src/app.ts:74` / `backend/src/modules/invitation/invitation.routes.ts:8-10`

**Current state:** `app.ts` line 74 applies a rate limit specifically to `POST /api/invitations/complete`, but there is no corresponding entry for `GET /api/invitations/validate/:token`. The validate endpoint falls through to the general 100 req/min API limit. It performs a plaintext DB lookup by token value and, if found, returns the invitee's email, mobile number, role, and organisation name.

**Risk:** With no dedicated rate limit, an attacker can enumerate invite tokens at 6,000 requests/hour without triggering any invitation-specific throttling. Each successful hit returns PII (email, mobile) and the org structure. This is amplified by CRITICAL-1: tokens stored as UUIDs make targeted guessing more tractable.

**Fix:**
```typescript
// backend/src/app.ts — add before line 74
app.use('/api/invitations/validate', rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyPrefix: 'rl:invite-validate',
}));
```

---

### HIGH-2
**File:** `backend/src/modules/invitation/invitation.service.ts:202-317`

**Current state:** `completeInvitation` performs a two-phase check: `findUnique` to read the invitation (line 202), checks `status !== 'PENDING'` (line 207), then enters a `$transaction` block. Inside the transaction, the `employeeInvitation.update` to set `status: 'ACCEPTED'` does not include `where: { status: 'PENDING' }` as a guard — it uses only `where: { id: invitation.id }`. Two concurrent requests with the same token can both pass the pre-transaction status check before either commits, then both enter the transaction, both see an ACCEPTED-then-overwritten status, and both create User + Employee records.

**Risk:** Under a network retry or two-tab scenario, two User records with the same email could be created (or one employee's password silently overwritten by the second request). The `existingUser` branch (line 220) partially mitigates for pre-existing users but does not prevent the duplicate creation race for new users.

**Fix:** Atomically claim the token inside the transaction before doing any other work:

```typescript
result = await prisma.$transaction(async (tx) => {
  // Atomic claim — only one concurrent request will get count === 1
  const claimed = await tx.employeeInvitation.updateMany({
    where: { id: invitation.id, status: 'PENDING' },
    data: { status: 'PROCESSING' },
  });
  if (claimed.count === 0) {
    throw new BadRequestError('Invitation is no longer valid or is already being processed');
  }
  // ... create User + Employee ...
  await tx.employeeInvitation.update({
    where: { id: invitation.id },
    data: { status: 'ACCEPTED', acceptedAt: new Date(), employeeId: employee.id },
  });
  return { user, employee };
});
```

Add `PROCESSING` to the `InvitationStatus` enum in `prisma/schema.prisma` and `shared/src/enums.ts`. Add a cleanup job or cron that resets stale `PROCESSING` records (e.g., older than 5 minutes) back to `PENDING`.

---

## MEDIUM

### MEDIUM-1
**File:** `backend/src/modules/onboarding/onboarding.routes.ts:281-289`

**Current state:** `POST /api/onboarding/kyc/:employeeId/submit` is behind `authenticate` but has no ownership check. The handler calls `documentGateService.submitKyc(req.params.employeeId)` with the URL parameter directly, without verifying that the authenticated user's `employeeId` matches the parameter or that the user holds an HR/Admin role.

**Risk:** Any authenticated employee can trigger a KYC submission review for any other employee's record by changing `:employeeId` in the URL. This can force an incomplete document set into `SUBMITTED` state, potentially causing HR to verify (or accidentally approve) an unready submission.

**Fix:**
```typescript
router.post('/kyc/:employeeId/submit', authenticate, async (req, res, next) => {
  try {
    const isManagement = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(req.user!.role);
    if (!isManagement && req.user!.employeeId !== req.params.employeeId) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Not authorized to submit KYC for this employee' },
      });
    }
    const { documentGateService } = await import('./document-gate.service.js');
    const gate = await documentGateService.submitKyc(req.params.employeeId);
    res.json({ success: true, data: gate, message: 'KYC submitted for review' });
  } catch (err) { next(err); }
});
```

---

### MEDIUM-2
**File:** `backend/src/middleware/upload.middleware.ts:96-110` (createWalkInUpload) / `upload.middleware.ts:114-130` (createEmployeeUpload)

**Current state:** Both functions construct a filesystem path using `path.join(..., folderName)` or `path.join(..., empCode)` without sanitising the input string for path traversal sequences. `path.join` resolves `../` segments, so a `folderName` value of `../../etc` would resolve outside the intended directory tree. The functions then call `fs.mkdirSync` on the resolved path with `{ recursive: true }`.

**Risk:** If the `folderName` or `empCode` argument ever originates from or is influenced by user input (e.g., a future refactor passes a query parameter directly), an attacker could cause arbitrary directory creation on the server filesystem. If combined with a filename that collides with an existing sensitive file and the directory already exists, behaviour is unpredictable.

**Fix:** Add sanitisation at the entry point of both functions:

```typescript
function assertSafeName(name: string, label: string): void {
  if (!/^[a-zA-Z0-9_\-]+$/.test(name)) {
    throw new Error(`Unsafe ${label} value: "${name}"`);
  }
}

export function createWalkInUpload(folderName: string) {
  assertSafeName(folderName, 'folderName');
  // ... rest unchanged
}

export function createEmployeeUpload(empCode: string) {
  assertSafeName(empCode, 'empCode');
  // ... rest unchanged
}
```

---

### MEDIUM-3
**File:** `backend/src/middleware/upload.middleware.ts:89-93`

**Current state:** `uploadAny` is exported as a named export from the shared upload middleware. It accepts any file type, any MIME type, with a 50 MB limit. No route currently imports it, but its presence as a stable export makes it a standing temptation for future developers seeking a quick generic upload handler.

**Risk:** If `uploadAny` is mounted on any route — especially a public or low-privilege one — it permits uploading of executables, web shells, SVG XSS payloads, and oversized files with no validation.

**Fix:** Either delete the export or, if a generic handler is genuinely needed for an internal admin-only route, restrict it:

```typescript
// Restricted generic upload — admin-only routes; do NOT use on public endpoints
export const uploadAny = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max even for generic
  fileFilter: (_req, _file, cb) => {
    // Deliberately restricted: must pass an explicit fileFilter at the call site
    cb(new BadRequestError('uploadAny requires an explicit fileFilter at the route level'));
  },
});
```

---

## LOW

### LOW-1
**File:** `backend/src/modules/auth/auth.service.ts:182-184`

**Current state:** `forgotPassword` logs the raw reset token to stdout when `NODE_ENV === 'development'`:
```typescript
if (process.env.NODE_ENV === 'development') {
  console.log(`[DEV] Password reset token for ${email}: ${resetToken}`);
}
```

**Risk:** Development logs are frequently shipped to centralised log aggregators (Datadog, ELK, CloudWatch) in Docker/CI setups. If the same aggregator is shared across environments or logs are inadvertently retained, raw reset tokens are permanently stored. This pattern also normalises logging secrets, increasing the probability of it being replicated in production-adjacent code.

**Fix:** Remove the `console.log` line. Developers who need the token during local development can query Redis directly: `redis-cli GET "reset_token:<token>"`. If a convenience mechanism is truly needed, inject the token into the email queue response in development mode rather than stdout.

---

### LOW-2
**File:** `backend/src/modules/invitation/invitation.service.ts:136-145`

**Current state:** `createInvitation` includes `inviteToken: invitation.inviteToken` in its return value (line 139). This value is returned to the API caller (HR/Admin) in the JSON response body and will appear in request/response logs captured by `requestLogger` middleware.

**Risk:** Once CRITICAL-1 is fixed and the raw token is no longer stored in the DB, the token should only exist transiently in memory. Returning it in the response body reintroduces it to the log stream. If application logs are stored and accessible to developers or ops staff, this negates the hashing improvement.

**Fix:** After implementing CRITICAL-1, remove `inviteToken` from the return object. Return only `inviteUrl` (which already contains the token in URL form) and let the email/WhatsApp delivery be the exclusive channel through which the token reaches the invitee.

---

## Summary Table

| ID | Severity | Location | Issue |
|----|----------|----------|-------|
| CRITICAL-1 | CRITICAL | `schema.prisma:1781`, `invitation.service.ts:67,552` | Invite token is UUID stored as plaintext — no hashing |
| CRITICAL-2 | CRITICAL | `onboarding.routes.ts:19-25`, `onboarding.service.ts:179` | Public onboarding complete endpoint unrate-limited and skips step verification |
| HIGH-1 | HIGH | `app.ts:74`, `invitation.routes.ts:8` | `GET /invitations/validate/:token` has no dedicated rate limit |
| HIGH-2 | HIGH | `invitation.service.ts:202-317` | Race condition on `completeInvitation` — no atomic token claim inside transaction |
| MEDIUM-1 | MEDIUM | `onboarding.routes.ts:281` | KYC submit endpoint missing ownership/authorization check |
| MEDIUM-2 | MEDIUM | `upload.middleware.ts:96,114` | `createWalkInUpload`/`createEmployeeUpload` lack path traversal sanitisation |
| MEDIUM-3 | MEDIUM | `upload.middleware.ts:89` | `uploadAny` exported with 50 MB limit and no file type filter |
| LOW-1 | LOW | `auth.service.ts:182` | Raw password reset token logged to stdout in development |
| LOW-2 | LOW | `invitation.service.ts:136` | Raw invite token returned in API response body and thus captured by request logger |

---

## Positive Findings (Controls Verified Correct)

The following controls were confirmed correct and require no remediation.

- **Password hashing:** bcrypt with 12 rounds — `invitation.service.ts:215`, `onboarding.service.ts:113`. Compliant.
- **JWT access token expiry:** Defaults to `'15m'` via `JWT_ACCESS_EXPIRY` in `env.ts:17`. Compliant.
- **Refresh token delivery:** Issued as `httpOnly`, `secure` (production), `sameSite: strict` cookie — `auth.controller.ts:13-16`. Not returned to JavaScript. Compliant.
- **Invitation accept → cookie:** `completeInvitation` also sets the refresh token as `httpOnly` cookie — `invitation.controller.ts:51-57`. Compliant.
- **Refresh token rotation:** Old token deleted from Redis on every refresh — `auth.service.ts:158`. Compliant.
- **Invitation single-use:** Status transitions to `ACCEPTED` within the transaction; reuse after acceptance is blocked by the `status !== 'PENDING'` guard on line 207 (modulo HIGH-2 race). Compliant structurally.
- **Invite token DB uniqueness:** `@unique` constraint and `@@index([inviteToken])` enforced at DB level — `schema.prisma:1781,1791`. Compliant.
- **Legacy onboarding token entropy:** `randomBytes(32).toString('hex')` (256-bit) — `onboarding.service.ts:42`. Correct. Note: contrast with invitation token (CRITICAL-1) which uses UUID.
- **CORS:** Production restricts origin to `env.FRONTEND_URL` and `https://hr.anistonav.com` — `app.ts:52-59`. Compliant.
- **Request body size limit:** `express.json({ limit: '10mb' })` — `app.ts:62`. Compliant.
- **File upload MIME + extension cross-check:** `validateFileType` validates both simultaneously — `upload.middleware.ts:31-44`. Compliant.
- **File size limits:** Image 5 MB, document 10 MB, resume 5 MB enforced in all named multer instances. Compliant.
- **KYC photo/combined-PDF ownership check:** Present on both `/kyc/:employeeId/photo` and `/kyc/:employeeId/combined-pdf` — `onboarding.routes.ts:147-149,187-189`. Compliant.
- **Authenticated static file serving:** `/uploads` requires valid JWT before serving — `app.ts:168`. Compliant.
- **No raw SQL:** All queries go through Prisma ORM. No raw SQL strings observed in scoped files. Compliant.
