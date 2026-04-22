/**
 * One-time production cleanup script.
 * Removes ALL employees and users EXCEPT the SuperAdmin (superadmin@anistonav.com).
 * After this, only the invitation flow can create new employees.
 *
 * Usage: npx tsx scripts/cleanup-employees.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanup() {
  console.log('🧹 Cleaning up production employees...');

  // System accounts that should NEVER be deleted
  const systemEmails = ['superadmin@anistonav.com', 'hr@anistonav.com', 'admin@anistonav.com'];

  // Find all system users
  const systemUsers = await prisma.user.findMany({
    where: { email: { in: systemEmails } },
    select: { id: true, email: true },
  });

  if (systemUsers.length === 0) {
    console.error('❌ No system accounts found! Run seed first.');
    process.exit(1);
  }

  const systemUserIds = systemUsers.map(u => u.id);
  console.log(`  ✅ System accounts found: ${systemUsers.map(u => u.email).join(', ')}`);

  // Count before cleanup
  const userCount = await prisma.user.count();
  const employeeCount = await prisma.employee.count({ where: { isSystemAccount: { not: true } } });
  console.log(`  📊 Before: ${userCount} users, ${employeeCount} regular employees`);

  if (userCount <= systemUsers.length && employeeCount === 0) {
    console.log('  ✅ Already clean — only system accounts exist.');
    return;
  }

  // Delete in dependency order to avoid foreign key violations
  // Get all non-system employee IDs and user IDs
  const otherEmployees = await prisma.employee.findMany({
    where: { userId: { notIn: systemUserIds } },
    select: { id: true, userId: true, email: true, employeeCode: true },
  });

  const otherUserIds = otherEmployees.map(e => e.userId).filter(Boolean);
  const otherEmployeeIds = otherEmployees.map(e => e.id);

  console.log(`  🗑️  Removing ${otherEmployees.length} employees (keeping ${systemUsers.length} system accounts)...`);

  // Delete dependent records first (order matters for FK constraints)
  // Each delete is wrapped in try-catch so missing tables don't break the script
  const dependentDeletes = [
    // WhatsApp sessions & messages are PRESERVED across deploys — only deleted on manual logout
    // { name: 'WhatsAppMessages', fn: () => prisma.whatsAppMessage.deleteMany({}) },
    // { name: 'WhatsAppSessions', fn: () => prisma.whatsAppSession.deleteMany({}) },
    { name: 'EmployeeInvitations', fn: () => prisma.employeeInvitation.deleteMany({}) },
    { name: 'AuditLogs', fn: () => prisma.auditLog.deleteMany({ where: { userId: { in: otherUserIds } } }) },
    { name: 'ActivityLogs', fn: () => prisma.activityLog.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    { name: 'Notifications', fn: () => prisma.notification.deleteMany({ where: { userId: { in: otherUserIds } } }) },
    { name: 'DeviceSessions', fn: () => prisma.deviceSession.deleteMany({ where: { userId: { in: otherUserIds } } }) },
    { name: 'PermissionOverrides', fn: () => prisma.permissionOverride.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    { name: 'ProfileEditRequests', fn: () => prisma.profileEditRequest.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    // Leave FK deps (must delete children before leaveRequest)
    { name: 'LeaveTaskAudits', fn: async () => { const ids = await prisma.leaveRequest.findMany({ where: { employeeId: { in: otherEmployeeIds } }, select: { id: true } }).then(rs => rs.map(r => r.id)); return prisma.leaveTaskAudit.deleteMany({ where: { leaveRequestId: { in: ids } } }); } },
    { name: 'LeaveHandovers', fn: async () => { const ids = await prisma.leaveRequest.findMany({ where: { employeeId: { in: otherEmployeeIds } }, select: { id: true } }).then(rs => rs.map(r => r.id)); return prisma.leaveHandover.deleteMany({ where: { leaveRequestId: { in: ids } } }); } },
    { name: 'LeaveApprovalDecisions', fn: async () => { const ids = await prisma.leaveRequest.findMany({ where: { employeeId: { in: otherEmployeeIds } }, select: { id: true } }).then(rs => rs.map(r => r.id)); return prisma.leaveApprovalDecision.deleteMany({ where: { leaveRequestId: { in: ids } } }); } },
    { name: 'LeaveNotificationLogs', fn: async () => { const ids = await prisma.leaveRequest.findMany({ where: { employeeId: { in: otherEmployeeIds } }, select: { id: true } }).then(rs => rs.map(r => r.id)); return prisma.leaveNotificationLog.deleteMany({ where: { leaveRequestId: { in: ids } } }); } },
    { name: 'LeaveRequests', fn: () => prisma.leaveRequest.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    { name: 'LeaveBalances', fn: () => prisma.leaveBalance.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    // Attendance FK deps (must delete children before attendanceRecord)
    { name: 'AttendanceLogs', fn: async () => { const ids = await prisma.attendanceRecord.findMany({ where: { employeeId: { in: otherEmployeeIds } }, select: { id: true } }).then(rs => rs.map(r => r.id)); return prisma.attendanceLog.deleteMany({ where: { attendanceId: { in: ids } } }); } },
    { name: 'AttendanceAnomalies', fn: () => prisma.attendanceAnomaly.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    { name: 'AttendanceRegularizations', fn: () => prisma.attendanceRegularization.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    { name: 'GPSTrailPoints', fn: () => prisma.gPSTrailPoint.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    { name: 'AttendanceRecords', fn: () => prisma.attendanceRecord.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    // Payroll
    { name: 'PayrollAdjustments', fn: () => prisma.payrollAdjustment.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    { name: 'PayrollRecords', fn: () => prisma.payrollRecord.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    // Documents, assets
    { name: 'Documents', fn: () => prisma.document.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    { name: 'AssetAssignments', fn: () => prisma.assetAssignment.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    // Shifts
    { name: 'ShiftAssignments', fn: () => prisma.shiftAssignment.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    // Salary
    { name: 'SalaryHistories', fn: () => prisma.salaryHistory.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    { name: 'SalaryStructures', fn: () => prisma.salaryStructure.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    // Performance
    { name: 'PerformanceReviews', fn: () => prisma.performanceReview.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    { name: 'Goals', fn: () => prisma.goal.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    { name: 'OvertimeRequests', fn: () => prisma.overtimeRequest.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    // Helpdesk (model is Ticket, not HelpdeskTicket)
    { name: 'HelpdeskTickets', fn: () => prisma.ticket.deleteMany({ where: { createdBy: { in: otherUserIds } } }) },
    // Intern
    { name: 'InternAchievementLetters', fn: () => prisma.internAchievementLetter.deleteMany({ where: { internProfile: { employeeId: { in: otherEmployeeIds } } } }) },
    { name: 'InternProfiles', fn: () => prisma.internProfile.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    // Exit/offboarding
    { name: 'ExitChecklistItems', fn: () => prisma.exitChecklistItem.deleteMany({ where: { checklist: { employeeId: { in: otherEmployeeIds } } } }) },
    { name: 'ExitChecklists', fn: () => prisma.exitChecklist.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    // Onboarding
    { name: 'OnboardingDocumentGates', fn: () => prisma.onboardingDocumentGate.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    // Refresh tokens are in Redis — no DB model
  ];

  for (const { name, fn } of dependentDeletes) {
    try {
      const result = await fn();
      if ((result as any).count > 0) {
        console.log(`    ✅ ${name}: ${(result as any).count} deleted`);
      }
    } catch (err: any) {
      // Table might not exist or no matching records — that's fine
      console.log(`    ⚠️  ${name}: skipped (${err.message?.slice(0, 60)})`);
    }
  }

  // Delete employees (except system accounts)
  const empResult = await prisma.employee.deleteMany({
    where: { userId: { notIn: systemUserIds } },
  });
  console.log(`  ✅ Employees deleted: ${empResult.count}`);

  // Delete users (except system accounts)
  const userResult = await prisma.user.deleteMany({
    where: { id: { notIn: systemUserIds } },
  });
  console.log(`  ✅ Users deleted: ${userResult.count}`);

  // Verify
  const finalUserCount = await prisma.user.count();
  const finalEmployeeCount = await prisma.employee.count({ where: { isSystemAccount: { not: true } } });
  console.log(`\n  📊 After: ${finalUserCount} users (${systemUsers.length} system), ${finalEmployeeCount} regular employees`);
  console.log('  🎉 Cleanup complete! Only system accounts remain.');
  console.log('  📝 New employees must be created via Invite Employee flow.');
}

cleanup()
  .catch((e) => {
    console.error('❌ Cleanup failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
