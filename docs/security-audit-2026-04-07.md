# Aniston HRMS — Security Audit Report
**Date:** 2026-04-07
**Auditor:** Security Auditor Agent (Claude)
**Scope:** Backend codebase — authentication, authorization, data protection, input validation, file uploads, session security, sensitive data leakage, JWT security, error handling, environment configuration, Indian compliance

---

## Executive Summary

The codebase has a solid security foundation: bcrypt with 12 rounds is used consistently, AES-256-GCM encryption is correctly implemented for sensitive fields, JWT tokens expire at 15 minutes by default, refresh tokens are stored in httpOnly cookies, and the Docker container runs as a non-root user. However, several significant issues were found that require remediation before production hardening is considered complete.

**Finding counts by severity:**
- CRITICAL: 3
- HIGH: 7
- MEDIUM: 8
- LOW: 6

---

## CRITICAL Findings

### CRIT-1: Hardcoded Payroll Excel Password Exposed in Email Body
**File:** `backend/src/modules/payroll/payroll.routes.ts:293` and `backend/src/utils/payrollExcelExporter.ts:145,182`

The payroll Excel sheet password `aniston@payroll` is hardcoded in three places: it is used to protect the Excel sheets, and it is sent in the HTML body of the payroll report email in plaintext.

```
Sheet password: <strong>aniston@payroll</strong>
```

**Risk:** Any recipient of the payroll email (or anyone who intercepts it) learns the spreadsheet protection password. Since the same password is used for every organization and every payroll run, an attacker who receives any payroll email can open any exported payroll Excel file.

**Fix:** Generate a per-organization random password, store it encrypted in the `Organization` model, and display it to the SUPER_ADMIN via the UI rather than embedding it in an email. Alternatively, use per-run random passwords sent via a separate secure channel.

---

### CRIT-2: MFA-Verified Response Leaks Refresh Token in JSON Body
**File:** `backend/src/modules/auth/auth.controller.ts:238`

After MFA verification completes, the controller sets the refresh token correctly in an httpOnly cookie but also returns it in the JSON response body:

```typescript
res.json({ success: true, data: { accessToken, refreshToken, user: userData } });
```

**Risk:** The refresh token appearing in the response body means frontend JavaScript can read it (via RTK Query, `fetch`, or any XSS payload). This defeats the purpose of the httpOnly cookie. A successful XSS attack can exfiltrate the refresh token and establish a persistent session.

**Fix:** Remove `refreshToken` from the JSON response. The frontend must read the refresh token exclusively from the cookie. This is consistent with how the regular `/login` and `/refresh` endpoints work, which do not expose the refresh token in the body.

---

### CRIT-3: MFA Not Enforced at Login — Bypass Possible
**File:** `backend/src/modules/auth/auth.service.ts` (entire `login()` method)

The `login()` method in `auth.service.ts` issues a full `accessToken` and `refreshToken` without checking whether the user has MFA enabled. The MFA check is implemented as a separate optional flow in `auth.controller.ts` (the `verifyMFA` endpoint), but the `login` service never gates on `user.mfaEnabled`. A user with MFA enabled can therefore receive a fully valid access token simply by calling `POST /api/auth/login` and ignoring the MFA challenge step.

**Risk:** The entire MFA system is opt-in on the client side and provides no server-side enforcement. Any attacker who knows a password can log in without performing the MFA step.

**Fix:** In `auth.service.ts` `login()`, after verifying the password, check `user.mfaEnabled` (and whether the associated `UserMFA.isEnabled` is true). If true, return only a short-lived `mfaPendingToken` (signed JWT with a `mfaPending: true` claim and a 10-minute expiry) and a 200/202 response with `{ requiresMfa: true }`. Do not issue the full access/refresh tokens until `/mfa/verify` is called with a valid TOTP code.

---

## HIGH Findings

### HIGH-1: ENCRYPTION_KEY is Optional in Production — Schema Allows Fallback to JWT_SECRET
**File:** `backend/src/config/env.ts:16`

```typescript
ENCRYPTION_KEY: z.string().min(32).optional(),
```

`ENCRYPTION_KEY` is marked `.optional()` in the Zod schema. The encryption utility at `backend/src/utils/encryption.ts:16-24` silently falls back to `JWT_SECRET` in development and test, but in production it throws only if both are absent. If an operator forgets to set `ENCRYPTION_KEY` in production but `JWT_SECRET` is present, the application will boot normally and encrypt all Aadhaar/PAN data under `JWT_SECRET`.

**Risk:** All sensitive data (Aadhaar numbers, PAN numbers, AI API keys, task integration keys) would be encrypted with the same key used for JWT signing. Rotation of the JWT secret would make all encrypted data permanently unrecoverable. The fallback is invisible in logs after startup.

**Fix:** Make `ENCRYPTION_KEY` required (remove `.optional()`) in production: add a NODE_ENV check in `env.ts` or add a `.refine()` that requires the key when `NODE_ENV === 'production'`. Alternatively make it unconditionally required across all environments.

---

### HIGH-2: Walk-In Upload Endpoint is Fully Public with No Organization Scoping
**File:** `backend/src/modules/walkIn/walkIn.routes.ts:20`

```typescript
router.post('/upload', uploadDocument.single('file'), (req, res, next) => walkInController.uploadFile(req, res, next));
```

The `/api/walk-in/upload` endpoint requires no authentication. It accepts any document file up to 10 MB from any anonymous user and stores it on disk. The rate limiter applies 5 requests/minute for `/api/walk-in/register` but this path (`/upload`) only gets the general 100/minute limit.

**Risk:** An unauthenticated attacker can use this endpoint to fill the server disk with arbitrary files. There is also a secondary concern that `createWalkInUpload(folderName)` at `upload.middleware.ts:97` does `path.join(process.cwd(), 'uploads', 'walkin', folderName)` without sanitizing `folderName`, which could be a path-traversal vector if `folderName` is ever derived from user input.

**Fix:** Apply the same `rateLimiter({ windowMs: 60*1000, max: 5 })` used for `/register` to `/upload`. Add a per-IP daily upload quota. Sanitize any `folderName` argument by stripping `..` segments.

---

### HIGH-3: `redis.keys()` Used for Refresh Token Revocation — Production Performance Risk
**File:** `backend/src/modules/auth/auth.service.ts:245,274`

Both `resetPassword()` and `changePassword()` iterate over all Redis keys matching `refresh_token:*` to find and revoke a user's sessions:

```typescript
const keys = await redis.keys(`${REFRESH_TOKEN_PREFIX}*`);
for (const key of keys) { ... }
```

**Risk:** `KEYS *` is a blocking O(N) command that scans the entire Redis keyspace. In production with thousands of active sessions, this will block Redis for the duration of the scan, causing all other Redis-dependent operations (rate limiting, session lookups, caching) to pause. This is a denial-of-service vector: an attacker who triggers many password resets can degrade service for all users.

**Fix:** Use Redis Sets to track refresh token keys per user: `SADD user_sessions:{userId} {tokenKey}` at token creation and `SMEMBERS` + `DEL` at revocation. This reduces revocation from O(N) keyspace scan to O(M) where M is the number of sessions for one user, and is non-blocking.

---

### HIGH-4: Salary Slip PDF Download Has No Organization Scoping Check
**File:** `backend/src/modules/payroll/payroll.controller.ts:61`

```typescript
const record = await payrollService.getPayrollRecordById(req.params.id, req.user!.organizationId);
```

`getPayrollRecordById` scopes by `organizationId`, which prevents cross-organization access. However, a regular `EMPLOYEE` who knows the UUID of another employee's payroll record within the same organization can access their salary slip. The check at line 62-65 only verifies `record.employeeId !== req.user!.employeeId` — but payroll record UUIDs should not be guessable.

**Risk:** If a payroll record UUID leaks (e.g., via API response inspection, audit logs, or social engineering), any employee in the same organization can download another employee's salary slip by constructing `GET /api/payroll/records/{uuid}/pdf`. This is an IDOR (Insecure Direct Object Reference) vulnerability within the organization boundary.

**Fix:** The check at line 63 is correct in logic but only as effective as UUID confidentiality. Ensure payroll record IDs are never exposed in list responses visible to `EMPLOYEE` role users. Additionally, consider using a separate, short-lived signed token for salary slip download URLs rather than exposing the record UUID directly.

---

### HIGH-5: No Account Lockout After Failed Login Attempts
**File:** `backend/src/modules/auth/auth.service.ts` (`login()` method, entire file)

There is no failed-attempt counter or account lockout mechanism. The rate limiter at `app.ts:101` limits login attempts to 30 per 15 minutes per IP, but this provides no protection against:
- Distributed brute-force attacks from multiple IPs
- Credential stuffing attacks spread over time
- Attacks against a specific account from a valid IP that has not yet hit the rate limit

**Risk:** An attacker can attempt hundreds of password guesses against any account over the course of hours/days without the account being locked or the user being alerted.

**Fix:** Implement a per-user failed login counter in Redis with exponential backoff (e.g., lock after 10 failures, double lockout time per additional failure). Send an email alert to the user after 5 failed attempts. The Redis key `login_fails:{userId}` with a 15-minute TTL is a standard approach.

---

### HIGH-6: Microsoft Teams User Sync Uses Predictable Temp Password
**File:** `backend/src/modules/settings/settings.service.ts:436`

```typescript
const tempPassword = await bcrypt.hash(`Welcome@${new Date().getFullYear()}`, 12);
```

All users imported from Microsoft Teams/Azure AD receive the password `Welcome@2026` (or whichever year it is). This password is also structured predictably (capital letter, word, `@`, 4-digit year) meaning it satisfies complexity requirements and an attacker who knows the naming pattern can attempt it across all newly imported accounts.

**Risk:** Any employee who knows (or guesses) that the organization uses Aniston HRMS with Teams sync can attempt the predictable password against any account imported via Teams sync before the user has changed it. With a standard org of 100 employees, all 100 could be vulnerable simultaneously after an import.

**Fix:** Use `crypto.randomBytes(16).toString('hex')` for the temp password, the same approach already used in `walkIn.service.ts:569`. Force users to change this password on first login by setting a `mustChangePassword: true` flag on the `User` model and enforcing it in the `authenticate` middleware.

---

### HIGH-7: Attendance Monthly Report Export Uses Internal Self-Fetch (SSRF Risk)
**File:** `backend/src/modules/attendance/attendance.routes.ts:362`

```typescript
const reportRes = await fetch(`http://localhost:${process.env.PORT || 4000}/api/attendance/monthly-report?month=${month}&year=${year}`, {
  headers: { Authorization: req.headers.authorization || '' },
});
```

The export endpoint makes an HTTP request to itself by constructing a URL with `process.env.PORT`. The `month` and `year` query parameters come from `req.query` and are passed as integers after `parseInt`, so numeric injection is mitigated. However:

**Risk:** This pattern forwards the caller's Authorization header to an internal service. In an environment where the backend can reach other internal services on the same network, if the PORT value is ever manipulated (via environment variable injection or misconfiguration), this could be used to probe internal services. More practically, this creates an unnecessary circular dependency and doubles the request overhead.

**Fix:** Extract the monthly report computation logic into a shared service function and call it directly. Eliminate the internal HTTP self-call entirely. This also removes the coupling to `process.env.PORT`.

---

## MEDIUM Findings

### MED-1: CSP (Content Security Policy) Disabled
**File:** `backend/src/app.ts:63`

```typescript
contentSecurityPolicy: false,
```

CSP is explicitly disabled with a TODO comment citing Tailwind's inline styles and lazy routes.

**Risk:** Without CSP, a successful XSS attack has no browser-enforced restriction on what scripts can execute, what origins they can communicate with, or what data they can exfiltrate.

**Fix:** Implement a nonce-based CSP. Vite supports nonce injection via its `build.rollupOptions`. A minimal starting CSP: `default-src 'self'; script-src 'self' 'nonce-{nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss:`. Tailwind's inline styles require `style-src 'unsafe-inline'` or a hash-based approach, which is acceptable for styles but not scripts.

---

### MED-2: Zod Schemas Do Not Use `.strict()` — Unknown Fields Pass Through
**File:** All validation files in `backend/src/modules/*/`

No Zod schema uses `.strict()` or explicitly strips unknown fields. Zod's default behavior is to strip unknown fields from objects on `parse()`, which is safe, but several schemas use `z.any()` for nested fields:

- `backend/src/modules/settings/settings.validation.ts:9-10`: `address: z.any()`, `settings: z.any()`
- `backend/src/modules/employee/employee.controller.ts:181`: `metadata: z.any().optional()`

**Risk:** `z.any()` bypasses all validation for those fields. A caller can inject arbitrary JSON into these fields (including potentially very large payloads or prototype pollution vectors) which will be persisted directly to the database as JSON columns.

**Fix:** Define explicit schemas for JSON fields. At minimum add size limits: validate `address` and `settings` against a defined structure. Replace `z.any()` with typed schemas or at least `z.record(z.unknown()).optional()` combined with a payload size check.

---

### MED-3: Walk-In Upload Accepts Files Without Authentication and Stores Without Organization Binding
**File:** `backend/src/modules/walkIn/walkIn.routes.ts:20`

The public file upload endpoint does not bind uploaded files to any organization or walk-in record at upload time. A file is uploaded and a URL is returned, but nothing prevents the URL from being used in a different organization's walk-in registration.

**Risk:** File confusion attacks where one organization's documents are submitted under another organization's candidate record.

**Fix:** At minimum, require an organization token (the same token used to render the kiosk page) to be present in the upload request and record the association at upload time.

---

### MED-4: `uploadAny` Handler Has No MIME/Extension Validation and 50 MB Limit
**File:** `backend/src/middleware/upload.middleware.ts:90-93`

```typescript
export const uploadAny = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
});
```

This handler accepts any file type with no validation. While it is not currently wired to a public route, it exists as an exported symbol that can be imported by any route.

**Risk:** If `uploadAny` is accidentally used on a route (or intentionally used in a future feature), it allows uploading executable files, SVGs with embedded JavaScript, and other malicious file types with a 50 MB limit — 10x larger than the documented maximum.

**Fix:** Remove `uploadAny` or restrict it to internal/admin-only use with explicit comments. Add a MIME type validation even for the "any" handler that blocks executables (`.exe`, `.sh`, `.php`, `.py`, `.js`, `.bat`, etc.).

---

### MED-5: Refresh Token Cookie Uses `sameSite: 'lax'` Instead of `'strict'`
**File:** `backend/src/modules/auth/auth.controller.ts:14-19`

```typescript
res.cookie('refreshToken', result.refreshToken, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  ...
});
```

`SameSite: Lax` allows the cookie to be sent on top-level navigations (e.g., clicking a link to the app). For a pure SPA with separate frontend/backend origins, `SameSite: Strict` would prevent the cookie from being sent in cross-site requests at all.

**Risk:** With `lax`, cross-site GET requests that trigger a top-level navigation (e.g., a phishing link) will include the cookie. For a cookie-protected endpoint that performs state changes via GET (which this codebase does not), this would be CSRF. The current risk is low because all mutations use POST/PATCH/DELETE, but `strict` would be safer.

**Fix:** Change `sameSite` to `'strict'`. This is safe because the frontend SPA and the backend API should both be served from `https://hr.anistonav.com`, making same-site cookies work without restriction.

---

### MED-6: MFA TOTP Secret Stored as Base64 (Not Encrypted)
**File:** `backend/src/modules/auth/auth.controller.ts:161-166`

```typescript
const encSecret = Buffer.from(secret).toString('base64');
await prisma.userMFA.upsert({
  ...,
  create: { userId: req.user!.userId, secret: encSecret, isEnabled: false, backupCodes },
```

The TOTP secret is stored as plain Base64 in the `UserMFA.secret` column. Base64 is encoding, not encryption. Anyone with database read access (DBA, compromised Prisma Studio session, SQL injection) can read and decode all TOTP secrets.

**Risk:** An attacker with database access can extract all TOTP secrets and generate valid TOTP codes for any user's MFA, completely defeating the second factor.

**Fix:** Encrypt the TOTP secret with AES-256-GCM using the same `encrypt()` utility before storing: `const encSecret = encrypt(secret)`. Decrypt before use: `const secret = decrypt(mfa.secret)`.

---

### MED-7: scryptSync Used Without Explicit Work Factor Parameters
**File:** `backend/src/utils/encryption.ts:30`

```typescript
return crypto.scryptSync(secret, salt, 32);
```

`crypto.scryptSync` is called without the optional `options` parameter specifying `N`, `r`, and `p` (cost factors). Node.js defaults are `N=16384`, `r=8`, `p=1`. While these defaults are reasonable, they are not documented or enforced, meaning a Node.js version upgrade that changes defaults could silently alter the derived key.

**Risk:** Low immediate risk, but the lack of explicit parameters means the encryption behavior is implicitly version-dependent. Any change in Node.js defaults would make all previously encrypted data undecryptable without migration.

**Fix:** Explicitly specify cost parameters: `crypto.scryptSync(secret, salt, 32, { N: 16384, r: 8, p: 1 })`. Document these values alongside the format specification in the function.

---

### MED-8: Employee Code Uses Sequential Numeric Format — Enumerable
**File:** `backend/src/modules/employee/employee.service.ts:710-715`

```typescript
const lastNum = parseInt(lastEmployee.employeeCode.replace('EMP-', ''), 10);
return `EMP-${String(lastNum + 1).padStart(3, '0')}`;
```

Employee codes (EMP-001, EMP-002, etc.) are sequential integers. While the primary key is a UUID, the employee code is used in file paths (`uploads/employees/{empCode}/`) and may appear in URLs or exported files.

**Risk:** The sequential format allows enumeration of employee codes. A malicious insider or attacker can iterate EMP-001 through EMP-NNN to probe for valid records. This is low severity on its own but combines with IDOR risks.

**Fix:** This is a business/UX decision but consider appending a random suffix (e.g., `EMP-001-X4K2`) or using a non-sequential scheme for new employees. Alternatively, ensure employee codes are never used as authorization tokens.

---

## LOW Findings

### LOW-1: Error Messages Leaked in Development Mode
**File:** `backend/src/middleware/errorHandler.ts:183-185`

```typescript
message: process.env.NODE_ENV === 'production'
  ? 'An unexpected error occurred'
  : err.message,
```

In development, unhandled errors expose their full message. This is intentional for debugging but should be explicitly documented and guarded against accidental deployment of a development build.

**Risk:** Low. Confirmed safe in production. Ensure CI/CD always builds with `NODE_ENV=production`.

**Fix:** Add a build-time assertion or CI check that verifies `NODE_ENV=production` in deployed artifacts.

---

### LOW-2: Login Rate Limit is 30 Requests per 15 Minutes — Higher Than Spec
**File:** `backend/src/app.ts:101`

The login rate limit is 30 requests per 15 minutes. The API spec in `.claude/rules/api.md` documents auth routes as 50 per 15 minutes, and the code has it at 30, which is more restrictive. However, 30 attempts in 15 minutes still allows an attacker on a single IP to try 30 password guesses every 15 minutes (2/minute), which for a 6-character password space is still feasible.

**Risk:** Low in isolation; combined with the lack of account lockout (HIGH-5), this is the only brute-force protection.

**Fix:** Combine with HIGH-5 fix (per-user lockout). Consider reducing to 10 per 15 minutes for the login endpoint specifically.

---

### LOW-3: Swagger UI Exposed Without Authentication
**File:** `backend/src/app.ts:108-112`

The Swagger API documentation at `/api/docs` is publicly accessible without authentication. It exposes all route definitions, request schemas, and response structures.

**Risk:** In production, this gives any attacker a complete map of the API surface. It does not expose data but aids reconnaissance significantly.

**Fix:** Protect `/api/docs` with `authenticate` middleware and restrict to `SUPER_ADMIN` and `ADMIN` roles in production. Keep it open in development.

---

### LOW-4: `trust proxy` Set to `1` Without Validation
**File:** `backend/src/app.ts:56`

```typescript
app.set('trust proxy', 1);
```

`trust proxy: 1` trusts the first proxy in the chain for `X-Forwarded-For`. If the application is ever accidentally exposed directly to the internet without Nginx, the IP-based rate limiter will trust attacker-supplied `X-Forwarded-For` headers, defeating IP-based rate limiting.

**Risk:** Low if Nginx is always in front. High if the backend is ever exposed directly.

**Fix:** Set `trust proxy` to the explicit IP of the Nginx reverse proxy rather than a hop count. Alternatively, add a startup check that verifies the proxy header is present.

---

### LOW-5: HSTS Not Enabled in Development (Acceptable) — Confirm Production Setting
**File:** `backend/src/app.ts:64`

```typescript
hsts: env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
```

HSTS is correctly configured for production with a 1-year max-age and `includeSubDomains`. However, `preload: true` is not set, which means the domain is not in the HSTS preload list.

**Risk:** Low. First-visit HTTPS downgrade attacks remain possible without preload.

**Fix:** Add `preload: true` to the HSTS config and submit `hr.anistonav.com` to the HSTS preload list after confirming the domain will always serve HTTPS.

---

### LOW-6: MFA Backup Codes Generated with `Math.random()`
**File:** `backend/src/modules/auth/auth.controller.ts:158-160`

```typescript
const backupCodes = Array.from({ length: 8 }, () =>
  Math.random().toString(36).slice(2, 6).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase()
);
```

`Math.random()` is not a cryptographically secure pseudo-random number generator (CSPRNG). Backup codes generated this way could theoretically be predicted if the RNG seed is known.

**Risk:** Low practical risk in Node.js as V8's `Math.random()` uses a high-quality but non-CSPRNG algorithm. However, this is a security anti-pattern for any security token.

**Fix:** Use `crypto.randomBytes` to generate backup codes: e.g., `crypto.randomBytes(4).toString('hex').toUpperCase()` for each segment.

---

## Indian Compliance Notes

### COMP-1: Walk-In Candidate Aadhaar/PAN Stored in Schema Without `Encrypted` Suffix Convention
**File:** `prisma/schema.prisma:1908-1909`

```
aadhaarNumber   String?      // Masked: XXXX-XXXX-1234
panNumber       String?      // Masked: ABCDE1234F
```

The schema comment says "Masked" but the code in `walkIn.service.ts:73-74` actually stores the encrypted value, not the masked value. The field naming convention in `CLAUDE.md` requires sensitive fields to use the `Encrypted` suffix (e.g., `aadhaarEncrypted`). This inconsistency between the comment and the actual stored data (encrypted, not masked) could confuse future developers into treating the field as safe to display.

**Fix:** Rename the schema fields to `aadhaarNumberEncrypted` and `panNumberEncrypted` (with a migration) and update all references. Update schema comments to accurately reflect that the values are AES-256-GCM encrypted.

### COMP-2: No Audit Log for Salary Data Views
**File:** `backend/src/modules/payroll/payroll.controller.ts` (entire file)

The payroll controller fetches salary structure and payroll records but does not call `createAuditLog` for read operations. The audit spec in `CLAUDE.md` states audit logs should capture who viewed sensitive employee data.

**Fix:** Add `createAuditLog` calls for `getSalaryStructure`, `getPayrollRecords`, and `downloadSalarySlip` operations, recording the `userId`, `employeeId` accessed, and timestamp.

---

## Summary Table

| ID | Severity | File | Issue |
|----|----------|------|-------|
| CRIT-1 | CRITICAL | `payroll.routes.ts:293`, `payrollExcelExporter.ts:145` | Hardcoded payroll Excel password in email body |
| CRIT-2 | CRITICAL | `auth.controller.ts:238` | Refresh token leaked in MFA-verify JSON response |
| CRIT-3 | CRITICAL | `auth.service.ts` (login) | MFA not enforced server-side — full bypass possible |
| HIGH-1 | HIGH | `env.ts:16` | `ENCRYPTION_KEY` optional — silent fallback to `JWT_SECRET` |
| HIGH-2 | HIGH | `walkIn.routes.ts:20` | Public unauthenticated file upload with no org scope |
| HIGH-3 | HIGH | `auth.service.ts:245,274` | `redis.keys()` used for session revocation — O(N) blocking |
| HIGH-4 | HIGH | `payroll.controller.ts:61` | Salary slip download IDOR within organization |
| HIGH-5 | HIGH | `auth.service.ts` (login) | No account lockout after failed login attempts |
| HIGH-6 | HIGH | `settings.service.ts:436` | Predictable Teams-sync temp password `Welcome@{year}` |
| HIGH-7 | HIGH | `attendance.routes.ts:362` | Internal self-fetch for report export (SSRF risk) |
| MED-1 | MEDIUM | `app.ts:63` | CSP disabled globally |
| MED-2 | MEDIUM | Various validation files | `z.any()` used for JSON fields — no structure validation |
| MED-3 | MEDIUM | `walkIn.routes.ts:20` | Uploaded files not bound to organization at upload time |
| MED-4 | MEDIUM | `upload.middleware.ts:90` | `uploadAny` has no type validation, 50 MB limit |
| MED-5 | MEDIUM | `auth.controller.ts:14` | Refresh token cookie uses `sameSite: 'lax'` not `'strict'` |
| MED-6 | MEDIUM | `auth.controller.ts:161` | TOTP secret stored as plain Base64, not encrypted |
| MED-7 | MEDIUM | `encryption.ts:30` | `scryptSync` missing explicit cost parameters |
| MED-8 | MEDIUM | `employee.service.ts:714` | Sequential employee codes are enumerable |
| LOW-1 | LOW | `errorHandler.ts:183` | Error messages exposed in non-production builds |
| LOW-2 | LOW | `app.ts:101` | Login rate limit (30/15min) insufficient without lockout |
| LOW-3 | LOW | `app.ts:108` | Swagger UI unauthenticated in all environments |
| LOW-4 | LOW | `app.ts:56` | `trust proxy: 1` — vulnerable if exposed without Nginx |
| LOW-5 | LOW | `app.ts:64` | HSTS missing `preload: true` |
| LOW-6 | LOW | `auth.controller.ts:158` | MFA backup codes use `Math.random()` (not CSPRNG) |
| COMP-1 | COMPLIANCE | `schema.prisma:1908` | Walk-in Aadhaar/PAN fields named without `Encrypted` suffix |
| COMP-2 | COMPLIANCE | `payroll.controller.ts` | No audit log for salary data read operations |

---

## Positive Security Controls Confirmed

The following controls were verified as correctly implemented:

- bcrypt with 12 rounds used consistently across all password hashing operations (auth, invitation, walkIn, onboarding, employee creation)
- AES-256-GCM with per-encryption random salt and IV — correctly implemented in `encryption.ts`
- JWT access token expiry defaults to 15 minutes (`JWT_ACCESS_EXPIRY: z.string().default('15m')`)
- Refresh tokens stored in httpOnly cookies on login and refresh endpoints (CRIT-2 is specific to MFA flow only)
- Refresh token rotation implemented — old token deleted, new token issued on each refresh
- Refresh token invalidated on logout and password change
- Docker container runs as non-root user (`USER appuser`)
- `.env` file is in `.gitignore`
- Zod validation applied on all POST/PATCH mutation routes
- All routes apply `authenticate` middleware before business logic
- RBAC enforced via `authorize()` and `requirePermission()` on all sensitive routes
- CORS restricted to `FRONTEND_URL` and `https://hr.anistonav.com` in production
- Helmet applied with HSTS (production), `X-Frame-Options: DENY`, referrer policy
- Rate limiting applied to all routes including auth, walk-in, and public-apply
- Error handler correctly strips Prisma errors and stack traces in production
- Password reset uses `randomBytes(32)` with 1-hour Redis TTL
- No raw SQL queries found — all database access through Prisma ORM
- Uploaded files renamed with timestamp+random suffix — path traversal mitigated for standard uploads
- `ENCRYPTION_KEY` required to throw at startup if not set in production (though the `optional()` schema issue in HIGH-1 partially undermines this)
- Multi-tenant isolation: all queries include `organizationId` from the authenticated JWT
