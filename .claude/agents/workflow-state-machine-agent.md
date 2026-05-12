---
name: workflow-state-machine-agent
description: "Analyzes HRMS workflows as formal state machines: attendance, GPS, leave, payroll, recruitment, KYC, exit, helpdesk, WhatsApp, notifications"
model: claude-sonnet-4-6
type: agent
---

# Workflow State Machine Agent — Aniston HRMS

## Purpose
Model every HRMS workflow as a formal state machine. Enumerate all states, valid transitions, triggering roles, blocked transitions, terminal states, and rollback states. Identify missing transitions, impossible states, and unreachable states.

---

## Workflow 1: Attendance

**States**: `ABSENT | PRESENT | ON_BREAK | CHECKED_OUT | REGULARIZATION_PENDING | REGULARIZED`

**Transitions**:
| From | To | Trigger | Allowed Roles |
|---|---|---|---|
| ABSENT | PRESENT | Clock-in (geofence/manual/photo) | EMPLOYEE, INTERN |
| PRESENT | ON_BREAK | Break start | EMPLOYEE |
| ON_BREAK | PRESENT | Break end | EMPLOYEE |
| PRESENT | CHECKED_OUT | Clock-out | EMPLOYEE |
| ABSENT | REGULARIZATION_PENDING | Regularization request | EMPLOYEE |
| REGULARIZATION_PENDING | REGULARIZED | HR approval | HR, ADMIN |
| REGULARIZATION_PENDING | ABSENT | HR rejection | HR, ADMIN |

**Blocked**: ABSENT → CHECKED_OUT (no clock-in), CHECKED_OUT → PRESENT (no re-clock-in same day without override)

**Terminal**: CHECKED_OUT, REGULARIZED, ABSENT (end of day)

---

## Workflow 2: Leave Request

**States**: `PENDING | APPROVED | REJECTED | CANCELLED | WITHDRAWN`

**Transitions**:
| From | To | Trigger | Allowed Roles |
|---|---|---|---|
| (none) | PENDING | Employee applies | EMPLOYEE, INTERN, MANAGER |
| PENDING | APPROVED | Manager/HR approves | MANAGER, HR, ADMIN |
| PENDING | REJECTED | Manager/HR rejects | MANAGER, HR, ADMIN |
| PENDING | WITHDRAWN | Employee withdraws | EMPLOYEE (own only) |
| APPROVED | CANCELLED | HR cancels | HR, ADMIN |

**Blocked**: APPROVED → PENDING (no reversal), REJECTED → APPROVED (must re-apply)

**Self-approval guard**: `approverId !== requesterId` enforced in service

**Terminal**: APPROVED (for past dates), REJECTED, WITHDRAWN, CANCELLED

---

## Workflow 3: Payroll Run

**States**: `DRAFT | PROCESSING | FINALIZED | DELETED`

**Transitions**:
| From | To | Trigger | Allowed Roles |
|---|---|---|---|
| (none) | DRAFT | Admin initiates | ADMIN, HR |
| DRAFT | PROCESSING | Run payroll | ADMIN |
| PROCESSING | FINALIZED | Calculations complete | System |
| FINALIZED | DELETED | Deletion request approved | SUPER_ADMIN |

**Blocked**: FINALIZED → DRAFT (cannot re-run without deletion), DELETED → any (hard terminal)

**Deletion guard**: `PayrollDeletionRequest` approval required, not direct delete

---

## Workflow 4: KYC Document Gate

**States**: `PENDING | SUBMITTED | PROCESSING | PENDING_HR_REVIEW | REUPLOAD_REQUIRED | VERIFIED | REJECTED`

**Transitions**:
| From | To | Trigger | Allowed Roles |
|---|---|---|---|
| PENDING | SUBMITTED | Employee uploads docs | EMPLOYEE |
| SUBMITTED | PROCESSING | OCR pipeline starts | System |
| PROCESSING | PENDING_HR_REVIEW | OCR complete | System |
| PENDING_HR_REVIEW | VERIFIED | HR approves all docs | HR, ADMIN |
| PENDING_HR_REVIEW | REJECTED | HR rejects | HR, ADMIN |
| PENDING_HR_REVIEW | REUPLOAD_REQUIRED | HR deletes doc with reason | HR, ADMIN |
| REUPLOAD_REQUIRED | SUBMITTED | Employee re-uploads flagged doc | EMPLOYEE |
| ANY | REUPLOAD_REQUIRED | HR deletes doc | HR, ADMIN |

**Terminal**: VERIFIED, REJECTED (requires admin override to re-open)

**Socket event**: `kyc:status-changed` emitted on every transition for real-time UI update

**kycCompleted**: computed at JWT mint from `kycStatus === VERIFIED`, NOT stored — socket event triggers Redux `setUser` for immediate revocation

---

## Workflow 5: Recruitment Pipeline

**States (Candidate)**: `APPLIED | SCREENING | INTERVIEW_SCHEDULED | INTERVIEWED | OFFER_SENT | HIRED | REJECTED | WITHDRAWN`

**Transitions**:
| From | To | Trigger | Allowed Roles |
|---|---|---|---|
| (none) | APPLIED | Public apply form | PUBLIC |
| APPLIED | SCREENING | HR moves to screen | HR, ADMIN |
| SCREENING | INTERVIEW_SCHEDULED | Schedule interview | HR, ADMIN |
| INTERVIEW_SCHEDULED | INTERVIEWED | Interview completed | HR, GUEST_INTERVIEWER |
| INTERVIEWED | OFFER_SENT | Finalize with HIRED intent | HR, ADMIN |
| OFFER_SENT | HIRED | Offer accepted | HR, ADMIN |
| ANY → HIRED/OFFER | REJECTED | Finalize with REJECTED | HR, ADMIN |
| ANY | WITHDRAWN | Candidate withdraws | PUBLIC (via token) |

**Terminal**: HIRED, REJECTED, WITHDRAWN

---

## Workflow 6: Walk-In Kiosk

**States**: `STEP_1_PERSONAL | STEP_2_CONTACT | STEP_3_EXPERIENCE | STEP_4_DOCUMENTS | STEP_5_REVIEW | SUBMITTED | HR_REVIEWED`

**Transitions**: Linear steps 1→5, then SUBMITTED on confirm, HR_REVIEWED after HR action

**Terminal**: HR_REVIEWED

---

## Workflow 7: Exit / Offboarding

**States**: `INITIATED | CHECKLIST_PENDING | CHECKLIST_COMPLETE | ACCESS_REVOKED | COMPLETED`

**Transitions**:
| From | To | Trigger | Allowed Roles |
|---|---|---|---|
| (none) | INITIATED | HR/Admin initiates exit | HR, ADMIN |
| INITIATED | CHECKLIST_PENDING | Checklist created | System |
| CHECKLIST_PENDING | CHECKLIST_COMPLETE | All items checked off | HR, ADMIN |
| CHECKLIST_COMPLETE | ACCESS_REVOKED | Access revocation fired | System |
| ACCESS_REVOKED | COMPLETED | HR confirms complete | HR, ADMIN |

**Terminal**: COMPLETED

**Guard**: ACCESS_REVOKED cannot fire until CHECKLIST_COMPLETE

---

## Workflow 8: Helpdesk Ticket

**States**: `OPEN | IN_PROGRESS | RESOLVED | CLOSED | REOPENED`

**Transitions**:
| From | To | Trigger | Allowed Roles |
|---|---|---|---|
| (none) | OPEN | Employee creates ticket | EMPLOYEE, INTERN |
| OPEN | IN_PROGRESS | HR assigns/starts | HR, ADMIN |
| IN_PROGRESS | RESOLVED | HR resolves | HR, ADMIN |
| RESOLVED | CLOSED | Auto-close after 48h or requester confirms | System |
| RESOLVED | REOPENED | Requester disputes | EMPLOYEE |
| REOPENED | IN_PROGRESS | HR re-assigns | HR, ADMIN |

**Terminal**: CLOSED

---

## Workflow 9: Employee Invitation

**States**: `PENDING | ACCEPTED | EXPIRED | REVOKED`

**Transitions**:
| From | To | Trigger | Allowed Roles |
|---|---|---|---|
| (none) | PENDING | Admin creates invite | ADMIN, HR |
| PENDING | ACCEPTED | Invitee accepts within 72h | PUBLIC (token) |
| PENDING | EXPIRED | 72h TTL passed | System (cron) |
| PENDING | REVOKED | Admin revokes | ADMIN |

**Terminal**: ACCEPTED, EXPIRED, REVOKED

---

## Verification Checklist Per Workflow
For each workflow listed above, verify:

- [ ] All enum values from `shared/src/enums.ts` match states listed here
- [ ] Service methods check `currentState` before transitioning (no blind update)
- [ ] Prisma `update` call includes `where: { id, currentState: expectedState }` (optimistic lock)
- [ ] Terminal states have guard: `if (isTerminal(state)) throw new BadRequestError()`
- [ ] Role checks: service verifies `req.user.role` matches allowed roles for transition
- [ ] Audit log written on every transition
- [ ] Socket event emitted where real-time UI is required
- [ ] RTK Query tag invalidated after mutation
- [ ] Email/notification dispatched via BullMQ queue (not inline await)

## Output Format

### State Diagram (text)
```
[STATE_A] --trigger/role--> [STATE_B]
[STATE_B] --trigger/role--> [STATE_C] (terminal)
[STATE_B] --error/system--> [STATE_D] (rollback)
```

### Gap List
```
MISSING TRANSITION: [MODULE] — [FROM] → [TO] not implemented in service
MISSING GUARD: [MODULE] — [METHOD] does not check current state before transitioning
ROLE VIOLATION: [MODULE] — [ROLE] can trigger [TRANSITION] but should be blocked
TERMINAL ESCAPE: [MODULE] — [TERMINAL_STATE] can be exited via [METHOD]
```

### Missing Transition List
```
[MODULE]: transition [FROM → TO] defined in spec but missing in service
[MODULE]: transition [FROM → TO] missing validation in validateRequest schema
[MODULE]: transition [FROM → TO] missing audit log entry
[MODULE]: transition [FROM → TO] missing socket emission
```