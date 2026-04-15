import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date, format: 'short' | 'long' | 'iso' = 'short') {
  const d = new Date(date);
  if (format === 'iso') return d.toISOString().split('T')[0];
  if (format === 'long') return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function getInitials(firstName?: string, lastName?: string): string {
  const f = firstName?.charAt(0) || '';
  const l = lastName?.charAt(0) || '';
  return (f + l).toUpperCase() || '?';
}

/**
 * Convert a backend-stored upload path into a fully-qualified URL that the
 * browser can resolve, regardless of dev (Vite proxy) or production (nginx).
 *
 * - Absolute URLs (http/https) are returned unchanged — covers MS Teams avatars
 *   and any externally hosted images.
 * - Relative /uploads/... paths are prefixed with the backend origin so that
 *   cross-port requests (frontend :5173 → backend :4000) are handled correctly
 *   in environments where the Vite proxy is not involved (e.g. Electron, mobile).
 *   In normal Vite dev the proxy makes this optional, but being explicit never hurts.
 *
 * Usage:
 *   <img src={getUploadUrl(employee.avatar)} />
 *   <img src={getUploadUrl(branding.logoUrl)} />
 */
const _BACKEND_ORIGIN = (() => {
  const raw = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
  // Strip the /api suffix to get the bare origin
  return raw === '/api' ? '' : raw.replace(/\/api$/, '');
})();

export function getUploadUrl(path: string | null | undefined): string {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  // Already a full URL with port (shouldn't happen, but safe guard)
  if (path.startsWith('//')) return path;
  return `${_BACKEND_ORIGIN}${path}`;
}

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    // Employment statuses
    ACTIVE: 'badge-success',
    PROBATION: 'badge-warning',
    NOTICE_PERIOD: 'badge-warning',
    ONBOARDING: 'badge-info',
    INTERN: 'bg-purple-50 text-purple-700 border-purple-200',
    SUSPENDED: 'badge-danger',
    INACTIVE: 'badge-neutral',
    TERMINATED: 'badge-danger',
    ABSCONDED: 'badge-danger',
    // Attendance
    PRESENT: 'badge-success',
    ABSENT: 'badge-danger',
    HALF_DAY: 'badge-warning',
    ON_LEAVE: 'badge-info',
    NOT_CHECKED_IN: 'badge-neutral',
    // Leave / approval
    PENDING: 'badge-warning',
    APPROVED: 'badge-success',
    REJECTED: 'badge-danger',
    CANCELLED: 'badge-neutral',
  };
  return map[status] || 'badge-neutral';
}
