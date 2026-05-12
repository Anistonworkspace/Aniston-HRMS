---
name: audit-all-workflows
description: "Full workflow audit: trace every user-facing workflow end-to-end, verify UI → API → DB → notification → UI refresh cycle"
---

# Full Workflow Audit — Aniston HRMS

Audit every user-facing workflow as a complete end-to-end trace. For each workflow, verify the entire cycle: UI trigger → API → service → DB → BullMQ/socket → UI update.

## Workflows to Audit

### Workflow 1: Employee Leave Application
**Trace**:
1. Employee clicks "Apply Leave" → `LeavePage.tsx` form submits
2. RTK Query `useApplyLeaveMutation()` → `POST /api/leaves`
3. `authenticate` → `requirePermission('leaves', 'create')` → `validateRequest`
4. `leave.controller` → `leave.service.createLeaveRequest()`
5. Check: `LeaveBalance` sufficient → create `LeaveRequest` (PENDING) → `prisma.$transaction`
6. BullMQ: `notificationQueue.add('leave-applied')` → manager notified
7. Response: `{ success: true, data: leaveRequest }`
8. RTK: `invalidatesTags(['LeaveRequests', 'LeaveBalance'])`
9. UI: list refreshes, balance updates

**Check each step**: does it exist? Is it correct? Is it missing?

---

### Workflow 2: Manager Leave Approval
**Trace**:
1. Manager sees notification → clicks approve in `LeavePage.tsx` manager panel
2. RTK Query `useApproveLeaveM­utation()` → `PATCH /api/leaves/:id/approve`
3. Auth + permission + self-approval guard (`approverId !== requesterId`)
4. Service: `leaveRequest.status = PENDING` verified → `prisma.$transaction` → update to APPROVED + deduct balance
5. BullMQ: email to employee, notification to HR
6. Response: success
7. RTK: `invalidatesTags(['LeaveRequests', 'LeaveBalance', 'EmployeeStats'])`

---

### Workflow 3: KYC Document Submission & Review
**Trace (submit)**:
1. Employee submits docs in `KycGatePage.tsx`
2. `POST /api/documents` with `FormData` (multipart)
3. Multer middleware validates MIME + size
4. Service: save document record + upload file → update `DocumentGate` to SUBMITTED
5. OCR queue job triggered: `document-ocr` module processes
6. On OCR complete: gate → PENDING_HR_REVIEW
7. Socket: `kyc:status-changed` emitted to employee's room
8. HR notified via notification queue

**Trace (HR approve)**:
1. HR reviews in `KycHrReviewPage.tsx`
2. `PATCH /api/documents/:id/verify` → gate → VERIFIED
3. Socket: `kyc:status-changed` → employee Redux `setUser({ kycCompleted: true })`

**Trace (HR delete with reason)**:
1. HR enters reason → `DELETE /api/documents/:id` with `{ reason: "..." }` in body
2. `document.service.remove()`: soft-delete + `storageService.deleteFile()` (non-blocking)
3. `resetKycOnDocumentDeletion()`: gate → REUPLOAD_REQUIRED, reason stored in `documentRejectReasons`
4. Email: `document-deleted` template to employee
5. Socket: `kyc:status-changed` → employee Redux `setUser({ kycCompleted: false })` immediately

---

### Workflow 4: Payroll Run
**Trace**:
1. Admin clicks "Run Payroll" for month/year
2. `POST /api/payroll/run` with `{ month, year }`
3. Idempotency: check `Payroll` record exists for this month/year/org → reject if already finalized
4. Service: fetch all active employees → calculate EPF/ESI/PT/TDS per employee
5. `prisma.$transaction`: create Payroll + PayrollItems + SalaryHistory records
6. BullMQ: `payrollQueue.add('generate-payslips')` → PDF generated per employee
7. Response: `{ success: true, data: { employeeCount, totalAmount } }`
8. RTK: `invalidatesTags(['Payroll'])`

---

### Workflow 5: Public Job Application
**Trace**:
1. Candidate visits `/apply/:token`
2. `GET /api/jobs/:token` (public) → returns job details + AI MCQ questions
3. Candidate submits form → `POST /api/jobs/:token/apply`
4. Creates `PublicApplication` record + stores MCQ answers + calculates MCQ score
5. Email: confirmation to candidate with tracking UID
6. HR notified: new application in pipeline
7. Candidate visits `/track/:uid` to see status

---

### Workflow 6: Employee Onboarding via Invite
**Trace**:
1. HR creates invite → `POST /api/invitations` → email sent
2. Employee clicks email link → `/onboarding/invite/:token`
3. `GET /api/invitations/validate/:token` → validates token not expired
4. Employee submits name/password → `POST /api/invitations/accept/:token`
5. `prisma.$transaction`: create `User` + create `Employee` + update invite to ACCEPTED + create onboarding record
6. Response: JWT tokens → employee logged in
7. Redirect to 7-step onboarding wizard

---

### Workflow 7: Field Sales GPS Trail
**Trace**:
1. Employee opens app, grants GPS permission, foreground service starts
2. Every 60s: GPS point captured → buffered locally
3. Every 10 points: `POST /api/attendance/gps-trail` with batch
4. Service: save `LocationVisit` records + cluster visits (200m radius, >10min = stop)
5. Clock-out: trail finalized, visit summary computed
6. HR view: `FieldSalesView.tsx` shows trail on map

---

## Audit Output for Each Workflow
For each workflow:
1. Is every step implemented? (yes/partial/missing)
2. Are there gaps in the chain (step X completes but step X+1 never triggered)?
3. Are there missing error handlers (what if step X fails)?
4. Is the UI correctly refreshed after the workflow completes?
5. Are notifications/emails sent at the right steps (not too many, not missing)?

Produce a WORKFLOW-GAP finding for each broken link in any workflow chain.