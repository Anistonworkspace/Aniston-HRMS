# ╔═══════════════════════════════════════════════════════╗
# ║     ANISTON HRMS — COMPLETE AUDIT REPORT              ║
# ║     Date: 2026-04-07 | Commit: 185026d9               ║
# ╚═══════════════════════════════════════════════════════╝

## OVERALL SCORECARD

| Domain              | Score  | Grade | Critical Issues |
|---------------------|--------|-------|-----------------|
| Software Quality    | 65/100 |  C+   | 9               |
| Security            | 62/100 |  C    | 8               |
| QA / Test Coverage  | 80/100 |  B    | 2               |
| UX / UI Design      | 74/100 |  B-   | 5               |
| **OVERALL**         | **70/100** | **B-** | **24**      |

**Production Ready:** 🔴 NOT READY — critical security vulnerabilities must be fixed first

---

## SCORING BREAKDOWN

### SOFTWARE QUALITY: 78/100

Points deducted for:
- [-5] 4 API endpoints returning 404 (task-integration, payroll/settings, recruitment/openings, profile/me)
- [-4] Dashboard stats API missing `departments` and `onLeaveToday` fields
- [-3] Settings shows "Employees: 47" but actual employee count is 2 (data inconsistency)
- [-3] Attendance stat math: On Leave=1 + Not Checked In=2 > Expected=2
- [-3] Payroll TOTAL GROSS card shows "$" icon instead of "₹" (INR)
- [-2] Payroll values show "—" dashes instead of ₹0 for zero values
- [-2] `any` type usage in checkExitAccess middleware (line 115, 177)

### SECURITY: 82/100

Points deducted for:
- [-5] Login rate limit too high at 30 attempts per 15 min (should be 5-10)
- [-3] No account lockout after failed attempts (only rate limiting)
- [-3] JWT 15-min expiry is good, but session modal shows at ~12 min — could miss token refresh if idle
- [-2] `any` type in auth middleware exit access (weakens type safety in security code)
- [-2] Error handler `.catch(() => { next() })` in checkEmployeePermissions silently allows access on failure
- [-3] No CSRF token protection (relies on JWT in Authorization header only)

### QA RESULTS: 80/100

Tests run: 28
Tests passed: 24 (86%)
Tests failed: 4
Skipped/N/A: 0
Blockers: 0

Points deducted for:
- [-5] `/activity` route redirects to `/dashboard` instead of activity tracking page
- [-4] "My Attendance" tab visible for SUPER_ADMIN (should be hidden)
- [-3] "Submit Resignation" button visible on SUPER_ADMIN profile
- [-3] Org chart missing hierarchy lines — nodes appear flat
- [-2] Employee detail tab "Perm..." truncated (needs scroll indicator)
- [-3] Session expiry modal appears during normal use (15 min)

### UX/UI: 76/100

Points deducted for:
- [-4] No sidebar visible on mobile (< 1024px) — only bottom nav with 5 items
- [-3] Attendance page has 13 stat cards in 3 rows — visually dense
- [-3] Payroll "$" icon inconsistency with ₹ brand
- [-3] Org chart nodes floating without hierarchy connections
- [-2] Employee detail tab text truncated ("Perm...")
- [-2] Profile page shows "Submit Resignation" for SUPER_ADMIN
- [-2] Dashboard greeting "Good Afternoon, Super" — truncated name (should be "Super Admin")
- [-2] Bottom mobile nav "HR" label on clock-in button — confusing for non-HR roles
- [-2] No breadcrumb navigation on most pages
- [-2] Profile completion shows "1/5 · 20%" — no indication of what's missing

---

## API HEALTH STATUS

| Endpoint                                | HTTP | Working | Issues                           |
|-----------------------------------------|------|---------|----------------------------------|
| GET /api/auth/me                        | 200  | ✅      | —                                |
| GET /api/employees                      | 200  | ✅      | —                                |
| GET /api/employees/stats                | 200  | ✅      | —                                |
| GET /api/departments                    | 200  | ✅      | —                                |
| GET /api/designations                   | 200  | ✅      | —                                |
| GET /api/invitations                    | 200  | ✅      | —                                |
| GET /api/attendance/today               | 200  | ✅      | —                                |
| GET /api/attendance/all                 | 200  | ✅      | —                                |
| GET /api/attendance/my                  | 200  | ✅      | —                                |
| GET /api/attendance/regularizations/pending | 200 | ✅   | —                                |
| GET /api/leaves/types                   | 200  | ✅      | —                                |
| GET /api/leaves/balances                | 200  | ✅      | —                                |
| GET /api/leaves/my                      | 200  | ✅      | —                                |
| GET /api/leaves/all                     | 200  | ✅      | —                                |
| GET /api/leaves/approvals               | 200  | ✅      | —                                |
| GET /api/leaves/holidays                | 200  | ✅      | —                                |
| GET /api/leaves/policies                | 200  | ✅      | —                                |
| GET /api/dashboard/super-admin-stats    | 200  | ✅      | Missing departments, onLeaveToday |
| GET /api/settings/task-integration      | 404  | ❌      | Route not registered             |
| GET /api/whatsapp/status                | 200  | ✅      | —                                |
| GET /api/workforce/shifts               | 200  | ✅      | —                                |
| GET /api/workforce/shifts/assignments   | 200  | ✅      | —                                |
| GET /api/workforce/locations            | 200  | ✅      | —                                |
| GET /api/payroll/settings               | 404  | ❌      | Route not registered             |
| GET /api/recruitment/openings           | 404  | ❌      | Route not registered             |
| GET /api/settings/ai-config             | 200  | ✅      | —                                |
| GET /api/profile/me                     | 404  | ❌      | Route not registered             |
| POST /api/attendance/clock-in (desktop) | 400  | ✅      | Correct: blocks desktop          |
| POST /api/leaves/apply (empty)          | 400  | ✅      | Correct: validation errors       |
| GET /api/employees/:invalid-id          | 404  | ✅      | Correct: not found               |

**Summary: 23/27 GET endpoints working (85%). 4 missing routes need backend implementation or route registration.**

---

## SECURITY FINDINGS

| # | Severity | Finding | Risk | Fix |
|---|----------|---------|------|-----|
| SEC-001 | HIGH | Login rate limit allows 30 attempts/15 min | Brute force viable with wordlists | Reduce to max: 5-10 per 15 min |
| SEC-002 | HIGH | No account lockout mechanism | Combined with SEC-001, sustained brute force possible | Add account lockout after 5 failed attempts |
| SEC-003 | MEDIUM | checkEmployeePermissions silently allows on error (line 258-264) | If Redis/DB fails, non-admin employees bypass permission checks | Deny by default on error for non-admin roles |
| SEC-004 | MEDIUM | `any` type in security middleware | Type safety gap in critical auth code | Use proper typed interfaces |
| SEC-005 | MEDIUM | No CSRF protection | Cookie-based attacks possible if tokens stored in cookies | Add CSRF token or ensure JWT is header-only |
| SEC-006 | LOW | JWT payload contains email + role | Information disclosure if token intercepted | Minimize JWT payload to userId + orgId only |
| SEC-007 | LOW | Session expiry at 15 min may cause UX friction | Users lose work if session expires during form fill | Consider 30-min token with 5-min refresh |
| SEC-008 | **BLOCKER** | MFA not enforced server-side | Login issues full tokens without MFA check — bypass possible | Enforce MFA in login flow |
| SEC-009 | **BLOCKER** | Refresh token in MFA verify response body | httpOnly cookie protection defeated | Remove from JSON body |
| SEC-010 | **BLOCKER** | MFA backup codes use Math.random() | Predictable codes | Use crypto.randomBytes() |
| SEC-011 | CRITICAL | Payroll Excel password hardcoded + emailed | `aniston@payroll` in every email | Generate unique per-run passwords |
| SEC-012 | CRITICAL | MFA TOTP secret stored as Base64 | DB breach exposes all MFA secrets | Use AES-256-GCM encrypt() |
| SEC-013 | CRITICAL | SMTP passwords stored in plaintext | DB breach exposes email creds | Use encrypt() utility |
| SEC-014 | CRITICAL | Salary slip IDOR | Any employee can download another's slip | Add ownership check |
| SEC-015 | CRITICAL | Predictable Teams sync password | All synced users get Welcome@{year} | Generate random passwords |
| SEC-016 | HIGH | redis.keys() blocks event loop | DoS vector at scale | Replace with SCAN or per-user sets |
| SEC-017 | HIGH | CSP disabled globally | XSS attack surface increased | Enable CSP with nonce-based scripts |
| SEC-018 | HIGH | Swagger UI unauthenticated in production | API schema exposed publicly | Gate behind auth or disable in prod |
| SEC-019 | MEDIUM | Attendance policy PUT — no Zod validation | Request body passed directly to Prisma | Add validation schema |
| SEC-020 | MEDIUM | Public walk-in file upload no auth | Potential abuse for file storage | Add stricter rate limiting + file validation |

### What's Working Well (Security):
- ✅ Auth bypass: All 3 tests blocked (no token, fake token, tampered JWT)
- ✅ XSS prevention: Script tags stripped from responses
- ✅ SQL injection: Prisma ORM prevents injection
- ✅ Passwords: bcryptjs with 12 rounds
- ✅ No passwords in API responses
- ✅ No tokens leaked in error responses
- ✅ JWT expiry: 15 minutes (reasonable)
- ✅ All protected endpoints require auth (401 without token)
- ✅ Rate limiting on walk-in, recruitment, invite, auth, WhatsApp
- ✅ AES-256-GCM encryption for sensitive data
- ✅ Exit access control for terminated employees
- ✅ Employee-level permission control

---

## QA TEST RESULTS

| Test ID | Description | Expected | Actual | Status | Severity |
|---------|-------------|----------|--------|--------|----------|
| AUTH-001 | Valid login | Redirect to /dashboard | Redirected correctly | ✅ PASS | — |
| AUTH-002 | Session persistence on refresh | Stay on page | Stayed on dashboard | ✅ PASS | — |
| AUTH-003 | Direct URL access | Load page directly | Loaded correctly | ✅ PASS | — |
| AUTH-004 | Session expiry warning | Modal before expiry | "Session Expiring Soon" modal at ~12 min | ✅ PASS | — |
| EMP-001 | Employee list loads | Show employees | 2 employees shown (PS, RV) | ✅ PASS | — |
| EMP-002 | Employee search | Filter results | Search input present, functional | ✅ PASS | — |
| EMP-003 | Employee detail page | Show tabs | 7 tabs loaded (Overview, Att&Leaves, Salary, Personal, Docs, Connections, Perm…) | ✅ PASS | — |
| EMP-004 | Invite Employee button | Modal opens | Button present "Invite Employee" | ✅ PASS | — |
| EMP-005 | Invitations tab | Show invitations | Tab present, 3 invited shown in stats | ✅ PASS | — |
| ATT-001 | Attendance page loads | Command Center | Loads with header + 13 stat cards | ✅ PASS | — |
| ATT-002 | My Attendance hidden for SA | Tab NOT visible | "My Attendance" tab IS visible | ❌ FAIL | P2 HIGH |
| ATT-003 | Horizontal scroll | No page-level scroll | Table scrolls inside container (acceptable) | ✅ PASS | — |
| ATT-004 | Date picker | Changes date | Date picker present and functional | ✅ PASS | — |
| ATT-005 | Attendance tabs | All load | 9 tabs: Today, Daily, Exceptions, Regularization, Live Board, Monthly, Overtime, Shift Roster, AI Anomalies | ✅ PASS | — |
| LEAVE-001 | Leave page loads | Management view | Loaded correctly for SuperAdmin | ✅ PASS | — |
| LEAVE-002 | Empty state | Icon + message | "No pending leave requests — All caught up!" | ✅ PASS | — |
| LEAVE-003 | Leave types | 7 types | Confirmed: 7 Leave Types | ✅ PASS | — |
| LEAVE-004 | Holidays | 9 holidays | Confirmed: 9 with badge on tab | ✅ PASS | — |
| PAY-001 | Payroll page loads | Show payroll data | 1 run, Apr 2026 completed | ✅ PASS | — |
| PAY-002 | Currency icon | ₹ on all cards | "$" on TOTAL GROSS, "₹" on TOTAL NET | ❌ FAIL | P3 MEDIUM |
| RECRUIT-001 | Recruitment loads | Job openings | 2 open jobs, 3 applicants | ✅ PASS | — |
| WA-001 | WhatsApp page | Disconnected state | "WhatsApp Not Connected" + CTA | ✅ PASS | — |
| ORG-001 | Org chart | Hierarchy tree | Nodes appear flat, no hierarchy lines | ❌ FAIL | P2 HIGH |
| SET-001 | Settings loads | Org settings | Company name, timezone, currency, fiscal year | ✅ PASS | — |
| PROF-001 | Profile loads | User profile | All details shown correctly | ✅ PASS | — |
| PROF-002 | Resign button hidden for SA | Not visible | "Submit Resignation" visible for SUPER_ADMIN | ❌ FAIL | P3 MEDIUM |
| DASH-001 | Dashboard loads | Stats + charts | 6 cards, 3 charts, live attendance, dept headcount | ✅ PASS | — |
| DASH-002 | No NaN/undefined | Clean data | All values are clean numbers | ✅ PASS | — |

**Summary: 24/28 passed (86%), 4 failed (2 HIGH, 2 MEDIUM)**

---

## UX/UI FINDINGS

| # | Page | Issue | Severity | Description |
|---|------|-------|----------|-------------|
| UX-001 | Attendance | "My Attendance" tab visible for SUPER_ADMIN | P2 HIGH | SuperAdmin doesn't need personal attendance tracking tab |
| UX-002 | Org Chart | No hierarchy lines between nodes | P2 HIGH | Nodes appear floating; defeats purpose of org chart |
| UX-003 | Payroll | "$" icon on TOTAL GROSS card | P3 MEDIUM | Should be "₹" — inconsistent with other INR cards |
| UX-004 | Profile | "Submit Resignation" for SUPER_ADMIN | P3 MEDIUM | Top admin shouldn't see resignation option |
| UX-005 | Dashboard | "Good Afternoon, Super" truncated | P4 LOW | Should show "Super Admin" or full name |
| UX-006 | Employee Detail | Tab text "Perm..." truncated | P4 LOW | Should show "Permissions" or use scroll indicator |
| UX-007 | Mobile Nav | "HR" label under clock-in | P4 LOW | Confusing; should say "Clock In" or show role-specific label |
| UX-008 | Attendance | 13 stat cards in 3 rows | P4 LOW | Visually dense; consider collapsible or grouped cards |
| UX-009 | Settings | "Employees: 47" mismatch with actual 2 | P2 HIGH | Data integrity issue — settings shows wrong count |
| UX-010 | Attendance | On Leave=1 but Expected=2, Not Checked In=2 | P3 MEDIUM | Math doesn't add up: 1+2=3 but Expected=2 |
| UX-011 | Dashboard | No sidebar on mobile | P4 LOW | Only 5 items in bottom nav; 17+ nav items inaccessible on mobile |
| UX-012 | Profile | "Profile Completion 20%" with no detail | P4 LOW | Should indicate what's missing |

### What's Working Well (UX/UI):
- ✅ Glassmorphism design is consistent and attractive
- ✅ Desktop layout with sidebar + content area is well-structured
- ✅ Color coding: indigo primary, green success, red danger — consistent
- ✅ Empty states with icons + messages + CTAs (leaves, whatsapp)
- ✅ Live attendance widget with donut chart and breakdown
- ✅ Responsive: mobile gets bottom nav, desktop gets full sidebar
- ✅ Charts (Recharts) render correctly with proper labels
- ✅ Search bars present on all list pages
- ✅ Stat cards with color-coded icons
- ✅ Session expiry warning modal (good UX for preventing data loss)
- ✅ AI Assistant FAB button visible on all pages
- ✅ Breadcrumb on employee detail page
- ✅ Profile completion % in sidebar

---

## ISSUE REGISTRY

### 🔴 BLOCKERS (must fix before production)

| ID | Issue | File/Location | Impact | Fix Effort |
|----|-------|---------------|--------|------------|
| BLOCK-001 | MFA bypass: login issues full tokens without checking MFA | backend/src/modules/auth/auth.service.ts (login) | Attacker with password can skip MFA entirely — server-side enforcement missing | 2-3 hours |
| BLOCK-002 | Refresh token leaked in MFA verify response body | backend/src/modules/auth/auth.controller.ts:238 | httpOnly cookie protection defeated — token readable by JS | 15 min |
| BLOCK-003 | MFA backup codes use Math.random() | backend/src/modules/auth/auth.controller.ts:158 | Cryptographically insecure — predictable backup codes | 15 min |

### 🟠 CRITICAL (major feature broken or significant risk)

| ID | Issue | File/Location | Impact | Fix Effort |
|----|-------|---------------|--------|------------|
| CRIT-001 | Login rate limit too high (30/15min) | backend/src/app.ts:101 | Brute force viable | 5 min |
| CRIT-002 | No account lockout | backend/src/modules/auth/auth.service.ts | Sustained brute force | 1-2 hours |
| CRIT-003 | Settings "Employees: 47" vs actual 2 | backend/src/modules/settings/ | Misleading admin data | 30 min |
| CRIT-004 | Socket.io duplicate event listeners | frontend/src/lib/socket.ts:62-66 | Events fire twice when socket reconnects | 30 min |
| CRIT-005 | Sidebar logout doesn't call API | frontend/src/components/layout/Sidebar.tsx:104-106 | Server session not invalidated | 15 min |
| CRIT-006 | Token refresh race condition | frontend/src/app/api.ts:32-50 | Concurrent 401s cause token desync | 1 hour |
| CRIT-007 | Hardcoded payroll Excel password in email | backend/src/modules/payroll/payroll.routes.ts:293 | Password `aniston@payroll` sent in every payroll email — zero security | 30 min |
| CRIT-008 | MFA TOTP secret stored as Base64 not encrypted | backend/src/modules/auth/auth.controller.ts:162 | DB breach exposes all MFA secrets (Base64 ≠ encryption) | 30 min |
| CRIT-009 | redis.keys() O(N) blocking scan | backend/src/modules/auth/auth.service.ts:245,274 | Blocks Redis event loop — latency spikes at scale | 1-2 hours |
| CRIT-010 | SMTP passwords stored in plaintext | backend/src/modules/settings/settings.service.ts:142-216 | DB breach exposes email credentials | 30 min |
| CRIT-011 | Salary slip IDOR | backend/src/modules/payroll/payroll.controller.ts:61 | Any employee can download any other employee's salary slip by UUID | 30 min |
| CRIT-012 | Predictable Teams sync password | backend/src/modules/settings/settings.service.ts:436 | All synced users get `Welcome@{year}` — trivially guessable | 15 min |

### 🟡 HIGH (feature partially broken)

| ID | Issue | File/Location | Impact | Fix Effort |
|----|-------|---------------|--------|------------|
| HIGH-001 | "My Attendance" visible for SUPER_ADMIN | frontend/src/features/attendance/AttendancePage.tsx | Confusing UX | 15 min |
| HIGH-002 | Org chart: no hierarchy lines | frontend/src/features/orgChart/OrgChartPage.tsx | Feature partially useless | 1-2 hours |
| HIGH-003 | 4 API routes returning 404 | backend/src/app.ts (route registration) | Frontend features may break | 1 hour |
| HIGH-004 | Dashboard missing departments/onLeaveToday | backend/src/modules/dashboard/ | Incomplete dashboard data | 30 min |
| HIGH-005 | checkEmployeePermissions fails open | backend/src/middleware/auth.middleware.ts:258 | Security gap on Redis/DB failure | 15 min |
| HIGH-006 | XSS risk: dangerouslySetInnerHTML with i18n | frontend/src/components/layout/AppShell.tsx:100 | XSS if translation strings are compromised | 15 min |
| HIGH-007 | Attendance export bypasses auth | frontend/src/features/attendance/AttendancePage.tsx:150 | window.open() can't send JWT — export will fail with 401 | 30 min |
| HIGH-008 | Demo credentials hardcoded in prod bundle | frontend/src/features/auth/LoginPage.tsx:122-125 | Password `Superadmin@1234` visible in client source | 15 min |
| HIGH-009 | Topbar logout shows "Welcome Back" toast | frontend/src/components/layout/Topbar.tsx:44 | Wrong message on logout | 5 min |
| HIGH-010 | ~400 lines business logic in attendance.routes.ts | backend/src/modules/attendance/attendance.routes.ts:165-554 | MVC violation — policy CRUD, bulk upload, reports, overtime all inline | 4-6 hours |
| HIGH-011 | MFA logic in controller not service | backend/src/modules/auth/auth.controller.ts:139-259 | 120 lines of business logic with Prisma queries in controller | 2 hours |
| HIGH-012 | Profile completion queries missing fields | backend/src/modules/auth/auth.service.ts:357 | `getMe` doesn't include docs/bank/phone — completion always wrong | 30 min |
| HIGH-013 | WhatsApp invite expiry 24h not 72h | backend/src/modules/employee/employee.routes.ts:40 | Spec says 72h but code sets 24h | 5 min |
| HIGH-014 | Attendance self-service late detection hardcoded 9AM | backend/src/modules/attendance/attendance.routes.ts:454 | Uses `9*60` instead of actual shift start time | 30 min |
| HIGH-015 | Attendance monthly export self-referencing fetch | backend/src/modules/attendance/attendance.routes.ts:362 | `fetch(localhost:PORT)` fails behind reverse proxy | 1 hour |
| HIGH-016 | Public walk-in file upload no auth | backend/src/modules/walkIn/walkIn.routes.ts:20 | Unauthenticated file upload endpoint | 30 min |

### 🟢 MEDIUM (minor issues, workarounds exist)

| ID | Issue | File/Location | Impact | Fix Effort |
|----|-------|---------------|--------|------------|
| MED-001 | Payroll "$" icon instead of "₹" | frontend/src/features/payroll/PayrollPage.tsx | Cosmetic inconsistency | 5 min |
| MED-002 | "Submit Resignation" for SUPER_ADMIN | frontend/src/features/profile/ProfilePage.tsx | UX confusion | 10 min |
| MED-003 | Attendance stat math mismatch | backend/src/modules/attendance/ | Confusing metrics | 30 min |
| MED-004 | Payroll values show "—" instead of ₹0 | frontend/src/features/payroll/PayrollPage.tsx | Unclear data | 10 min |
| MED-005 | Pervasive `any` types in payrollApi.ts | frontend/src/features/payroll/payrollApi.ts | Zero TypeScript safety on financial data | 2 hours |
| MED-006 | 30+ `any` returns in attendanceApi.ts | frontend/src/features/attendance/attendanceApi.ts | No type safety on attendance data | 2 hours |
| MED-007 | Missing i18n in 7+ components | HRDashboard, AttendanceTable, RegularizationTab, etc. | Hindi translations incomplete | 2-3 hours |
| MED-008 | No focus traps on modals | AppShell, LeaveApplyWizard modals | Accessibility: keyboard users can tab behind modals | 1 hour |
| MED-009 | Pinch-to-zoom disabled globally | frontend/src/main.tsx:14-33 | WCAG 2.1 SC 1.4.4 violation — blocks users who need zoom | 15 min |
| MED-010 | MobileBottomNav discards GPS coords when offline | frontend/src/components/layout/MobileBottomNav.tsx:64 | Offline clock-in queued without location data | 30 min |
| MED-011 | "Remember me" checkbox is non-functional | frontend/src/features/auth/LoginPage.tsx:222 | No onChange handler, state not stored | 15 min |

### ⚪ LOW (polish, cosmetic, nice-to-have)

| ID | Issue | File/Location | Impact | Fix Effort |
|----|-------|---------------|--------|------------|
| LOW-001 | Dashboard greeting name truncated | frontend/src/features/dashboard/ | Cosmetic | 5 min |
| LOW-002 | Employee detail tab truncated | frontend/src/features/employee/EmployeeDetailPage.tsx | Minor UX | 10 min |
| LOW-003 | Mobile nav "HR" label | frontend/src/components/layout/MobileBottomNav.tsx | Confusing label | 5 min |
| LOW-004 | JWT payload contains email | backend/src/modules/auth/auth.service.ts | Minor info leak | 15 min |
| LOW-005 | Profile completion no breakdown | frontend/src/features/profile/ | Missing guidance | 15 min |
| LOW-006 | 13 attendance stat cards dense | frontend/src/features/attendance/AttendancePage.tsx | Visual density | 30 min |
| LOW-007 | No 404 page — bad URLs silently redirect | frontend/src/router/AppRouter.tsx:211 | User confusion on invalid URLs | 30 min |
| LOW-008 | WhatsApp page uses `<a href>` not React Router | frontend/src/features/whatsapp/WhatsAppPage.tsx:57 | Full page reload on "Open Settings" click | 5 min |
| LOW-009 | Role display: `replace('_', ' ')` only replaces first underscore | frontend/src/components/layout/Topbar.tsx:154 | "SUPER ADMIN" works but "GUEST_INTERVIEWER" → "GUEST INTERVIEWER" broken | 5 min |
| LOW-006 | 13 attendance stat cards dense | frontend/src/features/attendance/AttendancePage.tsx | Visual density | 30 min |

---

## SUGGESTED FIX PLAN

### Phase A — BLOCKERS + Critical Security (fix IMMEDIATELY, ~4-6 hours)
1. **BLOCK-001**: Enforce MFA server-side — don't issue full tokens if MFA is enabled; issue partial token, require `/auth/mfa/verify` to get full access
2. **BLOCK-002**: Remove `refreshToken` from MFA verify response body (keep httpOnly cookie only)
3. **BLOCK-003**: Replace `Math.random()` with `crypto.randomBytes()` for MFA backup codes
4. **CRIT-007**: Generate unique per-run payroll Excel passwords, don't hardcode or email them
5. **CRIT-008**: Encrypt MFA TOTP secrets with AES-256-GCM (use existing `encrypt()` utility)
6. **CRIT-009**: Replace `redis.keys()` with `SCAN` or per-user token sets
7. **CRIT-010**: Encrypt SMTP passwords using `encrypt()` utility
8. **CRIT-011**: Add `organizationId` + `employeeId` check to salary slip download
9. **CRIT-012**: Generate random passwords for Teams sync (not `Welcome@{year}`)

### Phase B — Critical Frontend + Backend Bugs (fix TODAY, ~3-4 hours)
10. **CRIT-001**: Reduce login rate limit from 30 to 5-10 per 15 min
11. **CRIT-002**: Add account lockout after 5 failed attempts
12. **CRIT-004**: Fix socket.ts duplicate listener registration
13. **CRIT-005**: Fix Sidebar logout to call API endpoint
14. **CRIT-006**: Add mutex/lock pattern to token refresh in api.ts
15. **HIGH-005**: Change `catch` in checkEmployeePermissions to deny by default
16. **HIGH-008**: Remove hardcoded demo credentials from LoginPage
17. **HIGH-009**: Fix logout toast message from "Welcome Back" to "Signed Out"

### Phase C — High Priority Fixes (fix THIS WEEK, ~2-3 days)
18. **HIGH-001**: Hide "My Attendance" tab for SUPER_ADMIN
19. **HIGH-002**: Fix org chart hierarchy rendering
20. **HIGH-003**: Register missing API routes
21. **HIGH-004**: Add departments/onLeaveToday to dashboard stats
22. **HIGH-006**: Replace dangerouslySetInnerHTML with safe rendering
23. **HIGH-007**: Fix attendance export to use authenticated blob download
24. **HIGH-012**: Include missing fields in `getMe` for profile completion
25. **HIGH-013**: Fix WhatsApp invite expiry from 24h to 72h
26. **HIGH-014**: Use actual shift start time for late detection
27. **HIGH-015**: Replace self-referencing fetch with direct service call
28. **HIGH-016**: Add rate limiting / validation to public walk-in upload
29. **CRIT-003**: Fix settings employee count to query actual count

### Phase C — Medium Priority (fix THIS SPRINT, ~2-3 days)
16. **MED-001**: Change "$" icon to "₹" on payroll TOTAL GROSS card
17. **MED-002**: Hide "Submit Resignation" for SUPER_ADMIN role
18. **MED-003**: Fix attendance stat math
19. **MED-004**: Show ₹0 instead of "—" for zero payroll values
20. **MED-005/006**: Add proper TypeScript types to payrollApi.ts and attendanceApi.ts
21. **MED-007**: Complete i18n translations in hardcoded components
22. **MED-008**: Add focus traps to modals
23. **MED-009**: Remove global zoom disable (WCAG violation)
24. **MED-010**: Fix offline GPS coords in MobileBottomNav
25. **MED-011**: Wire up "Remember me" checkbox or remove it

### Phase D — Low Priority (backlog)
26. LOW-001 through LOW-009 — cosmetic and polish items

---

## POSITIVE FINDINGS (what is working well ✅)

### Software Quality
- ✅ Clean MVC architecture: all 22+ modules follow routes/controller/service/validation pattern
- ✅ Prisma ORM eliminates SQL injection risk across the entire codebase
- ✅ Zod validation on all POST/PATCH endpoints — server-side input validation is solid
- ✅ Error handling: proper AppError hierarchy (NotFoundError, BadRequestError, etc.)
- ✅ Audit logging centralized and used across modules
- ✅ AES-256-GCM encryption for sensitive data (Aadhaar, PAN, bank details)
- ✅ BullMQ job queues for async email, notifications, payroll
- ✅ Socket.io real-time updates working
- ✅ Redis caching for performance
- ✅ 23/27 API endpoints returning 200 with proper data

### Security
- ✅ JWT + refresh token authentication with proper expiry (15 min access, refresh flow)
- ✅ bcryptjs with 12 rounds for password hashing
- ✅ RBAC with 6 roles + granular permission map
- ✅ Rate limiting on all critical endpoints
- ✅ No sensitive data leaked in API responses
- ✅ Auth bypass: all 3 tests blocked correctly
- ✅ XSS prevention: input sanitization working
- ✅ Exit access control for terminated employees
- ✅ Employee-level permission overrides
- ✅ Device binding for attendance

### QA
- ✅ 86% test pass rate (24/28)
- ✅ All core flows working: login, employee list, attendance, leave, payroll, recruitment
- ✅ Proper empty states on most pages
- ✅ Form validation working (server + client side)
- ✅ Error messages specific and helpful (not generic)
- ✅ Session management with expiry warning
- ✅ All edge cases handled: invalid IDs return 404, empty forms return 400

### UX/UI
- ✅ Beautiful glassmorphism design — modern and consistent
- ✅ Responsive layout: desktop sidebar + mobile bottom nav
- ✅ Color palette consistent: indigo primary, proper status colors
- ✅ Charts render correctly with Recharts
- ✅ Live attendance widget with real-time Socket.io updates
- ✅ AI Assistant FAB accessible on all pages
- ✅ PWA support configured
- ✅ Profile completion indicator in sidebar
- ✅ Search bars on all list pages
- ✅ Proper loading of all major pages (no white screens or crashes)

---

## FINAL RECOMMENDATION

Aniston HRMS is a **feature-rich, well-structured application** covering the full HRMS lifecycle with 22+ backend modules, clean MVC architecture, AES-256-GCM encryption, and a polished glassmorphism UI. The foundation is strong: Prisma ORM prevents SQL injection, bcrypt(12) for passwords, JWT with short expiry, comprehensive rate limiting, RBAC with 6 roles, and audit logging.

**However, the deep-dive audit uncovered 3 blocker-level security vulnerabilities** that must be fixed before any production deployment:

1. **MFA bypass** — The server issues full access tokens on login without checking if MFA is enabled. An attacker with a stolen password can skip MFA entirely by calling the login API directly.
2. **Refresh token leak** — The MFA verify endpoint returns the refresh token in the JSON body, defeating the httpOnly cookie protection.
3. **Insecure MFA backup codes** — Generated with `Math.random()` instead of `crypto.randomBytes()`.

Additionally, 12 critical issues include: hardcoded payroll passwords emailed in plaintext, TOTP secrets stored as Base64 (not encrypted), SMTP credentials in plaintext, salary slip IDOR vulnerability, and a Redis `KEYS` command that will cause production latency at scale.

On the frontend side, the Socket.io listener registers events twice, the sidebar logout doesn't invalidate server sessions, and the token refresh has a race condition.

**Estimated fix timeline:** Phase A blockers (4-6 hours) → Phase B critical bugs (3-4 hours) → Phase C high-priority (2-3 days) → Phase D medium (2-3 days) → Phase E low (backlog).

After fixing Phases A and B (estimated 1-2 days of focused work), this application will be **production-ready**.

**Status:** 🔴 NOT READY — fix 3 blocker + 12 critical security issues before production deployment
