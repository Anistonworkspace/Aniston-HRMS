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
    { name: 'Notifications', fn: () => prisma.notification.deleteMany({ where: { userId: { in: otherUserIds } } }) },
    { name: 'LeaveRequests', fn: () => prisma.leaveRequest.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    { name: 'LeaveBalances', fn: () => prisma.leaveBalance.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    { name: 'AttendanceRecords', fn: () => prisma.attendance.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    { name: 'PayrollRecords', fn: () => prisma.payroll.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    { name: 'Documents', fn: () => prisma.document.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    { name: 'AssetAssignments', fn: () => prisma.assetAssignment.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    { name: 'PerformanceGoals', fn: () => prisma.performanceGoal.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    { name: 'PerformanceReviews', fn: () => prisma.performanceReview.deleteMany({ where: { employeeId: { in: otherEmployeeIds } } }) },
    { name: 'HelpdeskTickets', fn: () => prisma.helpdeskTicket.deleteMany({ where: { createdBy: { in: otherUserIds } } }) },
    { name: 'RefreshTokens', fn: () => prisma.refreshToken.deleteMany({ where: { userId: { in: otherUserIds } } }) },
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
