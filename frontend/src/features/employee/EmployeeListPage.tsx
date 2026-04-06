import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Filter, MoreHorizontal, ChevronLeft, ChevronRight, UserPlus,
  Mail, Phone, X, Loader2, Copy, Send, CheckCircle2, Eye, Pencil,
  RefreshCw, UserCheck, UserX, Users, Clock, AlertTriangle, Shield,
  Building2, ChevronDown, Calendar, Briefcase, MapPin, Download,
} from 'lucide-react';
import {
  useGetEmployeesQuery,
  useGetEmployeeStatsQuery,
  useChangeEmployeeRoleMutation,
  useUpdateEmployeeMutation,
  useSendActivationInviteMutation,
} from './employeeApi';
import {
  useCreateInvitationMutation,
  useGetInvitationsQuery,
  useResendInvitationMutation,
  useDeleteInvitationMutation,
} from '../invitation/invitationApi';
import {
  useGetDepartmentsQuery,
  useGetDesignationsQuery,
  useCreateDepartmentMutation,
  useCreateDesignationMutation,
  useGetOfficeLocationsQuery,
  useGetManagersQuery,
} from './employeeDepsApi';
import { useAppSelector } from '../../app/store';
import { getInitials, getStatusColor, formatDate, cn } from '../../lib/utils';
import CenterModal from '../../components/ui/CenterModal';
import MiniModal from '../../components/ui/MiniModal';
import SearchableSelect from '../../components/ui/SearchableSelect';
import toast from 'react-hot-toast';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:4000';

// ──────────────────────────────────────────────
// Main Page
// ──────────────────────────────────────────────
export default function EmployeeListPage() {
  const navigate = useNavigate();
  const user = useAppSelector(s => s.auth.user);
  const canInvite = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role || '');
  const canManage = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role || '');
  const canCreateMasterData = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role || '');

  // Page state
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchDebounce, setSearchDebounce] = useState('');
  const [activeView, setActiveView] = useState<'employees' | 'invitations'>('employees');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Filters
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('');
  const [filterDesignation, setFilterDesignation] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterWorkMode, setFilterWorkMode] = useState('');
  const [filterOnboarding, setFilterOnboarding] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');

  // Row actions
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [updateEmployee] = useUpdateEmployeeMutation();
  const [sendActivationInvite] = useSendActivationInviteMutation();

  // Data
  const { data: deptData } = useGetDepartmentsQuery();
  const { data: desigData } = useGetDesignationsQuery();
  const departments = deptData?.data || [];
  const designations = desigData?.data || [];
  const { data: statsData } = useGetEmployeeStatsQuery();
  const stats = statsData?.data;

  const hasFilters = !!(filterStatus || filterDepartment || filterDesignation || filterRole || filterWorkMode || filterOnboarding);

  const clearFilters = () => {
    setFilterStatus('');
    setFilterDepartment('');
    setFilterDesignation('');
    setFilterRole('');
    setFilterWorkMode('');
    setFilterOnboarding('');
    setPage(1);
  };

  const handleStatusChange = async (empId: string, newStatus: string) => {
    setOpenMenuId(null);
    try {
      await updateEmployee({ id: empId, data: { status: newStatus as any } }).unwrap();
      toast.success(`Employee ${newStatus === 'ACTIVE' ? 'reactivated' : 'marked inactive'}`);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to update status');
    }
  };

  const handleSendActivation = async (empId: string) => {
    setOpenMenuId(null);
    try {
      await sendActivationInvite(empId).unwrap();
      toast.success('Activation email sent');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to send activation email');
    }
  };

  const { data, isLoading } = useGetEmployeesQuery({
    page,
    limit: 15,
    search: searchDebounce,
    ...(filterStatus && { status: filterStatus }),
    ...(filterDepartment && { department: filterDepartment }),
    ...(filterDesignation && { designation: filterDesignation }),
    ...(filterRole && { role: filterRole }),
    ...(filterWorkMode && { workMode: filterWorkMode }),
    ...(filterOnboarding && { onboardingStatus: filterOnboarding }),
    sortBy,
    sortOrder: sortOrder as 'asc' | 'desc',
  });

  const employees = data?.data || [];
  const meta = data?.meta;

  // Debounced search
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const handleSearch = (value: string) => {
    setSearch(value);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setSearchDebounce(value);
      setPage(1);
    }, 300);
  };

  // Cleanup search timer on unmount
  useEffect(() => {
    return () => clearTimeout(searchTimerRef.current);
  }, []);

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Manage Employees</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Manage your team, invitations, and workforce
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canInvite && (
            <button
              onClick={() => setShowInviteModal(true)}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <UserPlus size={16} /> Invite Employee
            </button>
          )}
        </div>
      </div>

      {/* Metrics Row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          <MetricCard label="Total" value={stats.total} icon={<Users size={16} />} color="indigo" />
          <MetricCard label="Active" value={stats.active} icon={<UserCheck size={16} />} color="green" />
          <MetricCard label="Invited" value={stats.invited} icon={<Mail size={16} />} color="blue" />
          <MetricCard label="Onboarding" value={stats.onboarding} icon={<Clock size={16} />} color="amber" />
          <MetricCard label="Probation" value={stats.probation} icon={<Shield size={16} />} color="orange" />
          <MetricCard label="Inactive" value={stats.inactive} icon={<UserX size={16} />} color="gray" />
          <MetricCard label="Notice / Exit" value={stats.noticePeriod + stats.terminated} icon={<AlertTriangle size={16} />} color="red" />
        </div>
      )}

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

      {/* Invite Modal */}
      <InviteEmployeeModal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        canCreateMasterData={canCreateMasterData}
      />

      {activeView === 'invitations' ? (
        <InvitationsTab />
      ) : (
      <>
        {/* Search & Controls */}
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search by name, email, code, mobile..."
              className="w-full pl-9 pr-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <button
            onClick={() => setShowFilters(v => !v)}
            className={cn(
              'flex items-center gap-2 px-3 py-2 border rounded-lg text-sm font-medium transition-colors',
              showFilters
                ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            )}
          >
            <Filter size={16} />
            <span className="hidden sm:inline">Filters</span>
            {hasFilters && (
              <span className="ml-1 w-2 h-2 rounded-full bg-indigo-500 inline-block" />
            )}
          </button>
          <select
            value={`${sortBy}-${sortOrder}`}
            onChange={(e) => {
              const [field, order] = e.target.value.split('-');
              setSortBy(field);
              setSortOrder(order);
              setPage(1);
            }}
            className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <option value="createdAt-desc">Newest First</option>
            <option value="createdAt-asc">Oldest First</option>
            <option value="firstName-asc">Name A-Z</option>
            <option value="firstName-desc">Name Z-A</option>
            <option value="employeeCode-asc">Code &uarr;</option>
            <option value="joiningDate-desc">Recently Joined</option>
          </select>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="flex flex-wrap items-end gap-3 mb-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
            <FilterSelect label="Status" value={filterStatus} onChange={v => { setFilterStatus(v); setPage(1); }}
              options={[
                { value: '', label: 'All Statuses' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'ONBOARDING', label: 'Onboarding' },
                { value: 'PROBATION', label: 'Probation' },
                { value: 'NOTICE_PERIOD', label: 'Notice Period' },
                { value: 'INACTIVE', label: 'Inactive' },
                { value: 'TERMINATED', label: 'Terminated' },
                { value: 'ABSCONDED', label: 'Absconded' },
              ]}
            />
            <FilterSelect label="Department" value={filterDepartment} onChange={v => { setFilterDepartment(v); setPage(1); }}
              options={[{ value: '', label: 'All Departments' }, ...departments.map((d: any) => ({ value: d.id, label: d.name }))]}
            />
            <FilterSelect label="Designation" value={filterDesignation} onChange={v => { setFilterDesignation(v); setPage(1); }}
              options={[{ value: '', label: 'All Designations' }, ...designations.map((d: any) => ({ value: d.id, label: d.name }))]}
            />
            <FilterSelect label="Role" value={filterRole} onChange={v => { setFilterRole(v); setPage(1); }}
              options={[
                { value: '', label: 'All Roles' },
                { value: 'SUPER_ADMIN', label: 'Super Admin' },
                { value: 'ADMIN', label: 'Admin' },
                { value: 'HR', label: 'HR' },
                { value: 'MANAGER', label: 'Manager' },
                { value: 'EMPLOYEE', label: 'Employee' },
                { value: 'INTERN', label: 'Intern' },
              ]}
            />
            <FilterSelect label="Work Mode" value={filterWorkMode} onChange={v => { setFilterWorkMode(v); setPage(1); }}
              options={[
                { value: '', label: 'All Work Modes' },
                { value: 'OFFICE', label: 'Office' },
                { value: 'HYBRID', label: 'Hybrid' },
                { value: 'REMOTE', label: 'Remote' },
                { value: 'FIELD_SALES', label: 'Field Sales' },
                { value: 'PROJECT_SITE', label: 'Project Site' },
              ]}
            />
            <FilterSelect label="Onboarding" value={filterOnboarding} onChange={v => { setFilterOnboarding(v); setPage(1); }}
              options={[
                { value: '', label: 'All' },
                { value: 'complete', label: 'Complete' },
                { value: 'pending', label: 'Pending' },
              ]}
            />
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 border border-red-200 rounded-lg transition-colors"
              >
                <X size={14} /> Clear
              </button>
            )}
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <Th>Employee</Th>
                  <Th className="hidden md:table-cell">Department</Th>
                  <Th className="hidden lg:table-cell">Reporting Manager</Th>
                  <Th className="hidden xl:table-cell">Work Mode</Th>
                  <Th className="hidden xl:table-cell">Shift</Th>
                  <Th className="hidden sm:table-cell">Joined</Th>
                  <Th>Status</Th>
                  <Th className="hidden lg:table-cell">Role</Th>
                  <Th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td colSpan={8} className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-gray-100 animate-pulse" />
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
                    <td colSpan={8} className="text-center py-16">
                      <Users size={40} className="mx-auto text-gray-200 mb-3" />
                      <p className="text-gray-400 text-sm font-medium">No employees found</p>
                      <p className="text-gray-300 text-xs mt-1">Try adjusting your search or filters</p>
                    </td>
                  </tr>
                ) : (
                  employees.map((emp: any) => (
                    <tr
                      key={emp.id}
                      onClick={() => navigate(`/employees/${emp.id}`)}
                      className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar employee={emp} />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">
                              {emp.firstName} {emp.lastName}
                            </p>
                            <p className="text-xs text-gray-400 truncate">
                              <span className="font-mono" data-mono>{emp.employeeCode}</span>
                              {' · '}{emp.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="text-sm text-gray-600">{emp.department?.name || '—'}</span>
                        {emp.designation?.name && (
                          <p className="text-xs text-gray-400">{emp.designation.name}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {emp.manager ? (
                          <span className="text-sm text-gray-600">{emp.manager.firstName} {emp.manager.lastName}</span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden xl:table-cell">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-600">
                          {emp.workMode?.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden xl:table-cell">
                        {emp.hasShift ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${
                            emp.currentShift?.shiftType === 'FIELD' ? 'bg-orange-100 text-orange-700' :
                            emp.currentShift?.shiftType === 'PROJECT_SITE' ? 'bg-green-100 text-green-700' :
                            'bg-blue-100 text-blue-700'
                          }`}>
                            {emp.currentShift?.name || 'Assigned'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-yellow-100 text-yellow-700">
                            No Shift
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className="text-sm text-gray-500">{formatDate(emp.joiningDate)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`badge ${getStatusColor(emp.status)}`}>
                          {emp.status?.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {emp.user?.role ? (
                          <RoleBadge role={emp.user.role} employeeId={emp.id} />
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          aria-label="More actions"
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setMenuPos({
                              top: Math.min(rect.bottom + 4, window.innerHeight - 220),
                              left: Math.max(8, Math.min(rect.right - 200, window.innerWidth - 232)),
                            });
                            setOpenMenuId(openMenuId === emp.id ? null : emp.id);
                          }}
                          className="p-1 rounded hover:bg-gray-100 transition-colors"
                        >
                          <MoreHorizontal size={16} className="text-gray-400" />
                        </button>

                        {openMenuId === emp.id && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setOpenMenuId(null)} />
                            <div
                              className="fixed z-50 w-56 bg-white rounded-xl shadow-xl border border-gray-200 py-1"
                              style={{ top: menuPos.top, left: menuPos.left }}
                            >
                              <ActionBtn icon={<Eye size={14} />} label="View Profile" onClick={() => { setOpenMenuId(null); navigate(`/employees/${emp.id}`); }} />
                              {canManage && <ActionBtn icon={<Pencil size={14} />} label="Edit Employee" onClick={() => { setOpenMenuId(null); navigate(`/employees/${emp.id}?edit=true`); }} />}
                              {canManage && emp.email && <ActionBtn icon={<RefreshCw size={14} />} label="Resend Activation" onClick={() => handleSendActivation(emp.id)} />}
                              {canManage && emp.status === 'ACTIVE' && (
                                <ActionBtn icon={<UserX size={14} />} label="Mark Inactive" className="text-amber-600 hover:bg-amber-50" onClick={() => handleStatusChange(emp.id, 'INACTIVE')} />
                              )}
                              {canManage && emp.status === 'INACTIVE' && (
                                <ActionBtn icon={<UserCheck size={14} />} label="Reactivate" className="text-green-600 hover:bg-green-50" onClick={() => handleStatusChange(emp.id, 'ACTIVE')} />
                              )}
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-sm text-gray-500">
                Showing {(meta.page - 1) * meta.limit + 1}–{Math.min(meta.page * meta.limit, meta.total)} of{' '}
                <span className="font-mono" data-mono>{meta.total}</span>
              </p>
              <div className="flex items-center gap-2">
                <button aria-label="Previous page" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={!meta.hasPrev}
                  className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  <ChevronLeft size={16} />
                </button>
                <span className="text-sm text-gray-600 font-mono px-2" data-mono>
                  {meta.page} / {meta.totalPages}
                </span>
                <button aria-label="Next page" onClick={() => setPage((p) => p + 1)} disabled={!meta.hasNext}
                  className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
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

// ──────────────────────────────────────────────
// Metric Card
// ──────────────────────────────────────────────
const COLOR_MAP: Record<string, string> = {
  indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
  green: 'bg-green-50 text-green-600 border-green-100',
  blue: 'bg-blue-50 text-blue-600 border-blue-100',
  amber: 'bg-amber-50 text-amber-600 border-amber-100',
  orange: 'bg-orange-50 text-orange-600 border-orange-100',
  gray: 'bg-gray-50 text-gray-500 border-gray-100',
  red: 'bg-red-50 text-red-600 border-red-100',
};

function MetricCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${COLOR_MAP[color] || COLOR_MAP.gray}`}>
      <div className="flex-shrink-0">{icon}</div>
      <div>
        <p className="text-lg font-bold font-mono leading-tight" data-mono>{value}</p>
        <p className="text-xs font-medium opacity-75">{label}</p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Filter Select (lightweight)
// ──────────────────────────────────────────────
function FilterSelect({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex-1 min-w-[140px]">
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ──────────────────────────────────────────────
// Table Header
// ──────────────────────────────────────────────
function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={cn('text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3', className)}>
      {children}
    </th>
  );
}

// ──────────────────────────────────────────────
// Avatar
// ──────────────────────────────────────────────
function Avatar({ employee }: { employee: any }) {
  return (
    <div className="w-9 h-9 rounded-lg flex-shrink-0 relative">
      {employee.avatar ? (
        <img
          src={employee.avatar.startsWith('http') ? employee.avatar : `${API_BASE}${employee.avatar}`}
          alt=""
          className="w-9 h-9 rounded-lg object-cover"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
            const sibling = target.nextElementSibling as HTMLElement | null;
            if (sibling) sibling.style.display = 'flex';
          }}
        />
      ) : null}
      <div
        className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center text-white font-semibold text-xs"
        style={{ display: employee.avatar ? 'none' : 'flex' }}
      >
        {getInitials(employee.firstName, employee.lastName)}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Action Button (Row Menu)
// ──────────────────────────────────────────────
function ActionBtn({ icon, label, onClick, className }: { icon: React.ReactNode; label: string; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn('w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors', className)}
    >
      {icon} {label}
    </button>
  );
}

// ──────────────────────────────────────────────
// Invite Employee CENTERED Modal
// ──────────────────────────────────────────────
function InviteEmployeeModal({ open, onClose, canCreateMasterData }: { open: boolean; onClose: () => void; canCreateMasterData: boolean }) {
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [role, setRole] = useState('EMPLOYEE');
  const [departmentId, setDepartmentId] = useState('');
  const [designationId, setDesignationId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [officeLocationId, setOfficeLocationId] = useState('');
  const [workMode, setWorkMode] = useState('');
  const [employmentType, setEmploymentType] = useState('');
  const [proposedJoiningDate, setProposedJoiningDate] = useState('');
  const [notes, setNotes] = useState('');
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(true);
  const [createInvitation, { isLoading }] = useCreateInvitationMutation();
  const [result, setResult] = useState<any>(null);
  const [emailError, setEmailError] = useState('');

  // Nested modal state
  const [showAddDept, setShowAddDept] = useState(false);
  const [showAddDesig, setShowAddDesig] = useState(false);

  // Data
  const { data: deptData } = useGetDepartmentsQuery();
  const { data: desigData } = useGetDesignationsQuery();
  const { data: locData } = useGetOfficeLocationsQuery();
  const { data: mgrData } = useGetManagersQuery();
  const departments = deptData?.data || [];
  const designations = desigData?.data || [];
  const locations = locData?.data || [];
  const managers = mgrData?.data || [];

  const deptOptions = departments.map((d: any) => ({ value: d.id, label: d.name }));
  const desigOptions = designations
    .filter((d: any) => !departmentId || !d.departmentId || d.departmentId === departmentId)
    .map((d: any) => ({ value: d.id, label: d.name, sublabel: d.department?.name }));
  const locOptions = locations.map((l: any) => ({ value: l.id, label: l.name }));
  const mgrOptions = managers.map((m: any) => ({ value: m.id, label: `${m.firstName} ${m.lastName}`, sublabel: m.employeeCode }));

  const resetForm = () => {
    setEmail(''); setMobile(''); setRole('EMPLOYEE'); setDepartmentId(''); setDesignationId('');
    setManagerId(''); setOfficeLocationId(''); setWorkMode(''); setEmploymentType('');
    setProposedJoiningDate(''); setNotes(''); setSendWelcomeEmail(true); setResult(null); setEmailError('');
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const validateEmail = (val: string) => {
    if (!val) { setEmailError(''); return true; }
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
    setEmailError(valid ? '' : 'Invalid email address');
    return valid;
  };

  const handleSubmit = async () => {
    if (!email && !mobile) {
      toast.error('Email or mobile number is required');
      return;
    }
    if (email && !validateEmail(email)) return;

    try {
      const body: any = { role };
      if (email) body.email = email.toLowerCase().trim();
      if (mobile) body.mobileNumber = mobile.trim();
      if (departmentId) body.departmentId = departmentId;
      if (designationId) body.designationId = designationId;
      if (managerId) body.managerId = managerId;
      if (officeLocationId) body.officeLocationId = officeLocationId;
      if (workMode) body.workMode = workMode;
      if (employmentType) body.employmentType = employmentType;
      if (proposedJoiningDate) body.proposedJoiningDate = proposedJoiningDate;
      if (notes) body.notes = notes;
      body.sendWelcomeEmail = sendWelcomeEmail;

      const res = await createInvitation(body).unwrap();
      setResult(res.data);
      toast.success('Invitation sent!');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to send invitation');
    }
  };

  const copyLink = () => {
    if (result?.inviteUrl) {
      navigator.clipboard.writeText(result.inviteUrl);
      toast.success('Invite link copied!');
    }
  };

  return (
    <>
      <CenterModal
        open={open}
        onClose={handleClose}
        title="Invite Employee"
        subtitle="Send an invitation for a new team member to join"
        maxWidth="max-w-xl"
      >
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
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Invite Link</label>
              <div className="flex items-center gap-2">
                <input readOnly value={result.inviteUrl || ''} className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs" />
                <button onClick={copyLink} className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50"><Copy size={16} /></button>
              </div>
              <p className="text-xs text-gray-400 mt-1">Expires: {new Date(result.expiresAt).toLocaleString('en-IN')}</p>
            </div>
            <button onClick={handleClose} className="btn-primary w-full text-sm mt-4">Done</button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Row 1: Email + Mobile */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Mail size={13} className="inline mr-1.5 -mt-0.5" />Email Address
                </label>
                <input
                  value={email}
                  onChange={e => { setEmail(e.target.value); validateEmail(e.target.value); }}
                  type="email"
                  placeholder="employee@company.com"
                  className={cn('w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2', emailError ? 'border-red-300 focus:ring-red-400' : 'border-gray-300 focus:ring-indigo-400')}
                />
                {emailError && <p className="text-xs text-red-500 mt-1">{emailError}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Phone size={13} className="inline mr-1.5 -mt-0.5" />Mobile (optional)
                </label>
                <input
                  value={mobile}
                  onChange={e => setMobile(e.target.value)}
                  placeholder="919876543210"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
            </div>

            {/* Row 2: Role + Employment Type */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
                <select value={role} onChange={e => setRole(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                  <option value="EMPLOYEE">Employee</option>
                  <option value="INTERN">Intern</option>
                  <option value="MANAGER">Manager</option>
                  <option value="HR">HR</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Employment Type</label>
                <select value={employmentType} onChange={e => setEmploymentType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                  <option value="">— Select —</option>
                  <option value="FULL_TIME">Full Time</option>
                  <option value="PART_TIME">Part Time</option>
                  <option value="CONTRACT">Contract</option>
                  <option value="INTERN">Intern</option>
                </select>
              </div>
            </div>

            {/* Row 3: Department + Designation (searchable with + Add new) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SearchableSelect
                label="Department"
                placeholder="Select department..."
                options={deptOptions}
                value={departmentId}
                onChange={setDepartmentId}
                canCreate={canCreateMasterData}
                createLabel="+ Add new Department"
                onCreateClick={() => setShowAddDept(true)}
              />
              <SearchableSelect
                label="Designation"
                placeholder="Select designation..."
                options={desigOptions}
                value={designationId}
                onChange={setDesignationId}
                canCreate={canCreateMasterData}
                createLabel="+ Add new Designation"
                onCreateClick={() => setShowAddDesig(true)}
              />
            </div>

            {/* Row 4: Manager + Location */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SearchableSelect
                label="Reporting Manager"
                placeholder="Select manager..."
                options={mgrOptions}
                value={managerId}
                onChange={setManagerId}
              />
              <SearchableSelect
                label="Office / Location"
                placeholder="Select location..."
                options={locOptions}
                value={officeLocationId}
                onChange={setOfficeLocationId}
              />
            </div>

            {/* Row 5: Work Mode + Joining Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Work Mode</label>
                <select value={workMode} onChange={e => setWorkMode(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                  <option value="">— Select —</option>
                  <option value="OFFICE">Office</option>
                  <option value="HYBRID">Hybrid</option>
                  <option value="REMOTE">Remote</option>
                  <option value="FIELD_SALES">Field Sales</option>
                  <option value="PROJECT_SITE">Project Site</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Proposed Joining Date</label>
                <input
                  type="date"
                  value={proposedJoiningDate}
                  onChange={e => setProposedJoiningDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="Internal notes about this invite..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
              />
            </div>

            {/* Welcome email toggle */}
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={sendWelcomeEmail}
                onChange={e => setSendWelcomeEmail(e.target.checked)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-400"
              />
              Send welcome email on invite
            </label>

            {/* Submit */}
            <div className="flex gap-3 pt-2 border-t border-gray-100">
              <button onClick={handleClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={isLoading || (!email && !mobile)}
                className="flex-1 btn-primary flex items-center justify-center gap-2 text-sm"
              >
                {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Send Invitation
              </button>
            </div>
          </div>
        )}
      </CenterModal>

      {/* Nested: Add Department Modal */}
      <AddDepartmentModal
        open={showAddDept}
        onClose={() => setShowAddDept(false)}
        onCreated={(id) => setDepartmentId(id)}
      />

      {/* Nested: Add Designation Modal */}
      <AddDesignationModal
        open={showAddDesig}
        onClose={() => setShowAddDesig(false)}
        onCreated={(id) => setDesignationId(id)}
        departmentId={departmentId}
      />
    </>
  );
}

// ──────────────────────────────────────────────
// Add Department Nested Modal
// ──────────────────────────────────────────────
function AddDepartmentModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [createDepartment, { isLoading }] = useCreateDepartmentMutation();

  const handleSubmit = async () => {
    const trimmed = name.trim().replace(/\s+/g, ' ');
    if (!trimmed) { setError('Department name is required'); return; }
    setError('');

    try {
      const res = await createDepartment({
        name: trimmed,
        ...(code && { code: code.trim() }),
        ...(description && { description: description.trim() }),
      }).unwrap();
      toast.success(`Department "${trimmed}" created`);
      onCreated(res.data.id);
      setName(''); setCode(''); setDescription('');
      onClose();
    } catch (err: any) {
      const msg = err?.data?.error?.message || 'Failed to create department';
      setError(msg);
      toast.error(msg);
    }
  };

  return (
    <MiniModal open={open} onClose={onClose} title="Add New Department">
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Department Name *</label>
          <input
            value={name}
            onChange={e => { setName(e.target.value); setError(''); }}
            placeholder="e.g. Engineering"
            autoFocus
            className={cn('w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2', error ? 'border-red-300 focus:ring-red-400' : 'border-gray-300 focus:ring-indigo-400')}
          />
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Code <span className="text-gray-400 font-normal">(auto-generated if empty)</span>
          </label>
          <input
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="e.g. ENG"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 uppercase"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            placeholder="Optional description..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
          />
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={isLoading || !name.trim()}
            className="flex-1 btn-primary text-sm flex items-center justify-center gap-2">
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Building2 size={14} />}
            Create Department
          </button>
        </div>
      </div>
    </MiniModal>
  );
}

// ──────────────────────────────────────────────
// Add Designation Nested Modal
// ──────────────────────────────────────────────
function AddDesignationModal({ open, onClose, onCreated, departmentId }: { open: boolean; onClose: () => void; onCreated: (id: string) => void; departmentId?: string }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [levelBand, setLevelBand] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [createDesignation, { isLoading }] = useCreateDesignationMutation();

  const handleSubmit = async () => {
    const trimmed = name.trim().replace(/\s+/g, ' ');
    if (!trimmed) { setError('Designation name is required'); return; }
    setError('');

    try {
      const res = await createDesignation({
        name: trimmed,
        ...(code && { code: code.trim() }),
        ...(levelBand && { levelBand: levelBand.trim() }),
        ...(description && { description: description.trim() }),
        ...(departmentId && { departmentId }),
      }).unwrap();
      toast.success(`Designation "${trimmed}" created`);
      onCreated(res.data.id);
      setName(''); setCode(''); setLevelBand(''); setDescription('');
      onClose();
    } catch (err: any) {
      const msg = err?.data?.error?.message || 'Failed to create designation';
      setError(msg);
      toast.error(msg);
    }
  };

  return (
    <MiniModal open={open} onClose={onClose} title="Add New Designation">
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Designation Name *</label>
          <input
            value={name}
            onChange={e => { setName(e.target.value); setError(''); }}
            placeholder="e.g. Senior Software Engineer"
            autoFocus
            className={cn('w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2', error ? 'border-red-300 focus:ring-red-400' : 'border-gray-300 focus:ring-indigo-400')}
          />
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Code <span className="text-gray-400 font-normal">(auto)</span>
            </label>
            <input
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="e.g. SSE"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 uppercase"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Level / Band</label>
            <input
              value={levelBand}
              onChange={e => setLevelBand(e.target.value)}
              placeholder="e.g. L5, Band A"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            placeholder="Optional description..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
          />
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={isLoading || !name.trim()}
            className="flex-1 btn-primary text-sm flex items-center justify-center gap-2">
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Briefcase size={14} />}
            Create Designation
          </button>
        </div>
      </div>
    </MiniModal>
  );
}

// ──────────────────────────────────────────────
// Invitations Tab
// ──────────────────────────────────────────────
function InvitationsTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useGetInvitationsQuery({ page, limit: 20 });
  const [resend, { isLoading: resending }] = useResendInvitationMutation();
  const [deleteInv, { isLoading: deletingInv }] = useDeleteInvitationMutation();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  const handleDelete = async (id: string) => {
    try {
      await deleteInv(id).unwrap();
      toast.success('Invitation deleted');
      setConfirmDeleteId(null);
    } catch {
      toast.error('Failed to delete invitation');
    }
  };

  const statusBadge = (inv: any) => {
    if (inv.status === 'ACCEPTED') return <span className="badge bg-green-50 text-green-700 border-green-200">Accepted</span>;
    const isExpired = inv.isExpired || inv.status === 'EXPIRED' || (inv.expiresAt && new Date(inv.expiresAt) < new Date());
    if (isExpired) return <span className="badge bg-red-50 text-red-600 border-red-200">Expired</span>;
    return <span className="badge bg-amber-50 text-amber-700 border-amber-200">Pending</span>;
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <Th>Contact</Th>
              <Th>Role</Th>
              <Th className="hidden sm:table-cell">Invited By</Th>
              <Th className="hidden md:table-cell">Sent</Th>
              <Th className="hidden md:table-cell">Expires</Th>
              <Th>Status</Th>
              <Th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="text-center py-12"><Loader2 className="animate-spin mx-auto text-indigo-600" size={24} /></td></tr>
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
                <td className="px-4 py-3 hidden sm:table-cell text-sm text-gray-500">{inv.invitedByEmail}</td>
                <td className="px-4 py-3 hidden md:table-cell text-sm text-gray-500">{formatDate(inv.createdAt)}</td>
                <td className="px-4 py-3 hidden md:table-cell text-sm text-gray-500">{formatDate(inv.expiresAt)}</td>
                <td className="px-4 py-3">{statusBadge(inv)}</td>
                <td className="px-4 py-3">
                  {inv.status !== 'ACCEPTED' && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleResend(inv.id)} disabled={resending}
                        className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                        Resend
                      </button>
                      {confirmDeleteId === inv.id ? (
                        <span className="inline-flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2 py-0.5">
                          <span className="text-[10px] text-red-600">Delete?</span>
                          <button onClick={() => handleDelete(inv.id)} disabled={deletingInv}
                            className="text-xs text-white bg-red-600 hover:bg-red-700 font-medium px-1.5 py-0.5 rounded">Yes</button>
                          <button onClick={() => setConfirmDeleteId(null)}
                            className="text-xs text-gray-500 hover:text-gray-700 font-medium px-1 py-0.5">No</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmDeleteId(inv.id)}
                          className="text-xs text-red-500 hover:text-red-700 font-medium">
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
          <p className="text-sm text-gray-500">Page {meta.page} of {meta.totalPages}</p>
          <div className="flex items-center gap-2">
            <button aria-label="Previous page" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={!meta.hasPrev}
              className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30"><ChevronLeft size={16} /></button>
            <button aria-label="Next page" onClick={() => setPage(p => p + 1)} disabled={!meta.hasNext}
              className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// Role Badge (inline editable for admins)
// ──────────────────────────────────────────────
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
          <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
        ))}
      </select>
    );
  }

  return (
    <span onClick={e => { if (isAdmin) { e.stopPropagation(); setEditing(true); } }}
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${ROLE_COLORS[role] || ROLE_COLORS.EMPLOYEE} ${isAdmin ? 'cursor-pointer hover:ring-1 hover:ring-indigo-300' : ''}`}
      title={isAdmin ? 'Click to change role' : ''}>
      {role.replace(/_/g, ' ')}
    </span>
  );
}
