---
name: audit-dead-ui-wiring
description: "Audit all frontend pages for dead UI, unwired buttons, stale modal state, broken dropdowns, missing loading/error states, API mismatches, mobile overflow"
---

# Dead UI & Wiring Audit — Aniston HRMS

Use `frontend-wiring-agent`. Check every page, every tab, every button, every modal.

## Step 1: Route Inventory
Read `frontend/src/router/AppRouter.tsx`. List every route and verify:
- Component file exists at the lazy import path
- Route has correct role guard
- Route has Suspense fallback

## Step 2: Page-by-Page Audit
For each page, open the component file and check every interactive element:

### Auth Pages
- `/login` — `LoginPage.tsx`: form submits, error shown, redirect works
- `/` — redirect to correct dashboard based on role

### Dashboard
- `/dashboard` — `DashboardPage.tsx`: all stats cards loaded, charts render
- Check: stats API called with `organizationId` scope

### Employee Module
- `/employees` — `EmployeesPage.tsx`: list loads, filters work, add button wired
- `/employees/:id` — `EmployeeDetailPage.tsx`: all tabs load, edit saves, delete with approval

### Attendance Module
- `/attendance` — tabs: Office | Field Sales | Project Site
- Office: clock-in/out button wired
- Field Sales: GPS trail visible
- Project Site: photo capture wired

### Leave Module
- `/leave` — tabs by role
- Employee: apply form, balance shown, history list
- Manager: pending requests list, approve/reject buttons wired
- HR: all requests visible, settings tab

### Payroll Module
- `/payroll` — employee sees own slips, admin sees run payroll
- Admin: run payroll button, month/year selector, download button

### KYC
- `/kyc` — `KycGatePage.tsx`: upload flow, re-upload banner when REUPLOAD_REQUIRED
- `/kyc/hr-review` — `KycHrReviewPage.tsx`: review panel, verify/reject/delete with reason

### Recruitment
- `/recruitment` — Kanban board, public applications tab
- Interview scheduling modal, finalization modal

### Settings
- `/settings` — tabs: General | AI Config | Task Integration | Branding | Audit Logs
- Each tab: loads data, save button wired

### Walk-in Kiosk
- `/walk-in` — public, 5-step form completes, HR management view

### Public Routes
- `/apply/:token` — MCQ form renders, submission works
- `/track/:uid` — status display correct
- `/onboarding/invite/:token` — token validation, form submission

## Step 3: Mobile Overflow Check (375px viewport)
For each page listed above, verify at 375px:
- No horizontal scroll
- Tables scroll or collapse to cards
- Buttons don't overflow
- Modals fit screen

## Step 4: RTK Query Invalidation Audit
For each mutation in `frontend/src/features/*/[module]Api.ts`:
- List all `invalidatesTags` entries
- Check: are ALL affected query caches invalidated?
- Flag any mutation where only partial invalidation happens

## Step 5: API Mismatch Detection
For each RTK Query endpoint:
- Read the endpoint URL and method
- Find the matching Express route in `backend/src/modules/`
- Verify: URL matches, method matches, body shape matches, response envelope handled

## Output
Produce findings using UI-WIRE format from `frontend-wiring-agent`.
Group by: DEAD_BUTTON, API_MISMATCH, STALE_MODAL, MISSING_INVALIDATION, OVERFLOW, EMPTY_STATE.
Give severity for each finding.
Total count: "Found X dead UI issues, Y API mismatches, Z overflow issues."