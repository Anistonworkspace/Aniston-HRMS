import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Mail, Phone, MapPin, Calendar, Building2, Briefcase, FileText, Shield, Send, Copy, Check, Clock, DollarSign, User, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useGetEmployeeQuery, useUpdateEmployeeMutation } from './employeeApi';
import { useCreateOnboardingInviteMutation } from '../onboarding/onboardingApi';
import { useGetEmployeeAttendanceQuery, useMarkAttendanceMutation } from '../attendance/attendanceApi';
import { useAppSelector } from '../../app/store';
import { getInitials, getStatusColor, formatDate, formatCurrency } from '../../lib/utils';
import toast from 'react-hot-toast';

const MANAGEMENT_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAppSelector((state) => state.auth.user);
  const isManagement = MANAGEMENT_ROLES.includes(user?.role || '');
  const { data: response, isLoading } = useGetEmployeeQuery(id!);
  const employee = response?.data;
  const [createInvite, { isLoading: inviting }] = useCreateOnboardingInviteMutation();
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'attendance' | 'documents' | 'payroll'>(
    MANAGEMENT_ROLES.includes(user?.role || '') ? 'attendance' : 'overview'
  );
  const [showEditModal, setShowEditModal] = useState(false);
  const [updateEmployee] = useUpdateEmployeeMutation();

  const handleSendInvite = async () => {
    try {
      const result = await createInvite(id!).unwrap();
      const link = `${window.location.origin}${result.data.inviteUrl}`;
      setInviteLink(link);
      toast.success('Onboarding invite sent!');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to send invite');
    }
  };

  const handleCopyLink = () => {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Link copied!');
    }
  };

  if (isLoading) {
    return (
      <div className="page-container">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-48 bg-gray-100 rounded" />
          <div className="layer-card p-6 space-y-4">
            <div className="flex gap-4">
              <div className="w-20 h-20 rounded-xl bg-gray-100" />
              <div className="space-y-3 flex-1">
                <div className="h-5 w-40 bg-gray-100 rounded" />
                <div className="h-4 w-56 bg-gray-50 rounded" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="page-container">
        <div className="layer-card p-12 text-center">
          <p className="text-gray-500">Employee not found</p>
          <button onClick={() => navigate('/employees')} className="btn-primary mt-4">
            Back to Employees
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Back button */}
      <button
        onClick={() => navigate('/employees')}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 mb-4 transition-colors"
      >
        <ArrowLeft size={16} />
        Back to Employees
      </button>

      {/* Profile header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="layer-card p-6 mb-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-start gap-5">
          <div className="w-20 h-20 rounded-xl bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-2xl font-display flex-shrink-0">
            {getInitials(employee.firstName, employee.lastName)}
          </div>
          <div className="flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <h1 className="text-xl font-display font-bold text-gray-900">
                {employee.firstName} {employee.lastName}
              </h1>
              <span className={`badge ${getStatusColor(employee.status)}`}>
                {employee.status}
              </span>
            </div>
            <p className="text-gray-500 text-sm mt-0.5">
              {employee.designation?.name || 'No designation'} · {employee.department?.name || 'No department'}
            </p>
            <p className="text-gray-400 text-xs font-mono mt-1" data-mono>
              {employee.employeeCode}
            </p>

            <div className="flex flex-wrap gap-4 mt-4 text-sm text-gray-500">
              <span className="flex items-center gap-1.5">
                <Mail size={14} className="text-gray-400" />
                {employee.email}
              </span>
              <span className="flex items-center gap-1.5">
                <Phone size={14} className="text-gray-400" />
                {employee.phone}
              </span>
              <span className="flex items-center gap-1.5">
                <Calendar size={14} className="text-gray-400" />
                Joined {formatDate(employee.joiningDate, 'long')}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSendInvite} disabled={inviting}
              className="btn-secondary text-sm flex items-center gap-1.5">
              <Send size={14} /> {inviting ? 'Sending...' : 'Send Onboarding Invite'}
            </button>
            <button onClick={() => setShowEditModal(true)} className="btn-primary text-sm">Edit Profile</button>
          </div>
          {inviteLink && (
            <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 w-full">
              <p className="text-xs text-emerald-700 truncate flex-1 font-mono" data-mono>{inviteLink}</p>
              <button onClick={handleCopyLink} className="text-emerald-600 hover:text-emerald-800 flex-shrink-0">
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          )}
        </div>
      </motion.div>

      {/* Tabs for management roles */}
      {isManagement && (
        <div className="flex gap-1 mb-6 border-b border-gray-100">
          {[
            { key: 'attendance' as const, label: 'Attendance & Leaves', icon: Clock },
            { key: 'overview' as const, label: 'Overview', icon: User },
            { key: 'documents' as const, label: 'Documents', icon: FileText },
            { key: 'payroll' as const, label: 'Salary', icon: DollarSign },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
                ${activeTab === tab.key
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Tab: Attendance (HR only) */}
      {isManagement && activeTab === 'attendance' && (
        <EmployeeAttendanceTab employeeId={id!} employeeName={`${employee.firstName} ${employee.lastName}`} />
      )}

      {/* Tab: Documents (HR only — full-width view) */}
      {isManagement && activeTab === 'documents' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="layer-card p-6">
          <h2 className="text-lg font-display font-bold text-gray-900 mb-4">Documents ({employee.documents?.length || 0})</h2>
          {employee.documents && employee.documents.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-3">
              {employee.documents.map((doc: any) => (
                <div key={doc.id} className="flex items-center justify-between p-4 bg-surface-2 rounded-xl">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{doc.name}</p>
                    <p className="text-xs text-gray-400">{doc.type} · Uploaded {formatDate(doc.createdAt)}</p>
                  </div>
                  <span className={`badge ${getStatusColor(doc.status)} text-xs`}>{doc.status}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-12">No documents uploaded yet</p>
          )}
        </motion.div>
      )}

      {/* Tab: Payroll (HR only) */}
      {isManagement && activeTab === 'payroll' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="layer-card p-6">
          <h2 className="text-lg font-display font-bold text-gray-900 mb-4">Salary & Payroll</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-4 bg-surface-2 rounded-xl">
              <p className="text-xs text-gray-400 mb-1">CTC (Annual)</p>
              <p className="text-xl font-bold font-mono text-gray-900" data-mono>
                {employee.ctc ? formatCurrency(Number(employee.ctc)) : '—'}
              </p>
            </div>
            <div className="p-4 bg-surface-2 rounded-xl">
              <p className="text-xs text-gray-400 mb-1">Work Mode</p>
              <p className="text-xl font-bold text-gray-900">{employee.workMode?.replace(/_/g, ' ') || 'OFFICE'}</p>
            </div>
            <div className="p-4 bg-surface-2 rounded-xl">
              <p className="text-xs text-gray-400 mb-1">Department</p>
              <p className="text-lg font-medium text-gray-900">{employee.department?.name || '—'}</p>
            </div>
            <div className="p-4 bg-surface-2 rounded-xl">
              <p className="text-xs text-gray-400 mb-1">Designation</p>
              <p className="text-lg font-medium text-gray-900">{employee.designation?.name || '—'}</p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Tab: Overview (default) — Info cards grid */}
      {(!isManagement || activeTab === 'overview') && (
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Personal Info */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="layer-card p-6"
        >
          <h2 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Shield size={16} className="text-brand-500" />
            Personal Information
          </h2>
          <dl className="space-y-3">
            <InfoRow label="Gender" value={employee.gender} />
            <InfoRow label="Date of Birth" value={employee.dateOfBirth ? formatDate(employee.dateOfBirth) : '—'} />
            <InfoRow label="Blood Group" value={employee.bloodGroup || '—'} />
            <InfoRow label="Marital Status" value={employee.maritalStatus || '—'} />
            <InfoRow label="Personal Email" value={employee.personalEmail || '—'} />
          </dl>
        </motion.div>

        {/* Employment Info */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="layer-card p-6"
        >
          <h2 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Building2 size={16} className="text-purple-500" />
            Employment Details
          </h2>
          <dl className="space-y-3">
            <InfoRow label="Department" value={employee.department?.name || '—'} />
            <InfoRow label="Designation" value={employee.designation?.name || '—'} />
            <InfoRow label="Work Mode" value={employee.workMode?.replace('_', ' ')} />
            <InfoRow label="Reports To" value={employee.manager ? `${employee.manager.firstName} ${employee.manager.lastName}` : '—'} />
            <InfoRow label="Office" value={employee.officeLocation?.name || '—'} />
            {employee.ctc && (
              <InfoRow label="CTC" value={formatCurrency(Number(employee.ctc))} mono />
            )}
          </dl>
        </motion.div>

        {/* Documents */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="layer-card p-6"
        >
          <h2 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <FileText size={16} className="text-amber-500" />
            Documents ({employee.documents?.length || 0})
          </h2>
          {employee.documents && employee.documents.length > 0 ? (
            <div className="space-y-2">
              {employee.documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between py-2 px-3 bg-surface-2 rounded-lg"
                >
                  <div>
                    <p className="text-sm text-gray-700">{doc.name}</p>
                    <p className="text-xs text-gray-400">{doc.type}</p>
                  </div>
                  <span className={`badge ${getStatusColor(doc.status)} text-xs`}>
                    {doc.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-6">No documents uploaded</p>
          )}
        </motion.div>

        {/* Emergency Contact */}
        {employee.emergencyContact && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="layer-card p-6"
          >
            <h2 className="text-sm font-semibold text-gray-800 mb-4">🆘 Emergency Contact</h2>
            <dl className="space-y-3">
              <InfoRow label="Name" value={(employee.emergencyContact as any).name} />
              <InfoRow label="Relationship" value={(employee.emergencyContact as any).relationship} />
              <InfoRow label="Phone" value={(employee.emergencyContact as any).phone} />
            </dl>
          </motion.div>
        )}
      </div>
      )}

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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-glass-lg w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-display font-semibold text-gray-800">Edit Employee</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-400">✕</button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSave(form); }} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">First Name</label>
              <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="input-glass w-full text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Last Name</label>
              <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="input-glass w-full text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input-glass w-full text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Phone</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input-glass w-full text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Gender</label>
              <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} className="input-glass w-full text-sm">
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
                <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date of Birth</label>
              <input type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} className="input-glass w-full text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Blood Group</label>
              <input value={form.bloodGroup} onChange={(e) => setForm({ ...form, bloodGroup: e.target.value })} className="input-glass w-full text-sm" placeholder="e.g. O+" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Work Mode</label>
              <select value={form.workMode} onChange={(e) => setForm({ ...form, workMode: e.target.value })} className="input-glass w-full text-sm">
                <option value="OFFICE">Office</option>
                <option value="HYBRID">Hybrid</option>
                <option value="REMOTE">Remote</option>
                <option value="FIELD_SALES">Field Sales</option>
                <option value="PROJECT_SITE">Project Site</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Joining Date</label>
              <input type="date" value={form.joiningDate} onChange={(e) => setForm({ ...form, joiningDate: e.target.value })} className="input-glass w-full text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="input-glass w-full text-sm">
                <option value="ACTIVE">Active</option>
                <option value="PROBATION">Probation</option>
                <option value="NOTICE_PERIOD">Notice Period</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Personal Email</label>
              <input value={form.personalEmail} onChange={(e) => setForm({ ...form, personalEmail: e.target.value })} className="input-glass w-full text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">CTC (Annual, INR)</label>
              <input type="number" value={form.ctc} onChange={(e) => setForm({ ...form, ctc: e.target.value ? Number(e.target.value) : '' })} className="input-glass w-full text-sm" />
            </div>
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
  PRESENT: '#22c55e',
  ABSENT: '#ef4444',
  HALF_DAY: '#f59e0b',
  HOLIDAY: '#3b82f6',
  WEEKEND: '#d1d5db',
  ON_LEAVE: '#a855f7',
  WORK_FROM_HOME: '#22c55e',
};

const STATUS_LABELS: Record<string, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  HALF_DAY: 'Half Day',
  HOLIDAY: 'Holiday',
  WEEKEND: 'Weekend',
  ON_LEAVE: 'On Leave',
  WORK_FROM_HOME: 'WFH',
};

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getWeeksForYear(year: number) {
  // Build a grid: rows = 7 days (Mon-Sun), columns = weeks
  const jan1 = new Date(year, 0, 1);
  const dec31 = new Date(year, 11, 31);

  // Find first Monday on or before Jan 1
  const startDay = jan1.getDay(); // 0=Sun
  const mondayOffset = startDay === 0 ? -6 : 1 - startDay;
  const firstMonday = new Date(year, 0, 1 + mondayOffset);

  const weeks: Date[][] = [];
  let current = new Date(firstMonday);

  while (current <= dec31 || weeks.length < 53) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    weeks.push(week);
    if (current > dec31 && weeks.length >= 52) break;
  }

  return weeks;
}

function getMonthPositions(weeks: Date[][], year: number) {
  const positions: { label: string; col: number }[] = [];
  let lastMonth = -1;
  weeks.forEach((week, i) => {
    // Use Thursday of the week to determine month (ISO week convention)
    const thu = week[3];
    if (thu && thu.getFullYear() === year && thu.getMonth() !== lastMonth) {
      lastMonth = thu.getMonth();
      positions.push({ label: MONTH_LABELS[lastMonth], col: i });
    }
  });
  return positions;
}

function EmployeeAttendanceTab({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [popupCell, setPopupCell] = useState<{ date: string; x: number; y: number } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const startDate = `${selectedYear}-01-01`;
  const endDate = `${selectedYear}-12-31`;

  const { data: response, isLoading } = useGetEmployeeAttendanceQuery({ employeeId, startDate, endDate });
  const [markAttendance, { isLoading: marking }] = useMarkAttendanceMutation();

  const records = response?.data?.records || [];
  const summary = response?.data?.summary;

  // Build a date->status map
  const dateStatusMap = useMemo(() => {
    const map: Record<string, string> = {};
    records.forEach((r: any) => {
      const dateKey = r.date?.split('T')[0];
      if (dateKey) map[dateKey] = r.status;
    });
    return map;
  }, [records]);

  // Build weeks grid
  const weeks = useMemo(() => getWeeksForYear(selectedYear), [selectedYear]);
  const monthPositions = useMemo(() => getMonthPositions(weeks, selectedYear), [weeks, selectedYear]);

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const getDateStatus = useCallback((date: Date): string | null => {
    const dateStr = date.toISOString().split('T')[0];
    if (date.getFullYear() !== selectedYear) return null;
    if (dateStr > todayStr) return null; // future
    if (dateStatusMap[dateStr]) return dateStatusMap[dateStr];
    // Check if weekend (Sat=5, Sun=6 in our Mon-indexed grid)
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) return 'WEEKEND';
    return null;
  }, [dateStatusMap, selectedYear, todayStr]);

  const getCellColor = (date: Date): string => {
    const status = getDateStatus(date);
    if (!status) return '#f3f4f6'; // light gray for no data / future
    return STATUS_COLORS[status] || '#f3f4f6';
  };

  const handleCellClick = (date: Date, e: React.MouseEvent) => {
    const dateStr = date.toISOString().split('T')[0];
    if (date.getFullYear() !== selectedYear) return;
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
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to mark attendance');
    }
  };

  // Close popup on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setPopupCell(null);
      }
    };
    if (popupCell) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [popupCell]);

  // Count records by status
  const attendanceCount = records.length;
  const leaveCount = records.filter((r: any) => r.status === 'ON_LEAVE').length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      {/* Year selector & summary */}
      <div className="layer-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold text-gray-900">{employeeName} — Attendance</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedYear((y) => y - 1)}
              className="p-1.5 hover:bg-surface-2 rounded-lg transition-colors"
            >
              <ChevronLeft size={16} className="text-gray-500" />
            </button>
            <span className="text-sm font-bold font-mono text-gray-800 min-w-[4ch] text-center" data-mono>
              {selectedYear}
            </span>
            <button
              onClick={() => setSelectedYear((y) => Math.min(y + 1, currentYear))}
              disabled={selectedYear >= currentYear}
              className="p-1.5 hover:bg-surface-2 rounded-lg transition-colors disabled:opacity-30"
            >
              <ChevronRight size={16} className="text-gray-500" />
            </button>
          </div>
        </div>

        {/* Summary stats row */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-5">
            <div className="stat-card text-center py-3">
              <p className="text-xl font-bold font-mono text-emerald-600" data-mono>{summary.present || 0}</p>
              <p className="text-[11px] text-gray-400">Present</p>
            </div>
            <div className="stat-card text-center py-3">
              <p className="text-xl font-bold font-mono text-red-500" data-mono>{summary.absent || 0}</p>
              <p className="text-[11px] text-gray-400">Absent</p>
            </div>
            <div className="stat-card text-center py-3">
              <p className="text-xl font-bold font-mono text-amber-500" data-mono>{summary.halfDay || 0}</p>
              <p className="text-[11px] text-gray-400">Half Day</p>
            </div>
            <div className="stat-card text-center py-3">
              <p className="text-xl font-bold font-mono text-purple-500" data-mono>{summary.onLeave || 0}</p>
              <p className="text-[11px] text-gray-400">On Leave</p>
            </div>
            <div className="stat-card text-center py-3">
              <p className="text-xl font-bold font-mono text-blue-500" data-mono>{summary.holidays || 0}</p>
              <p className="text-[11px] text-gray-400">Holidays</p>
            </div>
            <div className="stat-card text-center py-3">
              <p className="text-xl font-bold font-mono text-brand-600" data-mono>{summary.averageHours?.toFixed(1) || '0'}h</p>
              <p className="text-[11px] text-gray-400">Avg Hours</p>
            </div>
          </div>
        )}

        {/* Contribution calendar */}
        {isLoading ? (
          <div className="text-center py-12">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-400 mt-2">Loading attendance data...</p>
          </div>
        ) : (
          <div className="overflow-x-auto pb-2">
            <div className="inline-block">
              {/* Month labels */}
              <div className="flex ml-8 mb-1">
                {monthPositions.map((mp, i) => (
                  <div
                    key={i}
                    className="text-[10px] text-gray-400 font-medium uppercase"
                    style={{
                      position: 'relative',
                      left: `${mp.col * 15}px`,
                      marginRight: i < monthPositions.length - 1
                        ? `${(monthPositions[i + 1].col - mp.col) * 15 - 28}px`
                        : 0,
                    }}
                  >
                    {mp.label}
                  </div>
                ))}
              </div>

              {/* Grid: rows = days of week, cols = weeks */}
              <div className="flex gap-0">
                {/* Day labels column */}
                <div className="flex flex-col gap-[3px] mr-1.5 pt-0">
                  {DAY_LABELS.map((label, i) => (
                    <div key={label} className="h-[12px] flex items-center">
                      {i % 2 === 0 ? (
                        <span className="text-[9px] text-gray-400 w-6 text-right">{label}</span>
                      ) : (
                        <span className="w-6" />
                      )}
                    </div>
                  ))}
                </div>

                {/* Week columns */}
                {weeks.map((week, wi) => (
                  <div key={wi} className="flex flex-col gap-[3px]">
                    {week.map((date, di) => {
                      const dateStr = date.toISOString().split('T')[0];
                      const isCurrentYear = date.getFullYear() === selectedYear;
                      const status = getDateStatus(date);
                      const color = getCellColor(date);
                      return (
                        <div
                          key={di}
                          onClick={(e) => isCurrentYear && handleCellClick(date, e)}
                          className="rounded-[2px] transition-all duration-100 hover:ring-1 hover:ring-gray-400"
                          style={{
                            width: 12,
                            height: 12,
                            backgroundColor: isCurrentYear ? color : 'transparent',
                            cursor: isCurrentYear && dateStr <= todayStr ? 'pointer' : 'default',
                            opacity: isCurrentYear ? 1 : 0,
                          }}
                          title={isCurrentYear ? `${dateStr}: ${status ? STATUS_LABELS[status] || status : 'No record'}` : ''}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Legend */}
              <div className="flex items-center gap-3 mt-3 ml-8">
                <span className="text-[10px] text-gray-400">Less</span>
                {[
                  { color: '#f3f4f6', label: 'No data' },
                  { color: STATUS_COLORS.PRESENT, label: 'Present' },
                  { color: STATUS_COLORS.ABSENT, label: 'Absent' },
                  { color: STATUS_COLORS.HALF_DAY, label: 'Half Day' },
                  { color: STATUS_COLORS.ON_LEAVE, label: 'Leave' },
                  { color: STATUS_COLORS.HOLIDAY, label: 'Holiday' },
                  { color: STATUS_COLORS.WEEKEND, label: 'Weekend' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-1">
                    <div
                      className="w-[10px] h-[10px] rounded-[2px]"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-[9px] text-gray-400">{item.label}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-300 mt-2 ml-8 italic">
                This is based on the attendance of this Employee
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Mark attendance popup */}
      <AnimatePresence>
        {popupCell && (
          <motion.div
            ref={popupRef}
            initial={{ opacity: 0, scale: 0.9, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -4 }}
            transition={{ duration: 0.15 }}
            className="fixed z-50 bg-white rounded-xl shadow-glass-lg border border-gray-100 p-2 min-w-[160px]"
            style={{ left: Math.min(popupCell.x, window.innerWidth - 200), top: popupCell.y }}
          >
            <p className="text-[10px] text-gray-400 px-2 py-1 font-medium">
              Mark {popupCell.date}
            </p>
            {[
              { status: 'PRESENT', label: 'Present', color: STATUS_COLORS.PRESENT },
              { status: 'ABSENT', label: 'Absent', color: STATUS_COLORS.ABSENT },
              { status: 'HALF_DAY', label: 'Half Day', color: STATUS_COLORS.HALF_DAY },
              { status: 'ON_LEAVE', label: 'On Leave', color: STATUS_COLORS.ON_LEAVE },
            ].map((opt) => (
              <button
                key={opt.status}
                onClick={() => handleMarkStatus(opt.status)}
                disabled={marking}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-sm text-gray-700 hover:bg-surface-2 transition-colors text-left"
              >
                <div
                  className="w-3 h-3 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: opt.color }}
                />
                {opt.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Connections section (ERPNext-style) */}
      <div className="layer-card p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">Connections</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Attendance */}
          <div className="bg-surface-2 rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                <Clock size={16} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">Attendance</p>
                <p className="text-xs text-gray-400">{attendanceCount} records</p>
              </div>
            </div>
            <span className="text-lg font-bold font-mono text-emerald-600" data-mono>{attendanceCount}</span>
          </div>

          {/* Leave Application */}
          <div className="bg-surface-2 rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
                <Calendar size={16} className="text-purple-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">Leave Application</p>
                <p className="text-xs text-gray-400">{leaveCount} records</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold font-mono text-purple-600" data-mono>{leaveCount}</span>
              <button className="w-6 h-6 rounded-md bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors">
                <Plus size={12} className="text-gray-500" />
              </button>
            </div>
          </div>

          {/* Lifecycle */}
          <div className="bg-surface-2 rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <Briefcase size={16} className="text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">Lifecycle</p>
                <p className="text-xs text-gray-400">Events</p>
              </div>
            </div>
            <button className="w-6 h-6 rounded-md bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors">
              <Plus size={12} className="text-gray-500" />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start">
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className={`text-sm text-gray-700 text-right ${mono ? 'font-mono' : ''}`} data-mono={mono || undefined}>
        {value}
      </dd>
    </div>
  );
}
