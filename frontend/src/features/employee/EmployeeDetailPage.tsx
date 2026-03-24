import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Mail, Phone, MapPin, Calendar, Building2, Briefcase, FileText,
  Shield, Send, Copy, Check, Clock, DollarSign, User, ChevronLeft, ChevronRight,
  Plus, Heart, MessageSquare, Share2, Tag, Paperclip, Save, Loader2,
} from 'lucide-react';
import { useGetEmployeeQuery, useUpdateEmployeeMutation } from './employeeApi';
import { useCreateOnboardingInviteMutation } from '../onboarding/onboardingApi';
import { useGetEmployeeAttendanceQuery, useMarkAttendanceMutation } from '../attendance/attendanceApi';
import { useGetSalaryStructureQuery, useSaveSalaryStructureMutation } from '../payroll/payrollApi';
import { useUploadDocumentMutation, useVerifyDocumentMutation } from '../documents/documentApi';
import { useAppSelector } from '../../app/store';
import { getInitials, getStatusColor, formatDate, formatCurrency } from '../../lib/utils';
import toast from 'react-hot-toast';

const MANAGEMENT_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];
type TabKey = 'overview' | 'attendance' | 'personal' | 'salary' | 'documents' | 'connections';

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAppSelector((state) => state.auth.user);
  const { data: response, isLoading } = useGetEmployeeQuery(id!);
  const employee = response?.data;
  const [createInvite, { isLoading: inviting }] = useCreateOnboardingInviteMutation();
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('attendance');
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

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'attendance', label: 'Attendance & Leaves' },
    { key: 'salary', label: 'Salary' },
    { key: 'personal', label: 'Personal' },
    { key: 'documents', label: 'Documents' },
    { key: 'connections', label: 'Connections' },
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
            <button onClick={handleSendInvite} disabled={inviting} className="w-full btn-secondary text-xs py-2 flex items-center justify-center gap-1.5">
              <Send size={13} /> {inviting ? 'Sending...' : 'Send Onboarding Invite'}
            </button>
          </div>

          {inviteLink && (
            <div className="mt-3 p-2 bg-emerald-50 border border-emerald-200 rounded-lg">
              <div className="flex items-center gap-1">
                <p className="text-[10px] text-emerald-700 truncate flex-1 font-mono" data-mono>{inviteLink}</p>
                <button onClick={handleCopyLink} className="text-emerald-600 hover:text-emerald-800">
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          )}

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
              <EmployeeAttendanceTab employeeId={id!} employeeName={`${employee.firstName} ${employee.lastName}`} />
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

            {activeTab === 'connections' && (
              <div className="layer-card p-5">
                <h3 className="text-sm font-semibold text-gray-800 mb-4">Connections</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {[
                    { label: 'Attendance', color: 'bg-emerald-50', textColor: 'text-emerald-600', icon: Clock, count: '99+' },
                    { label: 'Attendance Request', color: 'bg-blue-50', textColor: 'text-blue-600', icon: FileText, count: 0 },
                    { label: 'Employee Checkin', color: 'bg-amber-50', textColor: 'text-amber-600', icon: MapPin, count: 0 },
                    { label: 'Leave Application', color: 'bg-purple-50', textColor: 'text-purple-600', icon: Calendar, count: 3 },
                    { label: 'Leave Allocation', color: 'bg-teal-50', textColor: 'text-teal-600', icon: DollarSign, count: 2 },
                    { label: 'Leave Policy Assignment', color: 'bg-orange-50', textColor: 'text-orange-600', icon: Shield, count: 0 },
                    { label: 'Employee Onboarding', color: 'bg-sky-50', textColor: 'text-sky-600', icon: Briefcase, count: 0 },
                    { label: 'Employee Transfer', color: 'bg-indigo-50', textColor: 'text-indigo-600', icon: ArrowLeft, count: 0 },
                    { label: 'Employee Promotion', color: 'bg-pink-50', textColor: 'text-pink-600', icon: ChevronRight, count: 0 },
                    { label: 'Shift Request', color: 'bg-rose-50', textColor: 'text-rose-600', icon: Clock, count: 0 },
                    { label: 'Employee Separation', color: 'bg-red-50', textColor: 'text-red-600', icon: User, count: 0 },
                    { label: 'Expense Claim', color: 'bg-green-50', textColor: 'text-green-600', icon: DollarSign, count: 1 },
                  ].map((card) => (
                    <div key={card.label} className="flex items-center justify-between p-3 bg-surface-2 rounded-xl hover:bg-gray-50 transition-colors cursor-pointer">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-7 h-7 rounded-lg ${card.color} flex items-center justify-center`}>
                          <card.icon size={14} className={card.textColor} />
                        </div>
                        <p className="text-xs font-medium text-gray-700">{card.label}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {card.count !== 0 && <span className="text-xs font-mono font-bold text-gray-500" data-mono>{card.count}</span>}
                        <button className="w-5 h-5 rounded bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-50">
                          <Plus size={10} className="text-gray-500" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
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
      <div className="layer-card p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">Connections</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { l: 'Attendance', c: 'bg-emerald-50', t: 'text-emerald-600', i: Clock, n: records.length || '99+' },
            { l: 'Leave Application', c: 'bg-purple-50', t: 'text-purple-600', i: Calendar, n: records.filter((r: any) => r.status === 'ON_LEAVE').length },
            { l: 'Lifecycle', c: 'bg-blue-50', t: 'text-blue-600', i: Briefcase, n: 0 },
          ].map(card => (
            <div key={card.l} className="bg-surface-2 rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg ${card.c} flex items-center justify-center`}><card.i size={16} className={card.t} /></div>
                <div><p className="text-sm font-medium text-gray-700">{card.l}</p><p className="text-xs text-gray-400">{card.n} records</p></div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold font-mono text-gray-500" data-mono>{card.n}</span>
                <button className="w-6 h-6 rounded-md bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-50"><Plus size={12} className="text-gray-500" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

/* =============================================================================
   Salary Tab — View & Edit Salary Structure
   ============================================================================= */

function SalaryTab({ employeeId, ctc, workMode, isManagement }: { employeeId: string; ctc: any; workMode: string; isManagement: boolean }) {
  const { data: salRes } = useGetSalaryStructureQuery(employeeId);
  const [saveSalary, { isLoading: saving }] = useSaveSalaryStructureMutation();
  const structure = salRes?.data;
  const [editing, setEditing] = useState(false);
  const [annualCtc, setAnnualCtc] = useState(ctc ? Number(ctc) : 0);

  // Auto-compute components from CTC
  const monthly = annualCtc / 12;
  const basic = monthly * 0.5;
  const hra = basic * 0.4;
  const da = monthly * 0.1;
  const ta = monthly * 0.05;
  const special = monthly - basic - hra - da - ta;

  // Deductions
  const epfEmployee = Math.min(basic, 15000) * 0.12;
  const esiEmployee = monthly <= 21000 ? monthly * 0.0075 : 0;
  const pt = monthly > 15000 ? 200 : monthly > 10000 ? 150 : 0;
  const totalDeductions = epfEmployee + esiEmployee + pt;
  const netMonthly = monthly - totalDeductions;

  const handleSave = async () => {
    try {
      await saveSalary({ employeeId, data: { ctc: annualCtc } }).unwrap();
      toast.success('Salary structure saved');
      setEditing(false);
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to save'); }
  };

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
          <p className="text-2xl font-bold font-mono text-brand-600" data-mono>{formatCurrency(Math.round(monthly))}</p>
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
            <SalaryRow label="Basic Salary (50%)" value={Math.round(basic)} />
            <SalaryRow label="HRA (40% of Basic)" value={Math.round(hra)} />
            <SalaryRow label="Dearness Allowance (10%)" value={Math.round(da)} />
            <SalaryRow label="Transport Allowance (5%)" value={Math.round(ta)} />
            <SalaryRow label="Special Allowance" value={Math.round(special)} />
            <div className="border-t border-gray-100 pt-2 mt-2">
              <SalaryRow label="Gross Monthly" value={Math.round(monthly)} bold />
            </div>
          </div>
        </div>
        <div className="layer-card p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">Deductions (Monthly)</h3>
          <div className="space-y-2.5">
            <SalaryRow label="EPF (Employee 12%)" value={Math.round(epfEmployee)} deduct />
            {esiEmployee > 0 && <SalaryRow label="ESI (Employee 0.75%)" value={Math.round(esiEmployee)} deduct />}
            <SalaryRow label="Professional Tax" value={pt} deduct />
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
              <button onClick={() => { setEditing(false); setAnnualCtc(ctc ? Number(ctc) : 0); }} className="btn-secondary text-sm">Cancel</button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="btn-primary text-sm flex items-center gap-1.5">
              <DollarSign size={14} /> Edit Salary Structure
            </button>
          )}
        </div>
      )}

      {/* Existing structure from DB */}
      {structure && (
        <div className="layer-card p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">Saved Structure</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            {Object.entries(structure).filter(([k]) => !['id', 'employeeId', 'createdAt', 'updatedAt', 'organizationId'].includes(k)).map(([key, val]) => (
              <div key={key}>
                <p className="text-xs text-gray-400 capitalize">{key.replace(/([A-Z])/g, ' $1')}</p>
                <p className="font-mono text-gray-700" data-mono>{val != null ? formatCurrency(Number(val)) : '—'}</p>
              </div>
            ))}
          </div>
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
  const [showUpload, setShowUpload] = useState(false);
  const [docName, setDocName] = useState('');
  const [docType, setDocType] = useState('OTHER');
  const fileRef = useRef<HTMLInputElement>(null);

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
        <button onClick={() => setShowUpload(!showUpload)} className="btn-primary text-xs flex items-center gap-1.5">
          <Plus size={14} /> Upload Document
        </button>
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
          {documents.map((doc: any) => (
            <div key={doc.id} className="layer-card p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-sm font-medium text-gray-800">{doc.name}</p>
                  <p className="text-xs text-gray-400">{doc.type?.replace(/_/g, ' ')} · {formatDate(doc.createdAt)}</p>
                </div>
                <span className={`badge ${getStatusColor(doc.status)} text-xs`}>{doc.status}</span>
              </div>
              {doc.fileUrl && (
                <a href={`${API_URL}${doc.fileUrl}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1 mb-2">
                  <FileText size={12} /> View Document
                </a>
              )}
              {isManagement && doc.status === 'PENDING' && (
                <div className="flex gap-2 mt-2 pt-2 border-t border-gray-50">
                  <button onClick={() => handleVerify(doc.id, 'VERIFIED')} className="text-xs text-emerald-600 hover:bg-emerald-50 px-2 py-1 rounded-lg">Verify</button>
                  <button onClick={() => handleVerify(doc.id, 'REJECTED')} className="text-xs text-red-500 hover:bg-red-50 px-2 py-1 rounded-lg">Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="layer-card p-12 text-center">
          <FileText size={32} className="text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No documents uploaded yet</p>
          <p className="text-xs text-gray-300 mt-1">Click "Upload Document" to add files</p>
        </div>
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
