import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import 'leaflet/dist/leaflet.css';
import {
  ArrowLeft, ArrowRight, Mail, Phone, MapPin, Calendar, Building2, Briefcase, FileText,
  Shield, Check, Clock, DollarSign, User, ChevronLeft, ChevronRight,
  Plus, Heart, MessageSquare, Share2, Tag, Paperclip, Save, Loader2, Send, XCircle, Award, Download, Copy, X, Eye, Trash2, Upload,
} from 'lucide-react';
import { useGetEmployeeQuery, useUpdateEmployeeMutation, useAddLifecycleEventMutation, useDeleteLifecycleEventMutation, useSendActivationInviteMutation, useGetLifecycleEventsQuery, useChangeEmployeeRoleMutation } from './employeeApi';
import { useGetEmployeeAttendanceQuery, useMarkAttendanceMutation, useSubmitRegularizationMutation, useGetHybridScheduleQuery } from '../attendance/attendanceApi';
import { useGetHolidaysQuery } from '../leaves/leaveApi';
import { useGetSalaryStructureQuery, useSaveSalaryStructureMutation, useGetSalaryHistoryQuery, useSaveSalaryStructureDynamicMutation } from '../payroll/payrollApi';
import { useGetComponentsQuery } from '../payroll/componentMasterApi';
import { useGetSalaryTemplatesQuery } from '../payroll/salaryTemplateApi';
import { useUploadDocumentMutation, useVerifyDocumentMutation, useDeleteDocumentMutation } from '../documents/documentApi';
// Letter issuance moved to Policies module
import { useGetInternProfileQuery, useGetAchievementLettersQuery, useIssueAchievementLetterMutation } from '../intern/internApi';
import { useGetShiftsQuery, useAssignShiftMutation, useGetEmployeeShiftQuery } from '../workforce/workforceApi';
import PermissionOverridePanel from '../permissions/PermissionOverridePanel';
import OcrVerificationPanel from '../documents/OcrVerificationPanel';
import { useGetEmployeeOcrSummaryQuery } from '../documents/documentOcrApi';
import { useVerifyKycMutation } from '../kyc/kycApi';
import { useGetDepartmentsQuery, useGetDesignationsQuery, useGetManagersQuery, useGetOfficeLocationsQuery } from './employeeDepsApi';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { useAppSelector } from '../../app/store';
import { getInitials, getStatusColor, formatDate, formatCurrency, getUploadUrl } from '../../lib/utils';
import toast from 'react-hot-toast';

const MANAGEMENT_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];
type TabKey = 'overview' | 'attendance' | 'salary' | 'documents' | 'connections' | 'intern' | 'permissions';

export default function EmployeeDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAppSelector((state) => state.auth.user);
  const { data: response, isLoading } = useGetEmployeeQuery(id!);
  const employee = response?.data;
  const [activeTab, setActiveTab] = useState<TabKey>('attendance');
  const [showEditModal, setShowEditModal] = useState(false);
  const [updateEmployee] = useUpdateEmployeeMutation();
  const [sendActivationInvite, { isLoading: sendingInvite }] = useSendActivationInviteMutation();

  const [searchParams, setSearchParams] = useSearchParams();
  const [avatarError, setAvatarError] = useState(false);
  const [showAttachmentsPopup, setShowAttachmentsPopup] = useState(false);
  const [showTagsPopup, setShowTagsPopup] = useState(false);

  const isManagement = MANAGEMENT_ROLES.includes(user?.role || '');
  const isTeamsSynced = !!(employee?.user as any)?.microsoftId;
  const hasNotLoggedIn = !employee?.user?.lastLoginAt;
  const showActivationButton = isManagement && isTeamsSynced && hasNotLoggedIn;

  // Auto-open edit modal when navigated with ?edit=true
  useEffect(() => {
    if (searchParams.get('edit') === 'true' && employee && isManagement) {
      setShowEditModal(true);
      searchParams.delete('edit');
      setSearchParams(searchParams, { replace: true });
    }
  }, [employee, searchParams, isManagement, setSearchParams]);

  // Profile completion for sidebar
  const profileCompletion = useMemo(() => {
    if (!employee) return { items: [], pct: 0 };
    const items = [
      { label: t('employees.completionPersonal'), done: !!(employee.dateOfBirth && employee.gender) },
      { label: t('employees.completionEmergency'), done: !!employee.emergencyContact },
      { label: t('employees.completionDept'), done: !!(employee.department && employee.designation) },
      { label: t('employees.completionDocuments'), done: (employee.documents?.length || 0) >= 3 },
      { label: t('employees.completionBank'), done: !!employee.bankAccountNumber },
    ];
    const pct = Math.round((items.filter(i => i.done).length / items.length) * 100);
    return { items, pct };
  }, [employee]);

  const handleShareProfile = () => {
    navigator.clipboard.writeText(window.location.href);
    toast.success('Profile link copied to clipboard');
  };

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
          <h2 className="text-lg font-display font-bold text-gray-600">{t('employees.notFound')}</h2>
          <button onClick={() => navigate('/employees')} className="mt-4 btn-primary text-sm">{t('employees.backToEmployees')}</button>
        </div>
      </div>
    );
  }

  const isIntern = employee?.user?.role === 'INTERN';
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: t('employees.overview') },
    { key: 'attendance', label: t('employees.attendanceLeaves') },
    ...(isManagement ? [{ key: 'salary' as TabKey, label: t('employees.salary') }] : []),
    { key: 'documents', label: t('employees.documents') },
    ...(isIntern ? [{ key: 'intern' as TabKey, label: t('employees.internProfile') }] : []),
    { key: 'connections', label: t('employees.connections') },
    ...(isManagement ? [{ key: 'permissions' as TabKey, label: t('employees.permissions') }] : []),
  ];

  return (
    <div className="min-h-screen bg-surface-1">
      {/* Top breadcrumb bar */}
      <div className="bg-white border-b border-gray-100 px-6 py-3">
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => navigate('/employees')} className="text-gray-400 hover:text-brand-600 transition-colors flex items-center gap-1">
            <ArrowLeft size={14} /> {t('employees.breadcrumb')}
          </button>
          <ChevronRight size={14} className="text-gray-300" />
          <span className="text-gray-800 font-medium font-mono" data-mono>{employee.employeeCode}</span>
        </div>
      </div>

      {/* Main content — 2-column layout */}
      <div className="flex gap-0 h-[calc(100dvh-49px)]">
        {/* Left sidebar — Profile card */}
        <div className="w-64 shrink-0 border-r border-gray-100 bg-white p-5 overflow-y-auto hidden lg:block">
          <div className="flex flex-col items-center mb-5">
            <div className="w-24 h-24 rounded-xl bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-3xl font-display mb-3 overflow-hidden">
              {employee.avatar && !avatarError ? (
                <img
                  src={getUploadUrl(employee.avatar)}
                  alt={`${employee.firstName} ${employee.lastName}`}
                  className="w-full h-full object-cover"
                  onError={() => setAvatarError(true)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  {getInitials(employee.firstName, employee.lastName)}
                </div>
              )}
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

          {/* Profile Completion Bar */}
          {profileCompletion.pct < 100 && (
            <div className="mt-5 border-t border-gray-100 pt-4">
              <h4 className="text-[11px] font-semibold text-gray-600 mb-2">{t('profile.profileCompletion')}</h4>
              <div className="space-y-1.5">
                {profileCompletion.items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-[11px]">
                    <span className="text-gray-500">{item.label}</span>
                    <span className={item.done ? 'text-emerald-600 font-medium' : 'text-amber-500'}>
                      {item.done ? '✓ Complete' : '○ Pending'}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${profileCompletion.pct >= 60 ? 'bg-emerald-500' : profileCompletion.pct >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                  style={{ width: `${profileCompletion.pct}%` }}
                />
              </div>
              <p className="text-[10px] text-gray-400 mt-1">{profileCompletion.pct}% complete</p>
            </div>
          )}

          <div className="mt-5 border-t border-gray-100 pt-4 space-y-2">
            <SidebarMeta icon={Paperclip} label="Attachments" count={employee.documents?.length || 0} onClick={() => setShowAttachmentsPopup(true)} />
            <SidebarMeta icon={Tag} label="Tags" onClick={() => setShowTagsPopup(true)} />
            <SidebarMeta icon={Share2} label="Share" onClick={handleShareProfile} />
          </div>

          {/* Attachments Popup */}
          <AnimatePresence>
            {showAttachmentsPopup && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                onClick={() => setShowAttachmentsPopup(false)}>
                <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
                  onClick={e => e.stopPropagation()}
                  className="bg-white rounded-xl shadow-glass-lg w-full max-w-md p-5 max-h-[70vh] overflow-y-auto">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2"><Paperclip size={15} /> Attachments</h3>
                    <button onClick={() => setShowAttachmentsPopup(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={16} className="text-gray-400" /></button>
                  </div>
                  {(employee.documents?.length || 0) === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-6">No documents uploaded yet</p>
                  ) : (
                    <div className="space-y-2">
                      {employee.documents?.map((doc: any) => (
                        <div key={doc.id} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <FileText size={16} className="text-brand-500 flex-shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-gray-700 truncate">{doc.name || doc.type?.replace(/_/g, ' ')}</p>
                              <p className="text-[10px] text-gray-400">{doc.createdAt ? formatDate(doc.createdAt) : ''}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {doc.status === 'VERIFIED' && <Check size={14} className="text-emerald-500" />}
                            {doc.fileUrl && (
                              <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="p-1 hover:bg-gray-200 rounded">
                                <Eye size={14} className="text-gray-500" />
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Tags Popup */}
          <AnimatePresence>
            {showTagsPopup && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                onClick={() => setShowTagsPopup(false)}>
                <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
                  onClick={e => e.stopPropagation()}
                  className="bg-white rounded-xl shadow-glass-lg w-full max-w-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2"><Tag size={15} /> Tags</h3>
                    <button onClick={() => setShowTagsPopup(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={16} className="text-gray-400" /></button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {employee.department && <span className="badge bg-purple-50 text-purple-700 border-purple-200">{employee.department.name}</span>}
                    {employee.designation && <span className="badge bg-blue-50 text-blue-700 border-blue-200">{employee.designation.name}</span>}
                    <span className="badge bg-gray-50 text-gray-600 border-gray-200">{employee.workMode?.replace(/_/g, ' ')}</span>
                    <span className={`badge ${getStatusColor(employee.status)}`}>{employee.status}</span>
                    {employee.user?.role && <span className="badge bg-indigo-50 text-indigo-700 border-indigo-200">{employee.user.role.replace(/_/g, ' ')}</span>}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-3">Tags are auto-generated from employee attributes</p>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

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
              <div className="flex-1 min-w-0">
                <h2 className="font-display font-bold text-gray-900">{employee.firstName} {employee.lastName}</h2>
                <p className="text-xs text-gray-400">{employee.employeeCode} · {employee.designation?.name || ''}</p>
              </div>
              <span className={`badge ${getStatusColor(employee.status)}`}>{employee.status?.replace(/_/g, ' ')}</span>
              {isManagement && (
                <button onClick={() => setShowEditModal(true)} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1 shrink-0">
                  <Save size={12} /> Edit
                </button>
              )}
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
                <EmployeeAttendanceTab employeeId={id!} employeeName={`${employee.firstName} ${employee.lastName}`} isManagement={isManagement} />
              </div>
            )}

            {activeTab === 'overview' && (
              <div className="grid md:grid-cols-2 gap-6">
                {/* Employment Details */}
                <div className="layer-card p-5">
                  <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2 mb-3">
                    <Building2 size={15} className="text-purple-500" /> Employment Details
                  </h3>
                  <dl className="space-y-2.5">
                    <InfoRow label="Department" value={employee.department?.name || '—'} />
                    <InfoRow label="Designation" value={employee.designation?.name || '—'} />
                    <InfoRow label="Work Mode" value={employee.workMode?.replace(/_/g, ' ')} />
                    <InfoRow label="Reports To" value={employee.manager ? `${employee.manager.firstName} ${employee.manager.lastName}` : '—'} />
                    <InfoRow label="Office" value={employee.officeLocation?.name || '—'} />
                    <InfoRow label="Current Shift" value={employee.currentShift ? `${employee.currentShift.name} (${employee.currentShift.startTime}–${employee.currentShift.endTime})` : 'No shift assigned'} />
                    <InfoRow label="Joining Date" value={formatDate(employee.joiningDate, 'long')} />
                    <InfoRow label="Status" value={employee.status?.replace(/_/g, ' ')} />
                    {isManagement && employee.ctc && <InfoRow label="CTC" value={formatCurrency(Number(employee.ctc))} mono />}
                  </dl>
                </div>

                {/* Personal Information */}
                <div className="layer-card p-5">
                  <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2 mb-3">
                    <User size={15} className="text-brand-500" /> Personal Information
                  </h3>
                  <dl className="space-y-2.5">
                    <InfoRow label="Full Name" value={`${employee.firstName} ${employee.lastName}`} />
                    <InfoRow label="Date of Birth" value={employee.dateOfBirth ? formatDate(employee.dateOfBirth) : '—'} />
                    <InfoRow label="Gender" value={employee.gender?.replace(/_/g, ' ') || '—'} />
                    <InfoRow label="Blood Group" value={employee.bloodGroup || '—'} />
                    <InfoRow label="Marital Status" value={employee.maritalStatus || '—'} />
                    <InfoRow label="Official Email" value={employee.email} />
                    <InfoRow label="Personal Email" value={employee.personalEmail || '—'} />
                    <InfoRow label="Phone" value={employee.phone || '—'} />
                  </dl>
                </div>

                {/* Address */}
                <div className="layer-card p-5">
                  <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2 mb-3">
                    <MapPin size={15} className="text-sky-500" /> Address & Emergency Contact
                  </h3>
                  {employee.address ? (
                    <div className="mb-3">
                      <p className="text-xs text-gray-400 mb-1">Address</p>
                      <p className="text-sm text-gray-700">
                        {(employee.address as any).line1 && `${(employee.address as any).line1}, `}
                        {(employee.address as any).city && `${(employee.address as any).city}, `}
                        {(employee.address as any).state && `${(employee.address as any).state} `}
                        {(employee.address as any).pincode}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 mb-3">No address on file</p>
                  )}
                  {employee.emergencyContact ? (
                    <dl className="space-y-2">
                      <p className="text-xs text-gray-400">Emergency Contact</p>
                      <InfoRow label="Name" value={(employee.emergencyContact as any).name || '—'} />
                      <InfoRow label="Relationship" value={(employee.emergencyContact as any).relationship || '—'} />
                      <InfoRow label="Phone" value={(employee.emergencyContact as any).phone || '—'} />
                    </dl>
                  ) : (
                    <p className="text-xs text-gray-400">No emergency contact on file</p>
                  )}
                </div>

                {/* Bank Details — HR only */}
                {isManagement && (
                  <div className="layer-card p-5">
                    <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2 mb-3">
                      <DollarSign size={15} className="text-emerald-500" /> Bank Details
                    </h3>
                    {employee.bankAccountNumber ? (
                      <dl className="space-y-2.5">
                        <InfoRow label="Account Holder" value={employee.accountHolderName || '—'} />
                        <InfoRow label="Bank" value={employee.bankName || '—'} />
                        <InfoRow label="Account No." value={`••••${employee.bankAccountNumber.slice(-4)}`} mono />
                        <InfoRow label="IFSC" value={employee.ifscCode || '—'} mono />
                        <InfoRow label="Account Type" value={employee.accountType || '—'} />
                      </dl>
                    ) : (
                      <p className="text-xs text-gray-400">No bank details on file</p>
                    )}
                  </div>
                )}

                {/* Profile Completion */}
                <div className="layer-card p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('profile.profileCompletion')}</h3>
                  <div className="space-y-2">
                    {[
                      { label: t('employees.completionPersonal'), done: !!(employee.dateOfBirth && employee.gender) },
                      { label: t('employees.completionEmergency'), done: !!employee.emergencyContact },
                      { label: t('employees.completionDept'), done: !!(employee.department && employee.designation) },
                      { label: t('employees.completionDocuments'), done: (employee.documents?.length || 0) >= 3 },
                      { label: t('employees.completionBank'), done: !!employee.bankAccountNumber },
                    ].map((item, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">{item.label}</span>
                        <span className={item.done ? 'text-emerald-600' : 'text-amber-500'}>
                          {item.done ? '✓ Complete' : '○ Pending'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{ width: `${[
                        !!(employee.dateOfBirth && employee.gender),
                        !!employee.emergencyContact,
                        !!(employee.department && employee.designation),
                        (employee.documents?.length || 0) >= 3,
                        !!employee.bankAccountNumber,
                      ].filter(Boolean).length * 20}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'salary' && (
              <SalaryTab employeeId={id!} ctc={employee.ctc} workMode={employee.workMode} isManagement={MANAGEMENT_ROLES.includes(user?.role || '')} />
            )}

            {activeTab === 'documents' && (
              <DocumentsTab employeeId={id!} documents={employee.documents || []} isManagement={MANAGEMENT_ROLES.includes(user?.role || '')} employeeName={`${employee.firstName} ${employee.lastName}`} />
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
            userRole={user?.role}
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

function SidebarMeta({ icon: Icon, label, count, onClick }: { icon: any; label: string; count?: number; onClick?: () => void }) {
  return (
    <div onClick={onClick} className="flex items-center justify-between text-xs text-gray-500 hover:text-gray-700 cursor-pointer py-1 hover:bg-gray-50 rounded px-1 -mx-1 transition-colors">
      <div className="flex items-center gap-2"><Icon size={13} className="text-gray-400" /> {label}</div>
      {count !== undefined ? <span className="text-gray-400 font-mono" data-mono>{count}</span> : <Plus size={12} className="text-gray-400" />}
    </div>
  );
}

/* =============================================================================
   Edit Employee Modal
   ============================================================================= */

const MANAGEMENT_CAN_EDIT_STATUS = ['SUPER_ADMIN', 'ADMIN', 'HR'];

function EditEmployeeModal({ employee, userRole, onSave, onClose }: { employee: any; userRole?: string; onSave: (data: any) => void; onClose: () => void }) {
  const canEditStatus = MANAGEMENT_CAN_EDIT_STATUS.includes(userRole || '');
  const [changeRole] = useChangeEmployeeRoleMutation();
  const [selectedRole, setSelectedRole] = useState<string>(employee.user?.role || 'EMPLOYEE');
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
    status: employee.status || 'ONBOARDING',
    ctc: employee.ctc ? Number(employee.ctc) : '',
    departmentId: employee.department?.id || '',
    designationId: employee.designation?.id || '',
    managerId: employee.manager?.id || '',
  });

  const { data: deptData } = useGetDepartmentsQuery();
  const { data: desigData } = useGetDesignationsQuery();
  const { data: mgrData } = useGetManagersQuery();
  const departments = deptData?.data || [];
  const designations = desigData?.data || [];
  const managers = mgrData?.data || [];

  const deptOptions = departments.map((d: any) => ({ value: d.id, label: d.name }));
  const desigOptions = designations
    .filter((d: any) => !form.departmentId || !d.departmentId || d.departmentId === form.departmentId)
    .map((d: any) => ({ value: d.id, label: d.name }));
  const mgrOptions = managers
    .filter((m: any) => m.id !== employee.id)
    .map((m: any) => ({ value: m.id, label: `${m.firstName} ${m.lastName}`, sublabel: m.employeeCode }));

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }} onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-glass-lg w-full max-w-2xl overflow-y-auto" style={{ maxHeight: 'min(90dvh, calc(100dvh - 2rem))' }}>
        <div className="flex items-center justify-between sticky top-0 bg-white z-10 px-6 pt-6 pb-4 border-b border-gray-100 -mx-0">
          <h2 className="text-lg font-display font-semibold text-gray-800">Edit Employee</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-400">✕</button>
        </div>
        <form onSubmit={async (e) => {
          e.preventDefault();
          // Change role separately if it changed and user has permission
          if (canEditStatus && selectedRole !== employee.user?.role) {
            await changeRole({ employeeId: employee.id, role: selectedRole }).unwrap();
          }
          onSave({
            ...form,
            departmentId: form.departmentId || null,
            designationId: form.designationId || null,
            managerId: form.managerId || null,
            ctc: form.ctc !== '' && form.ctc !== undefined ? Number(form.ctc) : undefined,
          });
        }} className="space-y-4 px-6 py-5">
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
          {/* Department, Designation, Manager */}
          <div className="grid grid-cols-3 gap-3">
            <SearchableSelect
              label="Department"
              placeholder="Select..."
              options={deptOptions}
              value={form.departmentId}
              onChange={(v) => setForm({ ...form, departmentId: v, designationId: '' })}
            />
            <SearchableSelect
              label="Designation"
              placeholder="Select..."
              options={desigOptions}
              value={form.designationId}
              onChange={(v) => setForm({ ...form, designationId: v })}
            />
            <SearchableSelect
              label="Reporting Manager"
              placeholder="Select..."
              options={mgrOptions}
              value={form.managerId}
              onChange={(v) => setForm({ ...form, managerId: v })}
            />
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
              {canEditStatus ? (
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="input-glass w-full text-sm">
                  <optgroup label="Active States">
                    <option value="ONBOARDING">Onboarding</option>
                    <option value="PROBATION">Probation</option>
                    <option value="INTERN">Intern</option>
                    <option value="ACTIVE">Active</option>
                  </optgroup>
                  <optgroup label="Current States">
                    <option value="NOTICE_PERIOD">Notice Period</option>
                    <option value="SUSPENDED">Suspended</option>
                  </optgroup>
                  <optgroup label="Terminal States">
                    <option value="INACTIVE">Inactive</option>
                    <option value="TERMINATED">Terminated</option>
                    <option value="ABSCONDED">Absconded</option>
                  </optgroup>
                </select>
              ) : (
                <div className="input-glass w-full text-sm flex items-center text-gray-600 bg-gray-50 cursor-not-allowed">
                  {form.status.replace(/_/g, ' ')}
                </div>
              )}</div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">Personal Email</label>
              <input value={form.personalEmail} onChange={(e) => setForm({ ...form, personalEmail: e.target.value })} className="input-glass w-full text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">CTC (Annual, INR)</label>
              <input type="number" value={form.ctc} onChange={(e) => setForm({ ...form, ctc: e.target.value ? Number(e.target.value) : '' })} className="input-glass w-full text-sm" /></div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Role
                {canEditStatus && <span className="ml-1 text-indigo-500 font-medium">(HR only)</span>}
              </label>
              {canEditStatus ? (
                <select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)} className="input-glass w-full text-sm">
                  <option value="EMPLOYEE">Employee</option>
                  <option value="INTERN">Intern</option>
                  <option value="MANAGER">Manager</option>
                  <option value="HR">HR</option>
                  <option value="ADMIN">Admin</option>
                  <option value="SUPER_ADMIN">Super Admin</option>
                </select>
              ) : (
                <div className="input-glass w-full text-sm flex items-center text-gray-600 bg-gray-50 cursor-not-allowed">
                  {selectedRole.replace(/_/g, ' ')}
                </div>
              )}
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
  PRESENT: '#22c55e', ABSENT: '#ef4444', HALF_DAY: '#f59e0b',
  HOLIDAY: '#3b82f6', WEEKEND: '#d1d5db', ON_LEAVE: '#a855f7',
  WORK_FROM_HOME: '#06b6d4', EVENT: '#f97316', WFH_DAY: '#06b6d4',
  LATE: '#fb923c',
};
const STATUS_LABELS: Record<string, string> = {
  PRESENT: 'Present', ABSENT: 'Absent', HALF_DAY: 'Half Day',
  HOLIDAY: 'Holiday', WEEKEND: 'Weekend', ON_LEAVE: 'On Leave',
  WORK_FROM_HOME: 'Work From Home', EVENT: 'Company Event', WFH_DAY: 'WFH Day',
  LATE: 'Late (Half Day)',
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

function EmployeeAttendanceTab({ employeeId, employeeName, isManagement }: { employeeId: string; employeeName: string; isManagement: boolean }) {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [popupCell, setPopupCell] = useState<{ date: string; x: number; y: number; record?: any } | null>(null);
  const [showRegForm, setShowRegForm] = useState(false);
  const [regReason, setRegReason] = useState('');
  const popupRef = useRef<HTMLDivElement>(null);

  const startDate = `${selectedYear - 1}-12-01`;
  const endDate = `${selectedYear}-12-31`;
  const { data: response, isLoading } = useGetEmployeeAttendanceQuery({ employeeId, startDate, endDate });
  const { data: holidaysRes } = useGetHolidaysQuery({ year: selectedYear });
  const { data: hybridRes } = useGetHybridScheduleQuery(employeeId);
  const [markAttendance, { isLoading: marking }] = useMarkAttendanceMutation();
  const [submitReg, { isLoading: submittingReg }] = useSubmitRegularizationMutation();

  const records = response?.data?.records || [];
  const summary = response?.data?.summary;
  const holidays = holidaysRes?.data || [];
  const hybridSchedule = hybridRes?.data;

  // Build lookup maps
  const dateStatusMap = useMemo(() => {
    const map: Record<string, any> = {};
    records.forEach((r: any) => { const k = r.date?.split('T')[0]; if (k) map[k] = r; });
    return map;
  }, [records]);

  const holidayMap = useMemo(() => {
    const map: Record<string, any> = {};
    holidays.forEach((h: any) => { const k = h.date?.split('T')[0]; if (k) map[k] = h; });
    return map;
  }, [holidays]);

  const hybridOfficeDays = useMemo(() => new Set((hybridSchedule?.officeDays as number[]) || []), [hybridSchedule]);
  const hybridWfhDays = useMemo(() => new Set((hybridSchedule?.wfhDays as number[]) || []), [hybridSchedule]);

  const monthGroups = useMemo(() => buildMonthGroups(selectedYear), [selectedYear]);
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const getDateStatus = useCallback((date: Date): string | null => {
    const dateStr = date.toISOString().split('T')[0];
    if (dateStr > todayStr) {
      // Future: show hybrid schedule colors
      if (hybridSchedule) {
        const dow = date.getDay();
        if (hybridWfhDays.has(dow)) return 'WORK_FROM_HOME';
        if (hybridOfficeDays.has(dow)) return null; // normal office day
      }
      // Future holidays/events show as orange
      if (holidayMap[dateStr]) return holidayMap[dateStr].type === 'EVENT' ? 'EVENT' : 'HOLIDAY';
      return null;
    }
    // Past/today: check attendance record first
    const rec = dateStatusMap[dateStr];
    if (rec) {
      // Check if late and marked HALF_DAY
      if (rec.status === 'HALF_DAY' && rec.notes?.includes('Late')) return 'LATE';
      return rec.status;
    }
    // Check holiday
    if (holidayMap[dateStr]) return holidayMap[dateStr].type === 'EVENT' ? 'EVENT' : 'HOLIDAY';
    // Weekend (Sunday only — Saturday is a working day)
    const dow = date.getDay();
    if (dow === 0) return 'WEEKEND';
    // Hybrid WFH day with no record
    if (hybridSchedule && hybridWfhDays.has(dow)) return 'WORK_FROM_HOME';
    return null;
  }, [dateStatusMap, holidayMap, hybridSchedule, hybridOfficeDays, hybridWfhDays, todayStr]);

  const getCellColor = (date: Date): string => {
    const s = getDateStatus(date);
    return s ? (STATUS_COLORS[s] || '#f3f4f6') : '#f3f4f6';
  };

  const handleCellClick = (date: Date, e: React.MouseEvent) => {
    const dateStr = date.toISOString().split('T')[0];
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const rec = dateStatusMap[dateStr];
    const holiday = holidayMap[dateStr];
    setPopupCell({ date: dateStr, x: rect.left, y: rect.bottom + 4, record: rec || holiday || null });
    setShowRegForm(false);
    setRegReason('');
  };

  const handleMarkStatus = async (status: string) => {
    if (!popupCell || marking) return;
    try {
      await markAttendance({ employeeId, date: popupCell.date, status }).unwrap();
      toast.success(`Marked as ${STATUS_LABELS[status] || status}`);
      setPopupCell(null);
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to mark attendance'); }
  };

  const handleSubmitReg = async () => {
    if (!popupCell?.record?.id || !regReason.trim()) return;
    try {
      await submitReg({ attendanceId: popupCell.record.id, reason: regReason.trim() }).unwrap();
      toast.success('Regularization request submitted');
      setPopupCell(null);
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to submit'); }
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
                { color: STATUS_COLORS.EVENT, label: 'Event' },
                { color: STATUS_COLORS.WORK_FROM_HOME, label: 'WFH' },
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

      {/* Cell click popup — shows details + mark + regularization */}
      <AnimatePresence>
        {popupCell && (
          <motion.div ref={popupRef} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
            className="fixed z-50 bg-white rounded-xl shadow-glass-lg border border-gray-100 p-3 min-w-[220px] max-w-[300px]"
            style={{ left: Math.min(popupCell.x, window.innerWidth - 320), top: Math.min(popupCell.y, window.innerHeight - 350) }}>

            <p className="text-[10px] text-gray-400 font-medium mb-2">{new Date(popupCell.date + 'T00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric', weekday: 'long' })}</p>

            {/* Holiday/Event info */}
            {holidayMap[popupCell.date] && (
              <div className={`rounded-lg px-2.5 py-2 mb-2 ${holidayMap[popupCell.date].type === 'EVENT' ? 'bg-orange-50 border border-orange-200' : 'bg-blue-50 border border-blue-200'}`}>
                <p className={`text-xs font-semibold ${holidayMap[popupCell.date].type === 'EVENT' ? 'text-orange-700' : 'text-blue-700'}`}>
                  {holidayMap[popupCell.date].type === 'EVENT' ? '📅 Event' : '🎉 Holiday'}: {holidayMap[popupCell.date].name}
                </p>
                {holidayMap[popupCell.date].description && (
                  <p className="text-[10px] text-gray-500 mt-0.5">{holidayMap[popupCell.date].description}</p>
                )}
                {holidayMap[popupCell.date].isHalfDay && (
                  <p className="text-[10px] text-amber-600 mt-0.5">Half Day ({holidayMap[popupCell.date].halfDaySession === 'FIRST_HALF' ? '1st half off' : '2nd half off'})</p>
                )}
                {holidayMap[popupCell.date].startTime && (
                  <p className="text-[10px] text-gray-500 mt-0.5">Time: {holidayMap[popupCell.date].startTime} — {holidayMap[popupCell.date].endTime}</p>
                )}
              </div>
            )}

            {/* Attendance record info */}
            {popupCell.record?.checkIn && (
              <div className="bg-gray-50 rounded-lg px-2.5 py-2 mb-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">Check-in</span>
                  <span className="font-medium text-gray-700">{new Date(popupCell.record.checkIn).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</span>
                </div>
                {popupCell.record.checkOut && (
                  <div className="flex justify-between mt-0.5">
                    <span className="text-gray-500">Check-out</span>
                    <span className="font-medium text-gray-700">{new Date(popupCell.record.checkOut).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</span>
                  </div>
                )}
                {popupCell.record.totalHours && (
                  <div className="flex justify-between mt-0.5">
                    <span className="text-gray-500">Hours</span>
                    <span className="font-medium font-mono text-gray-700" data-mono>{Number(popupCell.record.totalHours).toFixed(1)}h</span>
                  </div>
                )}
                <div className="flex justify-between mt-0.5">
                  <span className="text-gray-500">Status</span>
                  <span className={`font-medium ${popupCell.record.status === 'PRESENT' ? 'text-emerald-600' : popupCell.record.status === 'HALF_DAY' ? 'text-amber-600' : 'text-gray-600'}`}>
                    {STATUS_LABELS[popupCell.record.status] || popupCell.record.status}
                  </span>
                </div>
                {popupCell.record.notes && (
                  <p className="text-[10px] text-amber-600 mt-1 border-t border-gray-200 pt-1">{popupCell.record.notes}</p>
                )}
              </div>
            )}

            {/* Hybrid WFH indicator */}
            {hybridSchedule && !popupCell.record?.checkIn && !holidayMap[popupCell.date] && (() => {
              const dow = new Date(popupCell.date + 'T00:00').getDay();
              if (hybridWfhDays.has(dow)) return (
                <div className="bg-cyan-50 border border-cyan-200 rounded-lg px-2.5 py-2 mb-2">
                  <p className="text-xs text-cyan-700 font-medium">🏠 Work From Home Day</p>
                  <p className="text-[10px] text-cyan-600">Hybrid schedule — WFH on this day</p>
                </div>
              );
              if (hybridOfficeDays.has(dow)) return (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-2.5 py-2 mb-2">
                  <p className="text-xs text-indigo-700 font-medium">🏢 Office Day</p>
                  <p className="text-[10px] text-indigo-600">Hybrid schedule — in-office on this day</p>
                </div>
              );
              return null;
            })()}

            {/* Regularization for HALF_DAY/LATE */}
            {popupCell.record && (popupCell.record.status === 'HALF_DAY' || popupCell.record.notes?.includes('Late')) && !showRegForm && (
              <button onClick={() => setShowRegForm(true)}
                className="w-full text-xs text-brand-600 hover:text-brand-700 font-medium py-1.5 px-2 rounded-lg hover:bg-brand-50 transition-colors text-left mb-1">
                📝 Request Regularization (Half Day → Full Day)
              </button>
            )}

            {showRegForm && (
              <div className="bg-brand-50 border border-brand-200 rounded-lg p-2 mb-2">
                <p className="text-[10px] font-medium text-brand-700 mb-1">Regularization Request</p>
                <textarea value={regReason} onChange={e => setRegReason(e.target.value)}
                  placeholder="Reason for regularization..." rows={2}
                  className="w-full text-xs border border-brand-200 rounded-lg p-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-brand-300" />
                <div className="flex gap-1.5 mt-1.5">
                  <button onClick={handleSubmitReg} disabled={submittingReg || !regReason.trim()}
                    className="flex-1 text-[10px] bg-brand-600 text-white rounded-lg py-1 font-medium disabled:opacity-50">
                    {submittingReg ? 'Submitting...' : 'Submit'}
                  </button>
                  <button onClick={() => setShowRegForm(false)} className="text-[10px] text-gray-500 px-2">Cancel</button>
                </div>
              </div>
            )}

            {/* HR Mark Attendance options — only visible to management */}
            {isManagement && popupCell.date <= todayStr && (
              <>
                <div className="border-t border-gray-100 pt-1.5 mt-1">
                  <p className="text-[10px] text-gray-400 px-1 mb-1">HR: Mark as</p>
                  <div className="grid grid-cols-2 gap-1">
                    {[
                      { status: 'PRESENT', label: 'Present', color: STATUS_COLORS.PRESENT },
                      { status: 'ABSENT', label: 'Absent', color: STATUS_COLORS.ABSENT },
                      { status: 'HALF_DAY', label: 'Half Day', color: STATUS_COLORS.HALF_DAY },
                      { status: 'ON_LEAVE', label: 'On Leave', color: STATUS_COLORS.ON_LEAVE },
                    ].map(opt => (
                      <button key={opt.status} onClick={() => handleMarkStatus(opt.status)} disabled={marking}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] text-gray-700 hover:bg-surface-2 transition-colors text-left">
                        <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: opt.color }} />
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
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
   Salary Tab — Full Manual Editing with Component Builder
   ============================================================================= */

interface SalaryComponent {
  id: string;
  name: string;
  amount: number;
  mode: 'fixed' | 'percent'; // fixed amount or % of CTC
  percentValue: number; // stored % when in percent mode
  type: 'earning' | 'deduction';
  isStatutory?: boolean; // EPF, ESI, PT — auto-calculated
  isRequired?: boolean; // basic is always required
}

// Hardcoded fallback defaults (used only if component master hasn't loaded yet)
const FALLBACK_DEFAULTS: SalaryComponent[] = [
  { id: 'basic', name: 'Basic Salary', amount: 0, mode: 'percent', percentValue: 50, type: 'earning', isRequired: true },
  { id: 'hra', name: 'House Rent Allowance', amount: 0, mode: 'percent', percentValue: 40, type: 'earning' },
  { id: 'da', name: 'Dearness Allowance', amount: 0, mode: 'percent', percentValue: 10, type: 'earning' },
  { id: 'ta', name: 'Transport Allowance', amount: 0, mode: 'fixed', percentValue: 0, type: 'earning' },
  { id: 'specialAllowance', name: 'Special Allowance', amount: 0, mode: 'fixed', percentValue: 0, type: 'earning' },
  { id: 'medicalAllowance', name: 'Medical Allowance', amount: 0, mode: 'fixed', percentValue: 0, type: 'earning' },
  { id: 'lta', name: 'Leave Travel Assistance', amount: 0, mode: 'fixed', percentValue: 0, type: 'earning' },
];

// Map component master code to legacy field names
const CODE_TO_FIELD: Record<string, string> = {
  BASIC: 'basic', HRA: 'hra', DA: 'da', TA: 'ta',
  MEDICAL: 'medicalAllowance', SPECIAL: 'specialAllowance', LTA: 'lta',
};

/**
 * Build default earnings from the component master (Settings → Salary Components).
 * Uses the org's configured defaults (%, fixed amounts) instead of hardcoded values.
 */
function buildDefaultsFromMaster(masterComps: any[], annualCtc: number): SalaryComponent[] {
  const monthly = annualCtc / 12;
  const earningComps = masterComps
    .filter((c: any) => c.type === 'EARNING' && c.isActive)
    .sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));

  if (earningComps.length === 0) return FALLBACK_DEFAULTS;

  const earnings: SalaryComponent[] = [];
  for (const mc of earningComps) {
    const isPercent = mc.calculationRule === 'PERCENTAGE_CTC' || mc.calculationRule === 'PERCENTAGE_BASIC';
    const defaultPct = mc.defaultPercentage ? Number(mc.defaultPercentage) : 0;
    const defaultFixed = mc.defaultValue ? Number(mc.defaultValue) : 0;
    const amount = isPercent && monthly > 0 ? Math.round(monthly * defaultPct / 100) : defaultFixed;

    earnings.push({
      id: CODE_TO_FIELD[mc.code] || `master_${mc.code}`,
      name: mc.name,
      amount,
      mode: isPercent ? 'percent' : 'fixed',
      percentValue: defaultPct,
      type: 'earning',
      isRequired: mc.code === 'BASIC',
    });
  }
  return earnings;
}

/**
 * Build earnings from a saved salary structure.
 * Falls back to component master defaults when saved amounts are 0.
 */
function buildComponentsFromStructure(structure: any, annualCtc: number, masterComps?: any[]): SalaryComponent[] {
  const monthly = annualCtc / 12;

  // If structure has dynamic components array, use it directly
  if (structure?.components && Array.isArray(structure.components) && structure.components.length > 0) {
    const comps = structure.components as any[];
    return comps
      .filter((c: any) => c.type === 'earning')
      .map((c: any, i: number) => ({
        id: CODE_TO_FIELD[c.code] || c.name?.toLowerCase().replace(/\s+/g, '_') || `comp_${i}`,
        name: c.name,
        amount: Number(c.value || 0),
        mode: c.isPercentage ? 'percent' as const : 'fixed' as const,
        percentValue: c.percentage || (monthly > 0 ? Math.round((Number(c.value || 0) / monthly) * 100 * 100) / 100 : 0),
        type: 'earning' as const,
        isRequired: c.name === 'Basic' || c.name === 'Basic Salary',
      }));
  }

  // Build from master defaults, overriding with saved amounts
  const defaults = masterComps && masterComps.length > 0
    ? buildDefaultsFromMaster(masterComps, annualCtc)
    : FALLBACK_DEFAULTS;

  const earnings: SalaryComponent[] = [];
  for (const def of defaults) {
    // Check if structure has a saved value for this component
    const fieldName = def.id; // e.g. 'basic', 'hra', 'da'
    const savedAmt = structure?.[fieldName] ? Number(structure[fieldName]) : 0;

    if (savedAmt > 0) {
      // Use saved value
      const pct = monthly > 0 ? Math.round((savedAmt / monthly) * 100 * 100) / 100 : def.percentValue;
      earnings.push({ ...def, amount: savedAmt, percentValue: pct, mode: 'fixed' });
    } else {
      // Use master default
      earnings.push({ ...def });
    }
  }

  // Custom components from enabledComponents JSON
  if (structure?.enabledComponents?.customEarnings) {
    for (const ce of structure.enabledComponents.customEarnings) {
      earnings.push({ id: ce.id, name: ce.name, amount: ce.amount || 0, mode: ce.mode || 'fixed', percentValue: ce.percentValue || 0, type: 'earning' });
    }
  }

  return earnings;
}

function buildDeductionsFromStructure(structure: any, _annualCtc: number): SalaryComponent[] {
  const deductions: SalaryComponent[] = [];
  if (structure?.enabledComponents?.customDeductions) {
    for (const cd of structure.enabledComponents.customDeductions) {
      deductions.push({ id: cd.id, name: cd.name, amount: cd.amount || 0, mode: cd.mode || 'fixed', percentValue: cd.percentValue || 0, type: 'deduction' });
    }
  }
  // Also extract deduction components from dynamic components array
  if (structure?.components && Array.isArray(structure.components)) {
    for (const c of structure.components) {
      if (c.type === 'deduction') {
        deductions.push({ id: c.name?.toLowerCase().replace(/\s+/g, '_') || `ded_${deductions.length}`, name: c.name, amount: Number(c.value || 0), mode: 'fixed', percentValue: 0, type: 'deduction' });
      }
    }
  }
  return deductions;
}

let componentCounter = 0;

function SalaryTab({ employeeId, ctc, workMode, isManagement }: { employeeId: string; ctc: any; workMode: string; isManagement: boolean }) {
  const { data: salRes } = useGetSalaryStructureQuery(employeeId);
  const { data: historyRes } = useGetSalaryHistoryQuery(employeeId);
  const { data: compMasterRes } = useGetComponentsQuery();
  const { data: templatesRes } = useGetSalaryTemplatesQuery();
  const salaryHistory = historyRes?.data || [];
  const componentMaster = compMasterRes?.data || [];
  const templates = templatesRes?.data || [];
  const [saveSalaryDynamic, { isLoading: saving }] = useSaveSalaryStructureDynamicMutation();
  const structure = salRes?.data;
  // salaryMode: 'default' = payroll uses component master at runtime; 'custom' = per-employee saved components
  const [salaryMode, setSalaryMode] = useState<'default' | 'custom'>((structure as any)?.isCustom ? 'custom' : 'default');
  const [editing, setEditing] = useState(false);
  const [annualCtc, setAnnualCtc] = useState(ctc ? Number(ctc) : 0);
  const [taxRegime, setTaxRegime] = useState<'OLD_REGIME' | 'NEW_REGIME'>(structure?.incomeTaxRegime || 'NEW_REGIME');
  const [earnings, setEarnings] = useState<SalaryComponent[]>([]);
  const [customDeductions, setCustomDeductions] = useState<SalaryComponent[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showComponentPicker, setShowComponentPicker] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  // Apply a salary template to this employee's form
  const applyTemplateToForm = (tmpl: any) => {
    const annual = Number(tmpl.ctc || 0);
    setAnnualCtc(annual);
    const monthly = annual / 12;
    setTaxRegime(tmpl.incomeTaxRegime || 'NEW_REGIME');

    const newEarnings: SalaryComponent[] = [];
    const basicAmt = Number(tmpl.basic || 0);
    const basicPct = monthly > 0 ? Math.round((basicAmt / monthly) * 100 * 100) / 100 : 50;
    newEarnings.push({ id: 'basic', name: 'Basic Salary', amount: basicAmt, mode: 'percent', percentValue: basicPct, type: 'earning', isRequired: true });

    const stdFields: { id: string; field: string; name: string }[] = [
      { id: 'hra', field: 'hra', name: 'House Rent Allowance' },
      { id: 'da', field: 'da', name: 'Dearness Allowance' },
      { id: 'ta', field: 'ta', name: 'Transport Allowance' },
      { id: 'specialAllowance', field: 'specialAllowance', name: 'Special Allowance' },
      { id: 'medicalAllowance', field: 'medicalAllowance', name: 'Medical Allowance' },
      { id: 'lta', field: 'lta', name: 'Leave Travel Assistance' },
    ];
    for (const f of stdFields) {
      const amt = Number(tmpl[f.field] || 0);
      const pct = monthly > 0 ? Math.round((amt / monthly) * 100 * 100) / 100 : 0;
      newEarnings.push({ id: f.id, name: f.name, amount: amt, mode: amt > 0 ? 'fixed' : 'percent', percentValue: pct, type: 'earning' });
    }

    setEarnings(newEarnings);
    setCustomDeductions([]);
    setShowTemplatePicker(false);
    if (!editing) setEditing(true);
    toast.success(`Template "${tmpl.name}" applied — review and save`);
  };

  // Sync from server data — uses component master for defaults
  useEffect(() => {
    if (structure) {
      const annual = structure.ctc ? Number(structure.ctc) : (ctc ? Number(ctc) : 0);
      setAnnualCtc(annual);
      setTaxRegime(structure.incomeTaxRegime || 'NEW_REGIME');
      const mode = (structure as any).isCustom ? 'custom' : 'default';
      setSalaryMode(mode);
      // For display, always show component master defaults for default mode
      if (mode === 'default') {
        setEarnings(componentMaster.length > 0 ? buildDefaultsFromMaster(componentMaster, annual) : FALLBACK_DEFAULTS);
      } else {
        setEarnings(buildComponentsFromStructure(structure, annual, componentMaster));
      }
      setCustomDeductions(buildDeductionsFromStructure(structure, annual));
    } else {
      // No structure yet — default mode, use component master defaults
      const annual = ctc ? Number(ctc) : 0;
      setAnnualCtc(annual);
      setSalaryMode('default');
      const defaults = componentMaster.length > 0
        ? buildDefaultsFromMaster(componentMaster, annual)
        : FALLBACK_DEFAULTS.map(e => {
            const monthly = annual / 12;
            return { ...e, amount: e.mode === 'percent' && monthly > 0 ? Math.round(monthly * e.percentValue / 100) : 0 };
          });
      setEarnings(defaults);
    }
  }, [structure, ctc, componentMaster]);

  // Recalculate amounts when CTC changes (for percent-mode components)
  const recalcFromCtc = useCallback((newCtc: number) => {
    const monthly = newCtc / 12;
    setEarnings(prev => prev.map(e =>
      e.mode === 'percent' ? { ...e, amount: Math.round(monthly * e.percentValue / 100) } : e
    ));
    setCustomDeductions(prev => prev.map(d =>
      d.mode === 'percent' ? { ...d, amount: Math.round(monthly * d.percentValue / 100) } : d
    ));
  }, []);

  const handleCtcChange = (val: number) => {
    setAnnualCtc(val);
    recalcFromCtc(val);
  };

  // Live calculations
  const monthly = annualCtc / 12;
  const grossEarnings = earnings.reduce((sum, e) => sum + (e.amount || 0), 0);
  const basicAmount = earnings.find(e => e.id === 'basic')?.amount || 0;

  // Statutory deductions (auto-calculated)
  const epfEmployee = Math.min(basicAmount, 15000) * 0.12;
  const epfEmployer = Math.min(basicAmount, 15000) * 0.12;
  const esiEmployee = grossEarnings <= 21000 ? grossEarnings * 0.0075 : 0;
  const esiEmployer = grossEarnings <= 21000 ? grossEarnings * 0.0325 : 0;
  const pt = grossEarnings > 15000 ? 200 : grossEarnings > 10000 ? 150 : 0;

  const customDeductionTotal = customDeductions.reduce((sum, d) => sum + (d.amount || 0), 0);

  // Validation
  const validate = useCallback((): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (annualCtc <= 0) errs.ctc = 'Annual CTC must be greater than zero';
    if (basicAmount <= 0) errs.basic = 'Basic salary is required and must be positive';
    if (grossEarnings > monthly * 1.5) errs.gross = 'Total earnings significantly exceed monthly CTC';
    for (const e of earnings) {
      if (e.amount < 0) errs[e.id] = `${e.name} cannot be negative`;
      if (!e.name.trim()) errs[e.id] = 'Component name is required';
    }
    for (const d of customDeductions) {
      if (d.amount < 0) errs[d.id] = `${d.name} cannot be negative`;
      if (!d.name.trim()) errs[d.id] = 'Deduction name is required';
    }
    return errs;
  }, [annualCtc, basicAmount, grossEarnings, monthly, earnings, customDeductions]);

  useEffect(() => {
    if (editing) setErrors(validate());
  }, [editing, validate]);

  const hasErrors = Object.keys(errors).length > 0;

  // Component CRUD
  const updateEarning = (id: string, updates: Partial<SalaryComponent>) => {
    setEarnings(prev => prev.map(e => {
      if (e.id !== id) return e;
      const updated = { ...e, ...updates };
      // If switching mode or changing percent, recalculate amount
      if (updates.mode === 'percent' || (updates.percentValue !== undefined && e.mode === 'percent')) {
        updated.amount = Math.round(monthly * (updates.percentValue ?? updated.percentValue) / 100);
      }
      if (updates.mode === 'fixed' && updates.amount === undefined) {
        // keep existing amount when switching to fixed
      }
      return updated;
    }));
  };

  const updateDeduction = (id: string, updates: Partial<SalaryComponent>) => {
    setCustomDeductions(prev => prev.map(d => {
      if (d.id !== id) return d;
      const updated = { ...d, ...updates };
      if (updates.mode === 'percent' || (updates.percentValue !== undefined && d.mode === 'percent')) {
        updated.amount = Math.round(monthly * (updates.percentValue ?? updated.percentValue) / 100);
      }
      return updated;
    }));
  };

  const addEarning = () => {
    componentCounter++;
    setEarnings(prev => [...prev, {
      id: `custom_earning_${componentCounter}_${Date.now()}`,
      name: '',
      amount: 0,
      mode: 'fixed',
      percentValue: 0,
      type: 'earning',
    }]);
  };

  const addDeduction = () => {
    componentCounter++;
    setCustomDeductions(prev => [...prev, {
      id: `custom_deduction_${componentCounter}_${Date.now()}`,
      name: '',
      amount: 0,
      mode: 'fixed',
      percentValue: 0,
      type: 'deduction',
    }]);
  };

  const removeEarning = (id: string) => {
    setEarnings(prev => prev.filter(e => e.id !== id));
  };

  const removeDeduction = (id: string) => {
    setCustomDeductions(prev => prev.filter(d => d.id !== id));
  };

  const handleSave = async () => {
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      const firstError = Object.values(errs)[0];
      toast.error(firstError);
      return;
    }

    // Build dynamic components array for the new endpoint
    const components: { name: string; type: 'earning' | 'deduction'; value: number; isPercentage: boolean; percentage?: number }[] = [];

    for (const e of earnings) {
      components.push({
        name: e.name,
        type: 'earning',
        value: Math.round(e.amount),
        isPercentage: e.mode === 'percent',
        ...(e.mode === 'percent' ? { percentage: e.percentValue } : {}),
      });
    }

    for (const d of customDeductions) {
      components.push({
        name: d.name,
        type: 'deduction',
        value: Math.round(d.amount),
        isPercentage: d.mode === 'percent',
        ...(d.mode === 'percent' ? { percentage: d.percentValue } : {}),
      });
    }

    try {
      await saveSalaryDynamic({
        employeeId,
        data: {
          ctcAnnual: annualCtc,
          components,
          incomeTaxRegime: taxRegime,
          isCustom: salaryMode === 'custom',
          confirmOverwrite: true,
          changeType: structure ? 'REVISION' : 'INITIAL',
          reason: 'Updated from employee detail page',
        },
      }).unwrap();
      toast.success('Salary structure saved successfully');
      setEditing(false);
    } catch (err: any) {
      const msg = err?.data?.error?.message;
      if (msg?.toLowerCase().includes('validation')) {
        toast.error('Please check all fields — ensure CTC and Basic are positive numbers');
      } else {
        toast.error(msg || 'Failed to save salary structure');
      }
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setErrors({});
    setShowTemplatePicker(false);
    if (structure) {
      const annual = structure.ctc ? Number(structure.ctc) : (ctc ? Number(ctc) : 0);
      setAnnualCtc(annual);
      setTaxRegime(structure.incomeTaxRegime || 'NEW_REGIME');
      const mode = (structure as any).isCustom ? 'custom' : 'default';
      setSalaryMode(mode);
      if (mode === 'default') {
        setEarnings(componentMaster.length > 0 ? buildDefaultsFromMaster(componentMaster, annual) : FALLBACK_DEFAULTS);
      } else {
        setEarnings(buildComponentsFromStructure(structure, annual, componentMaster));
      }
      setCustomDeductions(buildDeductionsFromStructure(structure, annual));
    } else {
      const annual = ctc ? Number(ctc) : 0;
      setAnnualCtc(annual);
      setSalaryMode('default');
      setEarnings(componentMaster.length > 0 ? buildDefaultsFromMaster(componentMaster, annual) : FALLBACK_DEFAULTS);
      setCustomDeductions([]);
    }
  };

  // Statutory toggles
  const [epfEnabled, setEpfEnabled] = useState(true);
  const [esiEnabled, setEsiEnabled] = useState(true);
  const [ptEnabled, setPtEnabled] = useState(true);

  const activeEpfEmployee = epfEnabled ? Math.round(epfEmployee) : 0;
  const activeEpfEmployer = epfEnabled ? Math.round(epfEmployer) : 0;
  const activeEsiEmployee = esiEnabled && grossEarnings <= 21000 ? Math.round(esiEmployee) : 0;
  const activeEsiEmployer = esiEnabled && grossEarnings <= 21000 ? Math.round(esiEmployer) : 0;
  const activePt = ptEnabled ? pt : 0;

  const customDeductionTotal2 = customDeductions.reduce((sum, d) => sum + (d.amount || 0), 0);
  const totalDeductionsCalc = activeEpfEmployee + activeEsiEmployee + activePt + customDeductionTotal2;
  const netMonthlyCalc = grossEarnings - totalDeductionsCalc;

  return (
    <div className="space-y-4">
      {/* CTC + Summary — compact row */}
      <div className="grid grid-cols-4 gap-3">
        <div className="layer-card p-3 text-center">
          <p className="text-[10px] text-gray-400 mb-0.5">CTC (Annual)</p>
          {editing ? (
            <input type="number" value={annualCtc || ''} onChange={e => handleCtcChange(Number(e.target.value))}
              className={`input-glass w-full text-center text-sm font-bold font-mono py-1 ${errors.ctc ? 'ring-2 ring-red-400' : ''}`} data-mono placeholder="Annual CTC" />
          ) : (
            <p className="text-lg font-bold font-mono text-gray-900" data-mono>{annualCtc ? formatCurrency(annualCtc) : '—'}</p>
          )}
        </div>
        <div className="layer-card p-3 text-center">
          <p className="text-[10px] text-gray-400 mb-0.5">Monthly Gross</p>
          <p className="text-lg font-bold font-mono text-brand-600" data-mono>{formatCurrency(Math.round(grossEarnings))}</p>
        </div>
        <div className="layer-card p-3 text-center">
          <p className="text-[10px] text-gray-400 mb-0.5">Total Deductions</p>
          <p className="text-lg font-bold font-mono text-red-500" data-mono>-{formatCurrency(Math.round(totalDeductionsCalc))}</p>
        </div>
        <div className="layer-card p-3 text-center">
          <p className="text-[10px] text-gray-400 mb-0.5">Net Take-Home</p>
          <p className={`text-lg font-bold font-mono ${netMonthlyCalc < 0 ? 'text-red-600' : 'text-emerald-600'}`} data-mono>{formatCurrency(Math.round(netMonthlyCalc))}</p>
        </div>
      </div>

      {/* Salary Mode Switcher */}
      {isManagement && (
        <div className="layer-card p-3 flex items-center gap-3">
          <div className="flex-1">
            <p className="text-xs font-semibold text-gray-700">Salary Mode</p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {salaryMode === 'default'
                ? 'Uses org-wide component master. Settings changes auto-apply at payroll time.'
                : 'Custom per-employee components. Not affected by settings changes.'}
            </p>
          </div>
          <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-lg">
            <button
              onClick={() => {
                if (salaryMode !== 'default') {
                  setSalaryMode('default');
                  // Reset to master defaults when switching to default mode
                  const defaults = componentMaster.length > 0
                    ? buildDefaultsFromMaster(componentMaster, annualCtc)
                    : FALLBACK_DEFAULTS;
                  setEarnings(defaults);
                  setCustomDeductions([]);
                  if (!editing) setEditing(true);
                }
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${salaryMode === 'default' ? 'bg-white text-brand-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Default
            </button>
            <button
              onClick={() => {
                if (salaryMode !== 'custom') {
                  setSalaryMode('custom');
                  if (!editing) setEditing(true);
                }
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${salaryMode === 'custom' ? 'bg-white text-brand-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Customized
            </button>
          </div>
        </div>
      )}

      {/* Actions bar — always visible */}
      {isManagement && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <button onClick={handleSave} disabled={saving || hasErrors} className={`btn-primary text-xs flex items-center gap-1.5 py-1.5 ${hasErrors ? 'opacity-50' : ''}`}>
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} {saving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={handleCancel} className="btn-secondary text-xs py-1.5">Cancel</button>
                {hasErrors && <span className="text-[10px] text-red-500">{Object.values(errors)[0]}</span>}
              </>
            ) : (
              <div className="flex items-center gap-2">
                <button onClick={() => setEditing(true)} className="btn-primary text-xs flex items-center gap-1.5 py-1.5">
                  <DollarSign size={12} /> {salaryMode === 'custom' ? 'Edit Custom Components' : 'Edit CTC / Structure'}
                </button>
                {/* Apply Template dropdown */}
                <div className="relative">
                  <button onClick={() => setShowTemplatePicker(!showTemplatePicker)} className="btn-secondary text-xs flex items-center gap-1.5 py-1.5">
                    <FileText size={12} /> Apply Template
                  </button>
                  {showTemplatePicker && templates.length > 0 && (
                    <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-20 max-h-60 overflow-y-auto">
                      <div className="p-2 border-b border-gray-100">
                        <p className="text-[10px] text-gray-500 font-semibold uppercase">Select Template</p>
                      </div>
                      {templates.map((tmpl: any) => (
                        <button key={tmpl.id} onClick={() => applyTemplateToForm(tmpl)}
                          className="w-full text-left px-3 py-2 hover:bg-brand-50 transition-colors border-b border-gray-50 last:border-0">
                          <p className="text-xs font-medium text-gray-800">{tmpl.name}</p>
                          <p className="text-[10px] text-gray-500">{tmpl.type.replace(/_/g, ' ')} · CTC: ₹{Number(tmpl.ctc).toLocaleString('en-IN')}</p>
                        </button>
                      ))}
                    </div>
                  )}
                  {showTemplatePicker && templates.length === 0 && (
                    <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-20 p-3">
                      <p className="text-xs text-gray-500">No templates created yet. Go to Payroll → Templates to create one.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          {editing && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400">Tax:</span>
              <button onClick={() => setTaxRegime('NEW_REGIME')} className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${taxRegime === 'NEW_REGIME' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'}`}>New</button>
              <button onClick={() => setTaxRegime('OLD_REGIME')} className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${taxRegime === 'OLD_REGIME' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'}`}>Old</button>
            </div>
          )}
        </div>
      )}

      {/* Two-column: Earnings + Deductions side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT: Earnings */}
        <div className="layer-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Earnings (Monthly)</h3>
              {salaryMode === 'default' && (
                <p className="text-[10px] text-amber-600 mt-0.5">From component master — switch to Customized to edit</p>
              )}
            </div>
            {editing && salaryMode === 'custom' && (
              <div className="flex items-center gap-1.5">
                <button onClick={() => setShowComponentPicker(true)} className="text-[10px] text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-0.5">
                  <Plus size={11} /> Library
                </button>
                <button onClick={addEarning} className="text-[10px] text-brand-600 hover:text-brand-700 font-medium flex items-center gap-0.5">
                  <Plus size={11} /> Custom
                </button>
              </div>
            )}
          </div>

          {/* Component Picker */}
          {showComponentPicker && editing && (
            <div className="mb-3 p-2 bg-blue-50/50 border border-blue-100 rounded-lg">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] font-semibold text-blue-700">Component Library</p>
                <button onClick={() => setShowComponentPicker(false)} className="text-[10px] text-gray-400 hover:text-gray-600">Close</button>
              </div>
              <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto">
                {componentMaster
                  .filter((mc: any) => mc.type === 'EARNING' && mc.isActive && !earnings.find(e => e.name === mc.name))
                  .map((mc: any) => (
                    <button key={mc.id} onClick={() => {
                      componentCounter++;
                      const defaultPct = mc.defaultPercentage ? Number(mc.defaultPercentage) : 0;
                      const isPercent = mc.calculationRule === 'PERCENTAGE_CTC' || mc.calculationRule === 'PERCENTAGE_BASIC';
                      setEarnings(prev => [...prev, {
                        id: `master_${mc.code}_${componentCounter}`, name: mc.name,
                        amount: isPercent ? Math.round((annualCtc / 12) * defaultPct / 100) : (mc.defaultValue ? Number(mc.defaultValue) : 0),
                        mode: isPercent ? 'percent' as const : 'fixed' as const, percentValue: defaultPct, type: 'earning' as const,
                      }]);
                      setShowComponentPicker(false);
                    }} className="text-left p-1.5 rounded border border-blue-200 bg-white hover:bg-blue-50 text-[10px]">
                      <span className="font-medium text-gray-800">{mc.name}</span>
                      <span className="text-gray-400 ml-1">{mc.defaultPercentage ? `${Number(mc.defaultPercentage)}%` : ''}</span>
                    </button>
                  ))
                }
              </div>
            </div>
          )}

          <div className="space-y-0.5">
            {earnings.map(comp => (
              <SalaryComponentRow key={comp.id} component={comp} editing={editing && salaryMode === 'custom'} monthly={monthly}
                error={errors[comp.id]} onUpdate={(u) => updateEarning(comp.id, u)}
                onRemove={comp.isRequired ? undefined : () => removeEarning(comp.id)} />
            ))}
          </div>
          <div className="border-t border-gray-200 pt-2 mt-2 flex justify-between items-center">
            <span className="text-xs font-semibold text-gray-700">Gross Monthly</span>
            <span className="text-sm font-bold font-mono text-brand-600" data-mono>{formatCurrency(Math.round(grossEarnings))}</span>
          </div>
        </div>

        {/* RIGHT: Deductions */}
        <div className="layer-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Deductions (Monthly)</h3>
            {editing && salaryMode === 'custom' && (
              <button onClick={addDeduction} className="text-[10px] text-brand-600 hover:text-brand-700 font-medium flex items-center gap-0.5">
                <Plus size={11} /> Add
              </button>
            )}
          </div>

          {/* Statutory — toggleable */}
          <div className="space-y-1 mb-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Statutory</p>

            {/* EPF */}
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                {editing && (
                  <button onClick={() => setEpfEnabled(!epfEnabled)} className={`w-7 h-4 rounded-full transition-colors relative ${epfEnabled ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${epfEnabled ? 'left-3.5' : 'left-0.5'}`} />
                  </button>
                )}
                <span className={`text-xs ${epfEnabled ? 'text-gray-600' : 'text-gray-400 line-through'}`}>EPF 12%</span>
                <span className="text-[10px] text-gray-400">ER: {formatCurrency(activeEpfEmployer)}</span>
              </div>
              <span className={`text-xs font-mono ${epfEnabled ? 'text-red-600' : 'text-gray-300'}`} data-mono>-{formatCurrency(activeEpfEmployee)}</span>
            </div>

            {/* ESI */}
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                {editing && (
                  <button onClick={() => setEsiEnabled(!esiEnabled)} className={`w-7 h-4 rounded-full transition-colors relative ${esiEnabled ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${esiEnabled ? 'left-3.5' : 'left-0.5'}`} />
                  </button>
                )}
                <span className={`text-xs ${esiEnabled ? 'text-gray-600' : 'text-gray-400 line-through'}`}>ESI 0.75%</span>
                {grossEarnings > 21000 && <span className="text-[10px] text-amber-500">N/A &gt;21K</span>}
                {grossEarnings <= 21000 && <span className="text-[10px] text-gray-400">ER: {formatCurrency(activeEsiEmployer)}</span>}
              </div>
              <span className={`text-xs font-mono ${esiEnabled && grossEarnings <= 21000 ? 'text-red-600' : 'text-gray-300'}`} data-mono>-{formatCurrency(activeEsiEmployee)}</span>
            </div>

            {/* PT */}
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                {editing && (
                  <button onClick={() => setPtEnabled(!ptEnabled)} className={`w-7 h-4 rounded-full transition-colors relative ${ptEnabled ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${ptEnabled ? 'left-3.5' : 'left-0.5'}`} />
                  </button>
                )}
                <span className={`text-xs ${ptEnabled ? 'text-gray-600' : 'text-gray-400 line-through'}`}>Professional Tax</span>
                <span className="text-[10px] text-gray-400">Slab</span>
              </div>
              <span className={`text-xs font-mono ${ptEnabled ? 'text-red-600' : 'text-gray-300'}`} data-mono>-{formatCurrency(activePt)}</span>
            </div>
          </div>

          {/* Custom deductions */}
          {(customDeductions.length > 0 || editing) && (
            <div className="space-y-0.5">
              {customDeductions.length > 0 && <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Custom</p>}
              {customDeductions.map(comp => (
                <SalaryComponentRow key={comp.id} component={comp} editing={editing} monthly={monthly}
                  error={errors[comp.id]} onUpdate={(u) => updateDeduction(comp.id, u)}
                  onRemove={() => removeDeduction(comp.id)} isDeduction />
              ))}
            </div>
          )}

          {/* Deduction picker from library */}
          {editing && (
            <div className="mt-2">
              {componentMaster.filter((mc: any) => mc.type === 'DEDUCTION' && mc.isActive && !mc.isStatutory && !customDeductions.find(d => d.name === mc.name)).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  <span className="text-[10px] text-gray-400 self-center mr-1">Quick add:</span>
                  {componentMaster
                    .filter((mc: any) => mc.type === 'DEDUCTION' && mc.isActive && !mc.isStatutory && !customDeductions.find(d => d.name === mc.name))
                    .slice(0, 5)
                    .map((mc: any) => (
                      <button key={mc.id} onClick={() => {
                        componentCounter++;
                        setCustomDeductions(prev => [...prev, {
                          id: `master_${mc.code}_${componentCounter}`, name: mc.name,
                          amount: mc.defaultValue ? Number(mc.defaultValue) : 0, mode: 'fixed', percentValue: 0, type: 'deduction',
                        }]);
                      }} className="text-[10px] px-2 py-0.5 rounded-full border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
                        + {mc.name}
                      </button>
                    ))
                  }
                </div>
              )}
            </div>
          )}

          <div className="border-t border-gray-200 pt-2 mt-2 space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-gray-700">Total Deductions</span>
              <span className="text-sm font-bold font-mono text-red-600" data-mono>-{formatCurrency(Math.round(totalDeductionsCalc))}</span>
            </div>
            <div className="flex justify-between items-center border-t border-gray-200 pt-1.5">
              <span className="text-xs font-semibold text-gray-700">Net Take-Home</span>
              <span className={`text-sm font-bold font-mono ${netMonthlyCalc < 0 ? 'text-red-600' : 'text-emerald-600'}`} data-mono>{formatCurrency(Math.round(netMonthlyCalc))}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Salary Revision History */}
      {isManagement && salaryHistory.length > 0 && (
        <div className="layer-card p-5 mt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Salary Revision History</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium text-right">Previous CTC</th>
                  <th className="pb-2 font-medium text-right">New CTC</th>
                  <th className="pb-2 font-medium">Changed By</th>
                  <th className="pb-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {salaryHistory.slice(0, 10).map((rev: any, i: number) => (
                  <tr key={rev.id || i} className="border-b border-gray-50 hover:bg-gray-25">
                    <td className="py-2 text-gray-700 font-mono text-xs" data-mono>
                      {new Date(rev.effectiveFrom || rev.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        rev.changeType === 'PROMOTION' ? 'bg-emerald-50 text-emerald-700' :
                        rev.changeType === 'REVISION' ? 'bg-blue-50 text-blue-700' :
                        rev.changeType === 'CORRECTION' ? 'bg-amber-50 text-amber-700' :
                        rev.changeType === 'TEMPLATE_APPLIED' ? 'bg-purple-50 text-purple-700' :
                        'bg-gray-50 text-gray-700'
                      }`}>
                        {rev.changeType?.replace(/_/g, ' ') || 'INITIAL'}
                      </span>
                    </td>
                    <td className="py-2 text-right font-mono text-gray-500 text-xs" data-mono>
                      {rev.previousCtc ? `₹${Number(rev.previousCtc).toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className="py-2 text-right font-mono text-gray-900 font-medium text-xs" data-mono>
                      ₹{Number(rev.ctc).toLocaleString('en-IN')}
                    </td>
                    <td className="py-2 text-gray-600 text-xs">{rev.changedByName || '—'}</td>
                    <td className="py-2 text-gray-500 text-xs truncate max-w-[120px]">{rev.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Statutory & Compliance */}
      {isManagement && (
        <div className="layer-card p-5 mt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Statutory & Compliance</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-gray-500 text-xs">EPF Status</p>
              <p className="text-gray-800 font-medium">
                {(earnings.find(e => e.name === 'Basic Salary')?.amount ?? 0) > 0 ? '✓ Enrolled' : '— Not applicable'}
              </p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">ESI Status</p>
              <p className="text-gray-800 font-medium">
                {(() => { const gross = earnings.reduce((s, e) => s + e.amount, 0); return gross <= 21000 ? '✓ Applicable' : '— Gross exceeds ₹21,000'; })()}
              </p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Tax Regime</p>
              <p className="text-gray-800 font-medium">{taxRegime === 'NEW_REGIME' ? 'New Regime' : 'Old Regime'}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">PAN Status</p>
              <p className="text-gray-800 font-medium">{(structure as any)?.pan ? '✓ On file' : '⚠ Missing'}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Bank Details</p>
              <p className="text-gray-800 font-medium">{(structure as any)?.bankAccountNumber ? '✓ Verified' : '⚠ Not provided'}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Salary Version</p>
              <p className="text-gray-800 font-medium font-mono" data-mono>v{(structure as any)?.version || 1}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SalaryComponentRow({
  component,
  editing,
  monthly,
  error,
  onUpdate,
  onRemove,
  isDeduction,
}: {
  component: SalaryComponent;
  editing: boolean;
  monthly: number;
  error?: string;
  onUpdate: (updates: Partial<SalaryComponent>) => void;
  onRemove?: () => void;
  isDeduction?: boolean;
}) {
  if (!editing) {
    return (
      <div className="flex justify-between items-center py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">{component.name}</span>
          {component.mode === 'percent' && component.percentValue > 0 && (
            <span className="text-[9px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{component.percentValue}%</span>
          )}
        </div>
        <span className={`text-sm font-mono ${isDeduction ? 'text-red-600' : component.amount > 0 ? 'text-gray-800' : 'text-gray-300'}`} data-mono>
          {isDeduction ? '-' : ''}{component.amount > 0 ? formatCurrency(Math.round(component.amount)) : component.mode === 'percent' && component.percentValue > 0 ? `${component.percentValue}% of CTC` : formatCurrency(0)}
        </span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 py-1.5 rounded-lg transition-colors ${error ? 'bg-red-50 px-2 -mx-2' : ''}`}>
      {/* Component Name */}
      <input
        type="text"
        value={component.name}
        onChange={e => onUpdate({ name: e.target.value })}
        disabled={component.isRequired}
        placeholder="Component name"
        className={`input-glass text-xs flex-1 min-w-0 py-1.5 ${component.isRequired ? 'bg-gray-50 text-gray-600' : ''} ${error && !component.name.trim() ? 'ring-2 ring-red-400' : ''}`}
      />

      {/* Mode Toggle */}
      <button
        onClick={() => {
          const newMode = component.mode === 'fixed' ? 'percent' : 'fixed';
          if (newMode === 'percent') {
            const pct = monthly > 0 ? (component.amount / monthly) * 100 : 0;
            onUpdate({ mode: 'percent', percentValue: Math.round(pct * 100) / 100 });
          } else {
            onUpdate({ mode: 'fixed' });
          }
        }}
        className="text-[10px] font-mono px-2 py-1 rounded border border-gray-200 hover:border-brand-400 hover:bg-brand-50 transition-colors whitespace-nowrap"
        title={component.mode === 'percent' ? 'Switch to fixed amount' : 'Switch to % of CTC'}
      >
        {component.mode === 'percent' ? '%' : '₹'}
      </button>

      {/* Percent Input (shown when in percent mode) */}
      {component.mode === 'percent' && (
        <input
          type="number"
          value={component.percentValue || ''}
          onChange={e => {
            const pct = Number(e.target.value);
            onUpdate({ percentValue: pct, amount: Math.round(monthly * pct / 100) });
          }}
          className="input-glass text-xs w-16 text-right py-1.5 font-mono"
          data-mono
          placeholder="%"
          min={0}
          max={100}
          step={0.5}
        />
      )}

      {/* Amount Input */}
      <input
        type="number"
        value={component.amount || ''}
        onChange={e => {
          const amt = Number(e.target.value);
          onUpdate({
            amount: amt,
            ...(component.mode === 'percent' && monthly > 0 ? { percentValue: Math.round((amt / monthly) * 100 * 100) / 100 } : {}),
          });
        }}
        className={`input-glass text-xs w-28 text-right py-1.5 font-mono ${error ? 'ring-2 ring-red-400' : ''}`}
        data-mono
        placeholder="Amount"
        min={0}
      />

      {/* Delete Button */}
      {onRemove ? (
        <button
          onClick={onRemove}
          className="text-gray-400 hover:text-red-500 transition-colors p-0.5"
          title="Remove component"
        >
          <XCircle size={16} />
        </button>
      ) : (
        <div className="w-[20px]" /> /* spacer for required components */
      )}

      {/* Error tooltip */}
      {error && <span className="text-[10px] text-red-500 absolute right-0 -bottom-4">{error}</span>}
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

/* =============================================================================
   HR KYC Upload Modal — mirrors employee onboarding flow for offline uploads
   ============================================================================= */

type HrUploadExperience = 'FRESHER' | 'EXPERIENCED';
type HrUploadQual = 'TENTH' | 'TWELFTH' | 'GRADUATION' | 'POST_GRADUATION' | 'PHD';

const HR_QUAL_ORDER = ['TENTH', 'TWELFTH', 'GRADUATION', 'POST_GRADUATION', 'PHD'];
const HR_IDENTITY_TYPES = ['AADHAAR', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID'];
const HR_EMPLOYMENT_TYPES = ['EXPERIENCE_LETTER', 'RELIEVING_LETTER', 'OFFER_LETTER_DOC', 'SALARY_SLIP_DOC'];

interface HrRequiredDoc {
  type: string;
  label: string;
  hint?: string;
  required: boolean;
  acceptsAnyOf?: string[];
}

function computeHrRequiredDocs(exp: HrUploadExperience, qual: HrUploadQual): HrRequiredDoc[] {
  const docs: HrRequiredDoc[] = [];
  const idx = HR_QUAL_ORDER.indexOf(qual);
  if (idx >= 0) docs.push({ type: 'TENTH_CERTIFICATE',           label: '10th Marksheet / Certificate',              required: true });
  if (idx >= 1) docs.push({ type: 'TWELFTH_CERTIFICATE',          label: '12th Marksheet / Certificate',              required: true });
  if (idx >= 2) docs.push({ type: 'DEGREE_CERTIFICATE',           label: 'Graduation / Degree Certificate',           required: true });
  if (idx >= 3) docs.push({ type: 'POST_GRADUATION_CERTIFICATE',  label: 'Post-Graduation Certificate',               required: true });
  docs.push({ type: 'IDENTITY_PROOF', label: 'Identity Proof (any one)', hint: 'Aadhaar, Passport, Driving License, or Voter ID', required: true, acceptsAnyOf: HR_IDENTITY_TYPES });
  docs.push({ type: 'PAN',            label: 'PAN Card',                                                              required: true });
  docs.push({ type: 'RESIDENCE_PROOF', label: 'Residence Proof',  hint: 'Utility bill, rent agreement, or address proof', required: true });
  if (exp === 'EXPERIENCED') {
    docs.push({ type: 'EMPLOYMENT_PROOF', label: 'Employment Proof (any one)', hint: 'Experience Letter, Relieving Letter, Appointment Letter', required: false, acceptsAnyOf: HR_EMPLOYMENT_TYPES });
  }
  docs.push({ type: 'PHOTO', label: 'Passport Size Photograph', required: true });
  return docs;
}

function isHrDocSubmitted(doc: HrRequiredDoc, submittedTypes: string[]): boolean {
  if (doc.acceptsAnyOf) return doc.acceptsAnyOf.some(t => submittedTypes.includes(t));
  return submittedTypes.includes(doc.type);
}

const HR_QUAL_LABELS: Record<string, string> = {
  TENTH:           '10th / SSLC',
  TWELFTH:         '12th / Intermediate / PUC',
  GRADUATION:      'Graduation / Bachelor\'s Degree',
  POST_GRADUATION: 'Post-Graduation / Master\'s Degree',
  PHD:             'PhD / Doctorate',
};

function HrKycUploadModal({
  employeeId,
  employeeName,
  existingDocs,
  onClose,
  onUploaded,
}: {
  employeeId: string;
  employeeName: string;
  existingDocs: any[];
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [uploadDoc, { isLoading: uploading }] = useUploadDocumentMutation();
  const [step, setStep] = useState<1 | 2>(1);
  const [experience, setExperience] = useState<HrUploadExperience>('FRESHER');
  const [qualification, setQualification] = useState<HrUploadQual>('GRADUATION');
  const [currentUploadType, setCurrentUploadType] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const existingTypes = existingDocs.map((d: any) => d.type);
  const requiredDocs = computeHrRequiredDocs(experience, qualification);

  const handleFileSelect = async (docSpec: HrRequiredDoc, file: File) => {
    // Resolve actual doc type for "any one" groups
    let resolvedType = docSpec.type;
    let resolvedLabel = docSpec.label;
    if (docSpec.acceptsAnyOf) {
      // Use the first type in acceptsAnyOf (e.g. AADHAAR for IDENTITY_PROOF, EXPERIENCE_LETTER for EMPLOYMENT_PROOF)
      if (docSpec.type === 'IDENTITY_PROOF') { resolvedType = 'AADHAAR'; resolvedLabel = 'Identity Proof'; }
      else if (docSpec.type === 'EMPLOYMENT_PROOF') { resolvedType = 'EXPERIENCE_LETTER'; resolvedLabel = 'Employment Proof'; }
    }
    if (docSpec.type === 'PHOTO') { resolvedType = 'PHOTO'; resolvedLabel = 'Passport Size Photo'; }

    setCurrentUploadType(docSpec.type);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('type', resolvedType);
    fd.append('name', resolvedLabel);
    fd.append('employeeId', employeeId);
    try {
      await uploadDoc(fd).unwrap();
      toast.success(`${resolvedLabel} uploaded — OCR verification started`);
      onUploaded();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Upload failed');
    }
    setCurrentUploadType(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-base font-display font-bold text-gray-900">Upload KYC Documents</h3>
            <p className="text-xs text-gray-500 mt-0.5">Uploading for <span className="font-medium text-gray-700">{employeeName}</span> — same OCR verification as employee self-upload</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex gap-4 px-6 pt-4">
          {[{ n: 1, label: 'Employee Profile' }, { n: 2, label: 'Upload Documents' }].map(s => (
            <div key={s.n} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${step === s.n ? 'bg-brand-600 text-white' : step > s.n ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-400'}`}>
                {step > s.n ? <Check size={12} /> : s.n}
              </div>
              <span className={`text-xs ${step === s.n ? 'text-brand-600 font-medium' : 'text-gray-400'}`}>{s.label}</span>
              {s.n < 2 && <div className="w-8 h-px bg-gray-200 mx-1" />}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-3">Is this employee a fresher or experienced?</p>
                <div className="grid grid-cols-2 gap-3">
                  {(['FRESHER', 'EXPERIENCED'] as HrUploadExperience[]).map(opt => (
                    <button
                      key={opt}
                      onClick={() => setExperience(opt)}
                      className={`p-4 rounded-xl border-2 text-sm font-medium transition-all text-left ${experience === opt ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-gray-100 text-gray-600 hover:border-brand-200'}`}
                    >
                      {opt === 'FRESHER' ? '🎓 Fresher' : '💼 Experienced'}
                      <p className="text-xs font-normal text-gray-400 mt-1">
                        {opt === 'FRESHER' ? 'No prior work experience' : 'Has previous employment'}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-gray-700 mb-3">Highest educational qualification</p>
                <div className="grid grid-cols-1 gap-2">
                  {(Object.entries(HR_QUAL_LABELS) as [HrUploadQual, string][]).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setQualification(val)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-sm transition-all ${qualification === val ? 'border-brand-600 bg-brand-50 text-brand-700 font-medium' : 'border-gray-100 text-gray-600 hover:border-brand-200'}`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${qualification === val ? 'border-brand-600 bg-brand-600' : 'border-gray-300'}`} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => setStep(2)}
                className="w-full btn-primary flex items-center justify-center gap-2"
              >
                Continue to Upload <ArrowRight size={16} />
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-4">
                <button onClick={() => setStep(1)} className="text-gray-400 hover:text-gray-600">
                  <ArrowLeft size={16} />
                </button>
                <p className="text-xs text-gray-500">
                  {experience === 'FRESHER' ? 'Fresher' : 'Experienced'} · {HR_QUAL_LABELS[qualification]}
                </p>
              </div>

              <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-700 flex items-start gap-2">
                <Shield size={13} className="mt-0.5 shrink-0" />
                <span>Each document upload triggers the same Python OCR + tamper-detection pipeline used during employee onboarding. HR will see OCR results in the Documents tab.</span>
              </div>

              {requiredDocs.map(doc => {
                const isSubmitted = isHrDocSubmitted(doc, existingTypes);
                const isUploading = currentUploadType === doc.type;

                return (
                  <div
                    key={doc.type}
                    className={`flex items-center gap-3 p-3 rounded-xl border ${isSubmitted ? 'border-emerald-200 bg-emerald-50' : 'border-gray-100 bg-gray-50'}`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isSubmitted ? 'bg-emerald-100' : 'bg-white border border-gray-200'}`}>
                      {isSubmitted
                        ? <Check size={16} className="text-emerald-600" />
                        : <FileText size={16} className="text-gray-400" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${isSubmitted ? 'text-emerald-700' : 'text-gray-700'}`}>{doc.label}</p>
                      {doc.hint && <p className="text-xs text-gray-400 mt-0.5 truncate">{doc.hint}</p>}
                      {!doc.required && <span className="text-[10px] text-gray-400">(Optional)</span>}
                    </div>
                    <div className="shrink-0">
                      {isSubmitted ? (
                        <span className="text-xs text-emerald-600 font-medium">Uploaded</span>
                      ) : (
                        <>
                          <input
                            ref={el => { fileRefs.current[doc.type] = el; }}
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                            className="hidden"
                            onChange={e => {
                              const f = e.target.files?.[0];
                              if (f) handleFileSelect(doc, f);
                              e.target.value = '';
                            }}
                          />
                          <button
                            onClick={() => fileRefs.current[doc.type]?.click()}
                            disabled={isUploading || uploading}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium disabled:opacity-60 transition-colors"
                          >
                            {isUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                            {isUploading ? 'Uploading...' : 'Upload'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              <div className="pt-2 flex items-center justify-between text-xs text-gray-400">
                <span>{existingTypes.filter(t => requiredDocs.some(d => d.acceptsAnyOf ? d.acceptsAnyOf.includes(t) : d.type === t)).length} / {requiredDocs.length} uploaded</span>
                <button onClick={onClose} className="text-brand-600 hover:text-brand-700 font-medium">Done</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* =============================================================================
   Documents Tab — Upload & View
   ============================================================================= */

const DOC_TYPES = ['AADHAAR', 'PAN', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID', 'BANK_STATEMENT', 'OFFER_LETTER', 'RELIEVING_LETTER', 'EDUCATION', 'EXPERIENCE', 'OTHER'];

function DocumentsTab({ employeeId, documents, isManagement, employeeName }: { employeeId: string; documents: any[]; isManagement: boolean; employeeName?: string }) {
  const [verifyDoc] = useVerifyDocumentMutation();
  const [deleteDoc] = useDeleteDocumentMutation();
  const [verifyKyc, { isLoading: verifyingAll }] = useVerifyKycMutation();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { data: ocrSummaryRes, refetch: refetchOcr } = useGetEmployeeOcrSummaryQuery(employeeId, { skip: !isManagement });
  const [showKycModal, setShowKycModal] = useState(false);
  const [ocrDocId, setOcrDocId] = useState<string | null>(null);
  const [ocrDocName, setOcrDocName] = useState('');
  const [ocrDocType, setOcrDocType] = useState('');
  const [ocrDocFileUrl, setOcrDocFileUrl] = useState('');
  const [ocrDocStatus, setOcrDocStatus] = useState('');

  // Build OCR lookup by documentId for inline display
  const ocrByDocId: Record<string, any> = {};
  if (ocrSummaryRes?.data) {
    for (const item of ocrSummaryRes.data) {
      if (item.ocr) ocrByDocId[item.documentId] = item.ocr;
    }
  }

  const handleVerify = async (docId: string, status: string) => {
    try {
      await verifyDoc({ id: docId, status }).unwrap();
      toast.success(`Document ${status.toLowerCase()}`);
    } catch { toast.error('Failed to verify'); }
  };

  const handleDelete = async () => {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      await deleteDoc(confirmDeleteId).unwrap();
      toast.success('Document deleted — employee KYC status updated');
      setConfirmDeleteId(null);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to delete document');
    } finally {
      setDeleting(false);
    }
  };

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState('');

  return (
    <div className="space-y-4">
      {/* KYC Upload Modal (HR uploads on behalf of employee) */}
      {showKycModal && isManagement && (
        <HrKycUploadModal
          employeeId={employeeId}
          employeeName={employeeName || 'Employee'}
          existingDocs={documents}
          onClose={() => setShowKycModal(false)}
          onUploaded={() => refetchOcr()}
        />
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">Documents ({documents.length})</h3>
        <div className="flex gap-2">
          {isManagement && documents.some((d: any) => d.status === 'PENDING') && (
            <button onClick={async () => {
              try {
                const pending = documents.filter((d: any) => d.status === 'PENDING');
                for (const doc of pending) {
                  await verifyDoc({ id: doc.id, status: 'VERIFIED' }).unwrap();
                }
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
          {isManagement && (
            <button onClick={() => setShowKycModal(true)} className="btn-primary text-xs flex items-center gap-1.5">
              <Plus size={14} /> Upload Document
            </button>
          )}
        </div>
      </div>

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
                <button onClick={() => { setPreviewUrl(getUploadUrl(doc.fileUrl)); setPreviewName(doc.name); }}
                  className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1 mb-2">
                  <FileText size={12} /> View Document
                </button>
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
              {isManagement && ocr && (() => {
                const conf = Math.round((ocr.confidence || 0) * 100);
                const isFlagged = ocr.ocrStatus === 'FLAGGED' || conf < 60;
                const hasName = !!ocr.extractedName;
                const hasDocNum = !!ocr.extractedDocNumber;
                const noTamper = !doc.tamperDetected && !(ocr.tamperingIndicators?.length);
                const crossOk = ocr.crossValidationStatus === 'PASS';
                const crossFail = ocr.crossValidationStatus === 'FAIL';
                // Build 4 KYC pointers
                const pointers: Array<{ ok: boolean | null; text: string }> = [
                  {
                    ok: conf >= 70 ? true : conf >= 40 ? null : false,
                    text: conf >= 70 ? `AI confidence: ${conf}% — reliable extraction`
                        : conf >= 40 ? `AI confidence: ${conf}% — verify manually`
                        : `Low confidence: ${conf}% — manual review required`,
                  },
                  {
                    ok: ocr.isScreenshot ? false : ocr.isOriginalScan ? true : null,
                    text: ocr.isScreenshot ? 'Screenshot detected — original scan required'
                        : ocr.isOriginalScan ? 'Original scan — not a screenshot or photocopy'
                        : 'Scan quality unverified — check original',
                  },
                  {
                    ok: noTamper ? true : false,
                    text: noTamper ? 'No tampering or forgery indicators detected'
                        : 'Potential tampering detected — review carefully',
                  },
                  ocr.crossValidationStatus
                    ? {
                        ok: crossOk ? true : crossFail ? false : null,
                        text: crossOk ? 'Name/DOB matches other uploaded documents'
                            : crossFail ? 'Name or DOB mismatch with other documents'
                            : 'Cross-document validation: partial match',
                      }
                    : hasDocNum
                    ? { ok: true, text: `Document number extracted: ${ocr.extractedDocNumber}` }
                    : { ok: hasName ? true : null, text: hasName ? `Name on document: ${ocr.extractedName}` : 'No name extracted — document may be unclear' },
                ];
                return (
                  <div className="mt-3 rounded-xl border border-gray-100 overflow-hidden bg-white shadow-sm">
                    {/* Card header */}
                    <div className={`px-3 py-2 flex items-center justify-between ${isFlagged ? 'bg-red-50 border-b border-red-100' : 'bg-indigo-50 border-b border-indigo-100'}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        {isFlagged && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">
                            <Shield size={9} /> FLAGGED
                          </span>
                        )}
                        {ocr.isOriginalScan && !ocr.isScreenshot && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-700">Original Scan</span>
                        )}
                        {ocr.isScreenshot && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700">Screenshot</span>
                        )}
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          ocr.resolutionQuality === 'HIGH' ? 'bg-emerald-100 text-emerald-700'
                          : ocr.resolutionQuality === 'MEDIUM' ? 'bg-amber-100 text-amber-700'
                          : 'bg-red-100 text-red-700'
                        }`}>{ocr.resolutionQuality || '?'} Quality</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          conf >= 70 ? 'bg-emerald-100 text-emerald-700'
                          : conf >= 40 ? 'bg-amber-100 text-amber-700'
                          : 'bg-red-100 text-red-700'
                        }`}>{conf}% conf</span>
                        {ocr.crossValidationStatus && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            crossOk ? 'bg-emerald-100 text-emerald-700'
                            : crossFail ? 'bg-red-100 text-red-700'
                            : 'bg-amber-100 text-amber-700'
                          }`}>Cross-val: {ocr.crossValidationStatus}</span>
                        )}
                      </div>
                      <span className="text-[9px] text-gray-400 font-mono shrink-0">OCR AI</span>
                    </div>

                    {/* Extracted fields (compact) */}
                    {(hasName || ocr.extractedDob || ocr.extractedFatherName || hasDocNum) && (
                      <div className="px-3 pt-2 pb-1 grid grid-cols-2 gap-x-3 gap-y-1">
                        {ocr.extractedName && <div><span className="text-[9px] text-gray-400 uppercase tracking-wide">Name</span><p className="text-[11px] font-semibold text-gray-800 truncate">{ocr.extractedName}</p></div>}
                        {ocr.extractedDob && <div><span className="text-[9px] text-gray-400 uppercase tracking-wide">DOB</span><p className="text-[11px] font-semibold text-gray-800">{ocr.extractedDob}</p></div>}
                        {ocr.extractedFatherName && <div><span className="text-[9px] text-gray-400 uppercase tracking-wide">Father</span><p className="text-[11px] font-semibold text-gray-800 truncate">{ocr.extractedFatherName}</p></div>}
                        {ocr.extractedDocNumber && <div><span className="text-[9px] text-gray-400 uppercase tracking-wide">Doc No.</span><p className="text-[11px] font-semibold text-gray-800 font-mono">{ocr.extractedDocNumber}</p></div>}
                        {ocr.extractedGender && <div><span className="text-[9px] text-gray-400 uppercase tracking-wide">Gender</span><p className="text-[11px] font-semibold text-gray-800">{ocr.extractedGender}</p></div>}
                        {ocr.extractedAddress && <div className="col-span-2"><span className="text-[9px] text-gray-400 uppercase tracking-wide">Address</span><p className="text-[11px] text-gray-700 line-clamp-1">{ocr.extractedAddress}</p></div>}
                      </div>
                    )}

                    {/* KYC verification pointers */}
                    <div className="px-3 py-2 border-t border-gray-50 space-y-1">
                      <p className="text-[9px] text-gray-400 uppercase tracking-widest font-semibold mb-1">KYC Verification Checks</p>
                      {pointers.map((p, i) => (
                        <div key={i} className="flex items-start gap-1.5">
                          <span className={`shrink-0 mt-0.5 w-3 h-3 rounded-full flex items-center justify-center text-white text-[8px] font-bold
                            ${p.ok === true ? 'bg-emerald-500' : p.ok === false ? 'bg-red-500' : 'bg-amber-400'}`}>
                            {p.ok === true ? '✓' : p.ok === false ? '✗' : '!'}
                          </span>
                          <span className={`text-[10px] leading-relaxed ${p.ok === false ? 'text-red-700 font-medium' : p.ok === null ? 'text-amber-700' : 'text-gray-600'}`}>
                            {p.text}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* View full details button */}
                    <div className="px-3 pb-3">
                      <button
                        onClick={() => { setOcrDocId(doc.id); setOcrDocName(doc.name); setOcrDocType(doc.type); setOcrDocFileUrl(doc.fileUrl); setOcrDocStatus(doc.status); }}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold transition-colors shadow-sm"
                      >
                        <Eye size={12} /> View Full OCR Details & Validation
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* HR verify/reject/delete actions */}
              {isManagement && (
                <div className="flex gap-2 mt-2 pt-2 border-t border-gray-50">
                  {doc.status === 'PENDING' && (
                    <>
                      <button onClick={() => handleVerify(doc.id, 'VERIFIED')} className="text-xs text-emerald-600 hover:bg-emerald-50 px-2 py-1 rounded-lg">Verify</button>
                      <button onClick={() => handleVerify(doc.id, 'REJECTED')} className="text-xs text-red-500 hover:bg-red-50 px-2 py-1 rounded-lg">Reject</button>
                    </>
                  )}
                  <button
                    onClick={() => setConfirmDeleteId(doc.id)}
                    className="ml-auto text-xs text-red-400 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg flex items-center gap-1 transition-colors"
                    title="Delete document"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
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

      {/* Document Preview Modal */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setPreviewUrl(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[90vw] h-[85vh] max-w-5xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800">{previewName}</h3>
              <div className="flex items-center gap-2">
                <a href={previewUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs px-3 py-1.5 bg-brand-50 text-brand-600 rounded-lg hover:bg-brand-100 font-medium">
                  Open in New Tab
                </a>
                <button onClick={() => setPreviewUrl(null)}
                  className="text-gray-400 hover:text-gray-600 p-1">
                  <XCircle size={20} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              {previewUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i) ? (
                <img src={previewUrl} alt={previewName} className="w-full h-full object-contain p-4" />
              ) : (
                <object data={previewUrl} type="application/pdf" className="w-full h-full">
                  <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
                    <FileText size={48} className="text-gray-300" />
                    <p className="text-sm text-gray-500">Unable to preview this document inline.</p>
                    <a href={previewUrl} target="_blank" rel="noopener noreferrer"
                      className="btn-primary text-sm px-4 py-2">
                      Download / Open Document
                    </a>
                  </div>
                </object>
              )}
            </div>
          </div>
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

      {/* Delete Confirmation Modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => !deleting && setConfirmDeleteId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-[420px] max-w-[90vw]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <Trash2 size={18} className="text-red-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Delete Document</h3>
                <p className="text-xs text-gray-500 mt-0.5">This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-5">
              Are you sure you want to delete this document? The file will be soft-deleted and an audit log entry will be created.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDeleteId(null)}
                disabled={deleting}
                className="btn-secondary text-sm px-4"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
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

// ---------- Connections Cards with full-screen map popup ----------
function ConnectionsCards({ employeeId, records }: { employeeId: string; records: any[] }) {
  const { data: lifecycleRes } = useGetLifecycleEventsQuery(employeeId);
  const [openModal, setOpenModal] = useState<string | null>(null);

  const lifecycleEvents = lifecycleRes?.data || [];
  const attendanceCount = records.length;
  const leaveCount = records.filter((r: any) => r.status === 'ON_LEAVE').length;
  const lifecycleCount = lifecycleEvents.length;

  const cards = [
    { key: 'attendance', l: 'Attendance', c: 'bg-emerald-50', t: 'text-emerald-600', i: Clock, n: attendanceCount },
    { key: 'leave', l: 'Leave Application', c: 'bg-purple-50', t: 'text-purple-600', i: Calendar, n: leaveCount },
    { key: 'lifecycle', l: 'Lifecycle', c: 'bg-blue-50', t: 'text-blue-600', i: Briefcase, n: lifecycleCount },
  ];

  return (
    <div className="layer-card p-5">
      <h3 className="text-sm font-semibold text-gray-800 mb-3">Connections</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map(card => (
          <div key={card.key} className="bg-surface-2 rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg ${card.c} flex items-center justify-center`}><card.i size={16} className={card.t} /></div>
              <div><p className="text-sm font-medium text-gray-700">{card.l}</p><p className="text-xs text-gray-400">{card.n} records</p></div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold font-mono text-gray-500" data-mono>{card.n}</span>
              <button onClick={() => setOpenModal(card.key)}
                className="w-6 h-6 rounded-md bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors">
                <Plus size={12} className="text-gray-500" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Attendance Map Modal */}
      <AnimatePresence>
        {openModal === 'attendance' && (
          <AttendanceMapModal employeeId={employeeId} records={records} onClose={() => setOpenModal(null)} />
        )}
        {openModal === 'leave' && (
          <LeaveDetailModal records={records} onClose={() => setOpenModal(null)} />
        )}
        {openModal === 'lifecycle' && (
          <LifecycleDetailModal events={lifecycleEvents} onClose={() => setOpenModal(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---- Attendance Map Modal (shows check-in/out locations on map + GPS trail for field) ----
function AttendanceMapModal({ employeeId, records, onClose }: { employeeId: string; records: any[]; onClose: () => void }) {
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [mapReady, setMapReady] = useState(false);

  // Lazy import react-leaflet to avoid SSR issues
  useEffect(() => { setMapReady(true); }, []);

  // Records with location data
  const locatedRecords = records.filter((r: any) => r.checkInLocation || r.checkOutLocation);

  // Build markers
  const markers = locatedRecords.flatMap((r: any) => {
    const out: any[] = [];
    const ciLoc = r.checkInLocation;
    const coLoc = r.checkOutLocation;
    if (ciLoc?.lat && ciLoc?.lng) out.push({ ...r, type: 'checkin', lat: ciLoc.lat, lng: ciLoc.lng, accuracy: ciLoc.accuracy });
    if (coLoc?.lat && coLoc?.lng) out.push({ ...r, type: 'checkout', lat: coLoc.lat, lng: coLoc.lng, accuracy: coLoc.accuracy });
    return out;
  });

  const defaultCenter: [number, number] = markers.length > 0 ? [markers[0].lat, markers[0].lng] : [28.6139, 77.209];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col overflow-hidden" style={{ maxHeight: 'min(90dvh, calc(100dvh - 2rem))' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-display font-semibold text-gray-900">Attendance Locations</h2>
            <p className="text-xs text-gray-400">{locatedRecords.length} records with GPS data out of {records.length} total</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <Plus size={20} className="text-gray-500 rotate-45" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden" style={{ minHeight: '500px' }}>
          {/* Left: Record list */}
          <div className="w-72 border-r border-gray-100 overflow-y-auto flex-shrink-0">
            <div className="p-3 border-b border-gray-50 bg-gray-50/50">
              <p className="text-xs font-medium text-gray-500">All Attendance ({records.length})</p>
            </div>
            {records.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-8">No records</p>
            ) : (
              records.slice(0, 50).map((r: any, i: number) => {
                const hasLoc = r.checkInLocation || r.checkOutLocation;
                const isSelected = selectedRecord?.id === r.id;
                return (
                  <button key={r.id || i} onClick={() => hasLoc && setSelectedRecord(r)}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 text-left border-b border-gray-50 transition-colors ${isSelected ? 'bg-emerald-50' : hasLoc ? 'hover:bg-gray-50 cursor-pointer' : 'opacity-50 cursor-default'}`}>
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${r.status === 'PRESENT' ? 'bg-emerald-500' : r.status === 'ABSENT' ? 'bg-red-500' : r.status === 'HALF_DAY' ? 'bg-amber-500' : r.status === 'ON_LEAVE' ? 'bg-purple-500' : 'bg-gray-300'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-700">{new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', weekday: 'short' })}</p>
                      <p className="text-[10px] text-gray-400">
                        {r.checkIn ? new Date(r.checkIn).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—'}
                        {r.checkOut ? ` → ${new Date(r.checkOut).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}` : ''}
                        {r.totalHours ? ` (${Number(r.totalHours).toFixed(1)}h)` : ''}
                      </p>
                    </div>
                    {hasLoc && <MapPin size={12} className="text-emerald-400 flex-shrink-0" />}
                  </button>
                );
              })
            )}
          </div>

          {/* Right: Map */}
          <div className="flex-1 relative">
            {mapReady && (
              <AttendanceLeafletMap
                markers={markers}
                center={selectedRecord?.checkInLocation ? [selectedRecord.checkInLocation.lat, selectedRecord.checkInLocation.lng] : defaultCenter}
                selectedRecord={selectedRecord}
              />
            )}
            {markers.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-50/80 z-10">
                <div className="text-center">
                  <MapPin size={32} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-sm text-gray-500">No GPS data available</p>
                  <p className="text-xs text-gray-400">Employee clock-in/out locations will appear here</p>
                </div>
              </div>
            )}

            {/* Selected record detail overlay */}
            {selectedRecord && (
              <div className="absolute bottom-4 left-4 right-4 z-[1000] bg-white rounded-xl shadow-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      {new Date(selectedRecord.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric', weekday: 'long' })}
                    </p>
                    <div className="flex items-center gap-4 mt-1">
                      <span className="text-xs text-gray-500">
                        Check-in: <strong>{selectedRecord.checkIn ? new Date(selectedRecord.checkIn).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—'}</strong>
                      </span>
                      <span className="text-xs text-gray-500">
                        Check-out: <strong>{selectedRecord.checkOut ? new Date(selectedRecord.checkOut).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—'}</strong>
                      </span>
                      <span className="text-xs text-gray-500">
                        Hours: <strong>{selectedRecord.totalHours ? `${Number(selectedRecord.totalHours).toFixed(1)}h` : '—'}</strong>
                      </span>
                    </div>
                    {selectedRecord.notes && <p className="text-[10px] text-amber-600 mt-1">{selectedRecord.notes}</p>}
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${selectedRecord.status === 'PRESENT' ? 'bg-emerald-50 text-emerald-700' : selectedRecord.status === 'HALF_DAY' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                    {selectedRecord.status?.replace('_', ' ')}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ---- Leaflet Map for attendance markers ----
function AttendanceLeafletMap({ markers, center, selectedRecord }: { markers: any[]; center: [number, number]; selectedRecord: any }) {
  // Dynamic import to avoid SSR issues with leaflet
  const [MapComponents, setMapComponents] = useState<any>(null);

  useEffect(() => {
    import('react-leaflet').then(mod => {
      setMapComponents(mod);
    });
    import('leaflet').then(L => {
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      });
    });
  }, []);

  if (!MapComponents) return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-gray-400" size={24} /></div>;

  const { MapContainer, TileLayer, CircleMarker, Popup, useMap } = MapComponents;

  function MapController({ center, shouldFly }: { center: [number, number]; shouldFly: boolean }) {
    const map = useMap();
    // Invalidate map size on mount so tiles render fully
    useEffect(() => {
      setTimeout(() => { map.invalidateSize(); }, 100);
    }, []);
    // Fly to selected record location
    useEffect(() => {
      if (shouldFly) {
        map.flyTo(center, 16, { duration: 0.8 });
        // Invalidate again after fly animation
        setTimeout(() => { map.invalidateSize(); }, 900);
      }
    }, [center[0], center[1], shouldFly]);
    return null;
  }

  return (
    <MapContainer center={center} zoom={markers.length > 0 ? 14 : 5} style={{ height: '100%', width: '100%', minHeight: '500px' }} scrollWheelZoom zoomControl>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
      <MapController center={center} shouldFly={!!selectedRecord} />
      {markers.map((m: any, i: number) => {
        const isCheckIn = m.type === 'checkin';
        const isSelected = selectedRecord?.id === m.id;
        return (
          <CircleMarker key={`${m.id}-${m.type}-${i}`}
            center={[m.lat, m.lng]}
            radius={isSelected ? 10 : 7}
            pathOptions={{
              color: isCheckIn ? '#059669' : '#dc2626',
              fillColor: isCheckIn ? '#10b981' : '#ef4444',
              fillOpacity: isSelected ? 0.9 : 0.6,
              weight: isSelected ? 3 : 2,
            }}>
            <Popup>
              <div className="text-xs">
                <p className="font-semibold">{isCheckIn ? 'Check-In' : 'Check-Out'}</p>
                <p>{new Date(m.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                <p>{isCheckIn && m.checkIn ? new Date(m.checkIn).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : ''}</p>
                <p>{!isCheckIn && m.checkOut ? new Date(m.checkOut).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : ''}</p>
                {m.accuracy && <p className="text-gray-400">Accuracy: {Math.round(m.accuracy)}m</p>}
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}

// ---- Leave Detail Modal ----
function LeaveDetailModal({ records, onClose }: { records: any[]; onClose: () => void }) {
  const leaveRecords = records.filter((r: any) => r.status === 'ON_LEAVE');

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden" style={{ maxHeight: 'min(80dvh, calc(100dvh - 2rem))' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-display font-semibold text-gray-900">Leave Applications</h2>
            <p className="text-xs text-gray-400">{leaveRecords.length} leave days recorded</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <Plus size={20} className="text-gray-500 rotate-45" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {leaveRecords.length === 0 ? (
            <div className="text-center py-12">
              <Calendar size={32} className="mx-auto text-gray-200 mb-2" />
              <p className="text-sm text-gray-500">No leave records</p>
            </div>
          ) : (
            <div className="space-y-2">
              {leaveRecords.map((r: any, i: number) => (
                <div key={r.id || i} className="flex items-center gap-3 p-3 bg-purple-50/50 rounded-xl border border-purple-100">
                  <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
                    <Calendar size={16} className="text-purple-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">{new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric', weekday: 'long' })}</p>
                    <p className="text-xs text-gray-400">{r.workMode || 'OFFICE'} mode</p>
                  </div>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">On Leave</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ---- Lifecycle Events Detail Modal ----
function LifecycleDetailModal({ events, onClose }: { events: any[]; onClose: () => void }) {
  const typeColors: Record<string, string> = {
    JOINING: 'bg-emerald-100 text-emerald-700',
    PROBATION_END: 'bg-blue-100 text-blue-700',
    CONFIRMATION: 'bg-green-100 text-green-700',
    PROMOTION: 'bg-indigo-100 text-indigo-700',
    TRANSFER: 'bg-cyan-100 text-cyan-700',
    SALARY_REVISION: 'bg-amber-100 text-amber-700',
    WARNING: 'bg-red-100 text-red-700',
    SEPARATION: 'bg-gray-100 text-gray-700',
    STATUS_CHANGE: 'bg-violet-100 text-violet-700',
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden" style={{ maxHeight: 'min(80dvh, calc(100dvh - 2rem))' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-display font-semibold text-gray-900">Lifecycle Events</h2>
            <p className="text-xs text-gray-400">{events.length} events recorded</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <Plus size={20} className="text-gray-500 rotate-45" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {events.length === 0 ? (
            <div className="text-center py-12">
              <Briefcase size={32} className="mx-auto text-gray-200 mb-2" />
              <p className="text-sm text-gray-500">No lifecycle events</p>
            </div>
          ) : (
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-5 top-4 bottom-4 w-px bg-gray-200" />
              <div className="space-y-4">
                {events.map((ev: any) => (
                  <div key={ev.id} className="flex gap-4 relative">
                    <div className="w-10 h-10 rounded-full bg-white border-2 border-gray-200 flex items-center justify-center flex-shrink-0 z-10">
                      <Briefcase size={14} className="text-gray-500" />
                    </div>
                    <div className="flex-1 bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${typeColors[ev.eventType || ev.type] || 'bg-gray-100 text-gray-600'}`}>
                          {(ev.eventType || ev.type || '').replace(/_/g, ' ')}
                        </span>
                        <span className="text-[10px] text-gray-400">{new Date(ev.eventDate || ev.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                      </div>
                      <p className="text-sm font-medium text-gray-800">{ev.title}</p>
                      {ev.description && <p className="text-xs text-gray-500 mt-1">{ev.description}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
