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

  const superAdminEmail = 'superadmin@anistonav.com';

  // Find SuperAdmin user
  const superAdmin = await prisma.user.findUnique({
    where: { email: superAdminEmail },
  });

  if (!superAdmin) {
    console.error('❌ SuperAdmin not found! Run seed first.');
    process.exit(1);
  }

  console.log(`  ✅ SuperAdmin found: ${superAdmin.id}`);

  // Count before cleanup
  const userCount = await prisma.user.count();
  const employeeCount = await prisma.employee.count();
  console.log(`  📊 Before: ${userCount} users, ${employeeCount} employees`);

  if (userCount <= 1 && employeeCount <= 1) {
    console.log('  ✅ Already clean — only SuperAdmin exists.');
    return;
  }

  // Delete in dependency order to avoid foreign key violations
  // Get all non-SuperAdmin employee IDs and user IDs
  const otherEmployees = await prisma.employee.findMany({
    where: { userId: { not: superAdmin.id } },
    select: { id: true, userId: true, email: true, employeeCode: true },
  });

  const otherUserIds = otherEmployees.map(e => e.userId).filter(Boolean);
  const otherEmployeeIds = otherEmployees.map(e => e.id);

  console.log(`  🗑️  Removing ${otherEmployees.length} employees...`);

  // Delete dependent records first (order matters for FK constraints)
  // Each delete is wrapped in try-catch so missing tables don't break the script
  const dependentDeletes = [
    { name: 'WhatsAppMessages', fn: () => prisma.whatsAppMessage.deleteMany({}) },
    { name: 'WhatsAppSessions', fn: () => prisma.whatsAppSession.deleteMany({}) },
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

  // Delete employees (except SuperAdmin's)
  const empResult = await prisma.employee.deleteMany({
    where: { userId: { not: superAdmin.id } },
  });
  console.log(`  ✅ Employees deleted: ${empResult.count}`);

  // Delete users (except SuperAdmin)
  const userResult = await prisma.user.deleteMany({
    where: { id: { not: superAdmin.id } },
  });
  console.log(`  ✅ Users deleted: ${userResult.count}`);

  // Verify
  const finalUserCount = await prisma.user.count();
  const finalEmployeeCount = await prisma.employee.count();
  console.log(`\n  📊 After: ${finalUserCount} user, ${finalEmployeeCount} employee`);
  console.log('  🎉 Cleanup complete! Only SuperAdmin remains.');
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
