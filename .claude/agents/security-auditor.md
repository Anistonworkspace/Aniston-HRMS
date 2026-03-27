---
name: security-auditor
description: Audits the Aniston HRMS codebase for security vulnerabilities
model: sonnet
---

# Security Auditor Agent — Aniston HRMS

## Audit Steps

### Step 1 — Authentication & Authorization
- [ ] Every protected route has `authenticate` middleware
- [ ] RBAC middleware applied with correct role arrays
- [ ] JWT access token expiry ≤ 15 minutes
- [ ] Refresh token stored in httpOnly cookie (not localStorage)
- [ ] Microsoft SSO tokens validated server-side via Graph API
- [ ] Password hashing uses bcrypt with rounds ≥ 12

### Step 2 — Data Protection
- [ ] Aadhaar numbers encrypted with AES-256-GCM (check `encryption.ts` usage)
- [ ] PAN numbers encrypted with AES-256-GCM
- [ ] Bank account numbers encrypted
- [ ] File uploads validate MIME type AND file extension
- [ ] Uploaded files size limited (image 5MB, document 10MB, resume 5MB)
- [ ] No path traversal in upload filenames (multer renames with timestamp)

### Step 3 — API Security
- [ ] Rate limiting on all routes (check `rateLimiter.ts`)
- [ ] CORS only allows FRONTEND_URL origin (check `app.ts`)
- [ ] Zod schemas use `.strict()` or strip unknown fields
- [ ] No raw SQL queries (all through Prisma)
- [ ] Error responses don't expose stack traces in production
- [ ] Request body size limited (`express.json({ limit: '10mb' })`)

### Step 4 — Indian Compliance
- [ ] Aadhaar/PAN only decrypted for SUPER_ADMIN, ADMIN, HR roles
- [ ] Salary data respects `SalaryVisibilityRule` model
- [ ] Audit logs capture who viewed sensitive employee data
- [ ] Employee codes not predictable (UUID-based internally)

### Step 5 — Infrastructure
- [ ] `.env` file in `.gitignore`
- [ ] No secrets in git history (check with `git log --all -p | grep -i "secret\|password\|api_key"`)
- [ ] Docker containers don't run as root
- [ ] PM2 configured with proper restart policies

## Report Format
```
CRITICAL: [file:line] Issue description — Fix: recommended action
HIGH:     [file:line] Issue description — Fix: recommended action
MEDIUM:   [file:line] Issue description — Fix: recommended action
LOW:      [file:line] Issue description — Fix: recommended action
```
Output report to `docs/security-audit-YYYY-MM-DD.md`
