import { useAppSelector } from '../app/store';
import { useGetMyPermissionsQuery } from '../features/permissions/permissionsApi';

export type EmpPerms = {
  canMarkAttendance: boolean;
  canViewAttendanceHistory: boolean;
  canApplyLeaves: boolean;
  canViewLeaveBalance: boolean;
  canViewPayslips: boolean;
  canDownloadPayslips: boolean;
  canViewDocuments: boolean;
  canDownloadDocuments: boolean;
  canViewDashboardStats: boolean;
  canViewAnnouncements: boolean;
  canViewPolicies: boolean;
  canRaiseHelpdeskTickets: boolean;
  canViewOrgChart: boolean;
  canViewPerformance: boolean;
  canViewEditProfile: boolean;
};

const ALL_TRUE: EmpPerms = {
  canMarkAttendance: true,
  canViewAttendanceHistory: true,
  canApplyLeaves: true,
  canViewLeaveBalance: true,
  canViewPayslips: true,
  canDownloadPayslips: true,
  canViewDocuments: true,
  canDownloadDocuments: true,
  canViewDashboardStats: true,
  canViewAnnouncements: true,
  canViewPolicies: true,
  canRaiseHelpdeskTickets: true,
  canViewOrgChart: true,
  canViewPerformance: true,
  canViewEditProfile: true,
};

// These roles bypass employee-level permission restrictions entirely
const SKIP_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER']);

/**
 * Returns effective employee-level permissions.
 * SUPER_ADMIN / ADMIN / HR / MANAGER always get all-true (no restrictions).
 * EMPLOYEE / INTERN fetch from /employee-permissions/me (Redis-cached, 5-min TTL).
 */
export function useEmpPerms(): { perms: EmpPerms; isLoading: boolean } {
  const role = useAppSelector((s) => s.auth.user?.role || '');
  const isEmployee = !SKIP_ROLES.has(role);

  const { data, isLoading } = useGetMyPermissionsQuery(undefined, {
    skip: !isEmployee,
  });

  if (!isEmployee) {
    return { perms: ALL_TRUE, isLoading: false };
  }

  const raw: Record<string, boolean> = data?.data || {};
  const perms = {} as EmpPerms;
  for (const key of Object.keys(ALL_TRUE) as (keyof EmpPerms)[]) {
    // Default to true if the key is not present (safe fail-open for unset permissions)
    perms[key] = raw[key] !== false;
  }

  return { perms, isLoading };
}
