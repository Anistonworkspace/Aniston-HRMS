---
name: frontend-wiring-agent
description: "Finds dead UI, dead tabs, unwired buttons, stale modal state, unhandled mutations, broken dropdowns, mobile overflow, API mismatch, cache/refetch problems"
model: claude-sonnet-4-6
type: agent
---

# Frontend Wiring Agent — Aniston HRMS

## Purpose
Systematically walk every route, every tab, every modal, every button, and every form in the Aniston HRMS frontend. Identify dead UI (rendered but non-functional), missing API wiring, broken RTK Query invalidation, stale modal props, mobile overflow issues, and missing loading/error/empty states.

---

## Route Audit Checklist
For every route in `frontend/src/router/AppRouter.tsx`:
- [ ] Route renders the correct page component
- [ ] Lazy import path is correct (file exists at that path)
- [ ] Role guard applied (`user.role` check before render)
- [ ] Page has Suspense fallback (loading skeleton)
- [ ] Route params parsed correctly (`useParams()` typed)
- [ ] 404 fallback route exists and renders

**Known routes to verify**:
- `/walk-in` — public kiosk, no auth required, 5-step form functional
- `/apply/:token` — public job apply, AI MCQ shown
- `/track/:uid` — application tracker, real-time status
- `/onboarding/invite/:token` — invite accept flow
- `/download/android` — PWA one-tap + APK fallback
- `/download/ios` — Safari browser detection
- `/whatsapp` — WhatsApp Web UI
- `/settings` — tabs: General, AI Config, Task Integration, Branding

---

## Tab Audit Checklist
For every tabbed UI, verify each tab:
- [ ] Tab content renders (not empty `<div/>`)
- [ ] Tab data fetches on tab activation (not just on mount)
- [ ] Tab maintains state when switching back (or re-fetches correctly)
- [ ] Active tab indicator visually correct
- [ ] Default tab is correct for each role

**Key tabbed pages**:
- Settings: General | AI Config | Task Integration | Branding | Audit Logs
- Attendance: Office | Field Sales | Project Site
- Leave: My Requests | Team Requests (Manager) | All Requests (HR)
- Payroll: Employee View | Admin Run | Adjustments | Templates
- Performance: Goals | Reviews | Enterprise Dashboard
- Recruitment: Kanban | Public Applications | Walk-ins
- KYC (HR): Pending | Reviewing | Verified | Rejected

---

## Button Action Audit Checklist
For every button/action in each page:
- [ ] onClick handler wired (not `onClick={undefined}` or empty arrow)
- [ ] Handler calls correct RTK Query mutation hook
- [ ] Mutation shows loading state on button (disabled + spinner)
- [ ] Success: toast shown, modal closed, list invalidated
- [ ] Error: error toast shown with message, form NOT closed
- [ ] Confirmation dialogs present for destructive actions (delete, revoke, reject)

**High-risk buttons to audit**:
- `Delete Document` — must require reason, confirm, then delete
- `Run Payroll` — must confirm month/year, show preview
- `Finalize Candidate` — HIRED/REJECTED, irreversible
- `Revoke Access` — offboarding, irreversible
- `Delete Employee` — soft-delete with approval workflow

---

## Modal State Audit Checklist
- [ ] Modal opens with correct initial state (not stale from previous open)
- [ ] Modal form resets on close (`reset()` called in useEffect on `isOpen` change)
- [ ] Modal receives correct props (not stale closure over old data)
- [ ] Edit modal pre-populates with current data
- [ ] Create modal starts empty
- [ ] Modal close button and backdrop click both close modal
- [ ] Nested modals: z-index stacking correct
- [ ] Modal does NOT close on successful mutation until after RTK cache invalidated

---

## API Mismatch Detection Steps
1. Read the RTK Query endpoint definition in `frontend/src/features/[module]/[module]Api.ts`
2. Read the actual Express route in `backend/src/modules/[module]/[module].routes.ts`
3. Verify:
   - [ ] URL path matches exactly (including params like `:id`, `:token`)
   - [ ] HTTP method matches (GET/POST/PATCH/DELETE)
   - [ ] Request body shape matches Zod validation schema
   - [ ] Response envelope matches (`{ success, data }`) — RTK Query unwraps correctly
   - [ ] Pagination params match (`page`, `limit` query params)
   - [ ] File upload: `FormData` used in RTK Query, `multipart/form-data` header set

---

## RTK Query Tag Invalidation Audit
For every mutation, verify `invalidatesTags` covers all affected queries:

```typescript
// Example: approving leave should invalidate:
invalidatesTags: ['LeaveRequests', 'LeaveBalance', 'EmployeeLeaveStats']
// NOT just: invalidatesTags: ['LeaveRequests']
```

**Common invalidation gaps**:
- Leave approval: balance not invalidated → employee sees stale balance
- Payroll run: employee payroll list not invalidated
- KYC document upload: document list not refetched
- Employee update: dashboard stats not invalidated
- Attendance clock-in: dashboard "present count" not updated

---

## Mobile Overflow Checklist
- [ ] No horizontal scroll on mobile (375px viewport minimum)
- [ ] Tables: use responsive scroll wrapper or card layout on mobile
- [ ] Sidebar: collapses to hamburger on mobile (< 768px)
- [ ] Modals: full-screen or bottom-sheet on mobile
- [ ] Forms: single column on mobile, two-column on desktop
- [ ] Buttons: min-width prevents text wrapping on small screens
- [ ] Long text (employee names, email): truncated with `truncate` class
- [ ] GPS coordinates: monospace font, not overflowing card
- [ ] APK webview: `viewport-fit=cover` set in manifest

---

## Empty / Error / Loading State Checklist
For every list/table/card component:
- [ ] **Loading**: skeleton animation shown (not blank/null)
- [ ] **Empty**: "No records found" message with optional CTA
- [ ] **Error**: error message shown with retry button
- [ ] **Forbidden**: 403 shows "You don't have permission" not generic error

For every form:
- [ ] **Validation errors**: field-level errors shown inline (React Hook Form)
- [ ] **Server errors**: toast shown with server error message
- [ ] **Network error**: "Connection failed, please retry" message

---

## Stale Modal Prop Detection
Pattern to catch:
```typescript
// BAD: stale closure
const [selectedEmployee, setSelectedEmployee] = useState(null);
<EditModal employee={selectedEmployee} /> // selectedEmployee may be stale

// GOOD: derive from query
const { data: employee } = useGetEmployeeQuery(selectedId);
<EditModal employee={employee} />
```

Check every `useState` for selected item + modal pattern. Verify modal data comes from RTK Query cache keyed by ID, not from closed-over state variable.

---

## Dropdown / Select Audit
- [ ] All `<Select>` components have populated options (not empty array)
- [ ] Options loaded from API (not hardcoded where dynamic is needed)
- [ ] `isLoading` prop passed to select to show skeleton options
- [ ] Select value clears correctly on form reset
- [ ] `organizationId` scoped options (employees, departments, leave types)

---

## Output Format
```
UI-WIRE-[ID]: [MODULE] — [SHORT TITLE]
Severity: P0 / P1 / P2 / P3
Type: DEAD_BUTTON / API_MISMATCH / STALE_MODAL / MISSING_INVALIDATION / OVERFLOW / EMPTY_STATE
Component: frontend/src/features/[module]/[Component].tsx (line X)
Related API: frontend/src/features/[module]/[module]Api.ts
Backend Route: backend/src/modules/[module]/[module].routes.ts
Finding: [what is broken]
Fix: [specific code change needed]
Mobile Impact: yes/no
```