// ---------- Org Chart Constants ----------

// Layout
export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 80;
export const DAGRE_RANK_SEP = 100;
export const DAGRE_NODE_SEP = 60;
export const DRAG_PROXIMITY_PX = 100;
export const DETAIL_PANEL_WIDTH = 320;
export const LIST_INDENT_PX = 28;
export const LIST_AUTO_EXPAND_DEPTH = 2;

// Fetch all employees for org chart (no artificial limit)
export const ORG_CHART_EMPLOYEE_LIMIT = 1000;

// Role display configuration — single source of truth
export const ROLE_CONFIG: Record<string, {
  border: string;
  avatar: string;
  minimap: string;
  badge: string;
  label: string;
}> = {
  SUPER_ADMIN: {
    border: 'border-indigo-400 bg-indigo-50',
    avatar: 'bg-indigo-500 text-white',
    minimap: '#818cf8',
    badge: 'bg-indigo-100 text-indigo-700',
    label: 'Super Admin',
  },
  ADMIN: {
    border: 'border-blue-400 bg-blue-50',
    avatar: 'bg-blue-500 text-white',
    minimap: '#60a5fa',
    badge: 'bg-blue-100 text-blue-700',
    label: 'Admin',
  },
  HR: {
    border: 'border-teal-400 bg-teal-50',
    avatar: 'bg-teal-500 text-white',
    minimap: '#2dd4bf',
    badge: 'bg-teal-100 text-teal-700',
    label: 'HR',
  },
  MANAGER: {
    border: 'border-amber-400 bg-amber-50',
    avatar: 'bg-amber-500 text-white',
    minimap: '#fbbf24',
    badge: 'bg-amber-100 text-amber-700',
    label: 'Manager',
  },
  EMPLOYEE: {
    border: 'border-sky-300 bg-sky-50',
    avatar: 'bg-sky-500 text-white',
    minimap: '#38bdf8',
    badge: 'bg-gray-100 text-gray-600',
    label: 'Employee',
  },
  GUEST_INTERVIEWER: {
    border: 'border-orange-300 bg-orange-50',
    avatar: 'bg-orange-400 text-white',
    minimap: '#fb923c',
    badge: 'bg-orange-100 text-orange-700',
    label: 'Guest Interviewer',
  },
  INTERN: {
    border: 'border-pink-300 bg-pink-50',
    avatar: 'bg-pink-400 text-white',
    minimap: '#f9a8d4',
    badge: 'bg-pink-100 text-pink-700',
    label: 'Intern',
  },
  UNASSIGNED: {
    border: 'border-gray-200 bg-gray-50/50 opacity-70',
    avatar: 'bg-gray-300 text-gray-500',
    minimap: '#d1d5db',
    badge: 'bg-gray-100 text-gray-500',
    label: 'Unassigned',
  },
};

export const DEFAULT_ROLE_CONFIG = ROLE_CONFIG.EMPLOYEE;

// Roles that can manage org chart structure
export const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'];

export function getRoleConfig(role: string) {
  return ROLE_CONFIG[role] || DEFAULT_ROLE_CONFIG;
}

export function resolveDisplayRole(rawRole: string, designation?: string | null): string {
  const isUnassigned = (!designation || designation === 'Employee') && rawRole === 'EMPLOYEE';
  return isUnassigned ? 'UNASSIGNED' : rawRole;
}
