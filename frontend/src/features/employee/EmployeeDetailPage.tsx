import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Mail, Phone, MapPin, Calendar, Building2, Briefcase, FileText,
  Shield, Check, Clock, DollarSign, User, ChevronLeft, ChevronRight,
  Plus, Heart, MessageSquare, Share2, Tag, Paperclip, Save, Loader2, Send,
} from 'lucide-react';
import { useGetEmployeeQuery, useUpdateEmployeeMutation, useAddLifecycleEventMutation, useDeleteLifecycleEventMutation, useSendActivationInviteMutation, useGetLifecycleEventsQuery } from './employeeApi';
import { useGetEmployeeAttendanceQuery, useMarkAttendanceMutation } from '../attendance/attendanceApi';
import { useGetSalaryStructureQuery, useSaveSalaryStructureMutation } from '../payroll/payrollApi';
import { useUploadDocumentMutation, useVerifyDocumentMutation } from '../documents/documentApi';
import { useGetInternProfileQuery, useGetAchievementLettersQuery, useIssueAchievementLetterMutation } from '../intern/internApi';
import { useGetShiftsQuery, useAssignShiftMutation, useGetEmployeeShiftQuery } from '../workforce/workforceApi';
import PermissionOverridePanel from '../permissions/PermissionOverridePanel';
import OcrVerificationPanel from '../documents/OcrVerificationPanel';
import { useGetEmployeeOcrSummaryQuery } from '../documents/documentOcrApi';
import { useVerifyKycMutation } from '../kyc/kycApi';
import { useAppSelector } from '../../app/store';
import { getInitials, getStatusColor, formatDate, formatCurrency } from '../../lib/utils';
import toast from 'react-hot-toast';

const MANAGEMENT_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];
type TabKey = 'overview' | 'attendance' | 'personal' | 'salary' | 'documents' | 'connections' | 'intern' | 'permissions';

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAppSelector((state) => state.auth.user);
  const { data: response, isLoading } = useGetEmployeeQuery(id!);
  const employee = response?.data;
  const [activeTab, setActiveTab] = useState<TabKey>('attendance');
  const [showEditModal, setShowEditModal] = useState(false);
  const [updateEmployee] = useUpdateEmployeeMutation();
  const [sendActivationInvite, { isLoading: sendingInvite }] = useSendActivationInviteMutation();

  const isManagement = MANAGEMENT_ROLES.includes(user?.role || '');
  const isTeamsSynced = !!(employee?.user as any)?.microsoftId;
  const hasNotLoggedIn = !employee?.user?.lastLoginAt;
  const showActivationButton = isManagement && isTeamsSynced && hasNotLoggedIn;

  const handleSendActivationInvite = async () => {
    if (!id) return;
    try {
      const result = await sendActivationInvite(id).unwrap();
      toast.success(result.message || 'Activation invite sent');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to send activation invite');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-1 flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="min-h-screen bg-surface-1 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-display font-bold text-gray-600">Employee not found</h2>
          <button onClick={() => navigate('/employees')} className="mt-4 btn-primary text-sm">Back to Employees</button>
        </div>
      </div>
    );
  }

  const isIntern = employee?.user?.role === 'INTERN';
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'attendance', label: 'Attendance & Leaves' },
    { key: 'salary', label: 'Salary' },
    { key: 'personal', label: 'Personal' },
    { key: 'documents', label: 'Documents' },
    ...(isIntern ? [{ key: 'intern' as TabKey, label: 'Intern Profile' }] : []),
    { key: 'connections', label: 'Connections' },
    ...(isManagement ? [{ key: 'permissions' as TabKey, label: 'Permissions' }] : []),
  ];

  return (
    <div className="min-h-screen bg-surface-1">
      {/* Top breadcrumb bar */}
      <div className="bg-white border-b border-gray-100 px-6 py-3">
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => navigate('/employees')} className="text-gray-400 hover:text-brand-600 transition-colors flex items-center gap-1">
            <ArrowLeft size={14} /> Employee
          </button>
          <ChevronRight size={14} className="text-gray-300" />
          <span className="text-gray-800 font-medium font-mono" data-mono>{employee.employeeCode}</span>
        </div>
      </div>

      {/* Main content — 2-column layout */}
      <div className="flex gap-0 min-h-[calc(100vh-49px)]">
        {/* Left sidebar — Profile card */}
        <div className="w-64 shrink-0 border-r border-gray-100 bg-white p-5 overflow-y-auto hidden lg:block">
          <div className="flex flex-col items-center mb-5">
            <div className="w-24 h-24 rounded-xl bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-3xl font-display mb-3">
              {getInitials(employee.firstName, employee.lastName)}
            </div>
            <h2 className="text-base font-display font-bold text-gray-900 text-center">
              {employee.firstName} {employee.lastName}
            </h2>
            <span className={`badge ${getStatusColor(employee.status)} mt-1.5`}>{employee.status}</span>
            <p className="text-xs text-gray-400 mt-1">
              {employee.designation?.name || 'No designation'} · {employee.department?.name || ''}
            </p>
            <p className="text-xs font-mono text-gray-400 mt-0.5" data-mono>{employee.employeeCode}</p>
          </div>

          <div className="space-y-2.5 text-xs text-gray-500 mb-5">
            <div className="flex items-center gap-2"><Mail size={13} className="text-gray-400" /> <span className="truncate">{employee.email}</span></div>
            <div className="flex items-center gap-2"><Phone size={13} className="text-gray-400" /> +91 {employee.phone}</div>
            <div className="flex items-center gap-2"><Calendar size={13} className="text-gray-400" /> Joined {formatDate(employee.joiningDate)}</div>
            {employee.department && (
              <div className="flex items-center gap-2"><Building2 size={13} className="text-gray-400" /> {employee.department.name}</div>
            )}
          </div>

          <div className="border-t border-gray-100 pt-4 space-y-3">
            <button onClick={() => setShowEditModal(true)} className="w-full btn-primary text-xs py-2 flex items-center justify-center gap-1.5">
              <Save size={13} /> Edit Profile
            </button>
            {showActivationButton && (
              <button
                onClick={handleSendActivationInvite}
                disabled={sendingInvite}
                className="w-full flex items-center justify-center gap-1.5 text-xs py-2 rounded-lg border border-brand-200 text-brand-700 hover:bg-brand-50 transition-colors disabled:opacity-50"
              >
                {sendingInvite ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                {sendingInvite ? 'Sending...' : 'Send Activation Invite'}
              </button>
            )}
          </div>

          <div className="mt-6 border-t border-gray-100 pt-4 space-y-2">
            <SidebarMeta icon={Paperclip} label="Attachments" count={employee.documents?.length || 0} />
            <SidebarMeta icon={Tag} label="Tags" />
            <SidebarMeta icon={Share2} label="Share" />
          </div>

          <div className="mt-5 flex items-center gap-3 text-xs text-gray-400">
            <span className="flex items-center gap-1"><Heart size={12} /> 0</span>
            <span className="flex items-center gap-1"><MessageSquare size={12} /> 0</span>
            <span className="uppercase tracking-wide cursor-pointer hover:text-brand-600">Follow</span>
          </div>
        </div>

        {/* Right content area */}
        <div className="flex-1 overflow-y-auto">
          {/* Mobile profile header */}
          <div className="lg:hidden p-4 bg-white border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-lg font-display">
                {getInitials(employee.firstName, employee.lastName)}
              </div>
              <div className="flex-1">
                <h2 className="font-display font-bold text-gray-900">{employee.firstName} {employee.lastName}</h2>
                <p className="text-xs text-gray-400">{employee.employeeCode} · {employee.designation?.name || ''}</p>
              </div>
              <span className={`badge ${getStatusColor(employee.status)}`}>{employee.status}</span>
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-white border-b border-gray-100 px-6">
            <div className="flex gap-0 overflow-x-auto">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                    activeTab === tab.key
                      ? 'border-brand-600 text-brand-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tab content */}
          <div className="p-6">
            {activeTab === 'attendance' && (
              <div className="space-y-4">
                {/* Shift Assignment */}
                <ShiftAssignmentCard employeeId={id!} isManagement={MANAGEMENT_ROLES.includes(user?.role || '')} />
                <EmployeeAttendanceTab employeeId={id!} employeeName={`${employee.firstName} ${employee.lastName}`} />
              </div>
            )}

            {activeTab === 'overview' && (
              <div className="grid md:grid-cols-2 gap-6">
                <div className="layer-card p-5">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <Building2 size={15} className="text-purple-500" /> Employment Details
                  </h3>
                  <dl className="space-y-2.5">
                    <InfoRow label="Department" value={employee.department?.name || '—'} />
                    <InfoRow label="Designation" value={employee.designation?.name || '—'} />
                    <InfoRow label="Work Mode" value={employee.workMode?.replace(/_/g, ' ')} />
                    <InfoRow label="Reports To" value={employee.manager ? `${employee.manager.firstName} ${employee.manager.lastName}` : '—'} />
                    <InfoRow label="Office" value={employee.officeLocation?.name || '—'} />
                    <InfoRow label="Joining Date" value={formatDate(employee.joiningDate, 'long')} />
                    {employee.ctc && <InfoRow label="CTC" value={formatCurrency(Number(employee.ctc))} mono />}
                  </dl>
                </div>
                <div className="layer-card p-5">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <Shield size={15} className="text-brand-500" /> Personal Information
                  </h3>
                  <dl className="space-y-2.5">
                    <InfoRow label="Gender" value={employee.gender} />
                    <InfoRow label="Date of Birth" value={employee.dateOfBirth ? formatDate(employee.dateOfBirth) : '—'} />
                    <InfoRow label="Blood Group" value={employee.bloodGroup || '—'} />
                    <InfoRow label="Marital Status" value={employee.maritalStatus || '—'} />
                    <InfoRow label="Personal Email" value={employee.personalEmail || '—'} />
                  </dl>
                </div>
                {employee.emergencyContact && (
                  <div className="layer-card p-5">
                    <h3 className="text-sm font-semibold text-gray-800 mb-3">Emergency Contact</h3>
                    <dl className="space-y-2.5">
                      <InfoRow label="Name" value={(employee.emergencyContact as any).name || '—'} />
                      <InfoRow label="Relationship" value={(employee.emergencyContact as any).relationship || '—'} />
                      <InfoRow label="Phone" value={(employee.emergencyContact as any).phone || '—'} />
                    </dl>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'personal' && (
              <div className="grid md:grid-cols-2 gap-6">
                <div className="layer-card p-5">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">Personal Details</h3>
                  <dl className="space-y-2.5">
                    <InfoRow label="Full Name" value={`${employee.firstName} ${employee.lastName}`} />
                    <InfoRow label="Gender" value={employee.gender} />
                    <InfoRow label="Date of Birth" value={employee.dateOfBirth ? formatDate(employee.dateOfBirth) : '—'} />
                    <InfoRow label="Blood Group" value={employee.bloodGroup || '—'} />
                    <InfoRow label="Marital Status" value={employee.maritalStatus || '—'} />
                  </dl>
                </div>
                <div className="layer-card p-5">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">Contact Information</h3>
                  <dl className="space-y-2.5">
                    <InfoRow label="Official Email" value={employee.email} />
                    <InfoRow label="Personal Email" value={employee.personalEmail || '—'} />
                    <InfoRow label="Phone" value={employee.phone} />
                  </dl>
                </div>
              </div>
            )}

            {activeTab === 'salary' && (
              <SalaryTab employeeId={id!} ctc={employee.ctc} workMode={employee.workMode} isManagement={MANAGEMENT_ROLES.includes(user?.role || '')} />
            )}

            {activeTab === 'documents' && (
              <DocumentsTab employeeId={id!} documents={employee.documents || []} isManagement={MANAGEMENT_ROLES.includes(user?.role || '')} />
            )}

            {activeTab === 'intern' && isIntern && (
              <InternProfileTab employeeId={id!} employee={employee} isManagement={MANAGEMENT_ROLES.includes(user?.role || '')} />
            )}

            {activeTab === 'connections' && (
              <ConnectionsTab employee={employee} isManagement={MANAGEMENT_ROLES.includes(user?.role || '')} navigate={navigate} />
            )}

            {activeTab === 'permissions' && isManagement && (
              <PermissionOverridePanel employeeId={id!} />
            )}
          </div>
        </div>
      </div>

      {/* Edit Employee Modal */}
      <AnimatePresence>
        {showEditModal && employee && (
          <EditEmployeeModal
            employee={employee}
            onSave={async (data) => {
              try {
                await updateEmployee({ id: employee.id, data }).unwrap();
                toast.success('Employee updated');
                setShowEditModal(false);
              } catch (err: any) {
                toast.error(err?.data?.error?.message || 'Failed to update');
              }
            }}
            onClose={() => setShowEditModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function SidebarMeta({ icon: Icon, label, count }: { icon: any; label: string; count?: number }) {
  return (
    <div className="flex items-center justify-between text-xs text-gray-500 hover:text-gray-700 cursor-pointer py-1">
      <div className="flex items-center gap-2"><Icon size={13} className="text-gray-400" /> {label}</div>
      {count !== undefined ? <span className="text-gray-400 font-mono" data-mono>{count}</span> : <Plus size={12} className="text-gray-400" />}
    </div>
  );
}

/* =============================================================================
   Edit Employee Modal
   ============================================================================= */

function EditEmployeeModal({ employee, onSave, onClose }: { employee: any; onSave: (data: any) => void; onClose: () => void }) {
  const [form, setForm] = useState({
    firstName: employee.firstName || '',
    lastName: employee.lastName || '',
    email: employee.email || '',
    phone: employee.phone || '',
    personalEmail: employee.personalEmail || '',
    dateOfBirth: employee.dateOfBirth ? employee.dateOfBirth.split('T')[0] : '',
    gender: employee.gender || 'MALE',
    bloodGroup: employee.bloodGroup || '',
    maritalStatus: employee.maritalStatus || '',
    workMode: employee.workMode || 'OFFICE',
    joiningDate: employee.joiningDate ? employee.joiningDate.split('T')[0] : '',
    status: employee.status || 'ACTIVE',
    ctc: employee.ctc ? Number(employee.ctc) : '',
  });

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }} onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-glass-lg w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-display font-semibold text-gray-800">Edit Employee</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-400">✕</button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSave(form); }} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">First Name</label>
              <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="input-glass w-full text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Last Name</label>
              <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="input-glass w-full text-sm" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input-glass w-full text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Phone</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input-glass w-full text-sm" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">Gender</label>
              <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} className="input-glass w-full text-sm">
                <option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option><option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
              </select></div>
            <div><label className="block text-xs text-gray-500 mb-1">Date of Birth</label>
              <input type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} className="input-glass w-full text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Blood Group</label>
              <input value={form.bloodGroup} onChange={(e) => setForm({ ...form, bloodGroup: e.target.value })} className="input-glass w-full text-sm" placeholder="e.g. O+" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">Work Mode</label>
              <select value={form.workMode} onChange={(e) => setForm({ ...form, workMode: e.target.value })} className="input-glass w-full text-sm">
                <option value="OFFICE">Office</option><option value="HYBRID">Hybrid</option><option value="REMOTE">Remote</option>
                <option value="FIELD_SALES">Field Sales</option><option value="PROJECT_SITE">Project Site</option>
              </select></div>
            <div><label className="block text-xs text-gray-500 mb-1">Joining Date</label>
              <input type="date" value={form.joiningDate} onChange={(e) => setForm({ ...form, joiningDate: e.target.value })} className="input-glass w-full text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Status</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="input-glass w-full text-sm">
                <option value="ACTIVE">Active</option><option value="PROBATION">Probation</option>
                <option value="NOTICE_PERIOD">Notice Period</option><option value="INACTIVE">Inactive</option>
              </select></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">Personal Email</label>
              <input value={form.personalEmail} onChange={(e) => setForm({ ...form, personalEmail: e.target.value })} className="input-glass w-full text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">CTC (Annual, INR)</label>
              <input type="number" value={form.ctc} onChange={(e) => setForm({ ...form, ctc: e.target.value ? Number(e.target.value) : '' })} className="input-glass w-full text-sm" /></div>
          </div>
          <div className="flex gap-3 pt-3">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" className="btn-primary flex-1">Save Changes</button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

/* =============================================================================
   ERPNext-style Attendance Calendar
   ============================================================================= */

const STATUS_COLORS: Record<string, string> = {
  PRESENT: '#22c55e', ABSENT: '#ef4444', HALF_DAY: '#f59e0b',
  HOLIDAY: '#3b82f6', WEEKEND: '#d1d5db', ON_LEAVE: '#a855f7', WORK_FROM_HOME: '#22c55e',
};
const STATUS_LABELS: Record<string, string> = {
  PRESENT: 'Present', ABSENT: 'Absent', HALF_DAY: 'Half Day',
  HOLIDAY: 'Holiday', WEEKEND: 'Weekend', ON_LEAVE: 'On Leave', WORK_FROM_HOME: 'WFH',
};
const MONTH_LABELS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Build month-grouped weeks for ERPNext-style calendar
function buildMonthGroups(year: number) {
  const groups: { month: number; label: string; weeks: Date[][] }[] = [];

  // Start from previous December
  for (let m = -1; m < 12; m++) {
    const actualMonth = m === -1 ? 11 : m;
    const actualYear = m === -1 ? year - 1 : year;
    const label = m === -1 ? 'DEC' : MONTH_LABELS[m];

    const firstDay = new Date(actualYear, actualMonth, 1);
    const lastDay = new Date(actualYear, actualMonth + 1, 0);

    // Find Monday on or before the 1st
    const startDow = firstDay.getDay();
    const mondayOffset = startDow === 0 ? -6 : 1 - startDow;
    const weekStart = new Date(actualYear, actualMonth, 1 + mondayOffset);

    const weeks: Date[][] = [];
    const current = new Date(weekStart);

    while (current <= lastDay) {
      const week: Date[] = [];
      for (let d = 0; d < 7; d++) {
        week.push(new Date(current));
        current.setDate(current.getDate() + 1);
      }
      weeks.push(week);
    }

    groups.push({ month: actualMonth, label, weeks });
  }

  return groups;
}

function EmployeeAttendanceTab({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [popupCell, setPopupCell] = useState<{ date: string; x: number; y: number } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const startDate = `${selectedYear - 1}-12-01`;
  const endDate = `${selectedYear}-12-31`;
  const { data: response, isLoading } = useGetEmployeeAttendanceQuery({ employeeId, startDate, endDate });
  const [markAttendance, { isLoading: marking }] = useMarkAttendanceMutation();

  const records = response?.data?.records || [];
  const summary = response?.data?.summary;

  const dateStatusMap = useMemo(() => {
    const map: Record<string, string> = {};
    records.forEach((r: any) => { const k = r.date?.split('T')[0]; if (k) map[k] = r.status; });
    return map;
  }, [records]);

  const monthGroups = useMemo(() => buildMonthGroups(selectedYear), [selectedYear]);
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const getDateStatus = useCallback((date: Date): string | null => {
    const dateStr = date.toISOString().split('T')[0];
    if (dateStr > todayStr) return null;
    if (dateStatusMap[dateStr]) return dateStatusMap[dateStr];
    const dow = date.getDay();
    if (dow === 0 || dow === 6) return 'WEEKEND';
    return null;
  }, [dateStatusMap, todayStr]);

  const getCellColor = (date: Date): string => {
    const s = getDateStatus(date);
    return s ? (STATUS_COLORS[s] || '#f3f4f6') : '#f3f4f6';
  };

  const handleCellClick = (date: Date, e: React.MouseEvent) => {
    const dateStr = date.toISOString().split('T')[0];
    if (dateStr > todayStr) return;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPopupCell({ date: dateStr, x: rect.left, y: rect.bottom + 4 });
  };

  const handleMarkStatus = async (status: string) => {
    if (!popupCell || marking) return;
    try {
      await markAttendance({ employeeId, date: popupCell.date, status }).unwrap();
      toast.success(`Marked as ${STATUS_LABELS[status] || status}`);
      setPopupCell(null);
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to mark attendance'); }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (popupRef.current && !popupRef.current.contains(e.target as Node)) setPopupCell(null); };
    if (popupCell) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [popupCell]);

  const CELL = 11;
  const GAP = 2;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      <div className="layer-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold text-gray-900">{employeeName} — Attendance</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedYear(y => y - 1)} className="p-1.5 hover:bg-surface-2 rounded-lg"><ChevronLeft size={16} className="text-gray-500" /></button>
            <span className="text-sm font-bold font-mono text-gray-800 min-w-[4ch] text-center" data-mono>{selectedYear}</span>
            <button onClick={() => setSelectedYear(y => Math.min(y + 1, currentYear))} disabled={selectedYear >= currentYear} className="p-1.5 hover:bg-surface-2 rounded-lg disabled:opacity-30"><ChevronRight size={16} className="text-gray-500" /></button>
          </div>
        </div>

        {/* Summary stats */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-5">
            {[
              { v: summary.present, l: 'Present', c: 'text-emerald-600' },
              { v: summary.absent, l: 'Absent', c: 'text-red-500' },
              { v: summary.halfDay, l: 'Half Day', c: 'text-amber-500' },
              { v: summary.onLeave, l: 'On Leave', c: 'text-purple-500' },
              { v: summary.holidays, l: 'Holidays', c: 'text-blue-500' },
              { v: `${summary.averageHours?.toFixed(1) || '0'}h`, l: 'Avg Hours', c: 'text-brand-600' },
            ].map(s => (
              <div key={s.l} className="stat-card text-center py-3">
                <p className={`text-xl font-bold font-mono ${s.c}`} data-mono>{s.v || 0}</p>
                <p className="text-[11px] text-gray-400">{s.l}</p>
              </div>
            ))}
          </div>
        )}

        {/* ERPNext-style contribution calendar */}
        {isLoading ? (
          <div className="text-center py-12">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : (
          <div className="overflow-x-auto pb-2">
            <div className="flex items-start">
              {/* Day labels column */}
              <div className="shrink-0 mr-2 pt-5">
                {DAY_LABELS.map((label, i) => (
                  <div key={label} style={{ height: CELL + GAP }} className="flex items-center">
                    {i % 2 === 0 ? (
                      <span className="text-[10px] text-gray-400 w-7 text-right leading-none">{label}</span>
                    ) : (
                      <span className="w-7" />
                    )}
                  </div>
                ))}
              </div>

              {/* Month groups */}
              <div className="flex gap-[6px]">
                {monthGroups.map((group, gi) => (
                  <div key={gi} className="flex flex-col">
                    {/* Month label */}
                    <div className="text-[10px] text-gray-400 font-semibold uppercase mb-1 text-center tracking-wide" style={{ minWidth: group.weeks.length * (CELL + GAP) }}>
                      {group.label}
                    </div>
                    {/* Week columns for this month */}
                    <div className="flex gap-[2px]">
                      {group.weeks.map((week, wi) => (
                        <div key={wi} className="flex flex-col gap-[2px]">
                          {week.map((date, di) => {
                            const dateStr = date.toISOString().split('T')[0];
                            const isFuture = dateStr > todayStr;
                            const status = getDateStatus(date);
                            const color = getCellColor(date);
                            // Dim cells from outside the month
                            const inMonth = date.getMonth() === group.month;
                            return (
                              <div
                                key={di}
                                onClick={(e) => !isFuture && inMonth && handleCellClick(date, e)}
                                className="rounded-[2px] transition-all hover:ring-1 hover:ring-gray-400"
                                style={{
                                  width: CELL,
                                  height: CELL,
                                  backgroundColor: inMonth ? color : 'transparent',
                                  cursor: !isFuture && inMonth ? 'pointer' : 'default',
                                  opacity: inMonth ? (isFuture ? 0.3 : 1) : 0,
                                }}
                                title={inMonth ? `${dateStr}: ${status ? STATUS_LABELS[status] || status : 'No record'}` : ''}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-3 mt-3 ml-9">
              <span className="text-[10px] text-gray-400">Less</span>
              {[
                { color: '#f3f4f6', label: 'No data' },
                { color: STATUS_COLORS.PRESENT, label: 'Present' },
                { color: STATUS_COLORS.ABSENT, label: 'Absent' },
                { color: STATUS_COLORS.HALF_DAY, label: 'Half Day' },
                { color: STATUS_COLORS.ON_LEAVE, label: 'Leave' },
                { color: STATUS_COLORS.HOLIDAY, label: 'Holiday' },
                { color: STATUS_COLORS.WEEKEND, label: 'Weekend' },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-1">
                  <div className="w-[10px] h-[10px] rounded-[2px]" style={{ backgroundColor: item.color }} />
                  <span className="text-[9px] text-gray-400">{item.label}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-300 mt-2 ml-9 italic">This is based on the attendance of this Employee</p>
          </div>
        )}
      </div>

      {/* Mark attendance popup */}
      <AnimatePresence>
        {popupCell && (
          <motion.div ref={popupRef} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
            className="fixed z-50 bg-white rounded-xl shadow-glass-lg border border-gray-100 p-2 min-w-[160px]"
            style={{ left: Math.min(popupCell.x, window.innerWidth - 200), top: popupCell.y }}>
            <p className="text-[10px] text-gray-400 px-2 py-1 font-medium">Mark {popupCell.date}</p>
            {[
              { status: 'PRESENT', label: 'Present', color: STATUS_COLORS.PRESENT },
              { status: 'ABSENT', label: 'Absent', color: STATUS_COLORS.ABSENT },
              { status: 'HALF_DAY', label: 'Half Day', color: STATUS_COLORS.HALF_DAY },
              { status: 'ON_LEAVE', label: 'On Leave', color: STATUS_COLORS.ON_LEAVE },
            ].map(opt => (
              <button key={opt.status} onClick={() => handleMarkStatus(opt.status)} disabled={marking}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-sm text-gray-700 hover:bg-surface-2 transition-colors text-left">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: opt.color }} />
                {opt.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Connections */}
      <ConnectionsCards employeeId={employeeId} records={records} />
    </motion.div>
  );
}

/* =============================================================================
   Shift Assignment Card
   ============================================================================= */

function ShiftAssignmentCard({ employeeId, isManagement }: { employeeId: string; isManagement: boolean }) {
  const { data: shiftRes } = useGetEmployeeShiftQuery(employeeId);
  const { data: allShiftsRes } = useGetShiftsQuery(undefined, { skip: !isManagement });
  const [assignShift, { isLoading: assigning }] = useAssignShiftMutation();
  const [selectedShift, setSelectedShift] = useState('');

  const currentShift = shiftRes?.data?.shift;
  const shifts = allShiftsRes?.data || [];

  const handleAssign = async () => {
    if (!selectedShift) return;
    try {
      await assignShift({ employeeId, shiftId: selectedShift, startDate: new Date().toISOString().split('T')[0] }).unwrap();
      toast.success('Shift assigned');
      setSelectedShift('');
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  return (
    <div className="layer-card p-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
          <Clock size={18} className="text-blue-600" />
        </div>
        <div>
          <p className="text-sm font-medium text-gray-700">Current Shift</p>
          {currentShift ? (
            <p className="text-xs text-gray-500">{currentShift.name} ({currentShift.startTime} - {currentShift.endTime})</p>
          ) : (
            <p className="text-xs text-gray-400">No shift assigned</p>
          )}
        </div>
      </div>
      {isManagement && (
        <div className="flex items-center gap-2">
          <select value={selectedShift} onChange={e => setSelectedShift(e.target.value)} className="input-glass text-xs py-1.5">
            <option value="">Change shift...</option>
            {shifts.map((s: any) => <option key={s.id} value={s.id}>{s.name} ({s.startTime}-{s.endTime})</option>)}
          </select>
          {selectedShift && (
            <button onClick={handleAssign} disabled={assigning} className="btn-primary text-xs py-1.5 px-3">
              {assigning ? 'Assigning...' : 'Assign'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* =============================================================================
   Salary Tab — View & Edit Salary Structure
   ============================================================================= */

const DEFAULT_ENABLED: Record<string, boolean> = { basic: true, hra: true, da: true, ta: true, special: true, epf: true, esi: true, pt: true };

function SalaryTab({ employeeId, ctc, workMode, isManagement }: { employeeId: string; ctc: any; workMode: string; isManagement: boolean }) {
  const { data: salRes } = useGetSalaryStructureQuery(employeeId);
  const [saveSalary, { isLoading: saving }] = useSaveSalaryStructureMutation();
  const structure = salRes?.data;
  const [editing, setEditing] = useState(false);
  const [annualCtc, setAnnualCtc] = useState(ctc ? Number(ctc) : 0);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    structure?.enabledComponents ? { ...DEFAULT_ENABLED, ...structure.enabledComponents } : { ...DEFAULT_ENABLED }
  );

  // Sync enabled state when structure loads
  useEffect(() => {
    if (structure?.enabledComponents) {
      setEnabled({ ...DEFAULT_ENABLED, ...structure.enabledComponents });
    }
  }, [structure]);

  const toggleComponent = (key: string) => {
    if (key === 'basic') return; // Basic is always required
    setEnabled(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Auto-compute components from CTC
  const monthly = annualCtc / 12;
  const basic = enabled.basic ? monthly * 0.5 : 0;
  const hra = enabled.hra ? basic * 0.4 : 0;
  const da = enabled.da ? monthly * 0.1 : 0;
  const ta = enabled.ta ? monthly * 0.05 : 0;
  const special = enabled.special ? monthly - (monthly * 0.5) - (monthly * 0.5 * 0.4) - (monthly * 0.1) - (monthly * 0.05) : 0;
  const gross = basic + hra + da + ta + (enabled.special ? special : 0);

  // Deductions
  const epfEmployee = enabled.epf ? Math.min(basic, 15000) * 0.12 : 0;
  const esiEmployee = enabled.esi ? (monthly <= 21000 ? monthly * 0.0075 : 0) : 0;
  const pt = enabled.pt ? (monthly > 15000 ? 200 : monthly > 10000 ? 150 : 0) : 0;
  const totalDeductions = epfEmployee + esiEmployee + pt;
  const netMonthly = gross - totalDeductions;

  const handleSave = async () => {
    try {
      await saveSalary({ employeeId, data: { ctc: annualCtc, enabledComponents: enabled } }).unwrap();
      toast.success('Salary structure saved');
      setEditing(false);
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to save'); }
  };

  const earningRows = [
    { key: 'basic', label: 'Basic Salary (50%)', value: Math.round(basic) },
    { key: 'hra', label: 'HRA (40% of Basic)', value: Math.round(hra) },
    { key: 'da', label: 'Dearness Allowance (10%)', value: Math.round(da) },
    { key: 'ta', label: 'Transport Allowance (5%)', value: Math.round(ta) },
    { key: 'special', label: 'Special Allowance', value: Math.round(special) },
  ];

  const deductionRows = [
    { key: 'epf', label: 'EPF (Employee 12%)', value: Math.round(epfEmployee) },
    ...(esiEmployee > 0 || enabled.esi ? [{ key: 'esi', label: 'ESI (Employee 0.75%)', value: Math.round(esiEmployee) }] : []),
    { key: 'pt', label: 'Professional Tax', value: pt },
  ];

  return (
    <div className="space-y-6">
      {/* CTC Overview */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="layer-card p-5 text-center">
          <p className="text-xs text-gray-400 mb-1">CTC (Annual)</p>
          {editing ? (
            <input type="number" value={annualCtc} onChange={e => setAnnualCtc(Number(e.target.value))}
              className="input-glass w-full text-center text-lg font-bold font-mono" data-mono />
          ) : (
            <p className="text-2xl font-bold font-mono text-gray-900" data-mono>{annualCtc ? formatCurrency(annualCtc) : '—'}</p>
          )}
        </div>
        <div className="layer-card p-5 text-center">
          <p className="text-xs text-gray-400 mb-1">Monthly Gross</p>
          <p className="text-2xl font-bold font-mono text-brand-600" data-mono>{formatCurrency(Math.round(gross))}</p>
        </div>
        <div className="layer-card p-5 text-center">
          <p className="text-xs text-gray-400 mb-1">Monthly Net</p>
          <p className="text-2xl font-bold font-mono text-emerald-600" data-mono>{formatCurrency(Math.round(netMonthly))}</p>
        </div>
      </div>

      {/* Salary Breakdown */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="layer-card p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">Earnings (Monthly)</h3>
          <div className="space-y-2.5">
            {earningRows.map(row => (
              <div key={row.key} className={`flex items-center gap-2 ${!enabled[row.key] ? 'opacity-40' : ''}`}>
                {isManagement && editing && (
                  <input
                    type="checkbox"
                    checked={enabled[row.key]}
                    onChange={() => toggleComponent(row.key)}
                    disabled={row.key === 'basic'}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                )}
                <div className="flex-1">
                  <SalaryRow label={row.label} value={enabled[row.key] ? row.value : 0} />
                </div>
              </div>
            ))}
            <div className="border-t border-gray-100 pt-2 mt-2">
              <SalaryRow label="Gross Monthly" value={Math.round(gross)} bold />
            </div>
          </div>
        </div>
        <div className="layer-card p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">Deductions (Monthly)</h3>
          <div className="space-y-2.5">
            {deductionRows.map(row => (
              <div key={row.key} className={`flex items-center gap-2 ${!enabled[row.key] ? 'opacity-40' : ''}`}>
                {isManagement && editing && (
                  <input
                    type="checkbox"
                    checked={enabled[row.key]}
                    onChange={() => toggleComponent(row.key)}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                )}
                <div className="flex-1">
                  <SalaryRow label={row.label} value={enabled[row.key] ? row.value : 0} deduct />
                </div>
              </div>
            ))}
            <div className="border-t border-gray-100 pt-2 mt-2">
              <SalaryRow label="Total Deductions" value={Math.round(totalDeductions)} deduct bold />
            </div>
            <div className="border-t border-gray-200 pt-2 mt-2">
              <SalaryRow label="Net Take-Home" value={Math.round(netMonthly)} bold />
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      {isManagement && (
        <div className="flex gap-3">
          {editing ? (
            <>
              <button onClick={handleSave} disabled={saving} className="btn-primary text-sm flex items-center gap-1.5">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Structure
              </button>
              <button onClick={() => { setEditing(false); setAnnualCtc(ctc ? Number(ctc) : 0); if (structure?.enabledComponents) setEnabled({ ...DEFAULT_ENABLED, ...structure.enabledComponents }); else setEnabled({ ...DEFAULT_ENABLED }); }} className="btn-secondary text-sm">Cancel</button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="btn-primary text-sm flex items-center gap-1.5">
              <DollarSign size={14} /> Edit Salary Structure
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SalaryRow({ label, value, deduct, bold }: { label: string; value: number; deduct?: boolean; bold?: boolean }) {
  return (
    <div className={`flex justify-between items-center ${bold ? 'font-semibold' : ''}`}>
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-sm font-mono ${deduct ? 'text-red-600' : 'text-gray-800'} ${bold ? 'text-base' : ''}`} data-mono>
        {deduct ? '-' : ''}{formatCurrency(value)}
      </span>
    </div>
  );
}

/* =============================================================================
   Documents Tab — Upload & View
   ============================================================================= */

const DOC_TYPES = ['AADHAAR', 'PAN', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID', 'BANK_STATEMENT', 'OFFER_LETTER', 'RELIEVING_LETTER', 'EDUCATION', 'EXPERIENCE', 'OTHER'];

function DocumentsTab({ employeeId, documents, isManagement }: { employeeId: string; documents: any[]; isManagement: boolean }) {
  const [uploadDoc, { isLoading: uploading }] = useUploadDocumentMutation();
  const [verifyDoc] = useVerifyDocumentMutation();
  const [verifyKyc, { isLoading: verifyingAll }] = useVerifyKycMutation();
  const { data: ocrSummaryRes } = useGetEmployeeOcrSummaryQuery(employeeId, { skip: !isManagement });
  const [showUpload, setShowUpload] = useState(false);
  const [ocrDocId, setOcrDocId] = useState<string | null>(null);
  const [ocrDocName, setOcrDocName] = useState('');
  const [ocrDocType, setOcrDocType] = useState('');
  const [ocrDocFileUrl, setOcrDocFileUrl] = useState('');
  const [ocrDocStatus, setOcrDocStatus] = useState('');
  const [docName, setDocName] = useState('');
  const [docType, setDocType] = useState('OTHER');
  const fileRef = useRef<HTMLInputElement>(null);

  // Build OCR lookup by documentId for inline display
  const ocrByDocId: Record<string, any> = {};
  if (ocrSummaryRes?.data) {
    for (const item of ocrSummaryRes.data) {
      if (item.ocr) ocrByDocId[item.documentId] = item.ocr;
    }
  }

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { toast.error('Please select a file'); return; }
    if (!docName.trim()) { toast.error('Please enter document name'); return; }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', docName.trim());
    formData.append('type', docType);
    formData.append('employeeId', employeeId);

    try {
      await uploadDoc(formData).unwrap();
      toast.success('Document uploaded');
      setShowUpload(false);
      setDocName('');
      setDocType('OTHER');
      if (fileRef.current) fileRef.current.value = '';
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Upload failed'); }
  };

  const handleVerify = async (docId: string, status: string) => {
    try {
      await verifyDoc({ id: docId, status }).unwrap();
      toast.success(`Document ${status.toLowerCase()}`);
    } catch { toast.error('Failed to verify'); }
  };

  const API_URL = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:4000';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">Documents ({documents.length})</h3>
        <div className="flex gap-2">
          {isManagement && documents.some((d: any) => d.status === 'PENDING') && (
            <button onClick={async () => {
              try {
                // Verify all pending documents
                const pending = documents.filter((d: any) => d.status === 'PENDING');
                for (const doc of pending) {
                  await verifyDoc({ id: doc.id, status: 'VERIFIED' }).unwrap();
                }
                // Then approve KYC gate
                await verifyKyc(employeeId).unwrap();
                toast.success(`All ${pending.length} documents verified & KYC approved!`);
              } catch (err: any) {
                toast.error(err?.data?.error?.message || 'Failed to verify');
              }
            }} disabled={verifyingAll} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors">
              {verifyingAll ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Verify All & Approve KYC
            </button>
          )}
          <button onClick={() => setShowUpload(!showUpload)} className="btn-primary text-xs flex items-center gap-1.5">
            <Plus size={14} /> Upload Document
          </button>
        </div>
      </div>

      {/* Upload form */}
      {showUpload && (
        <div className="layer-card p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Document Name *</label>
              <input value={docName} onChange={e => setDocName(e.target.value)} className="input-glass w-full text-sm" placeholder="e.g. Aadhaar Card" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select value={docType} onChange={e => setDocType(e.target.value)} className="input-glass w-full text-sm">
                {DOC_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">File (PDF, JPG, PNG) *</label>
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" capture="environment"
              className="input-glass w-full text-sm file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-brand-50 file:text-brand-700" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleUpload} disabled={uploading} className="btn-primary text-sm flex items-center gap-1.5">
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
            <button onClick={() => setShowUpload(false)} className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Document list */}
      {documents.length > 0 ? (
        <div className="grid md:grid-cols-2 gap-3">
          {documents.map((doc: any) => {
            const ocr = ocrByDocId[doc.id];
            return (
            <div key={doc.id} className={`layer-card p-4 ${doc.tamperDetected ? 'ring-2 ring-red-300' : ''}`}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-sm font-medium text-gray-800">{doc.name}</p>
                  <p className="text-xs text-gray-400">{doc.type?.replace(/_/g, ' ')} · {formatDate(doc.createdAt)}</p>
                </div>
                <span className={`badge ${getStatusColor(doc.status)} text-xs`}>{doc.status}</span>
              </div>

              {/* Employee-facing: re-upload prompt for REJECTED documents */}
              {!isManagement && doc.status === 'REJECTED' && (
                <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-xs text-red-700 font-medium">This document was rejected. Please re-upload a clear, original scan.</p>
                  {doc.rejectionReason && <p className="text-xs text-red-600 mt-1">{doc.rejectionReason}</p>}
                </div>
              )}

              {isManagement && doc.fileUrl && (
                <a href={`${API_URL}${doc.fileUrl}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1 mb-2">
                  <FileText size={12} /> View Document
                </a>
              )}

              {/* Tamper/fake alert — HR only */}
              {isManagement && doc.tamperDetected && (
                <div className="mt-2 p-2.5 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-xs text-red-700 font-medium flex items-center gap-1.5">
                    <Shield size={12} className="text-red-600" /> FLAGGED: This document may be altered or fake
                  </p>
                  {doc.tamperDetails && <p className="text-xs text-red-600 mt-1">{doc.tamperDetails}</p>}
                </div>
              )}

              {/* Auto OCR extracted data — HR/Admin/SuperAdmin only */}
              {isManagement && ocr && (
                <div className="mt-2 p-3 bg-gray-50 border border-gray-100 rounded-lg space-y-2">
                  {/* Quality badges */}
                  <div className="flex flex-wrap gap-1.5">
                    {ocr.ocrStatus === 'FLAGGED' && (
                      <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700">FLAGGED</span>
                    )}
                    {ocr.isScreenshot && (
                      <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-50 text-red-600">Screenshot</span>
                    )}
                    {ocr.isOriginalScan && !ocr.isScreenshot && (
                      <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-600">Original Scan</span>
                    )}
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      ocr.resolutionQuality === 'HIGH' ? 'bg-emerald-50 text-emerald-600' : ocr.resolutionQuality === 'MEDIUM' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'
                    }`}>{ocr.resolutionQuality || '?'} Quality</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      ocr.confidence >= 0.7 ? 'bg-emerald-50 text-emerald-600' : ocr.confidence >= 0.4 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'
                    }`}>{Math.round(ocr.confidence * 100)}% conf</span>
                    {ocr.crossValidationStatus && (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        ocr.crossValidationStatus === 'PASS' ? 'bg-emerald-50 text-emerald-600' : ocr.crossValidationStatus === 'FAIL' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'
                      }`}>Cross: {ocr.crossValidationStatus}</span>
                    )}
                  </div>

                  {/* Extracted fields */}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    {ocr.extractedName && <div><span className="text-[10px] text-gray-400">Name</span><p className="text-xs font-medium text-gray-700 truncate">{ocr.extractedName}</p></div>}
                    {ocr.extractedDob && <div><span className="text-[10px] text-gray-400">DOB</span><p className="text-xs font-medium text-gray-700">{ocr.extractedDob}</p></div>}
                    {ocr.extractedFatherName && <div><span className="text-[10px] text-gray-400">Father</span><p className="text-xs font-medium text-gray-700 truncate">{ocr.extractedFatherName}</p></div>}
                    {ocr.extractedDocNumber && <div><span className="text-[10px] text-gray-400">Doc No.</span><p className="text-xs font-medium text-gray-700 font-mono">{ocr.extractedDocNumber}</p></div>}
                    {ocr.extractedGender && <div><span className="text-[10px] text-gray-400">Gender</span><p className="text-xs font-medium text-gray-700">{ocr.extractedGender}</p></div>}
                    {ocr.extractedMotherName && <div><span className="text-[10px] text-gray-400">Mother</span><p className="text-xs font-medium text-gray-700 truncate">{ocr.extractedMotherName}</p></div>}
                  </div>

                  {/* Detail panel link */}
                  <button onClick={() => { setOcrDocId(doc.id); setOcrDocName(doc.name); setOcrDocType(doc.type); setOcrDocFileUrl(doc.fileUrl); setOcrDocStatus(doc.status); }}
                    className="text-[10px] text-brand-600 hover:text-brand-700 font-medium">
                    View full OCR details &rarr;
                  </button>
                </div>
              )}

              {/* HR verify/reject actions */}
              {isManagement && doc.status === 'PENDING' && (
                <div className="flex gap-2 mt-2 pt-2 border-t border-gray-50">
                  <button onClick={() => handleVerify(doc.id, 'VERIFIED')} className="text-xs text-emerald-600 hover:bg-emerald-50 px-2 py-1 rounded-lg">Verify</button>
                  <button onClick={() => handleVerify(doc.id, 'REJECTED')} className="text-xs text-red-500 hover:bg-red-50 px-2 py-1 rounded-lg">Reject</button>
                </div>
              )}
            </div>
            );
          })}
        </div>
      ) : (
        <div className="layer-card p-12 text-center">
          <FileText size={32} className="text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No documents uploaded yet</p>
          <p className="text-xs text-gray-300 mt-1">Click "Upload Document" to add files</p>
        </div>
      )}

      {/* OCR Detail Slide-over — HR only, opened from inline "View full OCR details" */}
      {ocrDocId && (
        <OcrVerificationPanel
          documentId={ocrDocId}
          documentName={ocrDocName}
          documentType={ocrDocType}
          documentStatus={ocrDocStatus}
          employeeId={employeeId}
          fileUrl={ocrDocFileUrl}
          onClose={() => setOcrDocId(null)}
        />
      )}
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start">
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className={`text-sm text-gray-700 text-right ${mono ? 'font-mono' : ''}`} data-mono={mono || undefined}>{value}</dd>
    </div>
  );
}

/* =============================================================================
   Connections Tab — Connections grid + Lifecycle Timeline
   ============================================================================= */

const EVENT_TYPE_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  JOINING: { color: 'text-emerald-600', bg: 'bg-emerald-100', label: 'Joining' },
  PROBATION_END: { color: 'text-blue-600', bg: 'bg-blue-100', label: 'Probation End' },
  CONFIRMATION: { color: 'text-green-600', bg: 'bg-green-100', label: 'Confirmation' },
  PROMOTION: { color: 'text-purple-600', bg: 'bg-purple-100', label: 'Promotion' },
  TRANSFER: { color: 'text-indigo-600', bg: 'bg-indigo-100', label: 'Transfer' },
  SALARY_REVISION: { color: 'text-amber-600', bg: 'bg-amber-100', label: 'Salary Revision' },
  WARNING: { color: 'text-red-600', bg: 'bg-red-100', label: 'Warning' },
  SEPARATION: { color: 'text-red-700', bg: 'bg-red-100', label: 'Separation' },
  STATUS_CHANGE: { color: 'text-gray-600', bg: 'bg-gray-100', label: 'Status Change' },
  REHIRE: { color: 'text-teal-600', bg: 'bg-teal-100', label: 'Rehire' },
};

function ConnectionsTab({ employee, isManagement, navigate }: { employee: any; isManagement: boolean; navigate: (path: string) => void }) {
  const [addEvent, { isLoading: adding }] = useAddLifecycleEventMutation();
  const [deleteEvent] = useDeleteLifecycleEventMutation();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ eventType: 'JOINING', title: '', description: '', eventDate: new Date().toISOString().split('T')[0] });
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  // Fetch attendance only when expanded
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
  const endOfYear = new Date(now.getFullYear(), 11, 31).toISOString().split('T')[0];
  const { data: attendanceRes } = useGetEmployeeAttendanceQuery(
    { employeeId: employee.id, startDate: startOfYear, endDate: endOfYear },
    { skip: expandedCard !== 'Attendance' }
  );
  const attendanceRecords = attendanceRes?.data?.records || [];

  // Fetch shifts
  const { data: shiftRes } = useGetEmployeeShiftQuery(employee.id, { skip: expandedCard !== 'Shift Assignments' });
  const currentShift = shiftRes?.data;
  const { data: allShiftsRes } = useGetShiftsQuery(undefined, { skip: expandedCard !== 'Shift Assignments' || !isManagement });
  const allShifts = allShiftsRes?.data || [];
  const [assignShift] = useAssignShiftMutation();
  const [selectedShiftId, setSelectedShiftId] = useState('');

  const handleAssignShift = async () => {
    if (!selectedShiftId) return;
    try {
      await assignShift({ employeeId: employee.id, shiftId: selectedShiftId, startDate: new Date().toISOString().split('T')[0] }).unwrap();
      toast.success('Shift assigned');
      setSelectedShiftId('');
    } catch { toast.error('Failed to assign shift'); }
  };

  const events = employee.lifecycleEvents || [];
  const documents = employee.documents || [];
  const leaveRequests = employee.leaveRequests || [];
  const leaveBalances = employee.leaveBalances || [];
  const shiftAssignments = employee.shiftAssignments || [];

  // Auto-generate joining event if none exists
  const allEvents = useMemo(() => {
    const hasJoining = events.some((e: any) => e.eventType === 'JOINING');
    const base = [...events];
    if (!hasJoining && employee.joiningDate) {
      base.push({
        id: 'auto-joining',
        eventType: 'JOINING',
        title: 'Joined the organization',
        description: `Joined as ${employee.designation?.name || 'Employee'}`,
        eventDate: employee.joiningDate,
        createdAt: employee.joiningDate,
      });
    }
    return base.sort((a: any, b: any) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime());
  }, [events, employee]);

  const handleAdd = async () => {
    if (!form.title) { toast.error('Title required'); return; }
    try {
      await addEvent({ employeeId: employee.id, data: form }).unwrap();
      toast.success('Event added');
      setShowForm(false);
      setForm({ eventType: 'JOINING', title: '', description: '', eventDate: new Date().toISOString().split('T')[0] });
    } catch { toast.error('Failed'); }
  };

  const handleDelete = async (eventId: string) => {
    if (eventId === 'auto-joining') return;
    if (!confirm('Delete this event?')) return;
    try {
      await deleteEvent({ employeeId: employee.id, eventId }).unwrap();
      toast.success('Deleted');
    } catch { toast.error('Failed'); }
  };

  const toggleCard = (label: string) => {
    setExpandedCard(expandedCard === label ? null : label);
  };

  const connectionCards = [
    { label: 'Attendance', color: 'bg-emerald-50', textColor: 'text-emerald-600', icon: Clock, count: employee.attendanceRecords?.length || attendanceRecords.length || 0 },
    { label: 'Leave Application', color: 'bg-purple-50', textColor: 'text-purple-600', icon: Calendar, count: leaveRequests.length },
    { label: 'Leave Balance', color: 'bg-teal-50', textColor: 'text-teal-600', icon: DollarSign, count: leaveBalances.length },
    { label: 'Shift Assignments', color: 'bg-rose-50', textColor: 'text-rose-600', icon: Clock, count: shiftAssignments.length },
    { label: 'Documents', color: 'bg-green-50', textColor: 'text-green-600', icon: FileText, count: documents.length },
    { label: 'Lifecycle Events', color: 'bg-blue-50', textColor: 'text-blue-600', icon: Briefcase, count: allEvents.length },
  ];

  const renderExpanded = (label: string) => {
    switch (label) {
      case 'Attendance':
        return (
          <div className="mt-3 space-y-1.5 max-h-64 overflow-y-auto">
            {attendanceRecords.length === 0 ? (
              <p className="text-xs text-gray-400 py-3 text-center">No attendance records found</p>
            ) : attendanceRecords.slice(0, 20).map((rec: any) => (
              <div key={rec.id} className="flex items-center justify-between py-1.5 px-2 bg-white rounded-lg text-xs">
                <span className="font-mono text-gray-500" data-mono>{formatDate(rec.date)}</span>
                <span className={`badge text-[10px] ${rec.status === 'PRESENT' ? 'badge-success' : rec.status === 'ABSENT' ? 'badge-danger' : 'badge-warning'}`}>{rec.status}</span>
                <span className="font-mono text-gray-400" data-mono>{rec.totalHours ? `${Number(rec.totalHours).toFixed(1)}h` : '—'}</span>
              </div>
            ))}
          </div>
        );
      case 'Leave Application':
        return (
          <div className="mt-3 space-y-1.5 max-h-64 overflow-y-auto">
            {leaveRequests.length === 0 ? (
              <p className="text-xs text-gray-400 py-3 text-center">No leave requests</p>
            ) : leaveRequests.map((lr: any) => (
              <div key={lr.id} className="flex items-center justify-between py-1.5 px-2 bg-white rounded-lg text-xs">
                <span className="text-gray-700 font-medium">{lr.leaveType?.name || 'Leave'}</span>
                <span className="font-mono text-gray-400" data-mono>{formatDate(lr.startDate)} — {formatDate(lr.endDate)}</span>
                <span className="font-mono text-gray-500" data-mono>{lr.days}d</span>
                <span className={`badge text-[10px] ${lr.status === 'APPROVED' ? 'badge-success' : lr.status === 'REJECTED' ? 'badge-danger' : 'badge-warning'}`}>{lr.status}</span>
              </div>
            ))}
          </div>
        );
      case 'Leave Balance':
        return (
          <div className="mt-3 grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
            {leaveBalances.length === 0 ? (
              <p className="text-xs text-gray-400 py-3 text-center col-span-2">No leave balances</p>
            ) : leaveBalances.map((lb: any) => (
              <div key={lb.id} className="bg-white rounded-lg p-2.5">
                <p className="text-xs font-medium text-gray-700">{lb.leaveType?.name || 'Leave'}</p>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-sm font-bold font-mono text-brand-600" data-mono>{Number(lb.allocated) + Number(lb.carriedForward || 0) - Number(lb.used) - Number(lb.pending || 0)}</span>
                  <span className="text-[10px] text-gray-400">of {Number(lb.allocated)} available</span>
                </div>
                {Number(lb.used) > 0 && <p className="text-[10px] text-gray-400 mt-0.5">Used: {Number(lb.used)}</p>}
              </div>
            ))}
          </div>
        );
      case 'Shift Assignments':
        return (
          <div className="mt-3 space-y-2">
            {currentShift ? (
              <div className="bg-white rounded-lg p-2.5">
                <p className="text-xs font-medium text-gray-700">Current: {currentShift.shift?.name || '—'}</p>
                <p className="text-[10px] text-gray-400">{currentShift.shift?.startTime} — {currentShift.shift?.endTime}</p>
              </div>
            ) : (
              <p className="text-xs text-gray-400">No shift assigned</p>
            )}
            {isManagement && (
              <div className="flex items-center gap-2">
                <select value={selectedShiftId} onChange={e => setSelectedShiftId(e.target.value)} className="input-glass text-xs flex-1">
                  <option value="">Change shift...</option>
                  {allShifts.map((s: any) => <option key={s.id} value={s.id}>{s.name} ({s.startTime}–{s.endTime})</option>)}
                </select>
                <button onClick={handleAssignShift} disabled={!selectedShiftId} className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40">Assign</button>
              </div>
            )}
            {shiftAssignments.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">History</p>
                {shiftAssignments.slice(0, 5).map((sa: any) => (
                  <div key={sa.id} className="flex items-center justify-between py-1 px-2 bg-white rounded text-xs">
                    <span className="text-gray-600">{sa.shift?.name || 'Shift'}</span>
                    <span className="font-mono text-gray-400" data-mono>{formatDate(sa.startDate)}{sa.endDate ? ` — ${formatDate(sa.endDate)}` : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      case 'Documents':
        return (
          <div className="mt-3 space-y-1.5 max-h-64 overflow-y-auto">
            {documents.length === 0 ? (
              <p className="text-xs text-gray-400 py-3 text-center">No documents</p>
            ) : documents.map((doc: any) => (
              <div key={doc.id} className="flex items-center justify-between py-1.5 px-2 bg-white rounded-lg text-xs">
                <div>
                  <p className="text-gray-700 font-medium">{doc.name}</p>
                  <p className="text-[10px] text-gray-400">{doc.type?.replace(/_/g, ' ')}</p>
                </div>
                <span className={`badge text-[10px] ${getStatusColor(doc.status)}`}>{doc.status}</span>
              </div>
            ))}
          </div>
        );
      case 'Lifecycle Events':
        return null; // Already shown in the timeline below
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Connection cards — expandable */}
      <div className="layer-card p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-4">Connections</h3>
        <div className="space-y-2">
          {connectionCards.map((card) => (
            <div key={card.label}>
              <div
                onClick={() => toggleCard(card.label)}
                className={`flex items-center justify-between p-3 rounded-xl transition-colors cursor-pointer ${expandedCard === card.label ? 'bg-gray-100' : 'bg-surface-2 hover:bg-gray-50'}`}
              >
                <div className="flex items-center gap-2.5">
                  <div className={`w-7 h-7 rounded-lg ${card.color} flex items-center justify-center`}>
                    <card.icon size={14} className={card.textColor} />
                  </div>
                  <p className="text-xs font-medium text-gray-700">{card.label}</p>
                </div>
                <div className="flex items-center gap-2">
                  {card.count > 0 && <span className="text-xs font-mono font-bold text-gray-500" data-mono>{card.count}</span>}
                  <ChevronRight size={14} className={`text-gray-400 transition-transform ${expandedCard === card.label ? 'rotate-90' : ''}`} />
                </div>
              </div>
              <AnimatePresence>
                {expandedCard === card.label && card.label !== 'Lifecycle Events' && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden px-2"
                  >
                    {renderExpanded(card.label)}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>

      {/* Lifecycle Timeline */}
      <div className="layer-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-800">Employee Lifecycle</h3>
          {isManagement && (
            <button onClick={() => setShowForm(!showForm)} className="btn-primary text-xs flex items-center gap-1">
              <Plus size={12} /> Add Event
            </button>
          )}
        </div>

        {/* Add form */}
        {showForm && (
          <div className="bg-surface-2 rounded-xl p-4 mb-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Event Type</label>
                <select value={form.eventType} onChange={e => setForm({...form, eventType: e.target.value})} className="input-glass w-full text-sm">
                  {Object.entries(EVENT_TYPE_CONFIG).map(([key, { label }]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Date</label>
                <input type="date" value={form.eventDate} onChange={e => setForm({...form, eventDate: e.target.value})} className="input-glass w-full text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Title *</label>
              <input value={form.title} onChange={e => setForm({...form, title: e.target.value})} className="input-glass w-full text-sm" placeholder="e.g. Promoted to Senior Engineer" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Description</label>
              <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="input-glass w-full text-sm h-16 resize-none" placeholder="Additional details..." />
            </div>
            <div className="flex gap-2">
              <button onClick={handleAdd} disabled={adding} className="btn-primary text-xs">{adding ? 'Adding...' : 'Add Event'}</button>
              <button onClick={() => setShowForm(false)} className="btn-secondary text-xs">Cancel</button>
            </div>
          </div>
        )}

        {/* Timeline */}
        {allEvents.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No lifecycle events recorded</p>
        ) : (
          <div className="relative ml-4">
            <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gray-200" />
            {allEvents.map((event: any, idx: number) => {
              const config = EVENT_TYPE_CONFIG[event.eventType] || EVENT_TYPE_CONFIG.STATUS_CHANGE;
              return (
                <div key={event.id} className="relative pl-6 pb-6 last:pb-0">
                  <div className={`absolute left-[-4px] top-1 w-3 h-3 rounded-full ${config.bg} border-2 border-white shadow-sm`} />
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${config.bg} ${config.color}`}>
                          {config.label}
                        </span>
                        <span className="text-[10px] font-mono text-gray-400" data-mono>{formatDate(event.eventDate)}</span>
                      </div>
                      <p className="text-sm font-medium text-gray-800">{event.title}</p>
                      {event.description && <p className="text-xs text-gray-500 mt-0.5">{event.description}</p>}
                    </div>
                    {isManagement && event.id !== 'auto-joining' && (
                      <button onClick={() => handleDelete(event.id)} className="text-gray-300 hover:text-red-500 p-1 ml-2 flex-shrink-0">
                        <Plus size={12} className="rotate-45" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// =================== Intern Profile Tab ===================
function InternProfileTab({ employeeId, employee, isManagement }: { employeeId: string; employee: any; isManagement: boolean }) {
  const { data: profileRes, isLoading: profileLoading } = useGetInternProfileQuery(employeeId);
  const { data: lettersRes, isLoading: lettersLoading } = useGetAchievementLettersQuery(employeeId);
  const [issueLetter, { isLoading: issuing }] = useIssueAchievementLetterMutation();
  const [showLetterModal, setShowLetterModal] = useState(false);
  const [letterForm, setLetterForm] = useState({ title: '', description: '', issuedBy: '' });

  const profile = profileRes?.data;
  const letters = lettersRes?.data || [];

  const handleIssueLetter = async () => {
    if (!letterForm.title) { toast.error('Title is required'); return; }
    try {
      await issueLetter({ employeeId, data: letterForm }).unwrap();
      toast.success('Achievement letter issued');
      setShowLetterModal(false);
      setLetterForm({ title: '', description: '', issuedBy: '' });
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to issue letter'); }
  };

  if (profileLoading) return <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin text-brand-600 mx-auto" /></div>;

  return (
    <div className="space-y-6">
      {/* Intern Details Card */}
      <div className="layer-card p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <Briefcase size={15} className="text-purple-500" /> Internship Details
        </h3>
        {profile ? (
          <div className="grid md:grid-cols-2 gap-x-8 gap-y-3">
            <InfoRow label="College / University" value={profile.collegeUniversity || '—'} />
            <InfoRow label="Course" value={profile.course || '—'} />
            <InfoRow label="Specialization" value={profile.specialization || '—'} />
            <InfoRow label="Project Title" value={profile.projectTitle || '—'} />
            <InfoRow label="Internship Start" value={formatDate(profile.internshipStartDate, 'long')} />
            <InfoRow label="Internship End" value={formatDate(profile.internshipEndDate, 'long')} />
            <InfoRow label="Monthly Stipend" value={profile.stipend ? formatCurrency(Number(profile.stipend)) : '—'} mono />
            <InfoRow label="Mentor" value={profile.mentor ? `${profile.mentor.firstName} ${profile.mentor.lastName}` : '—'} />
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-4">No intern profile created yet</p>
        )}
      </div>

      {/* Achievement Letters */}
      <div className="layer-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <FileText size={15} className="text-emerald-500" /> Achievement Letters
          </h3>
          {isManagement && (
            <button onClick={() => setShowLetterModal(true)} className="btn-primary text-xs flex items-center gap-1">
              <Plus size={12} /> Issue Letter
            </button>
          )}
        </div>

        {lettersLoading ? (
          <div className="py-4 text-center"><Loader2 className="w-5 h-5 animate-spin text-brand-600 mx-auto" /></div>
        ) : letters.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No achievement letters issued yet</p>
        ) : (
          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left py-2.5 px-4 font-medium text-gray-500">Title</th>
                  <th className="text-left py-2.5 px-4 font-medium text-gray-500 hidden md:table-cell">Issued By</th>
                  <th className="text-left py-2.5 px-4 font-medium text-gray-500">Date</th>
                  <th className="text-right py-2.5 px-4 font-medium text-gray-500">Action</th>
                </tr>
              </thead>
              <tbody>
                {letters.map((letter: any) => (
                  <tr key={letter.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-2.5 px-4">
                      <p className="font-medium text-gray-800">{letter.title}</p>
                      {letter.description && <p className="text-xs text-gray-400 truncate max-w-xs">{letter.description}</p>}
                    </td>
                    <td className="py-2.5 px-4 text-gray-500 hidden md:table-cell">{letter.issuedBy}</td>
                    <td className="py-2.5 px-4 text-gray-500 font-mono text-xs" data-mono>{formatDate(letter.issuedAt)}</td>
                    <td className="py-2.5 px-4 text-right">
                      {letter.pdfUrl ? (
                        <a href={letter.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:text-brand-700 text-xs font-medium">
                          Download PDF
                        </a>
                      ) : (
                        <span className="text-xs text-gray-300">No PDF</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Issue Letter Modal */}
      <AnimatePresence>
        {showLetterModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setShowLetterModal(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4"
            >
              <h3 className="text-lg font-display font-semibold text-gray-800 mb-4">Issue Achievement Letter</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Title *</label>
                  <input value={letterForm.title} onChange={e => setLetterForm(f => ({ ...f, title: e.target.value }))}
                    className="input-glass w-full text-sm" placeholder="e.g. Outstanding Performance in Q1 Project" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Description</label>
                  <textarea value={letterForm.description} onChange={e => setLetterForm(f => ({ ...f, description: e.target.value }))}
                    className="input-glass w-full text-sm h-20 resize-none" placeholder="Details about the achievement..." />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Issued By</label>
                  <input value={letterForm.issuedBy} onChange={e => setLetterForm(f => ({ ...f, issuedBy: e.target.value }))}
                    className="input-glass w-full text-sm" placeholder="e.g. HR Manager" />
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={handleIssueLetter} disabled={issuing} className="btn-primary text-sm flex-1 flex items-center justify-center gap-2">
                  {issuing && <Loader2 size={14} className="animate-spin" />} Issue Letter
                </button>
                <button onClick={() => setShowLetterModal(false)} className="btn-secondary text-sm">Cancel</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------- Connections Cards with real data + popup ----------
function ConnectionsCards({ employeeId, records }: { employeeId: string; records: any[] }) {
  const { data: lifecycleRes } = useGetLifecycleEventsQuery(employeeId);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  const lifecycleEvents = lifecycleRes?.data || [];
  const attendanceCount = records.length;
  const leaveCount = records.filter((r: any) => r.status === 'ON_LEAVE').length;
  const lifecycleCount = lifecycleEvents.length;

  const cards = [
    { key: 'attendance', l: 'Attendance', c: 'bg-emerald-50', t: 'text-emerald-600', bc: 'border-emerald-200', i: Clock, n: attendanceCount },
    { key: 'leave', l: 'Leave Application', c: 'bg-purple-50', t: 'text-purple-600', bc: 'border-purple-200', i: Calendar, n: leaveCount },
    { key: 'lifecycle', l: 'Lifecycle', c: 'bg-blue-50', t: 'text-blue-600', bc: 'border-blue-200', i: Briefcase, n: lifecycleCount },
  ];

  return (
    <div className="layer-card p-5">
      <h3 className="text-sm font-semibold text-gray-800 mb-3">Connections</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map(card => (
          <div key={card.key}>
            <div className="bg-surface-2 rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg ${card.c} flex items-center justify-center`}><card.i size={16} className={card.t} /></div>
                <div><p className="text-sm font-medium text-gray-700">{card.l}</p><p className="text-xs text-gray-400">{card.n} records</p></div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold font-mono text-gray-500" data-mono>{card.n}</span>
                <button onClick={() => setExpandedCard(expandedCard === card.key ? null : card.key)}
                  className="w-6 h-6 rounded-md bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors">
                  <Plus size={12} className={`text-gray-500 transition-transform ${expandedCard === card.key ? 'rotate-45' : ''}`} />
                </button>
              </div>
            </div>
            <AnimatePresence>
              {expandedCard === card.key && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                  <div className={`mt-1 border ${card.bc} rounded-xl p-3 bg-white max-h-48 overflow-y-auto`}>
                    {card.key === 'attendance' && (records.length > 0 ? records.slice(0, 15).map((r: any, i: number) => (
                      <div key={i} className="flex justify-between text-xs py-1.5 border-b border-gray-50 last:border-0">
                        <span className="text-gray-600">{new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                        <span className={`font-medium ${r.status === 'PRESENT' ? 'text-emerald-600' : r.status === 'ABSENT' ? 'text-red-500' : r.status === 'ON_LEAVE' ? 'text-purple-500' : 'text-gray-500'}`}>{r.status?.replace('_', ' ')}</span>
                        <span className="text-gray-400 font-mono" data-mono>{r.totalHours ? `${Number(r.totalHours).toFixed(1)}h` : '—'}</span>
                      </div>
                    )) : <p className="text-xs text-gray-400 text-center py-2">No attendance records</p>)}
                    {card.key === 'leave' && (records.filter((r: any) => r.status === 'ON_LEAVE').length > 0
                      ? records.filter((r: any) => r.status === 'ON_LEAVE').slice(0, 10).map((r: any, i: number) => (
                        <div key={i} className="flex justify-between text-xs py-1.5 border-b border-gray-50 last:border-0">
                          <span className="text-gray-600">{new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
                          <span className="text-purple-600 font-medium">On Leave</span>
                        </div>
                      )) : <p className="text-xs text-gray-400 text-center py-2">No leave records</p>)}
                    {card.key === 'lifecycle' && (lifecycleEvents.length > 0 ? lifecycleEvents.map((ev: any) => (
                      <div key={ev.id} className="flex justify-between text-xs py-1.5 border-b border-gray-50 last:border-0">
                        <span className="text-gray-600">{ev.type?.replace('_', ' ')}</span>
                        <span className="text-gray-500">{new Date(ev.eventDate || ev.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                      </div>
                    )) : <p className="text-xs text-gray-400 text-center py-2">No lifecycle events</p>)}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </div>
  );
}
