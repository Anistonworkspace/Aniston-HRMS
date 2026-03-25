# ANISTON HRMS — COMPLETE RECREATION MEGA PROMPT
### Version 3.0 | Full Audit-Based | Production-Ready

> **Instructions for AI Agent:** Build "Aniston HRMS" — a complete, production-grade, enterprise Human Resource Management System as a Progressive Web Application. Follow every section precisely. Do NOT skip any model, endpoint, or component. The app name is **Aniston HRMS** for **Aniston Technologies LLP**.

---

## 1. PROJECT OVERVIEW

**Aniston HRMS** is an enterprise-grade HR platform for modern Indian organizations. It handles:
- **3 attendance modes** (Office geofence, Field Sales GPS, Project Site photo)
- **Full recruitment pipeline** (Job posting → AI screening → Kanban → Offer → Onboarding)
- **Walk-in candidate kiosk** (Public self-registration → Interview rounds → Hiring)
- **Indian payroll compliance** (EPF, ESI, PT, TDS with old/new tax regime)
- **Microsoft Teams integration** (SSO + employee sync from Azure AD)
- **Asset management** (CRUD + assign/return workflow)
- **Employee lifecycle** (Hire → Probation → Confirm → Promote → Exit)
- **Monday.com-inspired UI** with glassmorphism, layered shadows, depth hierarchy

---

## 2. TECH STACK

### Frontend
- **Framework:** React 18+ with Vite 8+
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS v3 + shadcn/ui + Radix UI primitives
- **State:** Redux Toolkit with RTK Query (auto-caching, tag-based invalidation)
- **Animations:** Framer Motion
- **Charts:** Recharts
- **Maps:** Leaflet + react-leaflet (OpenStreetMap, NOT Mapbox)
- **Icons:** Lucide React
- **Fonts:** Sora (headings), DM Sans (body), JetBrains Mono (data/numbers)
- **Forms:** React Hook Form + Zod resolvers
- **Routing:** React Router v7 with lazy loading
- **PWA:** vite-plugin-pwa (auto-update service worker, NetworkFirst for API)
- **WebSocket:** socket.io-client
- **Toast:** react-hot-toast

### Backend
- **Runtime:** Node.js 20+ with Express 4
- **Language:** TypeScript
- **ORM:** Prisma 6+ with PostgreSQL 16
- **Cache/Queue:** Redis 7 + BullMQ
- **Auth:** JWT (access 15m + refresh 7d httpOnly cookie) + bcryptjs
- **File Upload:** Multer (image 5MB, document 10MB, resume 5MB)
- **Real-time:** Socket.io 4
- **Email:** Nodemailer via BullMQ worker
- **PDF:** PDFKit (salary slips)
- **Excel:** ExcelJS (reports export)
- **Validation:** Zod
- **API Docs:** Swagger/OpenAPI 3.0
- **Logging:** Winston
- **Security:** Helmet + CORS + Rate limiting (Redis-backed)
- **Encryption:** AES-256-GCM for sensitive data (Aadhaar/PAN)

### Infrastructure
- **Database:** PostgreSQL 16 Alpine (Docker)
- **Cache:** Redis 7 Alpine (Docker)
- **Process Manager:** PM2 (production)
- **Reverse Proxy:** Nginx
- **CI:** GitHub Actions (lint, typecheck, test, build)

### Monorepo Structure
```
Aniston-hrms/
├── frontend/          # React app (Vite)
├── backend/           # Express API
├── shared/            # Shared TypeScript types, enums, permissions
├── prisma/            # Prisma schema + seed
├── docker/            # docker-compose.yml (postgres, redis, ai-service)
├── ai-service/        # Python FastAPI (OCR, DeepSeek scoring)
├── desktop-agent/     # Electron desktop monitoring agent
├── docs/              # Documentation
├── .github/workflows/ # CI pipeline
└── package.json       # npm workspaces root
```

Use `npm workspaces` with packages: `frontend`, `backend`, `shared`.

---

## 3. COMPLETE DATABASE SCHEMA (Prisma)

### Enums

```prisma
enum Role { SUPER_ADMIN; ADMIN; HR; MANAGER; EMPLOYEE; GUEST_INTERVIEWER }
enum UserStatus { ACTIVE; INACTIVE; SUSPENDED; PENDING_VERIFICATION }
enum Gender { MALE; FEMALE; OTHER; PREFER_NOT_TO_SAY }
enum EmployeeStatus { ACTIVE; PROBATION; NOTICE_PERIOD; INACTIVE; TERMINATED; ABSCONDED }
enum WorkMode { OFFICE; HYBRID; FIELD_SALES; PROJECT_SITE; REMOTE }
enum AttendanceStatus { PRESENT; ABSENT; HALF_DAY; HOLIDAY; WEEKEND; ON_LEAVE; WORK_FROM_HOME }
enum AttendanceSource { GEOFENCE_AUTO; MANUAL_APP; MANUAL_HR; QR_CODE; BIOMETRIC }
enum BreakType { LUNCH; SHORT; PRAYER; CUSTOM }
enum LeaveRequestStatus { PENDING; APPROVED; REJECTED; CANCELLED }
enum DocumentType { AADHAAR; PAN; PASSPORT; VOTER_ID; DRIVING_LICENSE; DEGREE_CERTIFICATE; TENTH_CERTIFICATE; TWELFTH_CERTIFICATE; EXPERIENCE_LETTER; OFFER_LETTER_DOC; RELIEVING_LETTER; BANK_STATEMENT; CANCELLED_CHEQUE; SALARY_SLIP_DOC; PHOTO; SIGNATURE; OTHER }
enum DocumentStatus { PENDING; VERIFIED; REJECTED; EXPIRED }
enum JobType { FULL_TIME; PART_TIME; CONTRACT; INTERNSHIP; RESEARCH }
enum JobStatus { DRAFT; OPEN; ON_HOLD; CLOSED }
enum ApplicationStatus { APPLIED; SCREENING; ASSESSMENT; INTERVIEW_1; INTERVIEW_2; HR_ROUND; FINAL_ROUND; OFFER; OFFER_ACCEPTED; JOINED; REJECTED; WITHDRAWN }
enum ApplicationSource { PORTAL; NAUKRI; LINKEDIN; REFERENCE; CAMPUS; WALK_IN }
enum OfferStatus { DRAFT; SENT; ACCEPTED; REJECTED; NEGOTIATING; EXPIRED }
enum PayrollRunStatus { DRAFT; PROCESSING; COMPLETED; LOCKED }
enum TaxRegime { OLD_REGIME; NEW_REGIME }
enum PoliceVerificationStatus { PENDING; INITIATED; IN_PROGRESS; COMPLETED; FAILED }
enum AssetCategory { LAPTOP; MOBILE; SIM_CARD; ACCESS_CARD; VISITING_CARD; MONITOR; OTHER }
enum AssetStatus { AVAILABLE; ASSIGNED; MAINTENANCE; RETIRED }
enum PolicyCategory { HR_GENERAL; LEAVE; HYBRID; WORK_MANAGEMENT; ESCALATION; IT; CODE_OF_CONDUCT; HEALTH_SAFETY }
enum GeofenceType { OFFICE; CLIENT_SITE; RESTRICTED }
enum ShiftType { OFFICE; HYBRID; FIELD }
enum WalkInStatus { WAITING; IN_INTERVIEW; ON_HOLD; SELECTED; REJECTED; COMPLETED; NO_SHOW }
enum InterviewRoundStatus { PENDING; SCHEDULED; IN_PROGRESS; COMPLETED; CANCELLED }
enum InterviewRoundResult { PASSED; FAILED; ON_HOLD }
```

### Models (35 total)

**Organization**
- id: UUID PK, name, slug (unique), logo?, timezone ("Asia/Kolkata"), fiscalYear ("APRIL_MARCH"), currency ("INR"), address (Json?), settings (Json?), createdAt, updatedAt
- Relations: users, employees, departments, designations, officeLocations, holidays, leaveTypes, auditLogs, geofences, shifts

**User**
- id: UUID PK, email (unique), passwordHash, role (Role, default EMPLOYEE), status (UserStatus, default ACTIVE), lastLoginAt?, mfaEnabled (false), microsoftId? (unique), authProvider ("local"), organizationId FK, createdAt, updatedAt
- Relations: organization, employee?, auditLogs, walkInInterviews

**Employee**
- id: UUID PK, employeeCode (unique, auto: EMP-001), userId? FK (unique), firstName, lastName, email, personalEmail?, phone, dateOfBirth?, gender (Gender), bloodGroup?, maritalStatus?, avatar?, address (Json?), emergencyContact (Json?), departmentId? FK, designationId? FK, managerId? FK (self-relation), workMode (WorkMode, default OFFICE), officeLocationId? FK, joiningDate, probationEndDate?, ctc (Decimal 12,2)?, status (EmployeeStatus, default ACTIVE), organizationId FK, policeVerificationStatus, policeVerificationDate?, resignationDate?, resignationReason?, lastWorkingDate?, exitType?, exitStatus?, exitApprovedBy?, exitApprovedAt?, exitNotes?, createdAt, updatedAt, deletedAt? (soft delete)
- Relations: organization, user, department, designation, manager, directReports, officeLocation, documents, attendanceRecords, gpsTrailPoints, projectSiteCheckIns, leaveBalances, leaveRequests, salaryStructure, payrollRecords, assetAssignments, shiftAssignments, lifecycleEvents, tickets, activityLogs, agentScreenshots
- Indexes: [organizationId, status], [departmentId], [managerId], [email]

**Department**
- id: UUID PK, name, description?, headId? FK (Employee), organizationId FK, createdAt, updatedAt, deletedAt?
- Unique: [name, organizationId]

**Designation**
- id: UUID PK, name, level? (Int), description?, organizationId FK, createdAt, updatedAt, deletedAt?
- Unique: [name, organizationId]

**OfficeLocation**
- id: UUID PK, name, address, city?, state?, country ("India"), timezone ("Asia/Kolkata"), geofenceId? FK (unique), organizationId FK, createdAt, updatedAt
- Relations: geofence, employees, shiftAssignments

**Document**
- id: UUID PK, employeeId? FK, name, type (DocumentType), fileUrl, thumbnailUrl?, status (DocumentStatus, default PENDING), ocrData (Json?), tamperDetected (false), tamperDetails?, expiryDate?, verifiedBy?, verifiedAt?, rejectionReason?, createdAt, updatedAt, deletedAt?

**AttendanceRecord**
- id: UUID PK, employeeId FK, date (Date), checkIn? (DateTime), checkOut?, totalHours? (Decimal 5,2), status (AttendanceStatus, default ABSENT), workMode (WorkMode), source (AttendanceSource, default MANUAL_APP), checkInLocation (Json?), checkOutLocation (Json?), ipAddress?, deviceType?, notes?, activeMinutes (Int, default 0), activityPulses (Int, default 0), createdAt, updatedAt
- Relations: breaks, regularization
- Unique: [employeeId, date], Index: [date]

**Break**
- id: UUID PK, attendanceId FK, startTime, endTime?, type (BreakType, default LUNCH), durationMinutes?

**AttendanceRegularization**
- id: UUID PK, attendanceId FK (unique), reason, requestedCheckIn?, requestedCheckOut?, status (LeaveRequestStatus, default PENDING), approvedBy?, approverRemarks?, createdAt, updatedAt

**GPSTrailPoint**
- id: UUID PK, employeeId FK, date (Date), lat (Decimal 10,7), lng (Decimal 10,7), accuracy? (Decimal 6,2), altitude?, speed?, heading?, batteryLevel? (Int), timestamp, visitLabel?, isVisitStop (false), stopDuration? (Int)
- Index: [employeeId, date]

**ProjectSiteCheckIn**
- id: UUID PK, employeeId FK, date (Date), siteName, siteAddress?, checkInPhoto?, checkInLat? (Decimal 10,7), checkInLng?, notes?, approvedBy?, createdAt
- Index: [employeeId, date]

**Geofence**
- id: UUID PK, name, type (GeofenceType, default OFFICE), coordinates (Json), radiusMeters? (Int), autoCheckIn (false), autoCheckOut (false), strictMode (false), organizationId FK, createdAt, updatedAt
- Relations: officeLocation

**LeaveType**
- id: UUID PK, name, code, defaultBalance (Decimal 5,1), carryForward (false), maxCarryForward? (Decimal 5,1), isPaid (true), minDays (Decimal 3,1, default 0.5), maxDays?, noticeDays (Int, default 0), gender? (Gender), applicableTo ("ALL"), maxPerMonth? (Int), allowWeekendAdjacent (true), allowSameDay (false), probationMonths (Int, default 3), requiresApproval (true), isActive (true), organizationId FK, createdAt, updatedAt
- Unique: [code, organizationId]

**LeaveBalance**
- id: UUID PK, employeeId FK, leaveTypeId FK, year (Int), allocated (Decimal 5,1), used (Decimal 5,1, default 0), carriedForward (Decimal 5,1, default 0), pending (Decimal 5,1, default 0)
- Unique: [employeeId, leaveTypeId, year]

**LeaveRequest**
- id: UUID PK, employeeId FK, leaveTypeId FK, startDate (Date), endDate (Date), days (Decimal 4,1), isHalfDay (false), halfDaySession?, reason, status (LeaveRequestStatus, default PENDING), approvedBy?, approverRemarks?, attachmentUrl?, createdAt, updatedAt
- Indexes: [employeeId, status], [startDate, endDate], [status]

**Holiday**
- id: UUID PK, name, date (Date), type ("PUBLIC"), isOptional (false), organizationId FK, createdAt
- Unique: [date, organizationId]

**SalaryStructure**
- id: UUID PK, employeeId FK (unique), ctc (Decimal 12,2), basic, hra, da?, ta?, medicalAllowance?, specialAllowance?, lta?, performanceBonus?, pfEmployee?, pfEmployer?, esiEmployee?, esiEmployer?, professionalTax?, tds?, incomeTaxRegime (TaxRegime, default NEW_REGIME), enabledComponents (Json?), effectiveFrom, createdAt, updatedAt

**PayrollRun**
- id: UUID PK, month (Int), year (Int), status (PayrollRunStatus, default DRAFT), processedBy?, processedAt?, totalGross? (Decimal 14,2), totalNet?, totalDeductions?, organizationId FK, createdAt, updatedAt
- Unique: [month, year, organizationId]

**PayrollRecord**
- id: UUID PK, payrollRunId FK, employeeId FK, grossSalary (Decimal 12,2), netSalary, basic, hra, otherEarnings (Json?), epfEmployee?, epfEmployer?, esiEmployee?, esiEmployer?, professionalTax?, tds?, otherDeductions (Json?), lopDays (Int, default 0), lopDeduction?, workingDays (Int), presentDays (Int), createdAt

**JobOpening**
- id: UUID PK, title, department, location, type (JobType, default FULL_TIME), experience?, salaryRange (Json?), description, requirements (String[]), openings (Int, default 1), status (JobStatus, default DRAFT), postedBy, approvedBy?, publishToNaukri (false), publishToWebsite (true), organizationId, createdAt, updatedAt, closedAt?
- Relations: applications, walkIns

**Application**
- id: UUID PK, jobOpeningId FK, candidateName, email, phone, resumeUrl, coverLetter?, source (ApplicationSource, default PORTAL), status (ApplicationStatus, default APPLIED), currentStage (Int, default 1), aiScore? (Decimal 5,2), aiScoreDetails (Json?), isIntern (false), createdAt, updatedAt
- Relations: interviewScores, offerLetter

**InterviewScore**
- id: UUID PK, applicationId FK, round (Int), interviewerId?, communicationScore? (Decimal 3,1), technicalScore?, problemSolving?, culturalFit?, overallScore?, notes?, teamsRecordingUrl?, aiAnalysis (Json?), createdAt

**OfferLetter**
- id: UUID PK, applicationId FK (unique), candidateEmail, ctc (Decimal 12,2), basicSalary, joiningDate?, status (OfferStatus, default DRAFT), pdfUrl?, sentAt?, respondedAt?, createdAt, updatedAt

**Asset**
- id: UUID PK, name, assetCode (unique), category (AssetCategory), serialNumber?, status (AssetStatus, default AVAILABLE), purchaseDate?, purchaseCost? (Decimal 12,2), notes?, organizationId, createdAt, updatedAt
- Relations: assignments, tickets

**AssetAssignment**
- id: UUID PK, assetId FK, employeeId FK, assignedBy, assignedAt (default now), returnedAt?, condition?, notes?

**Policy**
- id: UUID PK, title, category (PolicyCategory), content, version (Int, default 1), isActive (true), targetAudience (Json?), attachments (String[]), organizationId, createdAt, updatedAt
- Relations: acknowledgments

**PolicyAcknowledgment**
- id: UUID PK, policyId FK, employeeId, acknowledgedAt
- Unique: [policyId, employeeId]

**Announcement**
- id: UUID PK, title, content, priority ("NORMAL"), targetDepartments (String[]), targetRoles (String[]), publishedAt?, expiresAt?, createdBy, organizationId, createdAt, updatedAt

**SocialPost**
- id: UUID PK, authorId, content, imageUrl?, postType ("GENERAL"), likesCount (Int, default 0), commentsCount (Int, default 0), organizationId, createdAt, updatedAt
- Relations: comments, likes

**SocialComment**
- id: UUID PK, postId FK, authorId, content, createdAt

**SocialLike**
- id: UUID PK, postId FK, userId, createdAt
- Unique: [postId, userId]

**Ticket** (Helpdesk)
- id: UUID PK, ticketCode (unique), employeeId FK, category, subject, description, priority ("MEDIUM"), status ("OPEN"), assignedTo?, resolvedAt?, resolution?, organizationId, assetId? FK, createdAt, updatedAt
- Relations: employee, asset, comments

**TicketComment**
- id: UUID PK, ticketId FK, authorId, content, isInternal (false), createdAt

**Shift**
- id: UUID PK, name, code, shiftType (ShiftType, default OFFICE), startTime (String HH:mm), endTime (String HH:mm), graceMinutes (Int, default 15), halfDayHours (Decimal 4,2, default 4), fullDayHours (Decimal 4,2, default 8), trackingIntervalMinutes? (Int, for FIELD only), isDefault (false), isActive (true), organizationId FK, createdAt, updatedAt
- Unique: [code, organizationId]

**ShiftAssignment**
- id: UUID PK, employeeId FK, shiftId FK, locationId? FK, startDate (Date), endDate? (Date), assignedBy, createdAt
- Index: [employeeId, startDate]

**WalkInCandidate**
- id: UUID PK, tokenNumber (unique, format "WALK-IN-YYYY-NNNN"), jobOpeningId? FK, fullName, email, phone, city?, aadhaarFrontUrl?, aadhaarBackUrl?, panCardUrl?, selfieUrl?, aadhaarNumber? (masked), panNumber? (masked), ocrVerifiedName?, ocrVerifiedDob?, ocrVerifiedAddress?, tamperDetected (false), tamperDetails?, qualification?, fieldOfStudy?, experienceYears (Int, default 0), experienceMonths (Int, default 0), isFresher (true), currentCompany?, currentCtc? (Decimal 12,2), expectedCtc?, noticePeriod?, skills (String[]), aboutMe?, resumeUrl?, aiScore? (Decimal 5,2), aiScoreDetails (Json?), registrationDate (default now), status (WalkInStatus, default WAITING), currentRound (Int, default 0), totalRounds (Int, default 1), convertedToApp (false), applicationId?, hrNotes?, organizationId, createdAt, updatedAt
- Relations: jobOpening, interviewRounds
- Indexes: [organizationId, registrationDate], [status]

**WalkInInterviewRound**
- id: UUID PK, walkInId FK, roundNumber (Int), roundName, interviewerName?, interviewerId? FK (User), scheduledAt?, completedAt?, status (InterviewRoundStatus, default PENDING), communication? (Int 1-10), technical? (Int 1-10), problemSolving? (Int 1-10), culturalFit? (Int 1-10), overallScore? (Int 1-10), remarks?, result? (InterviewRoundResult), createdAt, updatedAt
- Unique: [walkInId, roundNumber]

**EmployeeEvent** (Lifecycle)
- id: UUID PK, employeeId FK, eventType (JOINING|PROBATION_END|CONFIRMATION|PROMOTION|TRANSFER|SALARY_REVISION|WARNING|SEPARATION|REHIRE|STATUS_CHANGE), title, description?, eventDate, metadata (Json?), createdBy?, createdAt
- Indexes: [employeeId], [eventDate]

**ReviewCycle**
- id: UUID PK, name, type ("QUARTERLY"), startDate (Date), endDate (Date), status ("DRAFT"), organizationId, createdAt, updatedAt

**Goal**
- id: UUID PK, employeeId, reviewCycleId? FK, title, description?, category ("INDIVIDUAL"), targetValue? (Decimal 10,2), currentValue?, unit?, weight (Int, default 100), status ("NOT_STARTED"), dueDate? (Date), completedAt?, organizationId, createdAt, updatedAt

**PerformanceReview**
- id: UUID PK, employeeId, reviewCycleId FK, reviewerId, selfRating? (Decimal 3,1), selfComments?, managerRating?, managerComments?, overallRating?, strengths (String[]), improvements (String[]), status ("PENDING"), submittedAt?, reviewedAt?, createdAt, updatedAt
- Unique: [employeeId, reviewCycleId]

**AuditLog**
- id: UUID PK, userId FK, entity, entityId, action, oldValue (Json?), newValue (Json?), ipAddress?, organizationId FK, createdAt
- Indexes: [entity, entityId], [userId], [createdAt]

**ActivityLog** (Desktop Agent)
- id: UUID PK, employeeId FK, date (Date), timestamp, activeApp?, activeWindow?, activeUrl?, category? (PRODUCTIVE|NEUTRAL|UNPRODUCTIVE), durationSeconds (Int, default 0), idleSeconds (Int, default 0), keystrokes (Int, default 0), mouseClicks (Int, default 0), mouseDistance (Int, default 0), organizationId, createdAt
- Indexes: [employeeId, date], [organizationId, date]

**AgentScreenshot**
- id: UUID PK, employeeId FK, date (Date), timestamp, imageUrl, activeApp?, activeWindow?, organizationId, createdAt
- Indexes: [employeeId, date]

---

## 4. RBAC PERMISSION SYSTEM

### 6 Roles
SUPER_ADMIN, ADMIN, HR, MANAGER, EMPLOYEE, GUEST_INTERVIEWER

### 21 Resources
employee, attendance, leave, payroll, recruitment, performance, policy, announcement, helpdesk, report, asset, settings, org_chart, social_wall, onboarding, audit_log, document, holiday, department, designation, walk_in

### 9 Actions
create, read, read:own, update, update:own, delete, approve, export, manage

### Permission Matrix (key roles)

**SUPER_ADMIN**: ALL actions on ALL resources (manage grants all)

**ADMIN**: Same as SUPER_ADMIN except no `manage` on some resources

**HR**:
- employee: create, read, update, manage, export
- attendance: read, update, export
- leave: read, update, approve, export
- payroll: create, read, update, export
- recruitment: create, read, update, delete
- walk_in: create, read, update, delete
- settings: read (view only)

**MANAGER**:
- employee: read (team only)
- leave: read, approve (direct reports)
- recruitment: create, read
- walk_in: read

**EMPLOYEE**:
- employee: read:own, update:own
- attendance: create, read:own
- leave: create, read:own
- payroll: read:own
- helpdesk: create, read:own
- social_wall: create, read
- document: create, read:own

**GUEST_INTERVIEWER**:
- recruitment: read, update (scores only)

### Permission Logic
`hasPermission(role, resource, action)`:
- `manage` grants ALL actions on that resource
- `read` covers `read:own`
- `update` covers `update:own`

Export from `shared/src/permissions.ts`, consumed by both frontend (sidebar filtering) and backend (middleware).

---

## 5. BACKEND ARCHITECTURE (22 Modules)

### Module Pattern
Each module at `backend/src/modules/<name>/` contains:
- `<name>.routes.ts` — Express router with auth middleware
- `<name>.controller.ts` — Request/response handling
- `<name>.service.ts` — Business logic + Prisma queries
- `<name>.validation.ts` — Zod schemas

### App Setup (`backend/src/app.ts`)
- Helmet, CORS (credentials: true), cookie-parser, express.json
- Rate limiting: walk-in register 5/min, recruitment apply 10/min, auth 50/15min, general 100/min
- Routes all prefixed with `/api`
- Health check at `GET /api/health` returns `{ success, data: { status, service, version, timestamp, dependencies: { database, redis } } }`
- Swagger UI at `/api/docs`
- Global error handler with consistent envelope: `{ success, data, error: { code, message, details } }`

### All API Endpoints (150+)

#### AUTH (`/api/auth`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /login | Public | Email/password login, returns JWT + refresh cookie |
| POST | /refresh | Public | Rotate refresh token from httpOnly cookie |
| POST | /logout | Public | Invalidate refresh token |
| POST | /forgot-password | Public | Send reset email (token stored in Redis 1h) |
| POST | /reset-password | Public | Validate token, update password |
| POST | /change-password | Auth | Verify current, update password |
| GET | /me | Auth | Current user profile |
| GET | /sso-status | Public | Check if Microsoft SSO enabled |
| GET | /microsoft | Public | Redirect to Azure AD login |
| GET | /microsoft/callback | Public | OAuth callback, create/match user, issue JWT |

#### EMPLOYEES (`/api/employees`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | / | Auth | List (paginated, filter by dept/status/workMode/search) |
| GET | /:id | Auth | Detail with relations |
| POST | / | HR+ | Create employee |
| POST | /invite | HR+ | Generate onboarding token, send email |
| PATCH | /:id | HR+ | Update employee info |
| PATCH | /:id/role | Admin+ | Change role (RBAC) |
| DELETE | /:id | Admin+ | Soft delete |
| POST | /me/resign | Auth | Submit resignation |
| GET | /exit-requests | HR+ | Pending exit requests |
| GET | /:id/exit-details | HR+ | Exit workflow status |
| POST | /:id/approve-exit | HR+ | Approve resignation |
| POST | /:id/complete-exit | HR+ | Complete exit, deactivate user |
| POST | /:id/withdraw-resignation | Auth | Cancel pending resignation |
| POST | /:id/terminate | HR+ | Force termination |
| GET | /:id/events | Auth | Lifecycle events |
| POST | /:id/events | HR+ | Add lifecycle event |
| DELETE | /:id/events/:eventId | HR+ | Remove event |

#### ATTENDANCE (`/api/attendance`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /clock-in | Auth | Check-in (lat/lng, source, mode-aware) |
| POST | /clock-out | Auth | Check-out |
| GET | /today | Auth | Today's status |
| GET | /my | Auth | My history |
| POST | /break/start | Auth | Start break |
| POST | /break/end | Auth | End break |
| POST | /activity-pulse | Auth | Heartbeat for hybrid/WFH |
| POST | /gps-trail | Auth | Record GPS point (field sales) |
| GET | /gps-trail/:employeeId/:date | HR+ | View GPS trail |
| POST | /regularization | Auth | Request attendance correction |
| PATCH | /regularization/:id | HR+ | Approve/reject |
| GET | /employee/:employeeId | HR+ | Employee's attendance |
| POST | /mark | HR+ | Manual mark |
| GET | /all | HR+ | All employees attendance |

#### LEAVES (`/api/leaves`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /types | Auth | Leave types |
| POST | /types | HR+ | Create leave type |
| PATCH | /types/:id | HR+ | Update |
| DELETE | /types/:id | HR+ | Delete |
| GET | /holidays | Auth | Holiday list |
| GET | /balances | Auth | My balances |
| GET | /balances/:employeeId | HR+ | Employee balances |
| POST | /apply | Auth | Apply for leave |
| GET | /my | Auth | My applications |
| DELETE | /:id | Auth | Cancel leave |
| GET | /approvals | Manager+ | Pending approvals |
| PATCH | /:id/action | Manager+ | Approve/reject |
| GET | /all | HR+ | All leaves |

#### PAYROLL (`/api/payroll`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /salary-structure/:employeeId | HR+ | Get structure |
| POST | /salary-structure/:employeeId | HR+ | Create/update |
| GET | /runs | HR+ | List runs |
| POST | /runs | HR+ | Create run |
| POST | /runs/:id/process | HR+ | Process (calculate EPF/ESI/PT/TDS) |
| GET | /runs/:id/records | HR+ | Records for run |
| GET | /records/:id/pdf | Auth | Download salary slip PDF |
| GET | /my-payslips | Auth | My payslips |

#### RECRUITMENT (`/api/recruitment`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /jobs | Auth | List jobs |
| GET | /jobs/:id | Auth | Job detail |
| POST | /jobs | HR+ | Create job |
| PATCH | /jobs/:id | HR+ | Update |
| DELETE | /jobs/:id | HR+ | Delete |
| GET | /jobs/:jobId/applications | HR+ | Applications for job |
| GET | /applications/:id | HR+ | Application detail |
| POST | /apply | Public | Apply (no auth) |
| PATCH | /applications/:id/stage | HR+ | Move pipeline stage (Kanban) |
| POST | /scores | Auth | Add interview score |
| POST | /applications/:id/ai-score | HR+ | Trigger AI scoring |
| POST | /offers | HR+ | Create offer |
| PATCH | /offers/:id/status | HR+ | Update offer status |
| GET | /pipeline/stats | HR+ | Pipeline analytics |

#### WALK-IN (`/api/walk-in`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /jobs | Public | Open jobs for kiosk |
| POST | /register | Public | Self-register (5-step) |
| POST | /upload | Public | Upload document |
| GET | /token/:tokenNumber | Public | Check status |
| GET | /stats | HR+ | Counts by status |
| GET | /all | HR+ | All walk-ins |
| GET | /selected | HR+ | Hired candidates |
| GET | /interviewers | HR+ | List interviewers |
| GET | /today | HR+ | Today's walk-ins |
| GET | /:id | HR+ | Detail |
| PATCH | /:id | HR+ | Update info |
| PATCH | /:id/status | HR+ | Change status |
| POST | /:id/notes | HR+ | Add HR notes |
| POST | /:id/rounds | HR+ | Create interview round |
| PATCH | /:id/rounds/:roundId | HR+ | Update round |
| DELETE | /:id/rounds/:roundId | HR+ | Delete round |
| PATCH | /:id/convert | HR+ | Convert to recruitment app |
| POST | /:id/hire | HR+ | Create employee + send invite |
| DELETE | /:id | HR+ | Delete |
| GET | /my-interviews | Auth | My assigned interviews |
| GET | /my-interviews/:roundId | Auth | Interview detail |
| PATCH | /my-interviews/:roundId/score | Auth | Submit score |

#### ONBOARDING (`/api/onboarding`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /invite/:employeeId | HR+ | Create token, send email |
| GET | /invites | HR+ | Pending invites |
| GET | /status/:token | Public | Progress (7 steps) |
| PATCH | /step/:token/:step | Public | Save step data |
| POST | /complete/:token | Public | Activate user |

#### SETTINGS (`/api/settings`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /organization | Admin+ | Org settings |
| PATCH | /organization | Admin+ | Update |
| GET | /locations | Admin+ | Office locations |
| POST | /locations | Admin+ | Create |
| PATCH | /locations/:id | Admin+ | Update |
| DELETE | /locations/:id | Admin+ | Delete |
| GET | /audit-logs | Admin+ | Audit logs |
| GET | /email | Admin+ | Email config (masked) |
| POST | /email | Admin+ | Save SMTP |
| POST | /email/test | Admin+ | Test connection |
| GET | /teams | Admin+ | Teams config (masked) |
| POST | /teams | Admin+ | Save Teams credentials (encrypted) |
| POST | /teams/test | Admin+ | Test connection |
| POST | /teams/sync | Admin+ | Sync users from Azure AD |
| GET | /system | Admin+ | System info |

#### ASSETS (`/api/assets`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /my | Auth | My assigned assets |
| GET | / | HR+ | All assets |
| GET | /:id | HR+ | Detail |
| POST | / | HR+ | Create |
| PATCH | /:id | HR+ | Update |
| POST | /:id/assign | HR+ | Assign to employee |
| PATCH | /assignments/:id/return | HR+ | Return asset |
| GET | /:id/assignments | HR+ | History |

#### Other modules follow same pattern:
- **DASHBOARD** (`/api/dashboard`): GET /stats, GET /pending-approvals
- **PERFORMANCE** (`/api/performance`): CRUD for cycles, goals, reviews
- **POLICIES** (`/api/policies`): CRUD + acknowledge
- **ANNOUNCEMENTS** (`/api/announcements`): CRUD + social wall (like/comment)
- **HELPDESK** (`/api/helpdesk`): my tickets, all tickets, CRUD + comments
- **REPORTS** (`/api/reports`): headcount, attendance, leave, payroll (Excel export)
- **DOCUMENTS** (`/api/documents`): upload, verify, delete
- **HOLIDAYS** (`/api/holidays`): CRUD
- **SHIFTS** (`/api/workforce`): shifts CRUD, locations CRUD, assign shift
- **AGENT** (`/api/agent`): heartbeat, screenshot, config, activity logs
- **DEPARTMENTS** (`/api/departments`): CRUD
- **DESIGNATIONS** (`/api/designations`): CRUD

### Middleware
1. **Auth**: JWT verify from `Authorization: Bearer <token>` header
2. **Role-based**: `authorize(...roles)` — checks user role
3. **Permission-based**: `requirePermission(resource, action)` — checks RBAC map
4. **Error Handler**: Custom AppError classes (NotFound, Unauthorized, Forbidden, BadRequest, Conflict)
5. **Rate Limiter**: Redis-backed, per-IP
6. **Upload**: Multer with type-specific handlers (uploadImage, uploadDocument, uploadResume)
7. **Request Logger**: Winston with request ID

### Background Jobs (BullMQ)
- **Email Worker**: Templates for onboarding-invite, password-reset, leave-approved, resignation, exit. 5 concurrent, 3 retries with exponential backoff.
- **Notification Worker**: Emits via Socket.io to user room. 10 concurrent, 2 retries.

### Socket.io
- Auth via JWT in handshake
- Rooms: `user:{userId}`, `org:{organizationId}`
- Helpers: `emitToUser()`, `emitToOrg()`, `getIO()`

### Utilities
- **Encryption**: AES-256-GCM for Aadhaar/PAN
- **Audit Logger**: Creates AuditLog records
- **PDF Generator**: Salary slip with pdfkit (earnings, deductions, net pay)
- **Excel Exporter**: Employee directory + attendance summary with exceljs

### Indian Payroll Rules
- **EPF**: 12% of basic (capped at basic ₹15,000), both employee & employer
- **ESI**: 0.75% employee + 3.25% employer (if gross ≤ ₹21,000)
- **Professional Tax**: State-wise slabs
- **TDS**: Monthly based on annual projection, old/new regime

---

## 6. FRONTEND ARCHITECTURE

### All Routes (React Router v7)

**Public (no auth)**
- `/login` — LoginPage
- `/auth/callback` — AuthCallbackPage (SSO)
- `/onboarding/:token` — OnboardingPortal (7-step wizard)
- `/jobs` — PublicJobsPage
- `/download` — DownloadPage (PWA/Agent)
- `/walk-in` — WalkInKioskPage (5-step kiosk, KioskLayout)

**Protected (under AppShell with Sidebar/Topbar)**
- `/dashboard` — DashboardPage
- `/pending-approvals` — PendingApprovalsPage
- `/employees` — EmployeeListPage
- `/employees/:id` — EmployeeDetailPage
- `/attendance` — AttendancePage (3-mode selector)
- `/attendance/employee/:employeeId` — EmployeeAttendanceDetailPage
- `/leaves` — LeavePage
- `/payroll` — PayrollPage
- `/recruitment` — RecruitmentPage (Kanban board)
- `/recruitment/:jobId` — JobDetailPage
- `/recruitment/candidate/:id` — CandidateDetailPage
- `/walk-in-management` — WalkInManagementPage
- `/walk-in-management/:id` — WalkInDetailPage
- `/hiring-passed` — HiringPassedPage
- `/interview-assignments` — InterviewAssignmentsPage
- `/assets` — AssetManagementPage (admin)
- `/my-assets` — MyAssetsPage (employee)
- `/exit-management` — ExitManagementPage
- `/exit-management/:id` — ExitDetailPage
- `/performance` — PerformancePage
- `/policies` — PoliciesPage
- `/announcements` — AnnouncementsPage (+ social wall)
- `/helpdesk` — HelpdeskPage
- `/org-chart` — OrgChartPage
- `/reports` — ReportsPage
- `/roster` — RosterPage
- `/settings` — SettingsPage (tabs: Org, Locations, Shifts, Email, Teams, Audit, System)
- `/profile` — ProfilePage
- `/` → redirect to `/dashboard`

### RTK Query Setup (`frontend/src/app/api.ts`)
- Base URL: `VITE_API_URL` env var or `http://localhost:4000/api`
- Credentials: `include` (cookies)
- Auth header: `Authorization: Bearer {accessToken}`
- **401 auto-refresh**: On 401, POST `/auth/refresh`, dispatch new token, retry original
- Tag types for cache: Employee, Dashboard, Attendance, Leave, LeaveBalance, Payroll, WalkIn, Document, Recruitment, Helpdesk, Holiday, Announcements, SocialPosts, TeamsConfig, Asset, Exit

### Redux State
```typescript
{
  api: RTKQueryState, // auto-managed
  auth: {
    user: AuthUser | null,
    accessToken: string | null,
    isLoading: boolean,
  }
}
```

### Sidebar Navigation (role-based)
Management roles (SUPER_ADMIN, ADMIN, HR) see:
- Dashboard, Manage Employees, Attendance Management, Leave Management, Payroll, Roster, Recruitment, Walk-In Mgmt, Hiring Passed, Employee Exit, Interview Tasks, Asset Management, Performance, Policies, Announcements, Helpdesk, Org Chart, Reports, Settings, Logout

Regular employees see:
- Dashboard, Attendance, Leaves, My Assets, Interview Tasks, Performance, Policies, Announcements, Helpdesk, Org Chart, Profile, Logout

### Key Components
- **AppShell**: Main layout (sidebar + topbar + content area + MobileBottomNav)
- **Sidebar**: Collapsible, role-filtered nav items, logout button
- **Topbar**: Search bar, NotificationBell (Socket.io), user dropdown
- **MobileBottomNav**: Home, Leave, Check In/Out (center button), Alerts, Profile
- **ErrorBoundary**: React class error boundary wrapping entire app
- **LocationPickerMap**: Leaflet map with click-to-set, draggable marker, radius circle
- **LocationSearch**: Nominatim geocoding with debounced search
- **ActivityCheckInPrompt**: "Still working?" toast every 60 min
- **AgentDownloadBanner**: Desktop agent install prompt for office/hybrid employees

### Key Hooks
- **useActivityTracker**: Page Visibility API + 5-min heartbeat pulse for all logged-in users

---

## 7. UI DESIGN SYSTEM

### Philosophy
Monday.com-inspired layered design with glassmorphism. NOT flat design. Every surface has depth through shadows, blur, and layering.

### Fonts (Google Fonts)
- **Sora** (headings, `font-display`): weights 300-800
- **DM Sans** (body, `font-body`): weights 400-700
- **JetBrains Mono** (data/numbers, `[data-mono]`): weights 400-600

### Brand Colors (Indigo palette)
```
brand-50: #eef2ff, brand-100: #e0e7ff, brand-200: #c7d2fe, brand-300: #a5b4fc
brand-400: #818cf8, brand-500: #6366f1, brand-600: #4f46e5 (PRIMARY)
brand-700: #4338ca, brand-800: #3730a3, brand-900: #312e81, brand-950: #1e1b4b
```

### Surface Colors
```
surface-0: #ffffff (base), surface-1: #f8fafc, surface-2: #f1f5f9, surface-3: #e2e8f0
```

### Shadows
```css
glass: 0 8px 32px 0 rgba(31, 38, 135, 0.07)
layer: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)
layer-md: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)
layer-lg: 0 10px 15px -3px rgba(0,0,0,0.05), 0 4px 6px -2px rgba(0,0,0,0.03)
```

### CSS Utility Classes (`globals.css`)
- `.glass-card` — Semi-transparent with backdrop-blur
- `.layer-card` — White card with shadow-layer, hover:shadow-layer-md + translateY(-1px)
- `.stat-card` — Stats display with hover elevation
- `.input-glass` — Glassmorphic input fields
- `.btn-primary` — Brand-600 bg, white text, hover:brand-700
- `.btn-secondary` — White bg, gray border, hover:gray-50
- `.btn-ghost` — Transparent, hover:gray-100
- `.badge`, `.badge-success`, `.badge-warning`, `.badge-danger`, `.badge-info`
- `.page-container` — max-w-[1600px] mx-auto
- `.custom-scrollbar` — Thin 6px webkit scrollbar

### Animations (Tailwind config)
- `fade-in` (0.3s ease-out)
- `slide-up` (0.3s ease-out)
- `slide-down` (0.3s ease-out)
- `scale-in` (0.2s ease-out)

### Framer Motion
Use for page transitions (fade-in), modal animations, collapse/expand, card hover effects.

---

## 8. API RESPONSE ENVELOPE

All API responses use:
```typescript
{
  success: boolean,
  data: T,
  error?: { code: string, message: string, details?: Record<string, string[]> },
  meta?: { page: number, limit: number, total: number, totalPages: number, hasNext: boolean, hasPrev: boolean }
}
```

---

## 9. SEED DATA

Create seed at `prisma/seed.ts`:

**Organization**: Aniston Technologies LLP, slug "aniston", timezone "Asia/Kolkata", currency "INR"

**Departments** (8): Engineering, Human Resources, Sales, Marketing, Finance, Operations, Design, Quality Assurance

**Designations** (16): CEO (L1), CTO (L2), VP Engineering (L3), HR Director (L3), Engineering Manager (L4), HR Manager (L4), Sales Manager (L4), Senior Software Engineer (L5), Software Engineer (L6), Junior Software Engineer (L7), HR Executive (L6), Sales Executive (L6), Marketing Executive (L6), UI/UX Designer (L6), QA Engineer (L6), Intern (L8)

**Super Admin**: superadmin@anistonav.com / Superadmin@1234, role SUPER_ADMIN, EMP-001, CEO

**Leave Types** (7): CL 12d, EL 12d (carry 6), SL 12d, ML 182d (female), PL 15d (male), LWP 0d (unpaid), SAB 0d (unpaid)

**Holidays 2026** (10): Republic Day, Holi, Good Friday, Eid ul-Fitr, Independence Day, Ganesh Chaturthi, Gandhi Jayanti, Dussehra, Diwali, Christmas

---

## 10. ENVIRONMENT VARIABLES

```env
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://aniston:password@localhost:5432/aniston_hrms?schema=public
REDIS_URL=redis://localhost:6379
JWT_SECRET=(min 32 chars)
JWT_REFRESH_SECRET=(min 32 chars)
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
FRONTEND_URL=http://localhost:5173
API_URL=http://localhost:4000
AI_SERVICE_URL=http://localhost:8000
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@aniston.in
```

Frontend env: `VITE_API_URL=/api` (production), `VITE_AGENT_DOWNLOAD_URL=/uploads/agent/AnistonActivityAgent-Setup.exe`

---

## 11. PWA CONFIGURATION

In `vite.config.ts` with `vite-plugin-pwa`:
- Register type: autoUpdate
- Manifest: name "Aniston HRMS", start_url "/dashboard", display "standalone", theme_color "#4F46E5"
- Icons: 192x192 and 512x512 (maskable)
- Workbox: NetworkFirst for `/api/.*` (10s timeout, 24h cache, 100 max entries)

---

## 12. CI/CD PIPELINE

GitHub Actions `.github/workflows/ci.yml`:
- Trigger: push to main/develop, PR to main
- Services: PostgreSQL 16 (port 5432)
- Steps: checkout → setup Node 20 → npm ci → prisma generate → typecheck → build backend → build frontend (VITE_API_URL=/api) → run tests

---

## 13. CONVENTIONS

- UUIDs for all primary keys
- Soft deletes (`deletedAt`) on major entities
- Employee codes: `EMP-001`, `EMP-002` (auto-generated)
- Currency: INR, formatted `en-IN` locale
- Timestamps: `createdAt` + `updatedAt` on all models
- Pagination: `page`, `limit` query params, response in `meta`
- All dates: ISO 8601
- File uploads to `uploads/` directory, served statically

---

## 14. KEY BUSINESS FLOWS

### 1. Walk-In → Hire → Onboard
Candidate fills kiosk (5 steps) → Token generated → Shows in Walk-In Management → HR adds interview rounds → Assigns interviewers from org → Interviewers score → HR marks SELECTED → Shows in Hiring Passed → HR clicks Hire → Employee created with EMP code → Onboarding email sent → New hire completes 7-step wizard → User activated

### 2. Attendance (3 Modes)
- **OFFICE**: Employee clock-in → Geofence check (Haversine distance) → Auto-detect office → Record with location
- **FIELD_SALES**: GPS trail recorded every 60s → Visit clustering (200m radius, >10min = stop) → Dashboard shows trail map
- **PROJECT_SITE**: Manual check-in with photo + site name + GPS → HR reviews

### 3. Leave Management
Employee applies → Manager/HR sees in approvals → Approve/Reject → Balance auto-updated → Attendance marked ON_LEAVE

### 4. Payroll Processing
HR creates salary structure (CTC breakdown) → Creates monthly run → Process calculates: basic, HRA, DA, TA, allowances, EPF (12% capped), ESI (0.75%/3.25%), PT, TDS, LOP deduction → Generates salary slips (PDF)

### 5. Microsoft Teams Integration
Admin fills Client ID + Secret + Tenant ID in Settings → Test Connection validates via Graph API → Sync Employees pulls users from Azure AD → Creates employees + users with Microsoft SSO → Employees can "Sign in with Microsoft"

### 6. Employee Exit
Employee submits resignation → HR reviews → Approve → Asset return → Handover → Complete exit → User deactivated

---

## 15. PRODUCTION DEPLOYMENT

### Requirements
- EC2 (Ubuntu 22/24), Node.js 20, Docker + Docker Compose, Nginx, PM2

### Steps
1. PostgreSQL + Redis via Docker
2. Clone repo, `npm ci`, create `.env.production`
3. `npx prisma generate && npx prisma db push && npx tsx prisma/seed.ts`
4. Build: `npm run build --workspace=backend && cd frontend && npx vite build`
5. Start: `pm2 start "npx tsx backend/src/server.ts" --name aniston-hrms`
6. Nginx: reverse proxy port 80 → 4000 for `/api/`, serve `frontend/dist/` for `/`, `try_files` for SPA
7. PM2 startup for auto-restart on reboot

---

**END OF MEGA PROMPT**

> This prompt contains everything needed to recreate Aniston HRMS from scratch. Follow each section sequentially. Build the shared package first, then Prisma schema, then backend modules one by one, then frontend pages. Test each module before moving to the next.
