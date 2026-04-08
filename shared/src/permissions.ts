// ============================================
// Aniston HRMS — RBAC Permissions Map
// ============================================
import { Role } from './enums';

export type Action =
  | 'create'
  | 'read'
  | 'read:own'
  | 'update'
  | 'update:own'
  | 'delete'
  | 'approve'
  | 'export'
  | 'manage';

export type Resource =
  | 'employee'
  | 'attendance'
  | 'leave'
  | 'payroll'
  | 'recruitment'
  | 'performance'
  | 'policy'
  | 'announcement'
  | 'helpdesk'
  | 'report'
  | 'asset'
  | 'settings'
  | 'org_chart'
  | 'social_wall'
  | 'onboarding'
  | 'audit_log'
  | 'document'
  | 'holiday'
  | 'department'
  | 'designation'
  | 'walk_in'
  | 'exit_access'
  | 'letter';

export type PermissionsMap = Record<Role, Partial<Record<Resource, Action[]>>>;

export const PERMISSIONS: PermissionsMap = {
  [Role.SUPER_ADMIN]: {
    employee: ['create', 'read', 'update', 'delete', 'manage', 'export'],
    attendance: ['create', 'read', 'update', 'delete', 'manage', 'export'],
    leave: ['create', 'read', 'update', 'delete', 'approve', 'manage', 'export'],
    payroll: ['create', 'read', 'update', 'delete', 'manage', 'export'],
    recruitment: ['create', 'read', 'update', 'delete', 'manage', 'export'],
    performance: ['create', 'read', 'update', 'delete', 'manage', 'export'],
    policy: ['create', 'read', 'update', 'delete', 'manage'],
    announcement: ['create', 'read', 'update', 'delete', 'manage'],
    helpdesk: ['create', 'read', 'update', 'delete', 'manage'],
    report: ['read', 'export', 'manage'],
    asset: ['create', 'read', 'update', 'delete', 'manage'],
    settings: ['read', 'update', 'manage'],
    org_chart: ['read', 'manage'],
    social_wall: ['create', 'read', 'update', 'delete', 'manage'],
    onboarding: ['create', 'read', 'update', 'delete', 'manage'],
    audit_log: ['read', 'export'],
    document: ['create', 'read', 'update', 'delete', 'manage'],
    holiday: ['create', 'read', 'update', 'delete'],
    department: ['create', 'read', 'update', 'delete'],
    designation: ['create', 'read', 'update', 'delete'],
    walk_in: ['create', 'read', 'update', 'delete'],
    exit_access: ['create', 'read', 'update', 'delete', 'manage'],
    letter: ['create', 'read', 'update', 'delete', 'manage'],
  },

  [Role.ADMIN]: {
    employee: ['create', 'read', 'update', 'delete', 'manage', 'export'],
    attendance: ['create', 'read', 'update', 'delete', 'export'],
    leave: ['create', 'read', 'update', 'delete', 'approve', 'export'],
    payroll: ['create', 'read', 'update', 'delete', 'export'],
    recruitment: ['create', 'read', 'update', 'delete', 'export'],
    performance: ['create', 'read', 'update', 'delete', 'export'],
    policy: ['create', 'read', 'update', 'delete'],
    announcement: ['create', 'read', 'update', 'delete'],
    helpdesk: ['create', 'read', 'update', 'delete'],
    report: ['read', 'export'],
    asset: ['create', 'read', 'update', 'delete'],
    settings: ['read', 'update'],
    org_chart: ['read', 'manage'],
    social_wall: ['create', 'read', 'update', 'delete'],
    onboarding: ['create', 'read', 'update', 'delete'],
    audit_log: ['read', 'export'],
    document: ['create', 'read', 'update', 'delete'],
    holiday: ['create', 'read', 'update', 'delete'],
    department: ['create', 'read', 'update', 'delete'],
    designation: ['create', 'read', 'update', 'delete'],
    walk_in: ['create', 'read', 'update', 'delete'],
    exit_access: ['create', 'read', 'update', 'delete'],
    letter: ['create', 'read', 'update', 'delete'],
  },

  [Role.HR]: {
    employee: ['create', 'read', 'update', 'manage', 'export'],
    attendance: ['read', 'update', 'export'],
    leave: ['read', 'update', 'approve', 'export'],
    payroll: ['create', 'read', 'update', 'export'],
    recruitment: ['create', 'read', 'update', 'delete'],
    performance: ['create', 'read', 'update'],
    policy: ['create', 'read', 'update'],
    announcement: ['create', 'read', 'update'],
    helpdesk: ['read', 'update'],
    report: ['read', 'export'],
    asset: ['create', 'read', 'update'],
    settings: ['read'],
    org_chart: ['read'],
    social_wall: ['create', 'read', 'update', 'delete'],
    onboarding: ['create', 'read', 'update'],
    audit_log: ['read'],
    document: ['create', 'read', 'update'],
    holiday: ['create', 'read', 'update'],
    department: ['create', 'read', 'update'],
    designation: ['create', 'read', 'update'],
    walk_in: ['create', 'read', 'update', 'delete'],
    exit_access: ['create', 'read', 'update'],
    letter: ['create', 'read', 'update'],
  },

  [Role.MANAGER]: {
    employee: ['read'],
    attendance: ['read'],
    leave: ['read', 'approve'],
    payroll: ['read:own'],
    recruitment: ['create', 'read'],
    performance: ['create', 'read', 'update'],
    policy: ['read'],
    announcement: ['read'],
    helpdesk: ['create', 'read:own'],
    report: ['read'],
    asset: ['read'],
    org_chart: ['read'],
    social_wall: ['create', 'read'],
    onboarding: ['read'],
    document: ['read:own'],
    holiday: ['read'],
    department: ['read'],
    designation: ['read'],
    walk_in: ['read'],
  },

  [Role.EMPLOYEE]: {
    employee: ['read:own', 'update:own'],
    attendance: ['create', 'read:own'],
    leave: ['create', 'read:own'],
    payroll: ['read:own'],
    policy: ['read'],
    announcement: ['read'],
    helpdesk: ['create', 'read:own'],
    social_wall: ['create', 'read'],
    document: ['create', 'read:own'],
    holiday: ['read'],
    org_chart: ['read'],
    letter: ['read'],
  },

  [Role.INTERN]: {
    employee: ['read:own', 'update:own'],
    attendance: ['create', 'read:own'],
    leave: ['create', 'read:own'],
    helpdesk: ['create', 'read:own'],
    social_wall: ['create', 'read'],
    document: ['create', 'read:own'],
    policy: ['read'],
    announcement: ['read'],
    holiday: ['read'],
    org_chart: ['read'],
    letter: ['read'],
  },

  [Role.GUEST_INTERVIEWER]: {
    recruitment: ['read', 'update'],
  },
};

/**
 * Check if a role has a specific permission on a resource
 */
export function hasPermission(
  role: Role,
  resource: Resource,
  action: Action
): boolean {
  const rolePermissions = PERMISSIONS[role];
  if (!rolePermissions) return false;

  const resourceActions = rolePermissions[resource];
  if (!resourceActions) return false;

  // 'manage' grants all actions
  if (resourceActions.includes('manage')) return true;

  // 'read' also covers 'read:own'
  if (action === 'read:own' && resourceActions.includes('read')) return true;

  // 'update' also covers 'update:own'
  if (action === 'update:own' && resourceActions.includes('update')) return true;

  return resourceActions.includes(action);
}
