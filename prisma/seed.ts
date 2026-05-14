import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Safety guard — never seed against production
const dbUrl = process.env.DATABASE_URL || '';
if (!dbUrl.includes('localhost') && !dbUrl.includes('127.0.0.1') && process.env.ALLOW_PROD_SEED !== 'true') {
  console.error('❌ SEED BLOCKED: DATABASE_URL does not point to localhost. Refusing to seed a non-local database.');
  console.error('   If you truly want to seed production, set ALLOW_PROD_SEED=true explicitly.');
  process.exit(1);
}

async function main() {
  console.log('🌱 Seeding Aniston HRMS database...');

  // Create organization
  const org = await prisma.organization.upsert({
    where: { slug: 'aniston' },
    update: {},
    create: {
      name: 'Aniston Technologies LLP',
      slug: 'aniston',
      timezone: 'Asia/Kolkata',
      fiscalYear: 'APRIL_MARCH',
      currency: 'INR',
      address: {
        line1: 'Aniston Technologies LLP',
        city: 'New Delhi',
        state: 'Delhi',
        pincode: '110001',
        country: 'India',
      },
    },
  });

  console.log(`  ✅ Organization: ${org.name}`);

  // Create departments
  const departments = [
    { name: 'Engineering', description: 'Software Development & IT' },
    { name: 'Human Resources', description: 'People & Culture' },
    { name: 'Sales', description: 'Sales & Business Development' },
    { name: 'Marketing', description: 'Marketing & Communications' },
    { name: 'Finance', description: 'Accounting & Finance' },
    { name: 'Operations', description: 'Operations & Administration' },
    { name: 'Design', description: 'UI/UX & Product Design' },
    { name: 'Quality Assurance', description: 'Testing & QA' },
  ];

  for (const dept of departments) {
    await prisma.department.upsert({
      where: { name_organizationId: { name: dept.name, organizationId: org.id } },
      update: {},
      create: { ...dept, organizationId: org.id },
    });
  }
  console.log(`  ✅ Departments: ${departments.length} created`);

  // Create designations
  const designations = [
    { name: 'CEO', level: 1 },
    { name: 'CTO', level: 2 },
    { name: 'VP Engineering', level: 3 },
    { name: 'HR Director', level: 3 },
    { name: 'Engineering Manager', level: 4 },
    { name: 'HR Manager', level: 4 },
    { name: 'Sales Manager', level: 4 },
    { name: 'Senior Software Engineer', level: 5 },
    { name: 'Software Engineer', level: 6 },
    { name: 'Junior Software Engineer', level: 7 },
    { name: 'HR Executive', level: 6 },
    { name: 'Sales Executive', level: 6 },
    { name: 'Marketing Executive', level: 6 },
    { name: 'UI/UX Designer', level: 6 },
    { name: 'QA Engineer', level: 6 },
    { name: 'Intern', level: 8 },
  ];

  for (const desig of designations) {
    await prisma.designation.upsert({
      where: { name_organizationId: { name: desig.name, organizationId: org.id } },
      update: {},
      create: { ...desig, organizationId: org.id },
    });
  }
  console.log(`  ✅ Designations: ${designations.length} created`);

  // ---------- System Accounts (not counted as employees) ----------

  const engDept = await prisma.department.findFirst({
    where: { name: 'Engineering', organizationId: org.id },
  });
  const hrDept = await prisma.department.findFirst({
    where: { name: 'Human Resources', organizationId: org.id },
  });
  const ceoDes = await prisma.designation.findFirst({
    where: { name: 'CEO', organizationId: org.id },
  });
  const hrDirDes = await prisma.designation.findFirst({
    where: { name: 'HR Director', organizationId: org.id },
  });

  const systemAccounts = [
    {
      email: 'superadmin@anistonav.com',
      password: 'Superadmin@1234',
      role: 'SUPER_ADMIN' as const,
      employeeCode: 'SYS-001',
      firstName: 'Super',
      lastName: 'Admin',
      departmentId: engDept?.id,
      designationId: ceoDes?.id,
    },
    {
      email: 'hr@anistonav.com',
      password: 'Hr@1234',
      role: 'HR' as const,
      employeeCode: 'SYS-002',
      firstName: 'HR',
      lastName: 'Manager',
      departmentId: hrDept?.id,
      designationId: hrDirDes?.id,
    },
    {
      email: 'admin@anistonav.com',
      password: 'Admin@1234',
      role: 'ADMIN' as const,
      employeeCode: 'SYS-003',
      firstName: 'Admin',
      lastName: 'User',
      departmentId: engDept?.id,
      designationId: ceoDes?.id,
    },
    {
      email: 'developer@anistonav.com',
      password: 'Developer@2026!',
      role: 'SUPER_ADMIN' as const,
      employeeCode: 'SYS-DEV',
      firstName: 'Developer',
      lastName: 'Account',
      departmentId: engDept?.id,
      designationId: ceoDes?.id,
    },
  ];

  // Migrate old EMP-xxx system accounts to SYS-xxx and mark as system accounts
  const migrationMap: Record<string, { newCode: string; email: string }> = {
    'EMP-001': { newCode: 'SYS-001', email: 'superadmin@anistonav.com' },
  };
  for (const [oldCode, { newCode, email }] of Object.entries(migrationMap)) {
    const old = await prisma.employee.findUnique({ where: { employeeCode: oldCode } });
    if (old && old.email === email) {
      await prisma.employee.update({ where: { employeeCode: oldCode }, data: { employeeCode: newCode, isSystemAccount: true } });
      console.log(`  🔄 Migrated ${oldCode} → ${newCode}`);
    }
  }
  // Ensure all admin-role employees are marked as system accounts
  const adminEmails = systemAccounts.map(a => a.email);
  await prisma.employee.updateMany({
    where: { email: { in: adminEmails } },
    data: { isSystemAccount: true },
  });

  for (const acct of systemAccounts) {
    // Only hash + set password on CREATE (first seed). Never overwrite on update
    // so production passwords changed via the app are preserved.
    const existingUser = await prisma.user.findUnique({ where: { email: acct.email } });
    const passwordHash = existingUser ? existingUser.passwordHash : await bcrypt.hash(acct.password, 12);
    const user = await prisma.user.upsert({
      where: { email: acct.email },
      update: { role: acct.role, status: 'ACTIVE' },
      create: {
        email: acct.email,
        passwordHash,
        role: acct.role,
        status: 'ACTIVE',
        organizationId: org.id,
      },
    });

    await prisma.employee.upsert({
      where: { employeeCode: acct.employeeCode },
      update: { isSystemAccount: true, userId: user.id, status: 'ACTIVE', deletedAt: null, onboardingComplete: true },
      create: {
        employeeCode: acct.employeeCode,
        userId: user.id,
        firstName: acct.firstName,
        lastName: acct.lastName,
        email: acct.email,
        phone: '+91-0000000000',
        gender: 'PREFER_NOT_TO_SAY',
        departmentId: acct.departmentId,
        designationId: acct.designationId,
        workMode: 'OFFICE',
        joiningDate: new Date('2024-01-01'),
        status: 'ACTIVE',
        onboardingComplete: true,
        isSystemAccount: true,
        organizationId: org.id,
      },
    });
    console.log(`  ✅ ${acct.role}: ${acct.email}`);
  }

  // Demo employee removed — all real employees are created via invitation flow only.

  // NOTE: All other users are created via the invitation flow.
  // HR/Admin/SuperAdmin sends an invite → user sets password → onboarding wizard.
  // No Microsoft Teams sync — invitation-only user creation.

  // Leave types are created by HR via Leave Management → Types tab.
  // Policy Settings is the single source of truth for allocations.
  // No default leave types are seeded — HR configures from scratch.

  // Create Leave Policy (AT/HR/LAP/2026-03/002 v3.0)
  const leavePolicyContent = `LEAVE, ATTENDANCE & PROFESSIONAL INTEGRITY POLICY
Aniston Technologies LLP — Document Ref: AT/HR/LAP/2026-03/002 | Version 3.0 (Final Revised) | Effective: Immediate

⚠ MANDATORY COMPLIANCE NOTICE
This policy supersedes all previous verbal or informal leave and attendance arrangements.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. ANNUAL LEAVE ENTITLEMENT (20 Days/Year)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Casual Leave (CL) — 7 days: Personal work, appointments, family events. 2-day advance notice required. Max 2 consecutive days.
• Sick Leave (SL) — 7 days: Illness, medical treatment. Inform HR before 9:00 AM. Medical certificate required for 2+ consecutive days.
• Emergency Leave (EL) — 3 days: Genuine emergencies ONLY (hospitalisation, accident, bereavement). Inform within 1 hour via phone call. Documentation mandatory.
• Privilege Leave (PL) — 3 days: Planned vacations, travel. 7-day advance notice. Available after 6 months. Carry forward max 3 days.
• Leave Without Pay (LWP) — When all paid leaves exhausted. Salary deducted proportionally.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. MONTHLY CAP — Maximum 2 Paid Leaves/Month
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

No employee shall take more than 2 paid leaves in any single calendar month across ALL categories. Excess days → LWP with salary deduction.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. MANDATORY ATTENDANCE — 1st to 10th of Every Month
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NO leave permitted during 1st-10th of any month except documented medical emergencies requiring hospitalisation. Violations: LWP + Written Warning → Show Cause → PRP.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. OFFICE TIMINGS & ATTENDANCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Reporting Time: 9:30 AM (Sharp) | Grace Period: 20 minutes (up to 9:50 AM)
• Working Hours: 8 hours (9:30 AM – 6:30 PM) | Lunch: 2:00 PM – 2:40 PM
• Working Days: Monday to Saturday
• Physical presence ≠ Attendance. Must be at workstation and productive.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. SANDWICH RULE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Leave taken adjacent to holidays — the intervening holiday(s) also count as leave.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6. PATTERN-BASED DEDUCTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HR reviews attendance monthly. If habitual lateness/absences detected, leave deducted: Emergency Leave → Sick Leave → Casual Leave → Privilege Leave → LWP.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7. DISCIPLINARY ACTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Proxy attendance → Immediate termination
• Fake documentation → Immediate suspension + termination
• 3 consecutive unauthorised days → Deemed abandonment
• Exceeding 2-leave cap repeatedly → Performance Review Program
• Unapproved leave → LWP + Written Warning → Show Cause → PRP

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
8. LEAVE APPLICATION PROTOCOL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• All requests via official leave management system (this application)
• WhatsApp/verbal requests are NOT valid leave applications
• Leave is approved ONLY upon written confirmation from HR/Manager
• Submitting application does not guarantee approval`;

  await prisma.policy.upsert({
    where: { id: 'leave-policy-v3' },
    update: { content: leavePolicyContent, version: 3 },
    create: {
      id: 'leave-policy-v3',
      title: 'Leave, Attendance & Professional Integrity Policy',
      category: 'LEAVE',
      content: leavePolicyContent,
      version: 3,
      isActive: true,
      organizationId: org.id,
    },
  });
  console.log('  ✅ Leave policy created');

  // Holidays are NOT auto-seeded — HR adds them manually via Leave Management > Holidays & Events
  // Only Sunday is a weekly off. HR can add Indian Holidays using the suggestions button.
  console.log('  ℹ️  Holidays: None auto-created (HR adds via Leave Management)');

  console.log('\n🎉 Seed completed successfully!');
  console.log('\n┌──────────────────────────────────────────────────────────────────────┐');
  console.log('│  SYSTEM ACCOUNT CREDENTIALS (hidden from employee dashboard)       │');
  console.log('├──────────────┬──────────────────────────┬──────────────────────────┤');
  console.log('│ Role         │ Email                    │ Password                 │');
  console.log('├──────────────┼──────────────────────────┼──────────────────────────┤');
  console.log('│ SUPER_ADMIN  │ superadmin@anistonav.com │ [set in seed]            │');
  console.log('│ HR           │ hr@anistonav.com         │ [set in seed]            │');
  console.log('│ ADMIN        │ admin@anistonav.com      │ [set in seed]            │');
  console.log('├──────────────┼──────────────────────────┼──────────────────────────┤');
  console.log('│  DEMO EMPLOYEE (visible on dashboard, HR can delete permanently)   │');
  console.log('├──────────────┼──────────────────────────┼──────────────────────────┤');
  console.log('│ EMPLOYEE     │ demo@anistonav.com       │ [set in seed]            │');
  console.log('├──────────────┴──────────────────────────┴──────────────────────────┤');
  console.log('│  All other users are created via the Invitation flow.              │');
  console.log('└──────────────────────────────────────────────────────────────────────┘');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
