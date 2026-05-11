import { prisma } from '../lib/prisma.js';
import { ForbiddenError } from '../middleware/errorHandler.js';

type RestrictionKey =
  | 'canHRChangeShift'
  | 'canHRMarkAttendance'
  | 'canHREditProfile'
  | 'canHRManageLeave'
  | 'canHRManageDocuments'
  | 'canHRChangeRole'
  | 'canHRRunPayroll'
  | 'canHREditSalary'
  | 'canHRViewPayroll'
  | 'canHRAddPayrollAdjustment'
  | 'canHRExportAttendance'
  | 'canHRResolveRegularization'
  | 'canHRSetHybridSchedule'
  | 'canHRManageKYC'
  | 'canHRManageExit'
  | 'canHRResetPassword';

const ACTION_LABELS: Record<RestrictionKey, string> = {
  canHRChangeShift: 'change shifts',
  canHRMarkAttendance: 'mark attendance',
  canHREditProfile: 'edit this employee profile',
  canHRManageLeave: 'manage leave',
  canHRManageDocuments: 'manage documents',
  canHRChangeRole: 'change role',
  canHRRunPayroll: 'run payroll',
  canHREditSalary: 'edit salary',
  canHRViewPayroll: 'view payroll records',
  canHRAddPayrollAdjustment: 'add payroll adjustments',
  canHRExportAttendance: 'export attendance data',
  canHRResolveRegularization: 'resolve regularization requests',
  canHRSetHybridSchedule: 'set hybrid schedule',
  canHRManageKYC: 'manage KYC',
  canHRManageExit: 'manage offboarding',
  canHRResetPassword: 'reset password',
};

/**
 * Checks if the performing role is HR and if they're blocked from a specific action
 * on the target employee. Throws ForbiddenError if blocked.
 *
 * Non-HR roles (SUPER_ADMIN, ADMIN) are always allowed through.
 */
export async function assertHRActionAllowed(
  performerRole: string,
  employeeId: string,
  action: RestrictionKey,
): Promise<void> {
  if (performerRole !== 'HR') return;

  const restriction = await prisma.hRActionRestriction.findFirst({
    where: { employeeId },
    select: { [action]: true },
  });

  if (restriction && restriction[action] === false) {
    throw new ForbiddenError(
      `Super Admin has restricted HR from performing this action: ${ACTION_LABELS[action]} for this employee.`,
    );
  }
}
