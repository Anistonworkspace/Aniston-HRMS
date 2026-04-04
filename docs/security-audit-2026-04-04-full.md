# Security Audit — Aniston HRMS (Full Bank-Grade Review)
**Date:** 2026-04-04
**Auditor:** Claude Security Agent (claude-sonnet-4-6)
**Scope:** File Upload Security, API Security, Payroll/High-Risk Actions, Infrastructure, Audit Logging
**Files read:** upload.middleware.ts, app.ts, errorHandler.ts, auth.middleware.ts, auth.service.ts, auth.controller.ts, auth.routes.ts, rateLimiter.ts, requestLogger.ts, payroll.routes.ts, payroll.controller.ts, payroll.service.ts (audit calls), env.ts, encryption.ts, auditLogger.ts, employee.service.ts, employee.validation.ts, employee.routes.ts, document.routes.ts, walkIn.routes.ts, settings.routes.ts, ai-config.service.ts, docker-compose.yml, Dockerfile, deploy.yml, ci.yml, .gitignore

---

## Executive Summary

The codebase demonstrates a solid security foundation: JWT with httpOnly cookies for refresh tokens, bcrypt at 12 rounds, AES-256-GCM encryption for PII, per-tenant data isolation enforced via `organizationId` on every Prisma query, Helmet, CORS restricted to known origins, and a centralized error handler that suppresses stack traces in production. The Docker image runs as a non-root user.

However, four CRITICAL and six HIGH severity issues were found that require remediation before this system handles production payroll and KYC data at scale.

**Finding counts by severity:**
- CRITICAL: 4
- HIGH: 6
- MEDIUM: 7
- LOW: 5

---

## CRITICAL Findings

### CRIT-01 — ENCRYPTION_KEY is Optional in env.ts; Server Starts Without It
**File:** `backend/src/config/env.ts:16`
**Current state:**
```typescript
ENCRYPTION_KEY: z.string().min(32).optional(),
```
The Zod schema marks `ENCRYPTION_KEY` as optional. Zod validates at startup; if the variable is absent, the server starts without complaint. The `encryption.ts` utility falls back to `JWT_SECRET` in development/test and only throws at the first encrypt/decrypt call in production.

**Risk:** (1) A production server can start without `ENCRYPTION_KEY` if it is accidentally omitted from the environment file during a deployment. The first time an HR user saves an Aadhaar number, the call throws and the operation fails silently or returns a 500. (2) Worse, if `NODE_ENV` is not exactly `production`, the server silently uses `JWT_SECRET` as the encryption key. Data encrypted under `JWT_SECRET` will be permanently unrecoverable if `JWT_SECRET` is rotated for any reason. (3) This makes the ENCRYPTION_KEY protection theater: it can be absent in production with no startup-time enforcement.

**Fix:** Remove `.optional()`. The field must be unconditionally required at Zod validation time, regardless of `NODE_ENV`:
```typescript
ENCRYPTION_KEY: z.string().min(32),
```

---

### CRIT-02 — Legacy Encryption Uses a Hardcoded Salt Committed to Source Code
**File:** `backend/src/utils/encryption.ts:71`
**Current state:**
```typescript
salt = Buffer.from('aniston-hrms-salt');
```
The 3-part legacy ciphertext format (still accepted by `decrypt()`) uses a static, source-committed salt. This means every legacy Aadhaar, PAN, and bank account ciphertext in the database shares an identical salt.

**Risk:** The salt's purpose in scrypt is to make pre-computation attacks impractical. With a known, static salt (it is in the public repo), an attacker who obtains the database and the `ENCRYPTION_KEY` (e.g., via a separate breach of the secrets store) can compute a single scrypt derivation and then brute-force all legacy-encrypted values simultaneously in parallel. There is no per-record cost. Any Aadhaar number in the legacy format is exposed if `ENCRYPTION_KEY` is ever compromised.

**Fix:** Write a one-time migration script that:
1. Reads every employee record with a legacy-format encrypted field (detectable by 3-part `:` separator vs 4-part).
2. Decrypts the value using the current key.
3. Re-encrypts it in the 4-part (random-salt) format.
4. Saves the new ciphertext.
After migration is confirmed complete, remove the legacy 3-part branch from `decrypt()`. This migration must run before new data volume makes it impractical.

---

### CRIT-03 — Walk-In Upload Filename is Not Randomized; `folderName` is Attacker-Influenced
**File:** `backend/src/middleware/upload.middleware.ts:96-111`
**Current state:**
```typescript
export function createWalkInUpload(folderName: string) {
  const dir = path.join(process.cwd(), 'uploads', 'walkin', folderName);
  // ...
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}${ext}`);   // e.g. "file.pdf"
  },
```
`folderName` is passed in from caller code (which may derive it from request parameters or body), and the filename is `fieldname + extension` — no random component.

**Risk:** (1) Path traversal via `folderName`: if the caller passes a value like `../../agent` or `../employees/some-uuid/kyc`, `path.join` will resolve to a directory outside the walkin folder. A crafted upload then places a file in the agent download directory (which is served without authentication) or in another employee's KYC folder. (2) File overwrite: uploading twice with the same field name silently overwrites the previous file. For walk-in candidates, two documents for the same candidate are indistinguishable. (3) Enumeration: a predictable filename makes it easy to enumerate other candidates' documents if the download URL is ever guessed.

**Fix:**
- Validate `folderName` to an allowlist: UUID-only via `/^[0-9a-f-]{36}$/.test(folderName)`.
- Add a path-containment check after `path.join`: `if (!dir.startsWith(expectedBase)) throw new Error('Invalid folder')`.
- Always randomize: `cb(null, \`${file.fieldname}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}\`)`.

---

### CRIT-04 — `prisma db push` Used on Production Database in Deployment Workflow
**File:** `.github/workflows/deploy.yml:108`
**Current state:**
```yaml
# Use db push (safe mode, no --accept-data-loss) until migrations are baselined.
npx --no-install prisma db push
```
Even the comment acknowledges this is a TODO. `prisma db push` is explicitly documented by Prisma as a prototyping tool, not for production.

**Risk:** `db push` does not create migration files. It applies schema changes in a single transaction that cannot be rolled back. On schema drift (e.g., a column was manually added to production), `db push` may silently drop it. There is no migration history, making point-in-time recovery impossible. A bug in a Prisma schema change could cause silent, irreversible column drops or data truncation in the production database — including the `aadhaarEncrypted`, `panEncrypted`, and `bankAccountEncrypted` columns that store every employee's sensitive identity data.

**Fix:**
1. Run `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` to generate a baseline migration.
2. Run `npx prisma migrate resolve --applied <migration-name>` to mark it as already applied.
3. Replace `prisma db push` in `deploy.yml` with `npx prisma migrate deploy`.
4. Add a pre-deploy database backup step that is validated (restore test) before migration runs.

---

## HIGH Findings

### HIGH-01 — No Magic-Byte (File Header) Verification for Uploads
**File:** `backend/src/middleware/upload.middleware.ts:31-44`
**Current state:** The `validateFileType` function checks `file.mimetype` (HTTP header, client-controlled) and `path.extname(file.originalname)` (filename, client-controlled). Neither reads the file's binary content.

**Risk:** An attacker sets `Content-Type: image/jpeg` and names the file `shell.jpg`, but the file body contains a PHP webshell, HTML with `<script>`, or a ZIP-inside-JPEG polyglot. Multer writes it to disk. If the file is subsequently served with a permissive `Content-Type` (which Nginx may default to based on extension), it can execute or cause stored XSS. This is a classic bypass of header-only file type validation.

**Fix:** Add magic-byte inspection using the `file-type` npm package. Because multer's `fileFilter` runs before the file is written, you need to buffer a small header. A practical approach is to use `multer.memoryStorage()` for validation then stream to disk, or to use a post-upload validation step that reads the first 12 bytes of the saved file:
```typescript
import { fileTypeFromFile } from 'file-type';
// After multer saves the file:
const type = await fileTypeFromFile(req.file.path);
if (!allowedMimes.includes(type?.mime ?? '')) {
  fs.unlinkSync(req.file.path);
  throw new BadRequestError('File content does not match declared type');
}
```

---

### HIGH-02 — `uploadAny` Exported with No Type Restriction and 50 MB Limit
**File:** `backend/src/middleware/upload.middleware.ts:90-93`
**Current state:**
```typescript
export const uploadAny = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
});
```
No `fileFilter`. Accepts any MIME type. 50 MB limit — 5x the document limit.

**Risk:** If any route in the current or future codebase imports and uses `uploadAny`, it accepts executables, scripts, HTML files, or malware at 50 MB. This is an accident waiting to happen: a developer adding a new upload feature grabs the closest available export without noticing it has no type restriction.

**Fix:** Delete this export. If a broadly-permissive upload is ever genuinely needed (e.g., for an internal admin-only bulk import), create a dedicated named function at the call site with explicit justification in a comment, rather than a globally-exported open-ended uploader.

---

### HIGH-03 — Rate Limiter Silently Fails Open When Redis is Unavailable
**File:** `backend/src/middleware/rateLimiter.ts:34-37`
**Current state:**
```typescript
} catch {
  // If Redis is down, allow the request
  next();
}
```
**Risk:** If Redis becomes unavailable (OOM kill, network partition, container restart, Redis eviction under memory pressure), every rate limit across the entire application drops to zero — unlimited requests from all IPs. The login endpoint allows 200 requests per 15 minutes normally; during a Redis outage it allows infinite requests. This is exactly the window an attacker monitoring the system would exploit: cause a Redis outage, then brute-force credentials at full speed. Password reset, walk-in registration, and public job application endpoints become unlimited simultaneously.

**Fix:** Implement a local in-memory fallback using `lru-cache` with TTL-based counters that activates when Redis throws. For the authentication endpoints specifically, fail closed (return 503) rather than failing open, since temporary unavailability of rate limiting is a higher security risk than temporary service unavailability for login.

---

### HIGH-04 — Exit Access and Employee Permission Guards Fail Open on Any Async Error
**File:** `backend/src/middleware/auth.middleware.ts:182, 253`
**Current state:**
```typescript
// checkExitAccess
}).catch(() => next()); // On error, allow through (fail-open for exit check)

// checkEmployeePermissions
}).catch(() => next());
```
**Risk:** Both middleware functions enforce access control for terminated/exiting employees and feature-restricted employees. On any database or Redis error, they silently allow the request through. A terminated employee who should be locked out of payroll can access it if the DB is briefly slow or erroring. This is a fail-open security control — the opposite of what access control should do for high-sensitivity data.

**Fix:** `checkExitAccess` must fail closed. On a catch, return 503:
```typescript
}).catch(() => next(new AppError('Access control temporarily unavailable', 503, 'SERVICE_UNAVAILABLE')));
```
`checkEmployeePermissions` can fail open since it controls features rather than fundamental termination access, but this should be documented explicitly in a comment so future maintainers understand the intentional asymmetry.

---

### HIGH-05 — Password Reset and Forgot-Password Share the Permissive General Auth Rate Limit
**File:** `backend/src/modules/auth/auth.routes.ts:10-11`, `backend/src/app.ts:78`
**Current state:** `/api/auth/forgot-password` and `/api/auth/reset-password` fall under `app.use('/api/auth', rateLimiter({ max: 200 }))` — 200 requests per 15 minutes per IP.

**Risk:** (1) At 200 req/15 min for forgot-password, an attacker can enumerate valid email addresses at scale. Even though the response text is identical for found/not-found, timing differences in the database query make this feasible with 200 attempts. (2) Reset token space: tokens are 32 random bytes (256 bits) — unguessable, but the liberal rate limit does not protect against other issues. (3) Flooding an inbox with 200 reset emails in 15 minutes is a denial-of-service on a specific user.

**Fix:** Add dedicated limits before the general `/api/auth` handler (order matters — Express matches first):
```typescript
app.use('/api/auth/forgot-password',
  rateLimiter({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: 'rl:forgot' }));
app.use('/api/auth/reset-password',
  rateLimiter({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'rl:reset' }));
```

---

### HIGH-06 — `trust proxy` Not Set; Rate Limiting Keyed to Nginx's IP in Production
**File:** `backend/src/middleware/rateLimiter.ts:17`, `backend/src/app.ts`
**Current state:**
```typescript
const ip = req.ip || req.socket.remoteAddress || 'unknown';
```
`app.set('trust proxy', ...)` is absent from `app.ts`. The production deployment uses Nginx as a reverse proxy.

**Risk:** Without `trust proxy`, Express populates `req.ip` with the IP of the immediately-connected socket — which is `127.0.0.1` (Nginx on localhost) for every single request. All clients share one rate-limit bucket keyed to `127.0.0.1`. This means: (a) a single legitimate user making normal requests can trip the rate limit for the entire organization, (b) an attacker making 100 requests per minute is indistinguishable from a legitimate user making 1 request, and (c) the rate limiter provides zero protection against DDoS or brute-force from external IPs.

**Fix:** Add `app.set('trust proxy', 1)` to `app.ts`, immediately after `const app = express()`. This tells Express to read `req.ip` from `X-Forwarded-For` set by Nginx (trusting exactly one hop). Verify that the Nginx config sets `proxy_set_header X-Forwarded-For $remote_addr;`.

---

## MEDIUM Findings

### MED-01 — Salary Slip PDF Download Route Has No Middleware-Level Authorization
**File:** `backend/src/modules/payroll/payroll.routes.ts:115-117`
**Current state:**
```typescript
router.get('/records/:id/pdf',
  (req, res, next) => payrollController.downloadSalarySlip(req, res, next)
);
```
Every other sensitive payroll route has `authorize()` or `requirePermission()` as middleware. This route has only `authenticate` (inherited from `router.use(authenticate)`) and relies entirely on a controller-level check.

**Risk:** The controller's check (`record.employeeId !== req.user!.employeeId`) is correct but is the sole guard. If this check is ever accidentally removed or refactored incorrectly during a future update, there is no middleware-level safety net. Defense-in-depth requires the protection to exist at the routing layer independently of the business logic layer.

**Fix:** Add `requirePermission('payroll', 'read')` as route-level middleware and keep the ownership check in the controller as the second line of defense:
```typescript
router.get('/records/:id/pdf',
  requirePermission('payroll', 'read'),
  (req, res, next) => payrollController.downloadSalarySlip(req, res, next)
);
```

---

### MED-02 — No Maker-Checker on Payroll Run Creation and Processing
**File:** `backend/src/modules/payroll/payroll.routes.ts:52-60`
**Current state:** The same `HR` role user can `POST /payroll/runs` (create a run) and immediately `POST /payroll/runs/:id/process` (execute it). No second approval is required.

**Risk:** A compromised or malicious HR account can create a fraudulent payroll run (e.g., with inflated salary structures committed just prior) and process it immediately in a single session, before any manager or admin can review. In Indian payroll processing, once a run is processed and salaries are disbursed, reversal is operationally costly and may be legally contested.

**Fix:** Store `createdByUserId` on `PayrollRun` and enforce that the user who processes it (`POST /runs/:id/process`) is different from the user who created it. Alternatively, require `SUPER_ADMIN` or `ADMIN` role to process (HR can create but not finalize). Add an audit log entry on every `process` call that includes both the creator and processor user IDs for non-repudiation.

---

### MED-03 — Docker Compose Has a Hardcoded Fallback PostgreSQL Password
**File:** `docker/docker-compose.yml:10`
**Current state:**
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-aniston_hrms_2026}
```
The default fallback `aniston_hrms_2026` is committed to the repository.

**Risk:** Any developer who clones the repo and runs `docker compose up` without setting `POSTGRES_PASSWORD` gets a database running with a password visible to anyone with repository read access. The postgres port is bound to all interfaces (`5432:5432`, not `127.0.0.1:5432:5432`), meaning the database is reachable from the network if the developer's firewall is permissive. This is a common misconfiguration in corporate development environments.

**Fix:**
1. Remove the fallback: `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}`.
2. Bind the port to localhost: `"127.0.0.1:5432:5432"`.
3. Same treatment for `REDIS_URL` and AI service API key.

---

### MED-04 — Redis Has No Password Authentication
**File:** `docker/docker-compose.yml:20-27`, `backend/src/config/env.ts:13`
**Current state:** The Redis service has no `requirepass` or `--requirepass` directive. `REDIS_URL` defaults to `redis://localhost:6379` (no credentials).

**Risk:** Redis stores: refresh tokens (account takeover), password reset tokens (account takeover), rate limit counters (delete to bypass), exit access configs (delete to unlock terminated employees), employee permission configs, and AI conversation histories. Any process on the Docker network can read/write/delete all of this without authentication. In the Docker Compose network, the AI service container has unrestricted access to Redis.

**Fix:**
```yaml
# docker-compose.yml
redis:
  command: redis-server --requirepass ${REDIS_PASSWORD:?REDIS_PASSWORD must be set}
```
Add `REDIS_PASSWORD` to the env schema (required). Update `REDIS_URL` to `redis://:${REDIS_PASSWORD}@localhost:6379`.

---

### MED-05 — Zod Schemas Do Not Use `.strict()` on Mutation Endpoints
**File:** All `*.validation.ts` files (zero matches found for `.strict()` across the entire backend)
**Current state:** All Zod object schemas use `.object({})` without `.strict()`. Zod's default is to strip unknown keys on `.parse()`. This is safe when the parsed result is the only thing passed to Prisma.

**Risk:** The risk is not in current code but in future code: any developer who writes `prisma.employee.update({ data: req.body })` instead of `prisma.employee.update({ data: validatedData })` — a common mistake under time pressure — bypasses validation entirely. `.strict()` on mutation schemas would cause validation to fail on extra fields, forcing developers to be explicit about what is accepted. Without it, the codebase's correctness depends entirely on every contributor always using the parsed output.

**Fix:** Add `.strict()` to all POST and PATCH request body schemas:
```typescript
export const createEmployeeSchema = z.object({ ... }).strict();
export const updateEmployeeSchema = createEmployeeSchema.partial().strict();
```
List endpoints (GET queries) can remain without `.strict()` since extra query params are harmless.

---

### MED-06 — Password Reset Token Logged to Console in Development Mode
**File:** `backend/src/modules/auth/auth.service.ts:183`
**Current state:**
```typescript
if (process.env.NODE_ENV === 'development') {
  console.log(`[DEV] Password reset token for ${email}: ${resetToken}`);
}
```
**Risk:** (1) If `NODE_ENV=development` is accidentally set on staging or production, this token — a full account takeover credential valid for 1 hour — is written to stdout. (2) Docker logs, PM2 logs, or any log aggregator capturing stdout will store this token. If those logs are ever exported to a third-party service (Datadog, CloudWatch, Logtail), account takeover tokens are exfiltrated. (3) Even in development, token-bearing logs should not exist.

**Fix:** Remove this line entirely. Use a local SMTP trap (Mailhog at `http://localhost:8025` or Mailtrap) so the reset email is sent and visible without logging credentials. Update the dev setup documentation accordingly.

---

### MED-07 — Unvalidated Client-Supplied `X-Request-Id` Header
**File:** `backend/src/middleware/requestLogger.ts:6`
**Current state:**
```typescript
const requestId = (req.headers['x-request-id'] as string) || randomUUID();
```
No length or format validation. The client can supply any string.

**Risk:** Log injection: a client sets `X-Request-Id: foo\nERROR: Fake log line`. Structured logging systems that process newlines in log fields (particularly JSON log pipelines that encounter raw-string fields) can be tricked into creating fabricated log entries. A sophisticated attacker can inject fake audit events into the log stream to obscure real malicious activity. Additionally, an arbitrarily long header wastes memory.

**Fix:**
```typescript
const clientId = req.headers['x-request-id'] as string | undefined;
const requestId = (clientId && /^[a-zA-Z0-9\-_]{1,64}$/.test(clientId))
  ? clientId
  : randomUUID();
```

---

## LOW Findings

### LOW-01 — Upload Files Served Under Two Redundant URL Prefixes
**File:** `backend/src/app.ts:171-174`
**Current state:** Files are reachable at both `/uploads/...` and `/api/uploads/...` (four static middleware registrations). The `/uploads/` prefix does not include `/api/` and therefore sits outside any future middleware applied uniformly to `/api/` routes.

**Risk:** Low risk currently since both paths enforce `authenticate`. However, having two URL paths for the same physical files creates confusion about which URL is canonical, and the non-`/api/` path bypasses any future rate limiting or access logging that targets only `/api/` routes.

**Fix:** Remove the `/uploads/` and `/api/uploads/` fallback routes. Serve all files exclusively at `/api/uploads/` with a single `express.static` pointing to the correct base directory. Update all `fileUrl` values stored in the database to use the canonical prefix.

---

### LOW-02 — Audit Log Entries Are Permanently Deleted on Employee Hard-Delete
**File:** `backend/src/modules/employee/employee.service.ts:534`
**Current state:**
```typescript
{ name: 'AuditLog(user)', fn: () => tx.auditLog.deleteMany({ where: { userId: existing.userId! } }) },
```
When an employee is hard-deleted, all their audit log entries are deleted atomically in the same transaction.

**Risk:** An admin can permanently erase the complete audit trail of an employee's actions — payroll changes approved, documents accessed, settings modified — by triggering a hard delete. This violates the principle of audit log immutability and may conflict with Indian labour law requirements for record retention (minimum 3 years under various statutes including EPF Act, Payment of Wages Act, and Income Tax Act). It also undermines non-repudiation: a malicious actor with admin access can cover their tracks.

**Fix:** Never delete `AuditLog` records. Instead, anonymize them: replace PII fields with a tombstone (e.g., `userId = 'DELETED-${hash}'`, `ipAddress = null`) and mark with `anonymizedAt = now()`. Add a `deletedAt` column to `AuditLog` for the GDPR right-to-erasure case, and implement anonymization rather than deletion. Retain for at least 7 years.

---

### LOW-03 — Agent Downloads Served Without Any Authentication
**File:** `backend/src/app.ts:170`
**Current state:**
```typescript
app.use('/uploads/agent', express.static(path.join(uploadsBase, 'uploads', 'agent')));
```
The entire `uploads/agent/` directory is publicly accessible without authentication.

**Risk:** Any file placed in `uploads/agent/` — accidentally or maliciously — is publicly downloadable. There is no listing protection (Express static's `index` option is off by default, but file names are often guessable). A supply chain attack that modifies the agent installer in this directory would affect any user who downloads it.

**Fix:** Either: (1) restrict by filename allowlist (only serve known installer filenames); or (2) issue short-lived signed download URLs via an authenticated endpoint (`GET /api/agent/download-url` returns an HMAC-signed URL valid for 5 minutes), then serve the file only if the HMAC is valid. This ensures only authenticated employees receive agent installers.

---

### LOW-04 — Hardcoded `localhost:5174` as CORS Origin in Development
**File:** `backend/src/app.ts:55`
**Current state:**
```typescript
origin: env.NODE_ENV === 'development'
  ? [env.FRONTEND_URL, 'http://localhost:5173', 'http://localhost:5174']
  : ...
```
**Risk:** Low risk for a local development environment. The risk is that `NODE_ENV=development` on an accidentally internet-accessible staging server would allow cross-origin requests from `localhost:5173` and `localhost:5174` — which resolves to the requesting client's own `localhost`. In a browser, `localhost` on the client is the client's machine, not the server, so this is less dangerous than it appears, but it is sloppy and should be cleaned up.

**Fix:** Source the development CORS origins from environment variables (`ADDITIONAL_CORS_ORIGINS`) rather than hardcoding port numbers. Enforce `NODE_ENV=production` via PM2 ecosystem config for all deployed environments.

---

### LOW-05 — `keys.txt` Listed in `.gitignore` — Verify It Was Never Committed
**File:** `.gitignore:78`
**Current state:**
```
keys.txt
```
The presence of this entry implies a file named `keys.txt` existed (or exists) on at least one developer's machine and was at risk of being committed.

**Risk:** If `keys.txt` was ever committed before the `.gitignore` entry was added, its contents (likely production API keys, JWT secrets, or `ENCRYPTION_KEY`) are permanently in git history, recoverable by anyone with repository access via `git log --all -p -- keys.txt`.

**Fix:**
1. Run `git log --all --full-history -- keys.txt` to check if it was ever committed.
2. If it was: rotate all secrets immediately. Use `git filter-repo --path keys.txt --invert-paths` to purge the file from history and force-push. Notify all repository collaborators to re-clone.
3. Going forward: store all secrets in a secrets manager (AWS Secrets Manager, 1Password Secrets Automation, or HashiCorp Vault) rather than any local file.

---

## Summary Table

| ID | Severity | File | Issue |
|----|----------|------|-------|
| CRIT-01 | CRITICAL | `backend/src/config/env.ts:16` | ENCRYPTION_KEY is `.optional()` — server starts without it in any environment |
| CRIT-02 | CRITICAL | `backend/src/utils/encryption.ts:71` | Legacy hardcoded salt committed to source — all legacy PII ciphertexts share one salt |
| CRIT-03 | CRITICAL | `backend/src/middleware/upload.middleware.ts:103` | Walk-in upload filename not randomized; `folderName` allows path traversal |
| CRIT-04 | CRITICAL | `.github/workflows/deploy.yml:108` | `prisma db push` in production — no migration history, irreversible data loss risk |
| HIGH-01 | HIGH | `backend/src/middleware/upload.middleware.ts:31` | No magic-byte verification — MIME type and extension are client-controlled only |
| HIGH-02 | HIGH | `backend/src/middleware/upload.middleware.ts:90` | `uploadAny` exported with no type filter and 50 MB limit |
| HIGH-03 | HIGH | `backend/src/middleware/rateLimiter.ts:34` | Rate limiter fails open when Redis is unavailable |
| HIGH-04 | HIGH | `backend/src/middleware/auth.middleware.ts:182,253` | Exit access and permission middleware fail open on any async error |
| HIGH-05 | HIGH | `backend/src/modules/auth/auth.routes.ts:10` | Forgot/reset password share permissive 200 req/15 min general auth limit |
| HIGH-06 | HIGH | `backend/src/app.ts` + `rateLimiter.ts:17` | No `trust proxy` — all clients share one rate-limit bucket behind Nginx |
| MED-01 | MEDIUM | `backend/src/modules/payroll/payroll.routes.ts:115` | Salary slip PDF route has no middleware-level permission guard |
| MED-02 | MEDIUM | `backend/src/modules/payroll/payroll.routes.ts:52-60` | No maker-checker on payroll run creation vs. processing |
| MED-03 | MEDIUM | `docker/docker-compose.yml:10` | Hardcoded fallback Postgres password `aniston_hrms_2026` in repository |
| MED-04 | MEDIUM | `docker/docker-compose.yml:20` | Redis has no password — all secrets stored in Redis are accessible without auth |
| MED-05 | MEDIUM | All `*.validation.ts` | No `.strict()` on Zod schemas — mass assignment risk on developer error |
| MED-06 | MEDIUM | `backend/src/modules/auth/auth.service.ts:183` | Password reset token printed to console — captured by log aggregators |
| MED-07 | MEDIUM | `backend/src/middleware/requestLogger.ts:6` | Unvalidated client `X-Request-Id` header — log injection risk |
| LOW-01 | LOW | `backend/src/app.ts:171` | Upload files served at two URL prefixes — `/uploads/` and `/api/uploads/` |
| LOW-02 | LOW | `backend/src/modules/employee/employee.service.ts:534` | Audit log entries deleted on employee hard-delete — no immutability |
| LOW-03 | LOW | `backend/src/app.ts:170` | Agent installer downloads served without authentication |
| LOW-04 | LOW | `backend/src/app.ts:55` | `localhost:5174` hardcoded as CORS origin for development |
| LOW-05 | LOW | `.gitignore:78` | `keys.txt` gitignore entry — verify plaintext secrets never committed to history |

---

## Positive Security Controls Confirmed

The following areas were reviewed and found to be correctly implemented. No changes needed.

| Control | Location | Status |
|---------|----------|--------|
| JWT access token expiry = 15 min | `env.ts:17`, `auth.service.ts:314` | PASS |
| Refresh token in httpOnly, sameSite=strict, secure cookie | `auth.controller.ts:13-18` | PASS |
| Refresh token rotation on every use | `auth.service.ts:157-162` | PASS |
| bcrypt with 12 rounds | `auth.service.ts:195,226` | PASS |
| AES-256-GCM with random IV and random salt (new format) | `encryption.ts:37-48` | PASS |
| Helmet middleware applied globally | `app.ts:52` | PASS |
| CORS restricted to FRONTEND_URL and hr.anistonav.com in production | `app.ts:53-60` | PASS |
| Error handler suppresses stack traces in production | `errorHandler.ts:183-186` | PASS |
| Prisma errors return generic messages — no schema details leaked | `errorHandler.ts:122-174` | PASS |
| `express.json({ limit: '10mb' })` applied globally | `app.ts:63` | PASS |
| Docker image runs as non-root user | `Dockerfile:31,49` | PASS |
| Multi-stage Docker build — no build tools in production layer | `Dockerfile:1-50` | PASS |
| `.env` and `uploads/` in `.gitignore` | `.gitignore:19,56` | PASS |
| `organizationId` scoped in all Prisma queries (payroll, employee, settings) | Multiple services | PASS |
| Password reset response is constant for found/not-found emails | `auth.service.ts:174-186` | PASS |
| Employee salary slip restricted to owner or management roles | `payroll.controller.ts:62-65` | PASS |
| Salary visibility rules gated to `SUPER_ADMIN` only | `payroll.routes.ts:234-247` | PASS |
| Payroll audit logging on all mutation operations (6 call sites) | `payroll.service.ts:372,436,560,766,842,872` | PASS |
| Request ID middleware generates UUID when client omits header | `requestLogger.ts:6` | PASS (format validation still needed) |
| Pagination limit capped at 100 in employee query schema | `employee.validation.ts:51` | PASS |
| AES-256-GCM used for AI API key storage | `ai-config.service.ts:3` | PASS |
| Walk-in and public routes have dedicated tighter rate limits | `app.ts:72-76` | PASS |

---

## Remediation Priority

### Immediate — Before Next Production Deployment

1. **CRIT-01** — Add `ENCRYPTION_KEY` as a required field in `env.ts`. One line change, zero risk, prevents future encryption failures.
2. **CRIT-04** — Switch `deploy.yml` from `prisma db push` to `prisma migrate deploy`. Requires baselining first (one-time operation).
3. **HIGH-06** — Add `app.set('trust proxy', 1)` to `app.ts`. One line change, restores rate limiting to effective operation in production immediately.
4. **MED-03** — Remove the hardcoded `aniston_hrms_2026` fallback from `docker-compose.yml`.
5. **MED-04** — Add Redis `requirepass` to `docker-compose.yml` and corresponding env variable.

### Within 1 Sprint

6. **CRIT-02** — Write and run the PII migration script to re-encrypt legacy-format ciphertexts.
7. **CRIT-03** — Randomize walk-in upload filenames; validate and contain `folderName`.
8. **HIGH-01** — Add `file-type` magic-byte check after file is written to disk.
9. **HIGH-03** — Implement in-memory fallback rate limiter; fail closed on auth routes when Redis is down.
10. **HIGH-04** — `checkExitAccess` to fail closed (503) on async error.
11. **HIGH-05** — Add dedicated 5 req/15 min limit for `forgot-password` and `reset-password`.
12. **MED-06** — Delete the password reset token `console.log`.

### Within 2 Sprints

13. **HIGH-02** — Delete or restrict the `uploadAny` export.
14. **MED-01** — Add `requirePermission('payroll', 'read')` to the salary slip PDF route.
15. **MED-02** — Implement maker-checker: block the payroll run creator from processing the same run.
16. **MED-05** — Add `.strict()` to all POST and PATCH Zod schemas.
17. **MED-07** — Validate `X-Request-Id` header format and length.
18. **LOW-02** — Replace audit log deletion with anonymization on employee hard-delete.
19. **LOW-05** — Check git history for `keys.txt`; rotate if found.
20. **LOW-01**, **LOW-03**, **LOW-04** — Housekeeping: consolidate upload routes, restrict agent downloads, clean up CORS.
