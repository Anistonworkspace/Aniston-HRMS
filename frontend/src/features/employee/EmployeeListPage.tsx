import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Filter, MoreHorizontal, ChevronLeft, ChevronRight, UserPlus, Mail, Phone, X, Loader2, Copy, Send, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useGetEmployeesQuery, useChangeEmployeeRoleMutation } from './employeeApi';
import { useCreateInvitationMutation, useGetInvitationsQuery, useResendInvitationMutation } from '../invitation/invitationApi';
import { useGetDepartmentsQuery, useGetDesignationsQuery } from './employeeDepsApi';
import { useAppSelector } from '../../app/store';
import { getInitials, getStatusColor, formatDate, cn } from '../../lib/utils';
import toast from 'react-hot-toast';

export default function EmployeeListPage() {
  const navigate = useNavigate();
  const user = useAppSelector(s => s.auth.user);
  const canInvite = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role || '');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchDebounce, setSearchDebounce] = useState('');
  const [activeView, setActiveView] = useState<'employees' | 'invitations'>('employees');
  const [showInvitePanel, setShowInvitePanel] = useState(false);

  const { data, isLoading } = useGetEmployeesQuery({
    page,
    limit: 10,
    search: searchDebounce,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });

  const employees = data?.data || [];
  const meta = data?.meta;

  // Debounced search
  let searchTimer: ReturnType<typeof setTimeout>;
  const handleSearch = (value: string) => {
    setSearch(value);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      setSearchDebounce(value);
      setPage(1);
    }, 300);
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Employees</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Manage your team — {meta?.total ?? 0} total
          </p>
        </div>
        {canInvite && (
          <button onClick={() => setShowInvitePanel(true)} className="btn-primary flex items-center gap-2 text-sm">
            <UserPlus size={16} /> Invite Employee
          </button>
        )}
      </div>

      {/* Tab Switcher */}
      {canInvite && (
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-4">
          {(['employees', 'invitations'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveView(tab)}
              className={cn('px-4 py-1.5 rounded-md text-sm font-medium transition-all',
                activeView === tab ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              )}>
              {tab === 'employees' ? 'Employees' : 'Invitations'}
            </button>
          ))}
        </div>
      )}

      {/* Invite Slide-over */}
      <AnimatePresence>
        {showInvitePanel && <InviteEmployeeSlideOver onClose={() => setShowInvitePanel(false)} />}
      </AnimatePresence>

      {activeView === 'invitations' ? (
        <InvitationsTab />
      ) : (
      <>
      {/* Search & Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by name, email, code..."
            className="input-glass w-full pl-9 text-sm"
          />
        </div>
        <button className="btn-secondary flex items-center gap-2 text-sm">
          <Filter size={16} />
          <span className="hidden sm:inline">Filters</span>
        </button>
      </div>

      {/* Table */}
      <div className="data-table overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">
                Employee
              </th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 hidden md:table-cell">
                Department
              </th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 hidden lg:table-cell">
                Work Mode
              </th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 hidden sm:table-cell">
                Joined
              </th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">
                Status
              </th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 hidden lg:table-cell">
                Role
              </th>
              <th className="w-12 px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td colSpan={6} className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-gray-100 animate-pulse" />
                      <div className="space-y-2">
                        <div className="w-32 h-3 bg-gray-100 rounded animate-pulse" />
                        <div className="w-48 h-2.5 bg-gray-50 rounded animate-pulse" />
                      </div>
                    </div>
                  </td>
                </tr>
              ))
            ) : employees.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-gray-400 text-sm">
                  No employees found
                </td>
              </tr>
            ) : (
              employees.map((emp, index) => (
                <motion.tr
                  key={emp.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => navigate(`/employees/${emp.id}`)}
                  className="border-b border-gray-50 hover:bg-surface-2/50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 font-semibold text-sm flex-shrink-0">
                        {getInitials(emp.firstName, emp.lastName)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-800">
                          {emp.firstName} {emp.lastName}
                        </p>
                        <p className="text-xs text-gray-400">
                          <span className="font-mono" data-mono>{emp.employeeCode}</span>
                          {' · '}
                          {emp.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 hidden md:table-cell">
                    <span className="text-sm text-gray-600">{emp.department?.name || '—'}</span>
                    {emp.designation?.name && (
                      <p className="text-xs text-gray-400">{emp.designation.name}</p>
                    )}
                  </td>
                  <td className="px-4 py-3.5 hidden lg:table-cell">
                    <span className="badge badge-info text-xs">
                      {emp.workMode?.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 hidden sm:table-cell">
                    <span className="text-sm text-gray-500">{formatDate(emp.joiningDate)}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`badge ${getStatusColor(emp.status)}`}>
                      {emp.status}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 hidden lg:table-cell">
                    {(emp as any).user?.role ? (
                      <RoleBadge role={(emp as any).user.role} employeeId={emp.id} />
                    ) : <span className="text-xs text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3.5">
                    <button
                      onClick={(e) => e.stopPropagation()}
                      className="p-1 rounded hover:bg-gray-100 transition-colors"
                    >
                      <MoreHorizontal size={16} className="text-gray-400" />
                    </button>
                  </td>
                </motion.tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-sm text-gray-500">
              Showing {(meta.page - 1) * meta.limit + 1}-{Math.min(meta.page * meta.limit, meta.total)} of{' '}
              <span className="font-mono" data-mono>{meta.total}</span>
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={!meta.hasPrev}
                className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm text-gray-600 font-mono px-2" data-mono>
                {meta.page} / {meta.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!meta.hasNext}
                className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}

function InviteEmployeeSlideOver({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [role, setRole] = useState('EMPLOYEE');
  const [departmentId, setDepartmentId] = useState('');
  const [designationId, setDesignationId] = useState('');
  const [createInvitation, { isLoading }] = useCreateInvitationMutation();
  const [result, setResult] = useState<any>(null);

  const { data: deptData } = useGetDepartmentsQuery();
  const { data: desigData } = useGetDesignationsQuery();
  const departments = deptData?.data || [];
  const designations = desigData?.data || [];

  const handleSubmit = async () => {
    try {
      const body: any = { role };
      if (email) body.email = email;
      if (mobile) body.mobileNumber = mobile;
      if (departmentId) body.departmentId = departmentId;
      if (designationId) body.designationId = designationId;
      const res = await createInvitation(body).unwrap();
      setResult(res.data);
      toast.success('Invitation sent!');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to send invitation');
    }
  };

  const copyLink = () => {
    if (result?.inviteUrl) {
      navigator.clipboard.writeText(window.location.origin + result.inviteUrl);
      toast.success('Invite link copied!');
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ x: 400 }} animate={{ x: 0 }} exit={{ x: 400 }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="relative w-full max-w-md bg-white shadow-2xl h-full overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-display font-bold text-gray-900">Invite Employee</h2>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X size={20} /></button>
          </div>

          {result ? (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 size={20} className="text-green-600" />
                  <span className="text-sm font-semibold text-green-700">Invitation Sent!</span>
                </div>
                <p className="text-xs text-green-600">
                  {result.email && `Email sent to ${result.email}`}
                  {result.email && result.mobileNumber && ' and '}
                  {result.mobileNumber && `WhatsApp to ${result.mobileNumber}`}
                </p>
                {result.role && result.role !== 'EMPLOYEE' && (
                  <p className="text-xs text-green-600 mt-1">Role: {result.role.replace(/_/g, ' ')}</p>
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Invite Link</label>
                <div className="flex items-center gap-2">
                  <input readOnly value={window.location.origin + (result.inviteUrl || '')}
                    className="input-glass flex-1 text-xs" />
                  <button onClick={copyLink} className="btn-secondary p-2"><Copy size={16} /></button>
                </div>
                <p className="text-xs text-gray-400 mt-1">Expires: {new Date(result.expiresAt).toLocaleString('en-IN')}</p>
              </div>

              <button onClick={onClose} className="btn-primary w-full text-sm mt-4">Done</button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">Send an invitation to the employee's email. They'll set their password and complete onboarding.</p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
                  <Mail size={14} /> Email Address
                </label>
                <input value={email} onChange={e => setEmail(e.target.value)}
                  type="email" placeholder="employee@company.com" className="input-glass w-full text-sm" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
                  <Phone size={14} /> Mobile Number (optional)
                </label>
                <input value={mobile} onChange={e => setMobile(e.target.value)}
                  placeholder="919876543210" className="input-glass w-full text-sm" />
                <p className="text-xs text-gray-400 mt-1">With country code (e.g., 91 for India)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select value={role} onChange={e => setRole(e.target.value)}
                  className="input-glass w-full text-sm">
                  <option value="EMPLOYEE">Employee</option>
                  <option value="MANAGER">Manager</option>
                  <option value="HR">HR</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Department (optional)</label>
                <select value={departmentId} onChange={e => setDepartmentId(e.target.value)}
                  className="input-glass w-full text-sm">
                  <option value="">-- Select Department --</option>
                  {departments.map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Designation (optional)</label>
                <select value={designationId} onChange={e => setDesignationId(e.target.value)}
                  className="input-glass w-full text-sm">
                  <option value="">-- Select Designation --</option>
                  {designations.map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              <button onClick={handleSubmit} disabled={isLoading || (!email && !mobile)}
                className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
                {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Send Invitation
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function InvitationsTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useGetInvitationsQuery({ page, limit: 20 });
  const [resend, { isLoading: resending }] = useResendInvitationMutation();

  const invitations = data?.data || [];
  const meta = data?.meta;

  const handleResend = async (id: string) => {
    try {
      await resend(id).unwrap();
      toast.success('Invitation resent');
    } catch {
      toast.error('Failed to resend');
    }
  };

  const statusBadge = (inv: any) => {
    if (inv.status === 'ACCEPTED') return <span className="badge bg-green-50 text-green-700 border-green-200">Accepted</span>;
    if (inv.isExpired || inv.status === 'EXPIRED') return <span className="badge bg-red-50 text-red-600 border-red-200">Expired</span>;
    return <span className="badge bg-amber-50 text-amber-700 border-amber-200">Pending</span>;
  };

  return (
    <div className="data-table overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Contact</th>
            <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Role</th>
            <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Invited By</th>
            <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Sent</th>
            <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Expires</th>
            <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Status</th>
            <th className="w-24 px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={6} className="text-center py-12"><Loader2 className="animate-spin mx-auto text-brand-600" size={24} /></td></tr>
          ) : invitations.length === 0 ? (
            <tr><td colSpan={7} className="text-center py-12 text-gray-400 text-sm">No invitations yet</td></tr>
          ) : invitations.map((inv: any) => (
            <tr key={inv.id} className="border-b border-gray-50">
              <td className="px-4 py-3">
                <div className="text-sm text-gray-800">{inv.email || inv.mobileNumber}</div>
                {inv.email && inv.mobileNumber && <div className="text-xs text-gray-400">{inv.mobileNumber}</div>}
              </td>
              <td className="px-4 py-3">
                <span className="text-xs font-medium text-gray-600">{(inv.role || 'EMPLOYEE').replace(/_/g, ' ')}</span>
              </td>
              <td className="px-4 py-3 text-sm text-gray-500">{inv.invitedByEmail}</td>
              <td className="px-4 py-3 text-sm text-gray-500">{formatDate(inv.createdAt)}</td>
              <td className="px-4 py-3 text-sm text-gray-500">{formatDate(inv.expiresAt)}</td>
              <td className="px-4 py-3">{statusBadge(inv)}</td>
              <td className="px-4 py-3">
                {inv.status !== 'ACCEPTED' && (
                  <button onClick={() => handleResend(inv.id)} disabled={resending}
                    className="text-xs text-brand-600 hover:text-brand-700 font-medium">
                    Resend
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
          <p className="text-sm text-gray-500">Page {meta.page} of {meta.totalPages}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={!meta.hasPrev}
              className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30"><ChevronLeft size={16} /></button>
            <button onClick={() => setPage(p => p + 1)} disabled={!meta.hasNext}
              className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-50 text-purple-700 border-purple-200',
  ADMIN: 'bg-blue-50 text-blue-700 border-blue-200',
  HR: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  MANAGER: 'bg-amber-50 text-amber-700 border-amber-200',
  EMPLOYEE: 'bg-gray-50 text-gray-600 border-gray-200',
};

function RoleBadge({ role, employeeId }: { role: string; employeeId: string }) {
  const user = useAppSelector(s => s.auth.user);
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const [changeRole] = useChangeEmployeeRoleMutation();
  const [editing, setEditing] = useState(false);

  const handleChange = async (newRole: string) => {
    setEditing(false);
    if (newRole === role) return;
    try {
      await changeRole({ employeeId, role: newRole }).unwrap();
      toast.success(`Role changed to ${newRole}`);
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  if (editing && isAdmin) {
    return (
      <select value={role} onChange={e => handleChange(e.target.value)} onBlur={() => setEditing(false)}
        autoFocus onClick={e => e.stopPropagation()} className="text-xs border rounded-lg px-2 py-1 bg-white">
        {['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'].map(r => (
          <option key={r} value={r}>{r.replace('_', ' ')}</option>
        ))}
      </select>
    );
  }

  return (
    <span onClick={e => { if (isAdmin) { e.stopPropagation(); setEditing(true); } }}
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${ROLE_COLORS[role] || ROLE_COLORS.EMPLOYEE} ${isAdmin ? 'cursor-pointer hover:ring-1 hover:ring-brand-300' : ''}`}
      title={isAdmin ? 'Click to change role' : ''}>
      {role.replace('_', ' ')}
    </span>
  );
}
