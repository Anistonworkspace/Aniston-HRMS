---
name: hrms-patterns
description: Common patterns and business logic for Aniston HRMS
---

# HRMS Patterns & Business Logic

## Indian Payroll Formulas

### EPF (Employee Provident Fund)
```
Basic = CTC × (typically 40-50%)
EPF Employee = 12% of Basic (capped at Basic ₹15,000 → max ₹1,800/month)
EPF Employer = 12% of Basic (same cap)
```

### ESI (Employee State Insurance)
```
Only if Gross Salary ≤ ₹21,000/month
ESI Employee = 0.75% of Gross
ESI Employer = 3.25% of Gross
```

### Professional Tax
State-wise slabs (example: Maharashtra)
```
Gross ≤ ₹7,500 → ₹0
₹7,501 to ₹10,000 → ₹175
₹10,001+ → ₹200 (₹300 in Feb)
```

### TDS (Tax Deducted at Source)
```
Annual projected income = Monthly gross × 12
Apply old/new regime slabs
Monthly TDS = Annual tax / 12
```

## Walk-In → Hire Flow
```
1. Candidate fills kiosk form (/walk-in) → WalkInCandidate created (WAITING)
2. Token generated: WALK-IN-YYYY-NNNN
3. HR adds interview rounds → assigns interviewers
4. Each interviewer scores (communication, technical, problem-solving, cultural-fit, overall)
5. All rounds PASSED → status = SELECTED
6. Shows in Recruitment → Hiring Passed tab
7. HR clicks "Hire" → enters Teams email
8. Backend transaction:
   a. Create User (EMPLOYEE role, PENDING_VERIFICATION)
   b. Create Employee (PROBATION status, auto EMP-XXX code)
   c. Update WalkInCandidate → COMPLETED
   d. Generate onboarding token (Redis, 7-day TTL)
   e. Send welcome email via BullMQ
   f. Copy KYC documents to employee folder
9. New hire receives email → completes 7-step onboarding wizard
10. Employee active in system
```

## 3 Attendance Modes

### OFFICE (Geofence)
```
Employee clock-in → GPS coordinates captured
→ Haversine distance to office geofence center
→ If within radiusMeters → auto check-in
→ If outside → reject or mark as MANUAL
```

### FIELD_SALES (GPS Trail)
```
GPS recorded every 60 seconds
→ Visit clustering: 200m radius, >10min = stop
→ Dashboard shows trail on Leaflet map
→ Offline sync when connection restored
```

### PROJECT_SITE (Photo Check-in)
```
Manual check-in with:
- Photo capture (camera)
- Site selection (dropdown)
- GPS coordinates (auto)
→ HR reviews check-in photos
```

## Bulk Resume AI Scoring Flow
```
1. HR uploads PDFs → saved to uploads/resumes/bulk/
2. BulkResumeUpload + BulkResumeItem records created
3. BullMQ resume worker processes each file:
   a. Calls AI service /ai/score-resume
   b. Extracts: name, email, phone, skills
   c. Scores against job requirements (0-100)
   d. Updates BulkResumeItem with results
4. Results visible in Recruitment → AI Screened tab
5. HR can: View Resume, Send WhatsApp invite, Create Application, Delete
```

## Adding a New Sidebar Item
```typescript
// In frontend/src/components/layout/Sidebar.tsx → navItems array:
{ name: 'Display Name', path: '/route-path', icon: LucideIcon, roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] }
// If no roles specified → visible to all authenticated users
```

## Adding a New RTK Query Endpoint
```typescript
// In frontend/src/features/<name>/<name>Api.ts:
import { api } from '../../app/api';
export const featureApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getData: builder.query<any, void>({
      query: () => '/api-path',
      providesTags: ['TagName'],
    }),
    createData: builder.mutation<any, InputType>({
      query: (body) => ({ url: '/api-path', method: 'POST', body }),
      invalidatesTags: ['TagName'],
    }),
  }),
});
export const { useGetDataQuery, useCreateDataMutation } = featureApi;
```

## Encryption Pattern
```typescript
import { encrypt, decrypt, maskAadhaar } from '../utils/encryption';

// Encrypt before storing
const encrypted = encrypt(rawAadhaarNumber);
await prisma.employee.update({ data: { aadhaarEncrypted: encrypted } });

// Decrypt for authorized users
const decrypted = decrypt(employee.aadhaarEncrypted);

// Mask for display (shows last 4 digits only)
const masked = maskAadhaar(rawNumber); // "XXXX-XXXX-1234"
```
