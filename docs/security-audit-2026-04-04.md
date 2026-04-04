# Security Audit Report — Aniston HRMS Authentication & Session Management
**Date:** 2026-04-04
**Scope:** Authentication system, session/token management, invitation/reset tokens, security headers, frontend token storage
**Auditor:** Claude Security Audit Agent (claude-sonnet-4-6)
**Files Reviewed:**
- `backend/src/modules/auth/auth.service.ts`
- `backend/src/modules/auth/auth.controller.ts`
- `backend/src/modules/auth/auth.routes.ts`
- `backend/src/modules/auth/auth.validation.ts`
- `backend/src/middleware/auth.middleware.ts`
- `backend/src/middleware/rateLimiter.ts`
- `backend/src/middleware/errorHandler.ts`
- `backend/src/config/env.ts`
- `backend/src/utils/encryption.ts`
- `backend/src/modules/invitation/invitation.service.ts`
- `backend/src/app.ts`
- `frontend/src/features/auth/authSlice.ts`
- `frontend/src/app/api.ts`
- `frontend/src/features/auth/AuthCallbackPage.tsx`
- `frontend/src/features/onboarding/EmployeeOnboardingPage.tsx`
- `prisma/schema.prisma` (EmployeeInvitation model)
- `backend/Dockerfile`
- `.gitignore`

---

## Executive Summary

The authentication architecture is largely sound for a mid-size HRMS. Refresh tokens are opaque and stored in Redis (not as JWTs), httpOnly cookie delivery is implemented correctly, bcrypt rounds are at 12, and the Docker container runs as a non-root user. However, six issues require immediate remediation before this system can be considered bank-grade. The most severe are: no inactivity auto-logout (a stated requirement), the login rate limit is 4x too permissive, the invitation token is a UUID (cryptographically weak), ENCRYPTION_KEY is optional in production, and the auth middleware has two fail-open security middleware functions that silently discard errors.

---

## CRITICAL Findings

### CRIT-1: No Frontend Inactivity Auto-Logout — Required Feature Missing
**File:** `frontend/src/app/api.ts`, `frontend/src/features/auth/authSlice.ts`
**Current State:** There is no inactivity timer anywhere in the frontend application. The Redux store has no idle tracking. A session lives until the 15-minute access token expires and the refresh token (7-day TTL) successfully rotates.
**Risk:** An employee who leaves their workstation authenticated gives any physical accessor a full 15-minute window with a live access token, and up to 7 days if the refresh cookie is reachable. For an HRMS with salary, Aadhaar, and PAN data, this violates DPDPA data minimization principles and was explicitly listed as a user requirement (5 minutes).
**Fix:** Implement an `IdleTimer` hook that attaches `mousemove`, `keydown`, `scroll`, and `touchstart` listeners on the `window`. After 5 minutes of no events, dispatch `logout()` and call `POST /api/auth/logout` to invalidate the server-side refresh token in Redis. Reset the timer on every activity event. Example scaffold:
```typescript
// frontend/src/hooks/useIdleTimer.ts
export function useIdleTimer(timeoutMs = 5 * 60 * 1000) {
  const dispatch = useAppDispatch();
  const [logoutSession] = useLogoutMutation();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        await logoutSession().unwrap().catch(() => {});
        dispatch(logout());
      }, timeoutMs);
    };
    const events = ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach(e => window.removeEventListener(e, reset));
    };
  }, [dispatch, logoutSession, timeoutMs]);
}
```
Mount this inside `AppShell` (the authenticated layout wrapper) so it is only active for logged-in users.

---

### CRIT-2: ENCRYPTION_KEY is Optional in Production — Sensitive Data at Risk
**File:** `backend/src/config/env.ts` line 16, `backend/src/utils/encryption.ts` lines 12–27
**Current State:**
```typescript
// env.ts
ENCRYPTION_KEY: z.string().min(32).optional(),

// encryption.ts
if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
  const fallback = process.env.JWT_SECRET;
  ...
}
throw new Error('ENCRYPTION_KEY environment variable must be set');
```
The env schema marks `ENCRYPTION_KEY` as `.optional()`, meaning the server starts successfully in production without it. The `encryption.ts` function will throw at the first encryption call, but startup succeeds, and if no encrypted data is written yet (e.g., a new deploy), the error may surface only when a user tries to save Aadhaar or PAN data — after the system has been running and considered healthy.
**Risk:** CRITICAL for DPDPA compliance. Aadhaar and PAN are Sensitive Personal Data under DPDPA 2023. If the key is absent, encryption calls throw unhandled errors in production. If the error is silently caught upstream, data is stored unencrypted. Additionally, the Env schema allows a production deploy to be "healthy" with no encryption capability.
**Fix:**
1. Remove `.optional()` from `ENCRYPTION_KEY` in `env.ts` and add `.min(32)` so the server refuses to start without it.
2. Add a startup assertion in `backend/src/server.ts` that calls `encrypt('healthcheck')` and panics if it fails.
```typescript
// env.ts — change line 16 to:
ENCRYPTION_KEY: z.string().min(32),
```

---

### CRIT-3: Login Rate Limit is 200 Requests per 15 Minutes — Brute Force Viable
**File:** `backend/src/app.ts` line 78
**Current State:**
```typescript
app.use('/api/auth', rateLimiter({ windowMs: 15 * 60 * 1000, max: 200, keyPrefix: 'rl:auth' }));
```
This applies to all `/api/auth/*` routes including login. 200 attempts per 15 minutes from a single IP is 13 attempts per minute. The API guidance document states the limit should be 50 per 15 minutes for auth routes.
**Risk:** A targeted dictionary attack against a known email (account enumeration is not exploitable here since login uses a constant-time error, but brute-force against common passwords remains viable). An attacker probing from a single IP gets 200 guesses before hitting the limit — enough to test an entire charset of 8-character numeric PINs.
**Fix:** Change the auth catch-all limit to match the documented policy (50/15 min) and add a dedicated stricter limit on `/api/auth/login` specifically:
```typescript
// app.ts
app.use('/api/auth/login', rateLimiter({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'rl:login' }));
app.use('/api/auth/forgot-password', rateLimiter({ windowMs: 60 * 60 * 1000, max: 5, keyPrefix: 'rl:forgot-pw' }));
app.use('/api/auth', rateLimiter({ windowMs: 15 * 60 * 1000, max: 50, keyPrefix: 'rl:auth' }));
```

---

### CRIT-4: Security Middleware (checkExitAccess, checkEmployeePermissions) Fails Open
**File:** `backend/src/middleware/auth.middleware.ts` lines 182, 253
**Current State:**
```typescript
// checkExitAccess
}).catch(() => next()); // On error, allow through (fail-open for exit check)

// checkEmployeePermissions
}).catch(() => next());
```
Both global security middlewares silently swallow any error (Redis down, DB error, any exception) and call `next()`, allowing the request through without any access control check.
**Risk:** If Redis is temporarily unavailable or the DB is degraded, all exit access restrictions and employee feature restrictions are bypassed for every user simultaneously. A terminated employee whose access should be blocked gets full system access during any Redis outage.
**Fix:** Fail-closed: on error, return a 503 Service Unavailable rather than allowing through. At minimum log the error. If operational uptime during Redis degradation is a hard requirement, fail-open only for non-sensitive read-only routes:
```typescript
}).catch((err) => {
  logger.error('Exit access check failed — denying request for safety', err);
  next(new AppError('Access control check failed. Please try again.', 503, 'SERVICE_UNAVAILABLE'));
});
```

---

## HIGH Findings

### HIGH-1: Invitation Token is a UUID (v4) — Cryptographically Undersized
**File:** `prisma/schema.prisma` line 1846, `backend/src/modules/invitation/invitation.service.ts` line 558
**Current State:**
```prisma
inviteToken  String  @unique @default(uuid())
```
On resend, the token is regenerated with `crypto.randomUUID()`. UUID v4 has 122 bits of entropy. This is adequate but is not the correct primitive for a security token. More critically, `inviteToken` is stored **plaintext** in the database — there is no hashing before DB storage.
**Risk:** If the database is compromised (SQL injection via a future bug, a DB backup exfiltrated), all pending invitation tokens are exposed and can be used to create employee accounts in the organization. Invitation tokens give an attacker the ability to create a privileged account (e.g., ADMIN role if HR mistakenly sends an admin invite).
**Fix:**
1. Generate invitation tokens using `randomBytes(32).toString('hex')` (256 bits) instead of UUID.
2. Store only the SHA-256 hash of the token in the database. Return the raw token in the email/URL only. On validation, hash the candidate token and compare against the stored hash.
```typescript
// In createInvitation:
const rawToken = randomBytes(32).toString('hex');
const hashedToken = createHash('sha256').update(rawToken).digest('hex');
// Store hashedToken in DB, send rawToken in URL

// In validateToken:
const hashedToken = createHash('sha256').update(token).digest('hex');
const invitation = await prisma.employeeInvitation.findUnique({ where: { inviteToken: hashedToken } });
```

---

### HIGH-2: Password Reset Token Logged in Plaintext to Console in Development
**File:** `backend/src/modules/auth/auth.service.ts` lines 182–184
**Current State:**
```typescript
if (process.env.NODE_ENV === 'development') {
  console.log(`[DEV] Password reset token for ${email}: ${resetToken}`);
}
```
The raw reset token is printed to stdout in development mode. Development logs are often forwarded to log aggregators (Datadog, Papertrail, Logtail) that are shared across team members or archived. Log aggregators may also be in production-parity environments.
**Risk:** If a staging environment is misconfigured as `NODE_ENV=development` (common), reset tokens for real user accounts would be logged in plaintext and visible to anyone with log access. This is a direct account takeover vector.
**Fix:** Remove this log entirely. Use the email queue (already in place via BullMQ) to deliver the token. If development debugging is needed, log only a truncated token indicator: `[DEV] Reset email queued for ${email}`.

---

### HIGH-3: No Account Lockout After Repeated Failed Login Attempts
**File:** `backend/src/modules/auth/auth.service.ts` (login function)
**Current State:** The login function performs bcrypt comparison on every attempt. There is no counter for failed attempts, no lockout mechanism, no CAPTCHA trigger. The only protection is the rate limiter (which, as noted in CRIT-3, is set at 200 attempts).
**Risk:** If an attacker uses distributed IPs (rotating proxies), the rate limiter by IP provides no protection. A determined attacker can make thousands of attempts against a targeted account without any server-side lockout.
**Fix:** Implement a Redis-based failed-attempt counter per email:
```typescript
const failKey = `failed_login:${email}`;
const attempts = await redis.incr(failKey);
if (attempts === 1) await redis.expire(failKey, 15 * 60); // 15-minute window
if (attempts > 10) {
  throw new UnauthorizedError('Account temporarily locked due to too many failed attempts. Try again in 15 minutes.');
}
```
Reset the counter on successful login. Alert HR/admin after 5+ consecutive failures for admin accounts.

---

### HIGH-4: changePassword Does Not Invalidate Existing Sessions
**File:** `backend/src/modules/auth/auth.service.ts` lines 215–233
**Current State:** The `changePassword` function updates the password hash but does not invalidate existing refresh tokens in Redis. An attacker who has obtained a refresh token (e.g., from a compromised device) retains access even after the legitimate user changes their password.
**Risk:** Password change is a primary remediation action after suspected compromise. If the attacker's session is not invalidated, the password change provides no actual security benefit. The attacker can continue refreshing access tokens for up to 7 days.
**Fix:** Add the same Redis key-scan-and-delete logic that `resetPassword` already uses:
```typescript
// After updating passwordHash in changePassword:
const keys = await redis.keys(`${REFRESH_TOKEN_PREFIX}*`);
for (const key of keys) {
  const storedUserId = await redis.get(key);
  if (storedUserId === userId) await redis.del(key);
}
```
Note: `redis.keys()` is a blocking O(N) scan. Consider storing refresh tokens in a user-keyed set `refresh_tokens:{userId}` (a Redis Set) for O(1) invalidation of all user sessions.

---

### HIGH-5: SSO Callback Passes Access Token and User Data in URL Query Parameters
**File:** `frontend/src/features/auth/AuthCallbackPage.tsx` lines 13–20
**Current State:**
```typescript
const accessToken = searchParams.get('accessToken');
const userParam = searchParams.get('user');
```
The Microsoft SSO callback handler reads `accessToken` and a JSON-encoded user object from URL query parameters.
**Risk:** URL query parameters are stored in: browser history, server access logs, reverse proxy logs, Referer headers sent to third-party resources loaded on the page. A JWT access token in a URL is a OWASP Top 10 (A02:2021 Cryptographic Failures) finding. If the user navigates away and back, the token appears in browser history. Any third-party analytics or CDN script loaded on the callback page could read the Referer header containing the token.
**Fix:** The SSO callback should use a POST body or a short-lived, one-time-use server-side code exchange (PKCE flow). The backend SSO handler should set the access token as a short-lived httpOnly cookie for the callback redirect, not embed it in the URL. The frontend reads from the cookie, not the URL. At minimum, the current `window.history.replaceState` call must be kept (it already is), but logs remain a risk.

---

### HIGH-6: Redis-Based Refresh Token Scan is O(N) on All Keys
**File:** `backend/src/modules/auth/auth.service.ts` lines 204–209
**Current State:**
```typescript
const keys = await redis.keys(`${REFRESH_TOKEN_PREFIX}*`);
for (const key of keys) {
  const storedUserId = await redis.get(key);
  if (storedUserId === userId) await redis.del(key);
}
```
`redis.keys()` is a blocking command that scans the entire keyspace. This is called during `resetPassword`.
**Risk:** On a production Redis instance with thousands of active sessions, this command blocks all other Redis operations for the duration of the scan, causing latency spikes across all features (attendance, payroll, notifications). This is a denial-of-service vector: if an attacker triggers many simultaneous password resets (e.g., by enumerating valid email addresses), they can repeatedly block Redis.
**Fix:** Change the refresh token storage model to use a Redis Set keyed by user ID:
```typescript
// On token creation:
await redis.sadd(`user_sessions:${userId}`, token);
await redis.setex(`${REFRESH_TOKEN_PREFIX}${token}`, expiry, userId);

// On user session invalidation:
const tokens = await redis.smembers(`user_sessions:${userId}`);
const pipeline = redis.pipeline();
tokens.forEach(t => pipeline.del(`${REFRESH_TOKEN_PREFIX}${t}`));
pipeline.del(`user_sessions:${userId}`);
await pipeline.exec();
```

---

## MEDIUM Findings

### MED-1: No Absolute Session Lifetime — Refresh Tokens Can Be Extended Indefinitely
**File:** `backend/src/modules/auth/auth.service.ts` lines 319–324
**Current State:** Every time a refresh token is used, a new 7-day refresh token is issued (token rotation is correctly implemented). However, there is no absolute session lifetime — a user who accesses the app at least once per 7 days never needs to re-authenticate.
**Risk:** For HRMS data at the sensitivity of Aadhaar/PAN/salary, indefinite sessions are inappropriate. A compromised refresh cookie (e.g., from a home machine never logged out) provides permanent access.
**Fix:** Store the original login timestamp in Redis alongside the refresh token. On each rotation, check if `Date.now() - originalLoginTime > MAX_SESSION_AGE` (e.g., 30 days). If exceeded, reject the refresh and require re-login. Pass `originalLoginAt` through in the Redis value as a JSON object: `{ userId, originalLoginAt }`.

---

### MED-2: Cookie `secure` Flag is Disabled in Development — Potential Staging Misconfiguration
**File:** `backend/src/modules/auth/auth.controller.ts` lines 13–19 and 48–54
**Current State:**
```typescript
secure: process.env.NODE_ENV === 'production',
```
The `secure` flag is only set in production. If a staging or UAT environment uses `NODE_ENV=development` (common for easier debugging), the refresh token cookie is transmitted over plain HTTP.
**Fix:** Decouple the `secure` flag from `NODE_ENV` and tie it to the protocol in use. Add an explicit env variable:
```typescript
// env.ts
COOKIE_SECURE: z.string().transform(v => v === 'true').default('false'),

// auth.controller.ts
secure: env.COOKIE_SECURE,
```
Set `COOKIE_SECURE=true` in all deployed environments including staging.

---

### MED-3: `changePassword` Validation Missing Special Character Requirement
**File:** `backend/src/modules/auth/auth.validation.ts` lines 26–33
**Current State:**
```typescript
export const changePasswordSchema = z.object({
  newPassword: z.string()
    .min(8)
    .regex(/[A-Z]/)
    .regex(/[a-z]/)
    .regex(/[0-9]/),   // <-- no special character regex
});
```
`resetPasswordSchema` correctly requires a special character, but `changePasswordSchema` (used when a logged-in user changes their password) does not. This creates an inconsistency where a password set via reset must be strong, but a password changed in-app need not be.
**Fix:** Add `.regex(/[^A-Za-z0-9]/, 'Password must contain a special character')` to `changePasswordSchema.newPassword`.

---

### MED-4: Rate Limiter Fails Open When Redis is Unavailable
**File:** `backend/src/middleware/rateLimiter.ts` lines 34–36
**Current State:**
```typescript
} catch {
  // If Redis is down, allow the request
  next();
}
```
When Redis is unavailable, every rate-limited route allows unlimited requests.
**Risk:** A Redis outage is the ideal time to launch a brute-force attack — the attacker can attempt unlimited password guesses. This is a known attack pattern against rate-limiter implementations.
**Fix:** Implement a local in-memory fallback rate limiter (e.g., a simple `Map<string, number>` with TTL via `setTimeout`) that activates when Redis is down. The in-memory limiter does not scale across instances but provides meaningful protection on each individual server node.

---

### MED-5: `JWT_REFRESH_SECRET` is Defined in env.ts But Never Used
**File:** `backend/src/config/env.ts` line 15, `backend/src/modules/auth/auth.service.ts` lines 319–324
**Current State:** `JWT_REFRESH_SECRET` is validated in the env schema (required, min 32 chars) but the refresh token implementation uses opaque random bytes stored in Redis — there is no JWT signing of refresh tokens. The variable is loaded, required, and then ignored.
**Risk:** This is confusing dead code. A future developer might assume refresh tokens are signed JWTs and write code that validates them with this secret, creating a false sense of security. Alternatively, they might remove the Redis check assuming the JWT signature is the validation mechanism.
**Fix:** Either (a) remove `JWT_REFRESH_SECRET` from the env schema entirely with a comment explaining that refresh tokens are opaque Redis-backed tokens, or (b) actually use it to HMAC-sign the opaque token value before storage, providing an additional layer of validation.

---

### MED-6: No MFA Support — Admin and HR Accounts Unprotected
**File:** All auth files
**Current State:** There is no Multi-Factor Authentication implementation anywhere in the system.
**Risk:** For an HRMS handling Aadhaar, PAN, bank account numbers, and salary data for all employees, admin account compromise via credential stuffing or phishing provides immediate access to all sensitive data. DPDPA 2023 guidance and ISO 27001 both recommend MFA for access to sensitive personal data.
**Fix:** Implement TOTP-based MFA (RFC 6238) for SUPER_ADMIN, ADMIN, and HR roles as a mandatory control, optional for other roles. Use the `otplib` npm package. Store the TOTP secret encrypted with AES-256-GCM. After password validation succeeds, if the user has MFA enabled, return a temporary `mfa_challenge` token and require a second call to `/api/auth/verify-mfa` before issuing the access/refresh tokens.

---

### MED-7: Helmet is Used with Default Configuration — Missing Explicit CSP
**File:** `backend/src/app.ts` line 52
**Current State:**
```typescript
app.use(helmet());
```
Helmet is used but with all default settings. The default `helmet()` call does NOT set a `Content-Security-Policy` header. It does set `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security` (only in HTTPS contexts), and a few others by default. CSP is explicitly opt-in.
**Risk:** Without a CSP header, the backend API responses have no protection against content injection. For API endpoints this is lower risk, but the Swagger UI at `/api/docs` is served without CSP, making it a potential vector for stored XSS if any user-controlled data appears in Swagger descriptions.
**Fix:** Add explicit helmet configuration:
```typescript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // needed for Swagger UI
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));
```

---

## LOW Findings

### LOW-1: No Cross-Tab Logout Propagation
**File:** `frontend/src/features/auth/authSlice.ts`, `frontend/src/app/api.ts`
**Current State:** When a user logs out in one browser tab, other open tabs remain authenticated in their local Redux store. The access token in memory stays valid until it expires (up to 15 minutes). The refresh cookie is cleared server-side but the memory state is not synchronized across tabs.
**Risk:** Low — the 15-minute access token expiry limits the window. However, for sensitive operations (payroll viewing), another open tab in the background continues to show sensitive data.
**Fix:** Use the `BroadcastChannel` API to propagate logout events:
```typescript
// In authSlice logout reducer, or in the logout mutation onQueryStarted:
const channel = new BroadcastChannel('auth');
channel.postMessage({ type: 'LOGOUT' });

// In App.tsx or a useEffect in AppShell:
useEffect(() => {
  const channel = new BroadcastChannel('auth');
  channel.onmessage = (event) => {
    if (event.data?.type === 'LOGOUT') dispatch(logout());
  };
  return () => channel.close();
}, [dispatch]);
```

---

### LOW-2: Access Token Exposed in EmployeeOnboardingPage via localStorage Reference
**File:** `frontend/src/features/onboarding/EmployeeOnboardingPage.tsx` line 70
**Current State:**
```typescript
localStorage.removeItem('accessToken');
```
This code removes a key called `accessToken` from localStorage. However, the rest of the auth system stores the access token in Redux memory only (no `localStorage.setItem` for `accessToken` is found anywhere). This is a dead/stale code reference — the key being removed does not exist.
**Risk:** The code implies that at some point in the past (or in a parallel code path) the access token was stored in localStorage. If that path still exists and was missed in the review, the token would be vulnerable to XSS theft. The dead code also creates confusion about the auth storage model.
**Fix:** Remove `localStorage.removeItem('accessToken')` from the onboarding page. Replace with `dispatch(logout())` from Redux, which is the correct mechanism. Add a comment confirming that the access token is memory-only (Redux store, cleared on page reload).

---

### LOW-3: Refresh Token Cookie Path Restricted to `/api/auth` — Correct but Undocumented
**File:** `backend/src/modules/auth/auth.controller.ts` line 18
**Current State:**
```typescript
path: '/api/auth',
```
The refresh token cookie is scoped to `/api/auth`. This is a good practice (limits exposure of the cookie to only the refresh endpoint), but it means the cookie will not be sent on logout calls that go to `/api/auth/logout`. Checking the logout implementation — it reads from `req.cookies.refreshToken`, which works only because the cookie path matches. This is correct as-is but requires documentation.
**Risk:** If any developer changes the logout route path, the refresh token will not be cleared. This is a fragile dependency.
**Fix:** Add a code comment on both the cookie-setting and logout handlers explaining the path dependency. Consider adding a test that verifies the cookie is included on logout calls.

---

### LOW-4: Multer LIMIT_FILE_SIZE Error Message States 50MB but API Rule Specifies Lower Limits
**File:** `backend/src/middleware/errorHandler.ts` line 106
**Current State:**
```typescript
LIMIT_FILE_SIZE: 'File is too large. Maximum size is 50MB.',
```
The error message says 50MB, but the documented file limits are 5MB for images, 10MB for documents and resumes.
**Risk:** Users receive incorrect guidance, and the discrepancy suggests the actual multer limit may have been set to 50MB despite the documented 10MB maximum. This should be verified in `upload.middleware.ts`.
**Fix:** Update the error message to be generic (`'File is too large'`) or make it dynamic based on the route context.

---

### LOW-5: Fail-Open Error Suppression in `login()` — Permission Service
**File:** `backend/src/modules/auth/auth.service.ts` lines 76–82
**Current State:**
```typescript
try {
  const perms = await employeePermissionService.getEffectivePermissions(...);
  ...
} catch { /* fail silently */ }
```
If the employee permissions service throws (DB error, schema mismatch), the catch block is completely silent — no log, no metric, no alert. The login proceeds with `featurePermissions: null`.
**Risk:** Low severity for security (fail-open here means the user gets full access rather than restricted access, which is the safer default for a permissions narrowing system). However, the silent failure masks operational problems.
**Fix:** At minimum log the error: `catch (e) { logger.warn('Failed to fetch feature permissions at login', e); }`.

---

## Positive Findings (Controls Working Correctly)

The following controls were verified and are correctly implemented:

- **Password hashing:** bcrypt with 12 rounds — meets the minimum requirement.
- **JWT access token expiry:** Defaults to `15m` via `JWT_ACCESS_EXPIRY` env var — correct.
- **Refresh token delivery:** Set as `httpOnly: true`, `sameSite: 'strict'`, path-scoped to `/api/auth` — correct.
- **Refresh token generation:** `randomBytes(40).toString('hex')` = 320 bits of entropy — correct.
- **Refresh token rotation:** Old token deleted from Redis before new one is issued — correct.
- **Refresh token storage:** Opaque token stored in Redis (not a JWT) — correct. Server-side revocation is possible.
- **Account enumeration prevention on login:** Constant error message `'Invalid email or password'` regardless of whether email exists — correct.
- **Account enumeration prevention on forgot-password:** Returns the same message whether email exists or not — correct.
- **Reset token single-use enforcement:** Token deleted from Redis after use in `resetPassword` — correct.
- **Reset token expiry:** 1 hour via `redis.setex(..., 3600, ...)` — correct.
- **Invitation single-use enforcement:** `updateMany` with `{ status: 'PENDING' }` condition inside a transaction; if another request claimed it first, `claimed.count === 0` throws — correct.
- **AES-256-GCM encryption:** Random salt + random IV per encryption, auth tag verified on decrypt — correct.
- **RBAC implementation:** `hasPermission()` from shared package, `authorize()` and `requirePermission()` middleware — correctly applied.
- **CORS configuration:** Locked to `FRONTEND_URL` in production, credentials allowed — correct.
- **Docker non-root user:** `adduser -S appuser`, `USER appuser` in runtime stage — correct.
- **`.env` in `.gitignore`:** Confirmed present — correct.
- **Error handler stack trace suppression:** `process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message` — correct.
- **Body size limit:** `express.json({ limit: '10mb' })` — correct.

---

## Findings Summary Table

| ID | Severity | Area | Title |
|----|----------|------|-------|
| CRIT-1 | CRITICAL | Frontend | No inactivity auto-logout (5-minute requirement unmet) |
| CRIT-2 | CRITICAL | Backend | `ENCRYPTION_KEY` optional in production env schema |
| CRIT-3 | CRITICAL | Backend | Login rate limit 200/15min — 4x too permissive |
| CRIT-4 | CRITICAL | Backend | `checkExitAccess` and `checkEmployeePermissions` fail-open on error |
| HIGH-1 | HIGH | Backend | Invitation token is UUID stored plaintext — not hashed in DB |
| HIGH-2 | HIGH | Backend | Password reset token logged in plaintext to stdout in dev |
| HIGH-3 | HIGH | Backend | No account lockout after repeated failed login attempts |
| HIGH-4 | HIGH | Backend | `changePassword` does not invalidate existing refresh tokens |
| HIGH-5 | HIGH | Frontend | SSO callback passes JWT and user data in URL query parameters |
| HIGH-6 | HIGH | Backend | `redis.keys()` used for session invalidation — O(N) blocking |
| MED-1 | MEDIUM | Backend | No absolute session lifetime — infinite session via rotation |
| MED-2 | MEDIUM | Backend | `secure` cookie flag tied to `NODE_ENV` not to protocol |
| MED-3 | MEDIUM | Backend | `changePassword` schema missing special character requirement |
| MED-4 | MEDIUM | Backend | Rate limiter fails open when Redis is unavailable |
| MED-5 | MEDIUM | Backend | `JWT_REFRESH_SECRET` env var required but never used |
| MED-6 | MEDIUM | Backend | No MFA support for admin accounts |
| MED-7 | MEDIUM | Backend | Helmet used with default config — no explicit CSP header |
| LOW-1 | LOW | Frontend | No cross-tab logout propagation |
| LOW-2 | LOW | Frontend | Stale `localStorage.removeItem('accessToken')` in onboarding page |
| LOW-3 | LOW | Backend | Cookie path/logout dependency undocumented — fragile |
| LOW-4 | LOW | Backend | Multer error message states 50MB — inconsistent with documented limits |
| LOW-5 | LOW | Backend | Silent `catch` in login for feature permissions — no logging |

---

## Remediation Priority Order

1. **CRIT-1** — Implement 5-minute inactivity timer (stated requirement, DPDPA risk)
2. **CRIT-2** — Make `ENCRYPTION_KEY` required in env schema
3. **CRIT-3** — Tighten login rate limits to 10/15min
4. **CRIT-4** — Make security middleware fail-closed on error
5. **HIGH-2** — Remove plaintext token logging immediately
6. **HIGH-4** — Add session invalidation to `changePassword`
7. **HIGH-3** — Add Redis-based login lockout after 10 failures
8. **HIGH-1** — Hash invitation tokens before DB storage
9. **HIGH-6** — Replace `redis.keys()` with per-user session sets
10. **HIGH-5** — Refactor SSO callback to avoid token in URL
11. **MED-1 through MED-7** — Schedule for next sprint
12. **LOW-1 through LOW-5** — Schedule as housekeeping

---

*Report generated by Claude Security Audit Agent — 2026-04-04*
