# Security Audit — Aniston HRMS
**Date:** 2026-04-03
**Auditor:** Claude (Sonnet 4.6) via Security Auditor Agent
**Scope:** Full codebase — authentication, authorization, data protection, API security, Indian compliance, infrastructure

---

## Executive Summary

18 issues were found across 5 severity levels. The most urgent are:

- A 30-day JWT issued to the desktop agent (bypasses access revocation)
- Access tokens stored in `localStorage` (XSS-stealable)
- Plaintext Aadhaar and PAN numbers stored in the walk-in candidate table (not encrypted)
- `sortBy` parameter used directly as a Prisma `orderBy` key without an allowlist (ORM injection risk)
- Temp password returned in the HTTP response body as a plain string
- Bank details stored unencrypted in Redis during onboarding

---

## Findings

### CRITICAL

---

**CRITICAL: [backend/src/modules/agent/agent.service.ts:365-368, 389-392] Desktop agent JWT has a 30-day expiry with no revocation mechanism**

The `verifyPairCode` method issues a `jwt.sign(... { expiresIn: '30d' })` access token. This token is a standard bearer JWT validated only by signature — there is no Redis allowlist check, no refresh rotation, and no way to revoke it before expiry. If an employee is terminated or their device is compromised, the token stays valid for up to 30 days and grants full API access.

Fix: Issue a shorter-lived token (e.g., `1d`) and require heartbeat-based re-validation, OR store agent tokens in a Redis allowlist keyed by `employeeId` and check it inside `authenticate`. On employee deactivation, delete the key.

```typescript
// agent.service.ts — replace expiresIn
{ expiresIn: '24h' }

// auth.middleware.ts — in authenticate(), after jwt.verify():
if (decoded.isAgentToken) {
  const valid = await redis.exists(`agent_token:${decoded.employeeId}`);
  if (!valid) throw new UnauthorizedError('Agent session revoked');
}
```

---

**CRITICAL: [backend/src/modules/walkIn/walkIn.service.ts:72-73] Aadhaar and PAN numbers stored in plaintext in the database**

`walkIn.service.ts` writes `data.aadhaarNumber` and `data.panNumber` directly to the `WalkInCandidate` table with no encryption. The Prisma schema (`prisma/schema.prisma:1568-1572`) confirms the columns are plain `String?`. This violates Indian data-protection norms and contradicts the encryption standard applied elsewhere in the system.

Fix: Run these values through `encrypt()` from `backend/src/utils/encryption.ts` before persistence, and `decrypt()` + `maskAadhaar()`/`maskPAN()` when serving them to clients. Restrict full decryption to `SUPER_ADMIN`, `ADMIN`, and `HR` roles only.

```typescript
// walkIn.service.ts — in the create() data block:
aadhaarNumber: data.aadhaarNumber ? encrypt(data.aadhaarNumber) : null,
panNumber:     data.panNumber     ? encrypt(data.panNumber)     : null,
```

---

**CRITICAL: [frontend/src/features/auth/authSlice.ts:12-13, 24, 28] JWT access token stored in localStorage**

`authSlice.ts` persists the access token in `localStorage.setItem('accessToken', ...)` on every login and token refresh. Any XSS vulnerability (browser extension, injected script, future React `dangerouslySetInnerHTML` usage) can exfiltrate the token and impersonate the user indefinitely until expiry. The same token is used for salary and payroll APIs.

Fix: Keep the access token in Redux memory only. The refresh token already uses an httpOnly cookie — use that cookie mechanism for the access token as well, or keep it exclusively in the Redux slice's in-memory state and never write it to `localStorage`.

```typescript
// authSlice.ts — remove all localStorage calls for accessToken:
const initialState: AuthState = {
  user: null,
  accessToken: null,          // never read from localStorage
  isAuthenticated: false,     // derive from user != null
};

// setCredentials reducer:
state.accessToken = action.payload.accessToken;
// DELETE: localStorage.setItem('accessToken', action.payload.accessToken);
```

Also update `frontend/src/components/layout/AppShell.tsx:21` and `frontend/src/features/payroll/PayrollPage.tsx:87` which read the token directly from `localStorage`.

---

### HIGH

---

**HIGH: [backend/src/modules/employee/employee.service.ts:508-515] Temp password generated with `Math.random()` (not cryptographically random)**

`generateTempPassword()` uses `Math.floor(Math.random() * chars.length)`. `Math.random()` is not a CSPRNG. An attacker who can observe the timestamp or enough outputs can predict subsequent values.

Fix: Replace with `crypto.randomInt()`:

```typescript
import { randomInt } from 'crypto';

private generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars[randomInt(chars.length)];
  }
  return password;
}
```

---

**HIGH: [backend/src/modules/employee/employee.controller.ts:33] Temp password returned in HTTP response body**

`employee.controller.ts:33` returns `message: \`Employee created. Temporary password: ${result.tempPassword}\`` in the JSON response. This means the plaintext password appears in:
- HTTP access logs on the server
- Browser network tab / DevTools
- Any API gateway or proxy that logs response bodies
- The Redux store if the frontend stores the response

Fix: Remove the password from the response entirely. Send it only by email via the existing `enqueueEmail` mechanism.

```typescript
// employee.controller.ts
res.status(201).json({
  success: true,
  data: result.employee,
  message: 'Employee created. A temporary password has been sent to their email.',
});
```

---

**HIGH: [backend/src/modules/employee/employee.validation.ts:56] Unsanitized `sortBy` parameter used directly in Prisma `orderBy`**

`employeeQuerySchema` defines `sortBy: z.string().default('createdAt')` — any string value is accepted. In `employee.service.ts:42`, this is passed directly as `orderBy: { [sortBy]: sortOrder }`. Prisma will reject unknown column names at the ORM level, but the error is not caught gracefully and it is not safe to assume Prisma protects against all possible injection vectors. This also leaks schema column names in error messages.

Fix: Use an enum allowlist:

```typescript
// employee.validation.ts
sortBy: z.enum(['createdAt', 'firstName', 'lastName', 'employeeCode', 'joiningDate', 'status'])
        .default('createdAt'),
```

---

**HIGH: [backend/src/modules/onboarding/onboarding.service.ts:155-158] Bank details stored unencrypted in Redis during onboarding**

Step 5 of onboarding (`if (step === 5)`) stores `stepData` (which contains bank account number, IFSC code, and account holder name) directly in a Redis JSON blob as `data.stepData['step5'] = stepData`. This data persists for 7 days with no encryption. If Redis is compromised or the key is guessed/brute-forced, financial account details are exposed in plaintext.

Fix: Encrypt sensitive step data before writing to Redis, or better, persist bank details directly to the database (a `bankDetails` JSON field on the Employee model, encrypted) rather than staging them in Redis.

---

**HIGH: [backend/src/utils/encryption.ts:15] Encryption key falls back to JWT_SECRET**

When `ENCRYPTION_KEY` is not set (as in the current `.env` where `ENCRYPTION_KEY=""` is empty), `getKey()` falls back to `JWT_SECRET`. This means the same secret is used for both JWT signing and AES-256-GCM key derivation. Compromise of one renders the other vulnerable. The `.env.example` ships with an empty `ENCRYPTION_KEY`.

Fix: Require `ENCRYPTION_KEY` explicitly in `env.ts` and remove the fallback:

```typescript
// env.ts
ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters'),

// encryption.ts
function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error('ENCRYPTION_KEY must be set');
  return crypto.scryptSync(secret, 'aniston-hrms-salt', 32);
}
```

---

**HIGH: [backend/src/modules/auth/auth.controller.ts:36] Refresh token accepted from request body**

`auth.controller.ts:36` reads `const refreshToken = req.cookies.refreshToken || req.body.refreshToken`. This fallback allows a refresh token to be submitted in a JSON body rather than an httpOnly cookie. Any JavaScript on the page (or in an XSS scenario) that obtains a refresh token string can call `/api/auth/refresh` with it in the body, bypassing the httpOnly protection entirely.

Fix: Remove the `req.body.refreshToken` fallback:

```typescript
const refreshToken = req.cookies.refreshToken;
if (!refreshToken) {
  res.status(401).json({ ... });
  return;
}
```

---

**HIGH: [backend/src/modules/auth/auth.service.ts:183] Password reset token logged to console in production**

`auth.service.ts:183` has `console.log('[DEV] Password reset token for ${email}: ${resetToken}')` with no `NODE_ENV` guard. In production, this line emits a valid, exploitable password reset token to stdout/logging infrastructure where it may be stored and accessible to operators or log aggregation services.

Fix: Guard with `NODE_ENV` or remove entirely since the email flow should be the only delivery mechanism:

```typescript
if (env.NODE_ENV === 'development') {
  logger.debug(`[DEV] Password reset token for ${email}: ${resetToken}`);
}
```

---

**HIGH: [backend/src/modules/payroll/payroll.controller.ts:52-62] Salary slip PDF accessible to any authenticated user without ownership check**

`downloadSalarySlip` at `GET /api/payroll/records/:id/pdf` only requires `authenticate` (line 75-77 in payroll.routes.ts). There is no check that `req.user.employeeId` matches `record.employeeId`, and no admin-role restriction. Any authenticated employee who can guess or brute-force a payroll record UUID can download any other employee's salary slip.

Fix: Add an ownership or role check in the controller:

```typescript
async downloadSalarySlip(req: Request, res: Response, next: NextFunction) {
  try {
    const record = await payrollService.getPayrollRecordById(req.params.id, req.user!.organizationId);
    const adminRoles = ['SUPER_ADMIN', 'ADMIN', 'HR'];
    const isAdmin = adminRoles.includes(req.user!.role);
    const isOwner = record.employeeId === req.user!.employeeId;
    if (!isAdmin && !isOwner) {
      return next(new ForbiddenError('You do not have access to this payroll record'));
    }
    // ... rest of method
```

Also update `getPayrollRecordById` to accept and enforce `organizationId`.

---

### MEDIUM

---

**MEDIUM: [backend/src/app.ts:52-54] CORS allows `localhost:5174` in development**

The CORS configuration explicitly allows `http://localhost:5174` in `development` mode. This is a second origin that is not the configured `FRONTEND_URL`. If a developer inadvertently runs a malicious process on port 5174, it has full authenticated CORS access to the API.

Fix: Remove the hardcoded secondary port and use only `env.FRONTEND_URL`:

```typescript
origin: env.NODE_ENV === 'development'
  ? [env.FRONTEND_URL]
  : [env.FRONTEND_URL, 'https://hr.anistonav.com'].filter(Boolean),
```

---

**MEDIUM: [backend/src/modules/auth/auth.middleware.ts:182] `checkExitAccess` fails open on Redis/DB error**

The `.catch(() => next())` at line 182 means if Redis or the database throws, the exit access check silently passes the request through. An attacker who can cause Redis to fail (e.g., Redis memory exhaustion) could bypass exit restrictions for terminated employees.

Fix: Log the error and fail closed (or return a generic access-denied) instead of failing open:

```typescript
}).catch((err) => {
  logger.error('[checkExitAccess] Error checking exit access, denying request:', err);
  next(new ForbiddenError('Access check temporarily unavailable. Please try again.'));
});
```

The same pattern exists in `checkEmployeePermissions` at line 253 — apply the same fix there.

---

**MEDIUM: [backend/src/modules/upload.middleware.ts:77-107] `uploadDocument`, `createWalkInUpload`, and `createEmployeeUpload` allow 50MB files**

The spec in `.claude/rules/api.md` states document uploads should be limited to 10MB. The current limits are 50MB for all document-type handlers. An attacker can upload large files to exhaust disk space or trigger memory pressure.

Fix: Reduce to 10MB for documents:

```typescript
export const uploadDocument = multer({
  storage,
  fileFilter: documentFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per spec
});
```

---

**MEDIUM: [backend/src/middleware/upload.middleware.ts:31-65] MIME type validated but file extension not cross-checked**

All upload filters validate `file.mimetype` only. A user can rename `malware.php` to `document.pdf`, the browser will send `application/pdf` as the content-type (user-controlled), and Multer will accept it. While Node.js does not execute PHP, this is a path to uploading polyglot files.

Fix: Add extension validation in addition to MIME type:

```typescript
const documentFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = ['application/pdf', 'image/jpeg', ...];
  const allowedExts = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedMimes.includes(file.mimetype) && allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new BadRequestError('File type not allowed'));
  }
};
```

---

**MEDIUM: [backend/src/app.ts:165-169] Uploaded files served without authentication**

`express.static` serves the entire `uploads/` directory at `/uploads` and `/api/uploads` with no authentication middleware. Any URL of the form `/uploads/employees/{uuid}/kyc/aadhaar-front-*.pdf` is publicly accessible to anyone who knows or guesses the path. KYC documents (Aadhaar, PAN, photos) are directly accessible.

Fix: Replace `express.static` with an authenticated proxy route:

```typescript
// Remove the static middleware and add:
app.get('/uploads/employees/:employeeId/kyc/:filename',
  authenticate,
  async (req, res, next) => {
    const adminRoles = ['SUPER_ADMIN', 'ADMIN', 'HR'];
    const isAdmin = adminRoles.includes(req.user!.role);
    const isOwner = req.user!.employeeId === req.params.employeeId;
    if (!isAdmin && !isOwner) return next(new ForbiddenError('Access denied'));
    const filePath = path.join(uploadsBase, 'uploads', 'employees',
      req.params.employeeId, 'kyc', req.params.filename);
    res.sendFile(filePath);
  }
);
```

---

**MEDIUM: [backend/src/modules/encryption.ts:15 / .env:3-4] Encryption salt is hardcoded**

`scryptSync(secret, 'aniston-hrms-salt', 32)` uses a fixed, public salt `'aniston-hrms-salt'`. While scrypt still provides work factor, a hardcoded salt means that any two deployments using the same `ENCRYPTION_KEY` (or `JWT_SECRET`) will produce the same derived key. If the salt leaks (it's in the source code), precomputed attacks become easier.

Fix: Store a randomly generated salt in the environment and use it:

```typescript
// env.ts
ENCRYPTION_SALT: z.string().min(16, 'ENCRYPTION_SALT must be set'),

// encryption.ts
return crypto.scryptSync(secret, env.ENCRYPTION_SALT, 32);
```

---

**MEDIUM: [docker/docker-compose.yml:10] Database password hardcoded in docker-compose.yml**

`POSTGRES_PASSWORD: aniston_hrms_2026` is committed to version control. Even though this matches the `.env` (which is gitignored), the docker-compose file itself is tracked. If the database port is exposed (it is — `5432:5432`), this credential is sufficient for remote access.

Fix: Use the standard compose variable substitution and never hardcode credentials:

```yaml
environment:
  POSTGRES_USER: ${POSTGRES_USER}
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
  POSTGRES_DB: ${POSTGRES_DB}
```

Also close port `5432` to external interfaces in production — bind to `127.0.0.1:5432:5432`.

---

**MEDIUM: [backend/src/modules/onboarding/onboarding.routes.ts:268-276] KYC submit endpoint has no ownership check**

`POST /api/onboarding/kyc/:employeeId/submit` only requires `authenticate`. Any authenticated employee can submit any other employee's KYC for review by supplying a different `employeeId` in the URL. This could be used to lock another employee's KYC into PENDING_REVIEW state.

Fix: Add an ownership check:

```typescript
router.post('/kyc/:employeeId/submit', authenticate,
  async (req, res, next) => {
    const adminRoles = ['SUPER_ADMIN', 'ADMIN', 'HR'];
    const isAdmin = adminRoles.includes(req.user!.role);
    if (!isAdmin && req.user!.employeeId !== req.params.employeeId) {
      return next(new ForbiddenError('You can only submit your own KYC'));
    }
    // ...
```

The same applies to `/kyc/:employeeId/photo`, `/kyc/:employeeId/photo-upload`, and `/kyc/:employeeId/combined-pdf`.

---

### LOW

---

**LOW: [backend/src/modules/auth/auth.controller.ts:14-18, 48-53] Refresh token cookie uses `sameSite: 'lax'` instead of `'strict'`**

`sameSite: 'lax'` allows the cookie to be sent on top-level navigations from external sites (e.g., clicking a link). `sameSite: 'strict'` would prevent the cookie from being sent on any cross-site request. Since the refresh endpoint is at `/api/auth/refresh` and the cookie path is restricted to `/api/auth`, the risk is low but not zero on certain browser/proxy configurations.

Fix: Upgrade to `sameSite: 'strict'` for the refresh token cookie.

---

**LOW: [agent-desktop/src/config.ts:8] Electron store encryption key is a hardcoded string**

`STORE_ENCRYPTION_KEY: 'aniston-agent-v1'` is hardcoded in source. The `electron-store` library uses this to encrypt the on-disk credential store. Because the key is the same for every installation and is in the public source, an attacker with filesystem access to the agent data directory can decrypt stored credentials offline.

Fix: Derive the key from a machine-unique identifier (e.g., the system UUID or a value generated on first run and stored in the OS keychain via `keytar`), and do not commit it to source.

---

**LOW: [backend/src/modules/employee/employee.validation.ts:56] `sortBy` allows any string today — Prisma error message leaks schema**

As a secondary consequence of the HIGH finding above: when an invalid `sortBy` value is passed, Prisma throws a `PrismaClientValidationError` which is caught by `errorHandler.ts:113` and returns a generic message. However, during development with `NODE_ENV=development`, the full `err.message` (which includes the field name) is returned. Ensure the Prisma error handler does not leak field details in production — the current handler appears correct but should be verified after the enum fix is applied.

---

**LOW: [backend/src/modules/payroll/payroll.routes.ts:63-72] `getSalaryHistory` has no organization scope**

`payrollService.getSalaryHistory(req.params.employeeId)` does not pass `req.user!.organizationId`. A SUPER_ADMIN from one organization could query salary history for an employee in another organization if they know the employee UUID.

Fix: Pass and enforce `organizationId` in the service:

```typescript
async getSalaryHistory(employeeId: string, organizationId: string) {
  return prisma.salaryHistory.findMany({
    where: { employeeId, employee: { organizationId } },
    ...
  });
}
```

---

## Checklist Summary (from Audit Steps)

### Step 1 — Authentication & Authorization
- [x] Every protected route has `authenticate` middleware
- [x] RBAC middleware applied with correct role arrays
- [x] JWT access token expiry is `15m` (configured in `env.ts` and `.env`)
- [FAIL] Refresh token stored in httpOnly cookie — but also accepted from `req.body` (see HIGH finding)
- [ ] Microsoft SSO tokens validated server-side via Graph API — not audited (no SSO routes found in scope)
- [x] Password hashing uses bcrypt with rounds = 12

### Step 2 — Data Protection
- [FAIL] Aadhaar numbers in `WalkInCandidate` table NOT encrypted (CRITICAL)
- [FAIL] PAN numbers in `WalkInCandidate` table NOT encrypted (CRITICAL)
- [ ] Bank account numbers — not stored in DB during reviewed period (stored in Redis unencrypted, HIGH)
- [PARTIAL] File uploads validate MIME type only — extension not cross-checked (MEDIUM)
- [PARTIAL] Size limits correct for image/resume — document handlers use 50MB instead of 10MB (MEDIUM)
- [x] No path traversal in upload filenames — multer renames with timestamp

### Step 3 — API Security
- [x] Rate limiting on all routes (general: 100/min, auth: 200/15min, walk-in: 5/min, public-apply: 10/min)
- [PARTIAL] CORS allows `localhost:5174` in dev unnecessarily (MEDIUM)
- [FAIL] No Zod schemas use `.strict()` — unknown fields are silently stripped but not rejected
- [x] No raw SQL queries — single `SELECT 1` health check uses tagged template literal (safe)
- [x] Error responses don't expose stack traces in production
- [x] Request body size limited to 10MB

### Step 4 — Indian Compliance
- [FAIL] Aadhaar/PAN not encrypted in walk-in table (CRITICAL)
- [x] `SalaryVisibilityRule` model exists and is enforced via `SUPER_ADMIN` routes
- [x] Audit logs capture employee data access in most modules
- [x] Employee codes are `EMP-001` style (sequential, not UUIDs) but internal IDs are UUIDs

### Step 5 — Infrastructure
- [x] `.env` is in `.gitignore`
- [FAIL] `docker-compose.yml` has hardcoded DB password (MEDIUM)
- [x] Docker containers run as non-root user `appuser` (Dockerfile verified)
- [ ] PM2 configuration not found in audited scope

---

## Issue Index

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | CRITICAL | agent.service.ts:365,389 | 30-day agent JWT, no revocation |
| 2 | CRITICAL | walkIn.service.ts:72-73 | Aadhaar/PAN stored in plaintext |
| 3 | CRITICAL | authSlice.ts:12-13,24 | Access token in localStorage |
| 4 | HIGH | employee.service.ts:508-515 | Math.random() for temp password |
| 5 | HIGH | employee.controller.ts:33 | Temp password in HTTP response |
| 6 | HIGH | employee.validation.ts:56 | Unsanitized sortBy → Prisma orderBy |
| 7 | HIGH | onboarding.service.ts:155-158 | Bank details unencrypted in Redis |
| 8 | HIGH | encryption.ts:15 | Encryption falls back to JWT_SECRET |
| 9 | HIGH | auth.controller.ts:36 | Refresh token accepted from body |
| 10 | HIGH | auth.service.ts:183 | Reset token logged to console |
| 11 | HIGH | payroll.controller.ts:52-62 | Salary slip PDF: no ownership check |
| 12 | MEDIUM | app.ts:52-54 | CORS allows localhost:5174 in dev |
| 13 | MEDIUM | auth.middleware.ts:182 | checkExitAccess fails open on error |
| 14 | MEDIUM | upload.middleware.ts:77 | 50MB document limit (spec says 10MB) |
| 15 | MEDIUM | upload.middleware.ts:31-65 | MIME only, no file extension check |
| 16 | MEDIUM | app.ts:165-169 | Uploads served without authentication |
| 17 | MEDIUM | encryption.ts:15 | Hardcoded encryption salt |
| 18 | MEDIUM | docker-compose.yml:10 | DB password hardcoded in compose file |
| 19 | MEDIUM | onboarding.routes.ts:268 | KYC submit: no ownership check |
| 20 | LOW | auth.controller.ts:14 | sameSite: 'lax' on refresh cookie |
| 21 | LOW | agent-desktop/config.ts:8 | Hardcoded Electron store encryption key |
| 22 | LOW | payroll.routes.ts:63-72 | getSalaryHistory: no org scope |
