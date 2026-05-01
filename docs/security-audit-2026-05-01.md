# Security Audit Report — Aniston HRMS
**Date:** 2026-05-01  
**Auditor:** Automated Security Auditor (Claude Sonnet 4.6)  
**Scope:** Full codebase — backend, frontend, infrastructure, CI/CD  
**Repository:** Anistonworkspace/Aniston-HRMS

---

## ⛔ DEPLOYMENT BLOCKED — 3 CRITICAL findings must be resolved before next production deploy

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 3 |
| HIGH     | 5 |
| MEDIUM   | 6 |
| LOW      | 5 |
| INFO     | 4 |
| **Total**| **23** |

---

## Findings

---

### [CRITICAL-1] Hardcoded AES Encryption Key in Git Repository

**File:** `.github/workflows/deploy.yml:249`  
**CVSS Score:** 9.8 (Critical)

**Description:**  
The AES-256-GCM key used to encrypt all Aadhaar numbers, PAN numbers, bank account numbers, and AI API keys at rest is hardcoded in plaintext in the CI/CD workflow file — which is committed to the git repository. Anyone with read access to the repo (public, collaborators, or anyone who has ever cloned it) can decrypt every piece of sensitive employee PII in the production database immediately. This completely defeats encryption at rest.

**Evidence:**
```yaml
grep -q 'ENCRYPTION_KEY=' .env || echo 'ENCRYPTION_KEY=30f3a3cf6ce04631c122256f5656c70c69429d380ae91c8de9d5f8e05c4a0cf2' >> .env
```

**Impact:** Full decryption of all Aadhaar, PAN, bank account numbers, and AI API keys stored in the database.

**Remediation:**
1. Remove the hardcoded key from the workflow immediately
2. Store as a GitHub Actions secret: `secrets.ENCRYPTION_KEY`
3. Inject it in the workflow: `echo "ENCRYPTION_KEY=${{ secrets.ENCRYPTION_KEY }}" >> .env`
4. **Rotate the key immediately** — decrypt all encrypted fields and re-encrypt with a new key  
5. Treat the current key as fully compromised — assume all encrypted data has been read

---

### [CRITICAL-2] Redis Has No Authentication — Full Session/Token Exposure

**File:** `docker/docker-compose.yml:20-28`  
**CVSS Score:** 9.1 (Critical)

**Description:**  
The Redis container runs with no password (`requirepass`) or ACL configuration, bound to all interfaces (`0.0.0.0`). Redis stores: refresh tokens (session credentials), password reset tokens, MFA state, **decrypted plaintext AI API keys** (OpenAI, Anthropic, DeepSeek), rate limiter counters. Any process on the host or Docker network can read, forge, or delete all of these without authentication.

**Evidence:**
```yaml
redis:
  image: redis:7-alpine
  ports:
    - "6379:6379"
  # No requirepass, no ACL, no bind to 127.0.0.1
```

**Impact:** Session hijacking, token forgery, AI API key theft, rate limit bypass.

**Remediation:**
```yaml
redis:
  command: redis-server --requirepass "${REDIS_PASSWORD}"
  ports:
    - "127.0.0.1:6379:6379"
```
Set `REDIS_URL=redis://:${REDIS_PASSWORD}@localhost:6379` in `.env`. In production, use TLS (`rediss://`) if Redis is on a separate host.

---

### [CRITICAL-3] JWT Access Token Stored in localStorage — XSS-Accessible

**File:** `frontend/src/features/auth/authSlice.ts:10-32`  
**CVSS Score:** 8.8 (Critical)

**Description:**  
The JWT access token is persisted to `localStorage` and restored on every page load. `localStorage` is readable by any JavaScript on the page origin. A single XSS vulnerability in any dependency or injected content can silently exfiltrate the token and allow indefinite session impersonation against the HRMS backend — which stores Aadhaar numbers, payroll data, and documents for all employees.

**Evidence:**
```typescript
const persistedToken = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
// ...
try { localStorage.setItem('accessToken', action.payload.accessToken); } catch {}
```

**Impact:** Persistent session hijack via any XSS in any dependency.

**Remediation:**  
Move the access token to **in-memory Redux state only** (no localStorage persistence). The refresh token is already in an httpOnly cookie — the existing 401 re-hydration flow in `api.ts` will recover the access token on page reload. Remove both `localStorage.getItem` and `localStorage.setItem` calls:
```typescript
// Remove these lines:
const persistedToken = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
localStorage.setItem('accessToken', action.payload.accessToken);
```

---

### [HIGH-1] SSRF via User-Controlled Task Integration `baseUrl`

**File:** `backend/src/modules/task-integration/task-integration.service.ts:354, 363, 426, 460, 486`  
**CVSS Score:** 8.1 (High)

**Description:**  
The `baseUrl` field for JIRA and CUSTOM task integrations is taken from user input, stored in the database, and used directly as the target for outbound `fetch()` calls with no scheme validation, hostname allowlist, or private IP blocking. An ADMIN-role user can set `baseUrl` to internal network addresses (AWS IMDS `169.254.169.254`, `localhost:5432`, etc.) to probe internal services.

**Evidence:**
```typescript
const res = await fetch(`${baseUrl}/rest/api/3/search?jql=...`, { headers });
const res = await fetch(`${baseUrl}/api/external/employees/${externalUserId}`, { headers });
```

**Remediation:**
```typescript
function assertSafeBaseUrl(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new BadRequestError('baseUrl must use https');
  const host = parsed.hostname;
  if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|localhost$)/.test(host))
    throw new BadRequestError('baseUrl cannot point to internal networks');
}
```
Call `assertSafeBaseUrl(baseUrl)` before persisting to the database.

---

### [HIGH-2] IDOR on KYC Submit — Any Employee Can Submit Another Employee's KYC

**File:** `backend/src/modules/onboarding/onboarding.routes.ts:384-392`  
**CVSS Score:** 7.5 (High)

**Description:**  
`POST /kyc/:employeeId/submit` requires authentication but has **no ownership check**. Any authenticated employee who knows another employee's UUID can submit KYC on their behalf, advancing that employee's gate to `SUBMITTED` even if their documents are incomplete — bypassing the submission guard.

**Evidence:**
```typescript
router.post('/kyc/:employeeId/submit', authenticate,
  async (req, res, next) => {
    // No check: is req.user.employeeId === req.params.employeeId ?
    const gate = await documentGateService.submitKyc(req.params.employeeId);
```

**Remediation:**
```typescript
const isManagement = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(req.user!.role);
if (!isManagement && req.user!.employeeId !== req.params.employeeId) {
  return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
}
```

---

### [HIGH-3] IDOR on KYC Photo Upload — Any Employee Can Overwrite Another's Photo

**File:** `backend/src/modules/onboarding/onboarding.routes.ts:332-361`  
**CVSS Score:** 7.5 (High)

**Description:**  
`POST /kyc/:employeeId/photo-upload` has authentication but no ownership check. Any authenticated employee can upload a photo to any other employee's KYC record, overwriting the legitimate photo with a fraudulent one. This directly undermines face-comparison anti-impersonation controls. (The `/photo` endpoint at line 274 correctly has this check — the `/photo-upload` variant does not.)

**Evidence:**
```typescript
router.post('/kyc/:employeeId/photo-upload', authenticate,
  async (req, res, next) => {
    const employeeId = req.params.employeeId;
    // Missing: ownership / management role check
    const kycUpload = createEmployeeKycUpload(employeeId);
```

**Remediation:** Apply the same guard as the `/photo` route:
```typescript
const isManagement = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(req.user!.role);
if (!isManagement && req.user!.employeeId !== employeeId) {
  return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
}
```

---

### [HIGH-4] No Security Headers on Frontend (Nginx) — Clickjacking / MIME Sniffing

**File:** `deploy/nginx.conf`  
**CVSS Score:** 7.1 (High)

**Description:**  
Nginx serves the React frontend with no `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, or `Permissions-Policy` headers. Helmet.js provides these for `/api/*` routes only. The frontend routes (`/`, `/assets/`) are completely unprotected: users can be clickjacked in iframes, the browser will MIME-sniff responses, and there is no CSP to restrict script sources.

**Evidence:** No `add_header Content-Security-Policy`, `add_header X-Frame-Options`, or `add_header X-Content-Type-Options` directive exists in the frontend `location` blocks of `nginx.conf`.

**Remediation:** Add to the main `server {}` block in `nginx.conf`:
```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(self)" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss://hr.anistonav.com; object-src 'none'; frame-ancestors 'self';" always;
```

---

### [HIGH-5] Email Attachment Upload Accepts Any File Type — Malware Upload

**File:** `backend/src/middleware/upload.middleware.ts:329-334`  
**CVSS Score:** 7.3 (High)

**Description:**  
The `uploadEmailAttachment` multer instance uses `anyFileFilter` which accepts every file type without restriction. HR can upload `.exe`, `.js`, `.ps1`, `.bat` files as email attachments. These are stored on disk and sent to employees who may execute them, trusting the source is legitimate HR communication.

**Evidence:**
```typescript
const anyFileFilter = (_req: any, _file: Express.Multer.File, cb: multer.FileFilterCallback) => 
  cb(null, true);  // No type checking

export const uploadEmailAttachment = multer({
  fileFilter: anyFileFilter,  // Accepts everything
  limits: { fileSize: 10 * 1024 * 1024 },
});
```

**Remediation:** Replace with a strict allowlist:
```typescript
const attachmentFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) =>
  validateFileType(file,
    ['application/pdf', 'image/jpeg', 'image/png',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['.pdf', '.jpg', '.jpeg', '.png', '.xlsx', '.docx'],
    'Only PDF, images, Excel, and Word documents are allowed', cb);
```

---

### [MEDIUM-1] Rate Limiter Fails Open on Redis Outage — Brute Force Window

**File:** `backend/src/middleware/rateLimiter.ts:35-38`

**Description:**  
When Redis is unavailable the rate limiter catches the error and calls `next()`, allowing all requests through. An attacker who triggers a Redis outage (DoS on port 6379) then has an unlimited window to brute-force login credentials.

**Evidence:**
```typescript
} catch {
  next(); // If Redis is down, allow the request
}
```

**Remediation:** Fail closed for auth endpoints:
```typescript
} catch {
  if (req.path.includes('/auth/login') || req.path.includes('/auth/mfa')) {
    return next(new AppError('Service temporarily unavailable', 503, 'SERVICE_UNAVAILABLE'));
  }
  next();
}
```

---

### [MEDIUM-2] Decrypted AI API Keys Cached in Redis in Plaintext for 1 Hour

**File:** `backend/src/modules/ai-config/ai-config.service.ts:383-385`

**Description:**  
`getActiveConfigRaw()` decrypts the AI provider API key and caches the **plaintext key** in Redis for 1 hour. Since Redis has no authentication (CRITICAL-2), anyone who can connect to Redis reads production OpenAI/Anthropic/DeepSeek API keys directly.

**Evidence:**
```typescript
// Caches { apiKey: '<decrypted plaintext>', provider, ... } for 3600 seconds
await redis.setex(`${CACHE_KEY_PREFIX}${organizationId}`, CACHE_TTL, JSON.stringify(raw));
```

**Remediation:** Cache only metadata (provider, model), not the key itself. Decrypt on each call — the database round-trip is negligible compared to AI API latency. This finding is also resolved by fixing CRITICAL-2.

---

### [MEDIUM-3] Cross-Tenant IDOR on `GET /documents/:id`

**File:** `backend/src/modules/document/document.service.ts:48-57`

**Description:**  
`getById(id)` queries documents by ID alone with no `organizationId` filter. An HR user from Organization A who knows a document UUID belonging to Organization B can retrieve it via `GET /documents/:id`.

**Evidence:**
```typescript
const doc = await prisma.document.findUnique({
  where: { id },  // No organizationId scoping
});
```

**Remediation:**
```typescript
async getById(id: string, organizationId: string) {
  return prisma.document.findFirst({
    where: { id, employee: { organizationId }, deletedAt: null },
    ...
  });
}
```

---

### [MEDIUM-4] Bulk KYC Verify Has No Per-Employee Organization Scope Check

**File:** `backend/src/modules/onboarding/onboarding.routes.ts:1638-1666`

**Description:**  
`POST /kyc/bulk-verify` calls `verifyKyc()` for each `employeeId` in the request body without first confirming all IDs belong to the caller's organization. An HR user could verify KYC records for employees in other organizations by supplying cross-org UUIDs.

**Remediation:** Add a pre-flight org ownership check:
```typescript
const valid = await prisma.employee.findMany({
  where: { id: { in: employeeIds }, organizationId: req.user!.organizationId },
  select: { id: true },
});
const validIds = new Set(valid.map(e => e.id));
// Only process IDs in validIds
```

---

### [MEDIUM-5] AI Service (FastAPI) Port 8000 Exposed Without Authentication

**File:** `docker/docker-compose.yml:43-46`, `.github/workflows/deploy.yml:326`

**Description:**  
The Python AI service publishes port `8000` on all interfaces. The deploy script explicitly sets `AI_SERVICE_API_KEY=` (empty string), disabling the Python API key guard. Any internet-accessible machine can POST arbitrary documents to the OCR endpoint, using your OpenAI quota and receiving OCR results.

**Evidence:**
```bash
echo 'AI_SERVICE_API_KEY=' >> .env  # Disables auth guard in Python
```
```yaml
ai-service:
  ports:
    - "8000:8000"  # Exposed to internet
```

**Remediation:** Remove the `8000:8000` port mapping entirely. Connect via Docker internal DNS: `AI_SERVICE_URL=http://aniston-ai-service:8000`. If local debug access is needed: `127.0.0.1:8000:8000`.

---

### [MEDIUM-6] MIME Type Bypass via `application/octet-stream` — Extension-Only Fallback

**File:** `backend/src/middleware/upload.middleware.ts:44-48`

**Description:**  
File upload validation accepts `application/octet-stream` and falls back to extension-only checking. An attacker can rename an executable to `document.pdf` and upload it — the MIME check passes (octet-stream is allowed), and the extension check passes (`.pdf`). The file content is never inspected.

**Evidence:**
```typescript
const mimeOk = allowedMimes.includes(file.mimetype) || file.mimetype === 'application/octet-stream';
const extOk = allowedExts.includes(ext);
if (mimeOk && extOk) { cb(null, true); }
```

**Remediation:** After saving the file, use `file-type` npm package to inspect magic bytes and reject if they don't match the claimed extension:
```typescript
import { fileTypeFromFile } from 'file-type';
const detected = await fileTypeFromFile(savedPath);
if (!allowedMimes.includes(detected?.mime ?? '')) { unlink(savedPath); throw new BadRequestError('...'); }
```

---

### [LOW-1] `prisma db push --accept-data-loss` Used in Production Deploy

**File:** `.github/workflows/deploy.yml:292`

**Description:**  
The production CI/CD pipeline runs `prisma db push --accept-data-loss`. Prisma's own documentation warns this can silently drop columns and data. The project's own `database.md` rules prohibit this in production. A schema change that renames or removes a column will silently delete that column's data in production.

**Evidence:**
```bash
npx --no-install prisma db push --accept-data-loss
```

**Remediation:** Replace with `prisma migrate deploy` which applies versioned, reviewed migration files that never silently drop data.

---

### [LOW-2] Nginx Exposes Raw EC2 IP Without TLS Enforcement

**File:** `deploy/nginx.conf:2`

**Description:**  
`server_name` includes the raw EC2 IP `13.126.128.38`. The HTTP-to-HTTPS redirect only covers `hr.anistonav.com`, not the raw IP. Direct IP requests bypass TLS enforcement.

**Evidence:**
```nginx
server_name hr.anistonav.com 13.126.128.38;
```

**Remediation:** Remove the IP from `server_name`. Add a catch-all block to drop direct IP connections:
```nginx
server {
    listen 80 default_server;
    server_name _;
    return 444;
}
```

---

### [LOW-3] Legacy Hardcoded Salt in Encryption Fallback Path

**File:** `backend/src/utils/encryption.ts:70-72`

**Description:**  
The `decrypt()` function has a legacy 3-part ciphertext branch that uses the hardcoded constant `'aniston-hrms-salt'` as the KDF salt. A constant salt negates the security benefit of key derivation — any attacker who obtains `ENCRYPTION_KEY` can immediately derive the decryption key without needing to read the salt from the ciphertext.

**Evidence:**
```typescript
} else if (parts.length === 3) {
  salt = Buffer.from('aniston-hrms-salt'); // Hardcoded constant
}
```

**Remediation:** Migrate all legacy-encrypted records to the new format with random salts, then remove the 3-part branch from `decrypt()`.

---

### [LOW-4] `console.error` in Production Route Handlers — Unstructured PII Log Risk

**File:** `backend/src/modules/onboarding/onboarding.routes.ts:305, 357`

**Description:**  
`console.error` calls in production route handlers bypass the structured `logger` and may include request context in monitoring systems or log aggregators in unstructured form.

**Evidence:**
```typescript
console.error('[KYC Photo] Upload error:', innerErr);
console.error('[KYC Photo Upload] Error:', innerErr);
```

**Remediation:** Replace with `logger.error(...)` from `../../lib/logger.js`.

---

### [LOW-5] MFA Temp Token Not IP-Bound — Interception Risk

**File:** `backend/src/modules/auth/auth.service.ts:84-106`

**Description:**  
The 5-minute MFA `tempToken` is not bound to the originating IP. An intercepted `tempToken` can be completed from a different device.

**Remediation:** Bind `tempToken` to `req.ip` at issuance. Reject MFA completion if client IP differs.

---

## Info (No Action Required)

| # | Finding | Verdict |
|---|---------|---------|
| 1 | bcrypt rounds = 12 | Meets minimum — consider 14 for 2026 hardware |
| 2 | JWT access token TTL = 15 min | Compliant |
| 3 | Refresh tokens: 40-byte random, Redis-stored, rotated on use | Secure design |
| 4 | No `dangerouslySetInnerHTML` in React codebase | Clean |
| 5 | Prisma ORM only — no raw SQL injection vectors | Clean |

---

## Priority Remediation Order

| Priority | Finding | Effort |
|----------|---------|--------|
| 1 | CRITICAL-1: Rotate ENCRYPTION_KEY, remove from git | 1 hour |
| 2 | CRITICAL-2: Redis authentication + localhost bind | 30 min |
| 3 | CRITICAL-3: Remove JWT from localStorage | 1 hour |
| 4 | HIGH-2: IDOR on KYC submit | 15 min |
| 5 | HIGH-3: IDOR on KYC photo-upload | 15 min |
| 6 | HIGH-4: Add security headers to Nginx | 30 min |
| 7 | HIGH-5: Block email attachment file types | 30 min |
| 8 | HIGH-1: SSRF URL validation on task integration | 1 hour |
| 9 | MEDIUM-1: Rate limiter fail-closed for auth | 30 min |
| 10 | MEDIUM-3: Fix document getById org scoping | 20 min |
| 11 | MEDIUM-4: Bulk verify org check | 20 min |
| 12 | MEDIUM-5: Remove AI service port binding | 15 min |
| 13 | LOW-1: Switch to `prisma migrate deploy` in CI | 1 hour |

---

*Report generated: 2026-05-01 | Next audit recommended: 2026-08-01*
