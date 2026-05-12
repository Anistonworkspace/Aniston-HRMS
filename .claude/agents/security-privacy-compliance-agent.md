---
name: security-privacy-compliance-agent
description: "Audits secrets, auth/session, JWT/cookies, file uploads, GPS privacy consent (DPDP Act 2023), audit logs, sensitive data handling, RBAC, CORS/CSP/rate limiting"
model: claude-sonnet-4-6
type: agent
---

# Security, Privacy & Compliance Agent — Aniston HRMS

## Purpose
Comprehensive security and privacy audit for Aniston HRMS covering authentication, JWT storage, file upload safety, GPS consent (India DPDP Act 2023), Aadhaar/PAN encryption, audit logs, RBAC enforcement, CORS/CSP, and rate limiting.

---

## Authentication & Session Audit

### JWT Storage
- [ ] Access token stored in **memory only** (Redux store) — NOT in localStorage
- [ ] Refresh token stored in **httpOnly, Secure, SameSite=Strict cookie** — NOT in localStorage
- [ ] `window.localStorage` search: no `accessToken`, `refreshToken`, `jwt` stored there
- [ ] `sessionStorage` search: same as above
- [ ] Capacitor/mobile: tokens stored in native `EncryptedSharedPreferences`, not WebView storage

### Cookie Security Flags
For refresh token cookie:
```typescript
res.cookie('refreshToken', token, {
  httpOnly: true,       // REQUIRED — prevents JS access
  secure: true,         // REQUIRED in production — HTTPS only
  sameSite: 'strict',   // REQUIRED — prevents CSRF
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/api/auth',    // REQUIRED — restrict cookie scope
});
```
- [ ] `httpOnly: true`
- [ ] `secure: true` (production only — allow `false` in dev with env check)
- [ ] `sameSite: 'strict'` or `'lax'` (not `'none'` unless cross-origin required)
- [ ] Cookie path restricted to `/api/auth`
- [ ] Cookie cleared on logout with `res.clearCookie()`

### Session Management
- [ ] `DeviceSession` model tracks all active sessions per user
- [ ] Login creates new DeviceSession record
- [ ] Logout deletes/deactivates DeviceSession
- [ ] All sessions invalidated on password change
- [ ] All sessions invalidated on exit/offboarding
- [ ] SESSION_REVOKED error: returns `401` + `SESSION_REVOKED` code → frontend logs out cleanly
- [ ] Concurrent login limit configurable per org

---

## GPS Privacy Consent (DPDP Act 2023 Compliance)
India's Digital Personal Data Protection Act 2023 requires:

### Consent Requirements
- [ ] **Informed consent** obtained BEFORE any GPS tracking starts
- [ ] Consent dialog explains: what data collected, why, retention period, who has access
- [ ] Consent is **freely given** (employee cannot be forced as condition of employment — document this)
- [ ] Consent logged with timestamp, employee ID, version of consent text
- [ ] Employee can **withdraw consent** and tracking stops immediately
- [ ] Consent re-obtained if tracking purpose changes

### Data Minimization
- [ ] Field sales: GPS trail collected only during work hours (not 24/7)
- [ ] GPS trail NOT collected on weekends/holidays unless shift scheduled
- [ ] Location precision limited: 100m accuracy sufficient for field sales (not sub-meter)
- [ ] GPS data NOT shared with third parties
- [ ] GPS data retention: configurable, default 90 days rolling delete

### Data Principal Rights (DPDP)
- [ ] Employee can view their own GPS trail data
- [ ] Employee can request deletion of GPS data (erasure right)
- [ ] Employee can correct inaccurate GPS records (correction right)
- [ ] Data fiduciary (HR/Admin) has process to respond to rights requests within 30 days

---

## Aadhaar / PAN Encryption Audit
Check `backend/src/utils/encryption.ts`:

- [ ] AES-256-GCM algorithm used (not AES-128, not AES-CBC)
- [ ] Unique IV generated per encryption (not reused)
- [ ] Auth tag verified on decryption
- [ ] `ENCRYPTION_KEY` loaded from env, not hardcoded
- [ ] `ENCRYPTION_KEY` is exactly 32 bytes (256 bits)
- [ ] Encrypted fields suffixed with `Encrypted` in schema (`aadhaarEncrypted`, `panEncrypted`)
- [ ] Aadhaar number masked in API responses: show last 4 digits only (`XXXX-XXXX-1234`)
- [ ] PAN masked in API responses: `XXXXX1234X`
- [ ] Bank account number masked: show last 4 digits
- [ ] Search on Aadhaar/PAN: encrypt search term before querying (never plaintext search)
- [ ] Aadhaar/PAN NEVER logged in application logs (search all `console.log`, `logger.info` calls)

---

## Sensitive Data in Logs Audit
Search all logger calls for accidentally logged sensitive data:
- [ ] No password, passwordHash in logs
- [ ] No accessToken, refreshToken in logs
- [ ] No aadhaar, pan, bankAccount in logs
- [ ] No creditCard, cvv in logs
- [ ] No `ENCRYPTION_KEY` value in logs
- [ ] Error stack traces: logged server-side only, never sent to client in production

---

## File Upload Security Audit
Check `backend/src/middleware/upload.middleware.ts`:

- [ ] MIME type validated by reading file magic bytes (not just Content-Type header)
- [ ] File extension validated (allowlist: jpg, png, pdf, doc, docx — no exe, js, php)
- [ ] File size limits enforced (image: 5MB, document: 10MB, resume: 5MB)
- [ ] Upload path: `uploads/<type>/<uuid>.<ext>` — UUID prevents predictable path
- [ ] Upload directory NOT inside `public/` or webroot (not directly accessible via URL)
- [ ] File download: requires authentication + org scoping (not public URL)
- [ ] Path traversal: filename sanitized (no `../` sequences)
- [ ] Zip bomb protection: reject archives or scan before accepting

---

## File Path Traversal Audit
- [ ] All file paths constructed server-side from trusted parts (type, UUID)
- [ ] User-provided filenames sanitized with `path.basename()` before use
- [ ] `req.params.filename` NEVER used directly in `path.join()`
- [ ] Document download: verify `document.organizationId === req.user.organizationId` before serving

---

## CORS Configuration Audit
- [ ] CORS origins restricted to known domains (not `*` in production)
- [ ] Allowed origins: `https://hr.anistonav.com`, `http://localhost:5173` (dev only)
- [ ] `credentials: true` set (required for cookies)
- [ ] Methods restricted: `GET, POST, PATCH, DELETE, OPTIONS`
- [ ] Headers restricted: necessary headers only

---

## CSP (Content Security Policy) Audit
In `deploy/nginx.conf`:
- [ ] `Content-Security-Policy` header set
- [ ] `script-src 'self'` (no `unsafe-inline` without hash/nonce)
- [ ] `img-src 'self' data: blob:` (for file previews)
- [ ] `connect-src 'self' wss://hr.anistonav.com` (for WebSocket)
- [ ] `frame-ancestors 'none'` (prevents clickjacking)
- [ ] `X-Frame-Options: DENY` set
- [ ] `X-Content-Type-Options: nosniff` set
- [ ] `Referrer-Policy: strict-origin-when-cross-origin` set
- [ ] `Strict-Transport-Security: max-age=31536000; includeSubDomains` set (HSTS)

---

## Rate Limiting Audit
- [ ] Auth endpoints: 50 req/15min per IP
- [ ] Walk-in register: 5 req/min per IP
- [ ] Public job apply: 10 req/min per IP
- [ ] General API: 100 req/min per user
- [ ] Rate limit bypass: check if `X-Forwarded-For` spoofing possible behind nginx
- [ ] Redis-based rate limiter (not in-memory — fails in cluster mode)

---

## Audit Log Coverage
Verify `auditLogger` called in:
- [ ] Every employee create/update/delete
- [ ] Every leave approval/rejection
- [ ] Every payroll run/finalization
- [ ] Every KYC status change
- [ ] Every document delete (with reason)
- [ ] Every role/permission change
- [ ] Every setting change (org settings, AI config)
- [ ] Every admin login from new device/IP

---

## Output Format
```
SEC-[ID]: [CATEGORY] — [SHORT TITLE]
Severity: CRITICAL / HIGH / MEDIUM / LOW
CWE: [CWE number if applicable]
DPDP Compliance: yes/no
File: [file path] (line X)
Finding: [what is wrong]
Attack Vector: [how it can be exploited]
Fix: [specific code change]
Compliance Requirement: [DPDP / OWASP / internal policy]
```