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

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    ACTIVE: 'badge-success',
    PROBATION: 'badge-warning',
    NOTICE_PERIOD: 'badge-warning',
    INACTIVE: 'badge-neutral',
    TERMINATED: 'badge-danger',
    ABSCONDED: 'badge-danger',
    PRESENT: 'badge-success',
    ABSENT: 'badge-danger',
    HALF_DAY: 'badge-warning',
    ON_LEAVE: 'badge-info',
    PENDING: 'badge-warning',
    APPROVED: 'badge-success',
    REJECTED: 'badge-danger',
    CANCELLED: 'badge-neutral',
  };
  return map[status] || 'badge-neutral';
}
