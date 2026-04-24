import { useState, useMemo } from 'react';
import { KeyRound, Search, Send, CheckCircle2, ShieldAlert, Loader2, Mail, RotateCcw } from 'lucide-react';
import { useGetEmployeesQuery } from '../employee/employeeApi';
import { useAdminResetPasswordMutation } from '../auth/authApi';
import { useAppSelector } from '../../app/store';
import { getInitials, getUploadUrl } from '../../lib/utils';
import toast from 'react-hot-toast';
import type { EmployeeListItem } from '@aniston/shared';

const HR_BLOCKED_ROLES  = ['SUPER_ADMIN', 'ADMIN', 'HR'];
const ADMIN_BLOCKED_ROLES = ['SUPER_ADMIN'];
// Statuses that should never appear in the reset list
const EXCLUDED_STATUSES = ['TERMINATED', 'INACTIVE', 'ABSCONDED'];

export default function PasswordResetTab() {
  const user = useAppSelector((s) => s.auth.user);
  const isHR    = user?.role === 'HR';
  const isAdmin = user?.role === 'ADMIN';

  const [search,     setSearch]     = useState('');
  const [confirming, setConfirming] = useState<string | null>(null); // userId being confirmed
  const [sent,       setSent]       = useState<Record<string, boolean>>({}); // userId → sent

  // Fetch all employees (no status filter) — we exclude terminated on the frontend
  const { data: res, isLoading } = useGetEmployeesQuery({ limit: 300 });
  const employees: EmployeeListItem[] = res?.data || [];

  const [adminReset, { isLoading: resetting }] = useAdminResetPasswordMutation();

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return employees
      .filter((e) => !EXCLUDED_STATUSES.includes(e.status))
      .filter((e) =>
        !q ||
        e.firstName.toLowerCase().includes(q) ||
        e.lastName.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        (e.employeeCode || '').toLowerCase().includes(q)
      );
  }, [employees, search]);

  function isBlocked(emp: EmployeeListItem): boolean {
    const role = (emp.user?.role as string) || '';
    if (isHR    && HR_BLOCKED_ROLES.includes(role))    return true;
    if (isAdmin && ADMIN_BLOCKED_ROLES.includes(role)) return true;
    return false;
  }

  async function handleConfirmedReset(emp: EmployeeListItem) {
    const userId = emp.user?.id as string;
    if (!userId) {
      toast.error('This employee has no linked user account');
      setConfirming(null);
      return;
    }
    try {
      const result = await adminReset({ targetUserId: userId }).unwrap();
      setSent((prev) => ({ ...prev, [userId]: true }));
      toast.success(result?.message || `Reset link sent to ${emp.email}`);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to send reset link');
    } finally {
      setConfirming(null);
    }
  }

  function handleResend(userId: string) {
    // Clear sent state so the row returns to the normal "Reset Password" button
    setSent((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <KeyRound size={18} className="text-brand-600" />
          Employee Password Reset
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Send a secure password reset link to any employee's email address.
        </p>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
        <ShieldAlert size={16} className="text-amber-600 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-800 leading-relaxed">
          The employee will receive an email with a secure link valid for <strong>24 hours</strong>.
          Their current password stays active until they complete the reset.
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search by name, email or employee code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-glass w-full pl-9 pr-4 py-2.5 text-sm"
        />
      </div>

      {/* Employee list */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">No employees found</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((emp) => {
            const userId       = emp.user?.id as string | undefined;
            const blocked      = isBlocked(emp);
            const wasSent      = userId ? sent[userId] : false;
            const isConfirming = userId === confirming;
            const isSending    = isConfirming && resetting;
            const role         = (emp.user?.role as string) || 'EMPLOYEE';

            return (
              <div
                key={emp.id}
                className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-100 rounded-xl hover:border-gray-200 transition-colors"
              >
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full overflow-hidden bg-brand-100 flex items-center justify-center shrink-0">
                  {emp.avatar ? (
                    <img src={getUploadUrl(emp.avatar)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs font-semibold text-brand-700">
                      {getInitials(`${emp.firstName} ${emp.lastName}`)}
                    </span>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {emp.firstName} {emp.lastName}
                    <span className="ml-2 text-xs text-gray-400 font-mono" data-mono>
                      {emp.employeeCode}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500 flex items-center gap-1 truncate">
                    <Mail size={10} className="shrink-0" />
                    {emp.email}
                  </p>
                </div>

                {/* Role + status badges */}
                <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                    {role}
                  </span>
                  {emp.status !== 'ACTIVE' && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
                      {emp.status}
                    </span>
                  )}
                </div>

                {/* Action */}
                {!userId ? (
                  <span className="text-xs text-gray-400 shrink-0">No account</span>
                ) : blocked ? (
                  <span
                    title={isHR ? 'HR cannot reset Admin accounts' : 'Cannot reset Super Admin accounts'}
                    className="text-xs text-gray-400 bg-gray-50 px-3 py-1.5 rounded-lg shrink-0 cursor-default"
                  >
                    Protected
                  </span>
                ) : wasSent ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2.5 py-1.5 rounded-lg">
                      <CheckCircle2 size={12} />
                      Sent
                    </span>
                    <button
                      onClick={() => handleResend(userId)}
                      title="Send another reset link"
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-brand-600 bg-gray-50 hover:bg-brand-50 px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      <RotateCcw size={11} />
                      Re-send
                    </button>
                  </div>
                ) : isConfirming ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setConfirming(null)}
                      className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleConfirmedReset(emp)}
                      disabled={isSending}
                      className="flex items-center gap-1.5 text-xs font-medium bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-70"
                    >
                      {isSending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                      Confirm Send
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirming(userId)}
                    className="flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-lg transition-colors shrink-0"
                  >
                    <KeyRound size={12} />
                    Reset Password
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
