/**
 * SAFE demo-data cleanup script.
 *
 * ONLY deletes the seed demo user (demo@anistonav.com / EMP-001).
 * System accounts (superadmin, hr, admin) are NEVER touched.
 * Real production employees invited via the Invite flow are NEVER touched.
 *
 * Usage: npx tsx scripts/cleanup-employees.ts
 * Run manually on the server when you want to remove seed demo data only.
 * This script is NOT called from the CI/CD pipeline.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Only these seed demo emails will ever be deleted — nothing else
const DEMO_EMAILS = ['demo@anistonav.com'];

async function cleanup() {
  console.log('🧹 Removing seed demo users only (production employees are safe)...');

  // Find demo users
  const demoUsers = await prisma.user.findMany({
    where: { email: { in: DEMO_EMAILS } },
    select: { id: true, email: true },
  });

  if (demoUsers.length === 0) {
    console.log('  ✅ No demo users found — nothing to delete.');
    return;
  }

  const demoUserIds = demoUsers.map(u => u.id);
  console.log(`  Found demo users: ${demoUsers.map(u => u.email).join(', ')}`);

  // Find their employee records
  const demoEmployees = await prisma.employee.findMany({
    where: { userId: { in: demoUserIds } },
    select: { id: true, email: true, employeeCode: true },
  });

  const demoEmployeeIds = demoEmployees.map(e => e.id);
  console.log(`  Found demo employees: ${demoEmployees.map(e => `${e.employeeCode} (${e.email})`).join(', ')}`);
  console.log(`  Will delete ${demoEmployees.length} demo employee(s) and their data.`);
  console.log(`  All other production employees are untouched.`);

  if (demoEmployeeIds.length === 0) {
    // User exists but no employee record — just delete the user
    await prisma.user.deleteMany({ where: { id: { in: demoUserIds } } });
    console.log('  ✅ Demo user(s) deleted (no employee record found).');
    return;
  }

  // Delete all dependent data for demo employees in FK-safe order
  const dependentDeletes = [
    { name: 'AuditLogs', fn: () => prisma.auditLog.deleteMany({ where: { userId: { in: demoUserIds } } }) },
    { name: 'ActivityLogs', fn: () => prisma.activityLog.deleteMany({ where: { employeeId: { in: demoEmployeeIds } } }) },
    { name: 'Notifications', fn: () => prisma.notification.deleteMany({ where: { userId: { in: demoUserIds } } }) },
    { name: 'DeviceSessions', fn: () => prisma.deviceSession.deleteMany({ where: { userId: { in: demoUserIds } } }) },
    { name: 'PermissionOverrides', fn: () => prisma.permissionOverride.deleteMany({ where: { employeeId: { in: demoEmployeeIds } } }) },
    { name: 'ProfileEditRequests', fn: () => prisma.profileEditRequest.deleteMany({ where: { employeeId: { in: demoEmployeeIds } } }) },
    // Leave FK deps
    { name: 'LeaveTaskAudits', fn: async () => { const ids = await prisma.leaveRequest.findMany({ where: { employeeId: { in: demoEmployeeIds } }, select: { id: true } }).then(rs => rs.map(r => r.id)); return prisma.leaveTaskAudit.deleteMany({ where: { leaveRequestId: { in: ids } } }); } },
    { name: 'LeaveHandovers', fn: async () => { const ids = await prisma.leaveRequest.findMany({ where: { employeeId: { in: demoEmployeeIds } }, select: { id: true } }).then(rs => rs.map(r => r.id)); return prisma.leaveHandover.deleteMany({ where: { leaveRequestId: { in: ids } } }); } },
    { name: 'LeaveApprovalDecisions', fn: async () => { const ids = await prisma.leaveRequest.findMany({ where: { employeeId: { in: demoEmployeeIds } }, select: { id: true } }).then(rs => rs.map(r => r.id)); return prisma.leaveApprovalDecision.deleteMany({ where: { leaveRequestId: { in: ids } } }); } },
    { name: 'LeaveNotificationLogs', fn: async () => { const ids = await prisma.leaveRequest.findMany({ where: { employeeId: { in: demoEmployeeIds } }, select: { id: true } }).then(rs => rs.map(r => r.id)); return prisma.leaveNotificationLog.deleteMany({ where: { leaveRequestId: { in: ids } } }); } },
    { name: 'LeaveRequests', fn: () => prisma.leaveRequest.deleteMany({ where: { employeeId: { in: demoEmployeeIds } } }) },
    { name: 'LeaveBalances', fn: () => prisma.leaveBalance.deleteMany({ where: { employeeId: { in: demoEmployeeIds } } }) },
    // Attendance FK deps
    { name: 'AttendanceLogs', fn: async () => { const ids = await prisma.attendanceRecord.findMany({ where: { employeeId: { in: demoEmployeeIds } }, select: { id: true } }).then(rs => rs.map(r => r.id)); return prisma.attendanceLog.deleteMany({ where: { attendanceId: { in: ids } } }); } },
    { name: 'AttendanceAnomalies', fn: () => prisma.attendanceAnomaly.deleteMany({ where: { employeeId: { in: demoEmployeeIds } } }) },
    { name: 'AttendanceRegularizations', fn: () => prisma.attendanceRegularization.deleteMany({ where: { employeeId: { in: demoEmployeeIds } } }) },
    { name: 'GPSTrailPoints', fn: () => prisma.gPSTrailPoint.deleteMany({ where: { employeeId: { in: demoEmployeeIds } } }) },
    { name: 'AttendanceRecords', fn: () => prisma.attendanceRecord.deleteMany({ where: { employeeId: { in: demoEmployeeIds } } }) },
    // Payroll
    { name: 'PayrollAdjustments', fn: () => prisma.payrollAdjustment.deleteMany({ where: { employeeId: { in: demoEmployeeIds } } }) },
    { name: 'PayrollRecords', fn: () => prisma.payrollRecord.deleteMany({ where: { employeeId: { in: demoEmployeeIds } } }) },
    // Documents, assets
    { name: 'Documents', fn: () => prisma.document.deleteMany({ where: { employeeId: { in: demoEmployeeIds } } }) },
    { name: 'AssetAssignments', fn: () => prisma.assetAssignment.deleteMany({ where: { employeeId: { in: demoEmployeeIds } } }) },
    // Shifts, salary
    { name: 'ShiftAssignments', fn: () => prisma.shiftAssignment.deleteMany({ where: { employeeId: { in: demoEmployeeIds } } }) },
    { name: 'SalaryHistories', fn: () => prisma.salaryHistory.deleteMany({ where: { employeeId: { in: demoEmployeeIds } } }) },
    { name: 'SalaryStructures', fn: () => prisma.salaryStructure.deleteMany({ where: { employeeId: { in: demoEmployeeIds } } }) },
    // Performance
    { name: 'PerformanceReviews', fn: () => prisma.performanceReview.deleteMany({ where: { employeeId: { in: demoEmployeeIds } } }) },
    { name: 'Goals', fn: () => prisma.goal.deleteMany({ where: { employeeId: { in: demoEmployeeIds } } }) },
    { name: 'OvertimeRequests', fn: () => prisma.overtimeRequest.deleteMany({ where: { employeeId: { in: demoEmployeeIds } } }) },
    // Helpdesk
    { name: 'HelpdeskTickets', fn: () => prisma.ticket.deleteMany({ where: { createdBy: { in: demoUserIds } } }) },
    // Intern
    { name: 'InternAchievementLetters', fn: () => prisma.internAchievementLetter.deleteMany({ where: { internProfile: { employeeId: { in: demoEmployeeIds } } } }) },
    { name: 'InternProfiles', fn: () => prisma.internProfile.deleteMany({ where: { employeeId: { in: demoEmployeeIds } } }) },
    // Exit/offboarding
    { name: 'ExitChecklistItems', fn: () => prisma.exitChecklistItem.deleteMany({ where: { checklist: { employeeId: { in: demoEmployeeIds } } } }) },
    { name: 'ExitChecklists', fn: () => prisma.exitChecklist.deleteMany({ where: { employeeId: { in: demoEmployeeIds } } }) },
    // Onboarding
    { name: 'OnboardingDocumentGates', fn: () => prisma.onboardingDocumentGate.deleteMany({ where: { employeeId: { in: demoEmployeeIds } } }) },
  ];

  for (const { name, fn } of dependentDeletes) {
    try {
      const result = await fn();
      if ((result as any).count > 0) {
        console.log(`    ✅ ${name}: ${(result as any).count} deleted`);
      }
    } catch (err: any) {
      console.log(`    ⚠️  ${name}: skipped (${err.message?.slice(0, 80)})`);
    }
  }

  // Delete the demo employee records
  await prisma.employee.deleteMany({ where: { id: { in: demoEmployeeIds } } });
  console.log(`  ✅ Demo employee record(s) deleted`);

  // Delete the demo user accounts
  await prisma.user.deleteMany({ where: { id: { in: demoUserIds } } });
  console.log(`  ✅ Demo user account(s) deleted`);

  console.log('\n  🎉 Done — only demo@anistonav.com removed.');
  console.log('  All production employees and system accounts are untouched.');
}

cleanup()
  .catch((e) => {
    console.error('❌ Cleanup failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
