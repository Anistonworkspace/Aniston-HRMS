import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Mail, Phone, Building2, MapPin, Shield, Edit2, Key, Loader2, Save, X, UserMinus, AlertTriangle, Clock, CheckCircle2, CreditCard, MessageSquare, ShieldCheck, ShieldOff, HardHat, FileText, XCircle, Fingerprint } from 'lucide-react';
import { isBiometricAvailable } from '../../lib/capacitorBiometric';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useAppDispatch } from '../../app/store';
import { setAccessToken } from '../auth/authSlice';
import { useGetMeQuery, useChangePasswordMutation, useGetMfaStatusQuery } from '../auth/authApi';
import { MFASetupModal, MFADisableModal } from '../auth/MFASetupModal';
import { useUpdateEmployeeMutation, useGetEmployeeQuery, useConfirmBankByEmployeeMutation } from '../employee/employeeApi';
import { useSubmitResignationMutation } from '../exit/exitApi';
import { useGetMyProfileEditRequestsQuery, useApplyApprovedEditMutation } from './profileEditRequestApi';
import ProfileUpdateRequestModal from './ProfileUpdateRequestModal';
import { getInitials, formatDate, getUploadUrl } from '../../lib/utils';
import toast from 'react-hot-toast';
import { useEmpPerms } from '../../hooks/useEmpPerms';
import PermDenied from '../../components/PermDenied';

function isReadableBankAccount(val: string | null | undefined): boolean {
  if (!val || val === '__REENTRY_REQUIRED__') return false;
  return /^\d{6,20}$/.test(val.replace(/[\s\-]/g, ''));
}

export default function ProfilePage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('hi') ? 'hi-IN' : 'en-IN';
  const user = useAppSelector((s) => s.auth.user);
  const [searchParams] = useSearchParams();
  const isOnboarding = searchParams.get('onboarding') === 'true';
  const { isLoading } = useGetMeQuery();

  // Fetch full employee data if employeeId exists
  const { data: empRes } = useGetEmployeeQuery(user?.employeeId || '', { skip: !user?.employeeId });
  const employee = empRes?.data;

  const [updateEmployee, { isLoading: updating }] = useUpdateEmployeeMutation();
  const [confirmBank, { isLoading: confirmingBank }] = useConfirmBankByEmployeeMutation();
  const [submitResignation, { isLoading: resigning }] = useSubmitResignationMutation();
  const [applyApprovedEdit, { isLoading: applyingEdit }] = useApplyApprovedEditMutation();
  const [showEdit, setShowEdit] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showMfaSetup, setShowMfaSetup] = useState(false);
  const [showMfaDisable, setShowMfaDisable] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [activeEditRequestId, setActiveEditRequestId] = useState<string | null>(null);
  const [activeEditCategory, setActiveEditCategory] = useState<string | null>(null);
  const { data: mfaStatus, refetch: refetchMfa } = useGetMfaStatusQuery();

  const { perms } = useEmpPerms();
  const isEmployeeRole = ['EMPLOYEE', 'INTERN'].includes(user?.role || '');
  const { data: editRequestsRes } = useGetMyProfileEditRequestsQuery(undefined, { skip: !isEmployeeRole });
  const myEditRequests: any[] = (editRequestsRes?.data as any[]) || [];
  const pendingRequests = myEditRequests.filter((r: any) => r.status === 'PENDING');
  const approvedRequests = myEditRequests.filter((r: any) => r.status === 'APPROVED');
  const rejectedRequests = myEditRequests.filter((r: any) => r.status === 'REJECTED');

  // Countdown timer helpers
  const getTimeLeft = (expiresAt: string) => {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return 'Expired';
    const hours = Math.floor(diff / 3_600_000);
    const mins = Math.floor((diff % 3_600_000) / 60_000);
    return `${hours}h ${mins}m`;
  };
  const CATEGORY_LABELS: Record<string, string> = {
    PERSONAL_DETAILS: 'Personal Details',
    ADDRESS: 'Address',
    EMERGENCY_CONTACT: 'Emergency Contact',
    BANK_DETAILS: 'Bank Details',
    EPF_DETAILS: 'EPF Details',
  };

  const [showResignModal, setShowResignModal] = useState(false);

  // Biometric lock state
  const BIOMETRIC_KEY = 'aniston_biometric_enabled';
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(() => localStorage.getItem(BIOMETRIC_KEY) === '1');
  useEffect(() => { isBiometricAvailable().then(setBiometricSupported); }, []);
  const [resignForm, setResignForm] = useState({ reason: '', lastWorkingDate: '' });

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    gender: '',
    phone: '',
    personalEmail: '',
    bloodGroup: '',
    maritalStatus: '',
    qualification: '',
    emergencyContact: { name: '', phone: '', relationship: '', email: '' },
    address: { line1: '', city: '', state: '', pincode: '' },
  });
  const [bankForm, setBankForm] = useState({
    bankAccountNumber: '',
    bankName: '',
    bankBranchName: '',
    ifscCode: '',
    accountHolderName: '',
    accountType: '',
  });
  const [showBankEdit, setShowBankEdit] = useState(false);
  const [savingBank, setSavingBank] = useState(false);
  const [showEpfEdit, setShowEpfEdit] = useState(false);
  const [epfForm, setEpfForm] = useState({ epfMemberId: '', epfUan: '', epfEnabled: false });
  const [savingEpf, setSavingEpf] = useState(false);
  const [requestDefaultCategory, setRequestDefaultCategory] = useState<'PERSONAL_DETAILS' | 'ADDRESS' | 'EMERGENCY_CONTACT' | 'BANK_DETAILS' | 'EPF_DETAILS' | undefined>(undefined);

  // Profile completion calculation — must be before any early return to keep hooks order stable
  const completionItems = useMemo(() => {
    if (!employee) return [];
    const items = [
      { label: t('profile.personalDetails'), done: !!(employee.phone && employee.phone !== '0000000000' && employee.dateOfBirth) },
      { label: t('profile.emergencyContact'), done: !!(employee.emergencyContact && (employee.emergencyContact as any)?.name) },
      { label: t('common.address'), done: !!(employee.address && (employee.address as any)?.city) },
      { label: t('profile.personalEmail'), done: !!employee.personalEmail },
      { label: t('profile.bloodGroup'), done: !!employee.bloodGroup },
    ];
    return items;
  }, [employee, t]);

  const completionPct = completionItems.length > 0
    ? Math.round((completionItems.filter(i => i.done).length / completionItems.length) * 100)
    : 0;

  useEffect(() => {
    if (employee) {
      setForm({
        firstName: employee.firstName || '',
        lastName: employee.lastName || '',
        dateOfBirth: employee.dateOfBirth ? (employee.dateOfBirth as string).split('T')[0] : '',
        gender: employee.gender || '',
        phone: employee.phone || '',
        personalEmail: employee.personalEmail || '',
        bloodGroup: employee.bloodGroup || '',
        maritalStatus: employee.maritalStatus || '',
        qualification: (employee as any).qualification || '',
        emergencyContact: {
          name: (employee.emergencyContact as any)?.name || '',
          phone: (employee.emergencyContact as any)?.phone || '',
          relationship: (employee.emergencyContact as any)?.relationship || '',
          email: (employee.emergencyContact as any)?.email || '',
        },
        address: (employee.address as any) || { line1: '', city: '', state: '', pincode: '' },
      });
      setBankForm({
        bankAccountNumber: isReadableBankAccount(employee.bankAccountNumber) ? employee.bankAccountNumber! : '',
        bankName: employee.bankName || '',
        bankBranchName: (employee as any).bankBranchName || '',
        ifscCode: employee.ifscCode || '',
        accountHolderName: employee.accountHolderName || '',
        accountType: employee.accountType || '',
      });
      setEpfForm({
        epfMemberId: (employee as any).epfMemberId || '',
        epfUan: (employee as any).epfUan || '',
        epfEnabled: (employee as any).epfEnabled ?? false,
      });
    }
  }, [employee]);

  const handleSaveProfile = async () => {
    if (!user?.employeeId) return;
    try {
      await updateEmployee({ id: user.employeeId, data: form as any }).unwrap();
      toast.success(t('profile.profileUpdated'));
      setShowEdit(false);
    } catch { toast.error(t('profile.failedToUpdate')); }
  };

  const handleApplyEdit = async (requestId: string) => {
    try {
      await applyApprovedEdit(requestId).unwrap();
      toast.success('Changes applied successfully');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to apply changes');
    }
  };

  const handleSaveBankDetails = async () => {
    if (!user?.employeeId) return;
    setSavingBank(true);
    try {
      let bankData: any;
      if (isEmployeeRole) {
        // Employees can only directly update branch name
        bankData = { bankBranchName: bankForm.bankBranchName || null };
      } else {
        // HR/Admin can update all fields
        bankData = { ...bankForm };
        if (!bankData.accountType) delete bankData.accountType;
      }
      await updateEmployee({ id: user.employeeId, data: bankData }).unwrap();
      toast.success(isEmployeeRole ? 'Branch name saved' : 'Bank details saved');
      setShowBankEdit(false);
    } catch { toast.error('Failed to save bank details'); }
    finally { setSavingBank(false); }
  };

  const handleSaveEpfDetails = async () => {
    if (!user?.employeeId) return;
    setSavingEpf(true);
    try {
      await updateEmployee({ id: user.employeeId, data: { epfMemberId: epfForm.epfMemberId || null, epfUan: epfForm.epfUan || null, epfEnabled: epfForm.epfEnabled } as any }).unwrap();
      toast.success('EPF details saved');
      setShowEpfEdit(false);
    } catch { toast.error('Failed to save EPF details'); }
    finally { setSavingEpf(false); }
  };

  if (isLoading) {
    return (
      <div className="page-container animate-pulse">
        <div className="h-7 bg-gray-200 rounded w-32 mb-6" />
        <div className="layer-card p-6 flex items-center gap-4 mb-4">
          <div className="w-16 h-16 bg-gray-200 rounded-full flex-shrink-0" />
          <div className="space-y-2 flex-1">
            <div className="h-5 bg-gray-200 rounded w-40" />
            <div className="h-3 bg-gray-100 rounded w-24" />
          </div>
        </div>
        <div className="layer-card p-6 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 bg-gray-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <h1 className="text-2xl font-display font-bold text-gray-900 mb-6">{t('profile.title')}</h1>

      {/* Onboarding banner */}
      {isOnboarding && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="layer-card p-4 mb-6"
          style={{ borderColor: 'var(--ui-border-color)', background: 'var(--primary-highlighted-color)' }}
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--primary-highlighted-color)' }}>
              <CheckCircle2 size={20} style={{ color: 'var(--primary-color)' }} />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-gray-900">{t('profile.welcomeMessage')}</h3>
              <p className="text-xs text-gray-500 mt-1">{t('profile.fillDetails')}</p>
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-gray-500">{t('profile.profileCompletion')}</span>
                  <span className="font-mono font-semibold" style={{ color: 'var(--primary-color)' }} data-mono>{completionPct}%</span>
                </div>
                <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ background: 'var(--primary-color)' }}
                    style={{ width: `${completionPct}%` }}
                  />
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {completionItems.map((item) => (
                    <span
                      key={item.label}
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        item.done
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {item.done ? t('profile.done') : t('profile.incomplete')}: {item.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Profile header */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="md:layer-card md:p-4 md:p-6 mb-6 min-w-0 max-w-full">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 min-w-0">
          <div className="relative shrink-0">
            <div className="w-24 h-24 rounded-2xl flex items-center justify-center font-bold text-3xl font-display" style={{ background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' }}>
              {employee?.avatar ? (
                <img src={getUploadUrl(employee.avatar)} alt="" className="w-full h-full rounded-2xl object-cover" />
              ) : (
                getInitials(user?.firstName, user?.lastName)
              )}
            </div>
          </div>
          <div className="text-center sm:text-left flex-1 min-w-0 w-full">
            <h2 className="text-xl font-display font-bold text-gray-900 break-words [overflow-wrap:anywhere]">
              {user?.firstName} {user?.lastName}
            </h2>
            <p className="text-gray-500 text-sm mt-0.5 break-words [overflow-wrap:anywhere]">
              {employee?.designation?.name || 'No designation'} · {employee?.department?.name || 'No department'}
            </p>
            <div className="flex flex-wrap gap-3 mt-3 justify-center sm:justify-start min-w-0">
              <span className="inline-flex items-start gap-1.5 text-sm text-gray-500 max-w-full break-words [overflow-wrap:anywhere]">
                <Mail size={14} className="text-gray-400 mt-0.5 shrink-0" /> <span className="min-w-0">{user?.email}</span>
              </span>
              {employee?.phone && (
                <span className="inline-flex items-start gap-1.5 text-sm text-gray-500 max-w-full">
                  <Phone size={14} className="text-gray-400 mt-0.5 shrink-0" /> <span className="min-w-0">{employee.phone}</span>
                </span>
              )}
              <span className="inline-flex items-start gap-1.5 text-sm text-gray-500 max-w-full">
                <Shield size={14} className="text-gray-400 mt-0.5 shrink-0" /> <span className="min-w-0">{user?.role?.replace(/_/g, ' ')}</span>
              </span>
              {employee?.employeeCode && (
                <span className="inline-flex items-start gap-1.5 text-sm text-gray-500 font-mono max-w-full" data-mono>
                  <span className="min-w-0">{employee.employeeCode}</span>
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap justify-center sm:justify-start mt-3 sm:mt-0">
            {isEmployeeRole && perms.canViewEditProfile && (
              <button
                onClick={() => setShowRequestModal(true)}
                className="btn-secondary flex items-center gap-1.5 text-xs md:text-sm px-3 md:px-4 py-2 md:py-2.5"
              >
                <MessageSquare size={13} /> Request Profile Update
              </button>
            )}
            {employee && !employee.exitStatus && employee.status !== 'TERMINATED' && (
              <button onClick={() => setShowResignModal(true)} className="flex items-center gap-1.5 text-xs md:text-sm px-3 md:px-4 py-2 md:py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
                <UserMinus size={13} /> {t('profile.submitResignation')}
              </button>
            )}
          </div>
        </div>
      </motion.div>

      {/* Exit Status Card */}
      {employee?.exitStatus && employee.exitStatus !== 'WITHDRAWN' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="layer-card p-4 mb-6 border border-amber-200 bg-amber-50/50">
          <div className="flex items-center gap-3">
            {employee.exitStatus === 'COMPLETED' ? <UserMinus size={20} className="text-emerald-600" /> : <Clock size={20} className="text-amber-600" />}
            <div>
              <p className="text-sm font-semibold text-gray-800">
                {employee.exitStatus === 'PENDING' && t('profile.resignationPending')}
                {employee.exitStatus === 'APPROVED' && t('profile.resignationApproved')}
                {employee.exitStatus === 'NO_DUES_PENDING' && t('profile.exitApproved')}
                {employee.exitStatus === 'COMPLETED' && t('profile.exitCompleted')}
              </p>
              <p className="text-xs text-gray-500">
                {employee.lastWorkingDate && `${t('profile.lastWorkingDate')} ${new Date(employee.lastWorkingDate).toLocaleDateString(locale)}`}
                {employee.exitType && ` · ${employee.exitType.replace(/_/g, ' ')}`}
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Approved edit request banners */}
      {approvedRequests.map((req: any) => (
        <motion.div key={req.id} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="layer-card p-4 mb-4 border border-emerald-300 bg-emerald-50">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <CheckCircle2 size={18} className="text-emerald-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-emerald-800">
                  {CATEGORY_LABELS[req.category]} update approved
                </p>
                <p className="text-xs text-emerald-700 mt-0.5">
                  HR approved your request. Time remaining: <span className="font-medium">{getTimeLeft(req.editWindowExpiresAt)}</span>
                </p>
                {req.hrNote && <p className="text-xs text-emerald-600 mt-1">HR note: {req.hrNote}</p>}
                {req.requestedData && Object.keys(req.requestedData).length > 0 && (
                  <p className="text-xs text-emerald-600 mt-1">
                    Changes: {Object.entries(req.requestedData).map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').trim()}: ${v}`).join(' · ')}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={() => handleApplyEdit(req.id)}
              disabled={applyingEdit}
              className="btn-primary text-xs px-3 py-1.5 whitespace-nowrap flex items-center gap-1.5 disabled:opacity-50"
            >
              {applyingEdit ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
              Apply Changes
            </button>
          </div>
        </motion.div>
      ))}

      {/* Pending request banners */}
      {pendingRequests.map((req: any) => (
        <motion.div key={req.id} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="layer-card p-4 mb-4 border border-amber-200 bg-amber-50/50">
          <div className="flex items-center gap-3">
            <Clock size={16} className="text-amber-600 shrink-0" />
            <p className="text-sm text-amber-700">
              <span className="font-medium">{CATEGORY_LABELS[req.category]}</span> update request pending HR review.
            </p>
          </div>
        </motion.div>
      ))}

      {/* Rejected request banners */}
      {rejectedRequests.map((req: any) => (
        <motion.div key={req.id} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="layer-card p-4 mb-4 border border-red-200 bg-red-50/50">
          <div className="flex items-start gap-3">
            <XCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-red-700">
                <span className="font-medium">{CATEGORY_LABELS[req.category]}</span> update request was rejected.
              </p>
              {req.hrNote && <p className="text-xs text-red-600 mt-0.5">HR note: {req.hrNote}</p>}
              <button
                onClick={() => { setRequestDefaultCategory(req.category); setShowRequestModal(true); }}
                className="text-xs font-medium mt-1"
                style={{ color: 'var(--primary-color)' }}
              >
                Submit a new request →
              </button>
            </div>
          </div>
        </motion.div>
      ))}

      {/* Profile Update Request Modal */}
      <AnimatePresence>
        {showRequestModal && (
          <ProfileUpdateRequestModal onClose={() => { setShowRequestModal(false); setRequestDefaultCategory(undefined); }} defaultCategory={requestDefaultCategory} />
        )}
      </AnimatePresence>

      {/* Resign Modal */}
      {showResignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowResignModal(false)}>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-display font-semibold text-gray-800">{t('profile.submitResignation')}</h3>
              <button onClick={() => setShowResignModal(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 text-amber-700 text-xs mb-4">
              <AlertTriangle size={14} />
              {t('profile.resignationNotice')}
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">{t('profile.reason')} *</label>
                <textarea
                  value={resignForm.reason}
                  onChange={e => setResignForm({ ...resignForm, reason: e.target.value })}
                  className="input-glass w-full text-sm" rows={3}
                  placeholder={t('profile.reason') + '...'}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">{t('profile.proposedLastDate')} *</label>
                <input
                  type="date"
                  value={resignForm.lastWorkingDate}
                  onChange={e => setResignForm({ ...resignForm, lastWorkingDate: e.target.value })}
                  className="input-glass w-full text-sm"
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>
              <button
                onClick={async () => {
                  if (!resignForm.reason || !resignForm.lastWorkingDate) { toast.error(t('profile.fillAllFields')); return; }
                  try {
                    await submitResignation(resignForm).unwrap();
                    toast.success(t('profile.resignationSubmitted'));
                    setShowResignModal(false);
                    setResignForm({ reason: '', lastWorkingDate: '' });
                  } catch (err: any) { toast.error(err?.data?.error?.message || t('common.failed')); }
                }}
                disabled={resigning}
                className="w-full bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                {resigning ? <Loader2 size={16} className="animate-spin" /> : <UserMinus size={16} />}
                {resigning ? t('common.loading') : t('profile.confirmResignation')}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Edit Profile Modal — HR/management only; employees go through request flow */}
      {showEdit && !isEmployeeRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setShowEdit(false)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={e => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 flex flex-col"
            style={{ maxHeight: 'min(90dvh, 640px)' }}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100 shrink-0">
              <h3 className="text-base font-display font-semibold text-gray-800">{t('profile.editProfile')}</h3>
              <button onClick={() => setShowEdit(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {/* PERSONAL_DETAILS or no restriction */}
              {(!activeEditCategory || activeEditCategory === 'PERSONAL_DETAILS') && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">First Name *</label>
                      <input value={form.firstName} onChange={e => setForm({...form, firstName: e.target.value})}
                        className="input-glass w-full text-sm" placeholder="First name" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Last Name *</label>
                      <input value={form.lastName} onChange={e => setForm({...form, lastName: e.target.value})}
                        className="input-glass w-full text-sm" placeholder="Last name" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('profile.dateOfBirth')}</label>
                      <input type="date" value={form.dateOfBirth} onChange={e => setForm({...form, dateOfBirth: e.target.value})}
                        className="input-glass w-full text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Gender</label>
                      <select value={form.gender} onChange={e => setForm({...form, gender: e.target.value})} className="input-glass w-full text-sm">
                        <option value="">{t('common.selectOption')}</option>
                        <option value="MALE">Male</option>
                        <option value="FEMALE">Female</option>
                        <option value="OTHER">Other</option>
                        <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('common.phone')} *</label>
                      <input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})}
                        className="input-glass w-full text-sm" placeholder="+91 XXXXXXXXXX" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('profile.personalEmail')}</label>
                      <input value={form.personalEmail} onChange={e => setForm({...form, personalEmail: e.target.value})}
                        className="input-glass w-full text-sm" placeholder="personal@email.com" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('profile.bloodGroup')}</label>
                      <select value={form.bloodGroup} onChange={e => setForm({...form, bloodGroup: e.target.value})} className="input-glass w-full text-sm">
                        <option value="">{t('common.selectOption')}</option>
                        {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg => <option key={bg} value={bg}>{bg}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('profile.maritalStatus')}</label>
                      <select value={form.maritalStatus} onChange={e => setForm({...form, maritalStatus: e.target.value})} className="input-glass w-full text-sm">
                        <option value="">{t('common.selectOption')}</option>
                        <option value="Single">{t('profile.single')}</option>
                        <option value="Married">{t('profile.married')}</option>
                        <option value="Divorced">{t('profile.divorced')}</option>
                        <option value="Widowed">{t('profile.widowed')}</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Highest Qualification</label>
                    <select value={form.qualification} onChange={e => setForm({...form, qualification: e.target.value})} className="input-glass w-full text-sm">
                      <option value="">Select qualification</option>
                      {['10th Pass', '12th Pass', 'Diploma', 'Graduation', 'Post Graduation', 'PhD'].map(q => <option key={q} value={q}>{q}</option>)}
                    </select>
                  </div>
                </>
              )}

              {/* ADDRESS */}
              {(!activeEditCategory || activeEditCategory === 'ADDRESS') && (
                <>
                  <h4 className="text-xs font-semibold text-gray-600">{t('common.address')}</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <input value={form.address.line1} onChange={e => setForm({...form, address: {...form.address, line1: e.target.value}})}
                        className="input-glass w-full text-sm" placeholder={t('profile.streetAddress')} />
                    </div>
                    <input value={form.address.city} onChange={e => setForm({...form, address: {...form.address, city: e.target.value}})}
                      className="input-glass w-full text-sm" placeholder={t('common.city')} />
                    <input value={form.address.state} onChange={e => setForm({...form, address: {...form.address, state: e.target.value}})}
                      className="input-glass w-full text-sm" placeholder={t('common.state')} />
                    <input value={form.address.pincode} onChange={e => setForm({...form, address: {...form.address, pincode: e.target.value}})}
                      className="input-glass w-full text-sm" placeholder={t('common.pincode')} />
                  </div>
                </>
              )}

              {/* EMERGENCY_CONTACT */}
              {(!activeEditCategory || activeEditCategory === 'EMERGENCY_CONTACT') && (
                <>
                  <h4 className="text-xs font-semibold text-gray-600">{t('profile.emergencyContact')}</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <input value={form.emergencyContact.name} onChange={e => setForm({...form, emergencyContact: {...form.emergencyContact, name: e.target.value}})}
                      className="input-glass w-full text-sm" placeholder={t('common.name')} />
                    <input value={form.emergencyContact.phone} onChange={e => setForm({...form, emergencyContact: {...form.emergencyContact, phone: e.target.value}})}
                      className="input-glass w-full text-sm" placeholder={t('common.phone')} />
                    <select value={form.emergencyContact.relationship} onChange={e => setForm({...form, emergencyContact: {...form.emergencyContact, relationship: e.target.value}})}
                      className="input-glass w-full text-sm">
                      <option value="">{t('profile.relationship')}</option>
                      <option value="SPOUSE">Spouse</option>
                      <option value="PARENT">Parent</option>
                      <option value="SIBLING">Sibling</option>
                      <option value="FRIEND">Friend</option>
                      <option value="OTHER">Other</option>
                    </select>
                    <input value={(form.emergencyContact as any).email || ''} onChange={e => setForm({...form, emergencyContact: {...form.emergencyContact, email: e.target.value}})}
                      className="input-glass w-full text-sm" placeholder="Email (optional)" type="email" />
                  </div>
                </>
              )}

              {/* BANK_DETAILS — handled separately via employee update; show info note */}
              {activeEditCategory === 'BANK_DETAILS' && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
                  Bank details are updated by HR after reviewing your request. Please wait for HR to contact you, or reach out directly.
                </div>
              )}
            </div>
            <div className="p-5 border-t border-gray-100 shrink-0">
              <button onClick={handleSaveProfile} disabled={updating} className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
                {updating ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {t('profile.saveChanges')}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {/* Employment info */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="layer-card p-4 md:p-6 min-w-0 max-w-full">
          <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <Building2 size={16} style={{ color: 'var(--primary-color)' }} /> {t('profile.employmentDetails')}
          </h3>
          <dl className="space-y-3">
            <ProfileRow label={t('profile.employeeCode')} value={employee?.employeeCode} mono />
            <ProfileRow label={t('common.department')} value={employee?.department?.name} />
            <ProfileRow label={t('common.designation')} value={employee?.designation?.name} />
            <ProfileRow label="Employment Type" value={(employee as any)?.employmentType?.replace(/_/g, ' ')} />
            <ProfileRow label="Experience Level" value={(employee as any)?.experienceLevel || undefined} />
            <ProfileRow label={t('profile.workMode')} value={employee?.workMode?.replace(/_/g, ' ')} />
            <ProfileRow label={t('profile.joiningDate')} value={employee?.joiningDate ? formatDate(employee.joiningDate, 'long') : undefined} />
            <ProfileRow label={t('common.status')} value={employee?.status} />
            <ProfileRow label={t('common.manager')} value={employee?.manager ? `${employee.manager.firstName} ${employee.manager.lastName}` : undefined} />
            {!isEmployeeRole && (employee as any)?.ctc && (
              <ProfileRow
                label="Annual CTC"
                value={`₹${Number((employee as any).ctc).toLocaleString('en-IN')}`}
                mono
              />
            )}
          </dl>
        </motion.div>

        {/* Personal info */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="layer-card p-4 md:p-6 min-w-0 max-w-full">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3 min-w-0">
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2 min-w-0 break-words">
              <User size={16} style={{ color: 'var(--primary-color)' }} /> {t('profile.personalInfo')}
            </h3>
            {isEmployeeRole && perms.canViewEditProfile && (() => {
              const req = myEditRequests.find(r => r.category === 'PERSONAL_DETAILS' && (r.status === 'PENDING' || r.status === 'APPROVED'));
              return req ? (
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${req.status === 'PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {req.status === 'PENDING' ? 'Request pending' : 'Approved'}
                </span>
              ) : (
                <button onClick={() => { setRequestDefaultCategory('PERSONAL_DETAILS'); setShowRequestModal(true); }}
                  className="text-xs font-medium flex items-center gap-1" style={{ color: 'var(--primary-color)' }}>
                  <Edit2 size={12} /> Request to Update
                </button>
              );
            })()}
          </div>
          <dl className="space-y-3">
            <ProfileRow label={t('common.email')} value={user?.email} />
            <ProfileRow label={t('common.phone')} value={employee?.phone} />
            <ProfileRow label={t('profile.personalEmail')} value={employee?.personalEmail} />
            <ProfileRow label={t('profile.dateOfBirth')} value={employee?.dateOfBirth ? formatDate(employee.dateOfBirth, 'long') : undefined} />
            <ProfileRow label={t('profile.gender')} value={employee?.gender} />
            <ProfileRow label={t('profile.bloodGroup')} value={employee?.bloodGroup} />
            <ProfileRow label={t('profile.maritalStatus')} value={employee?.maritalStatus} />
            {(employee as any)?.qualification && <ProfileRow label="Qualification" value={(employee as any).qualification} />}
          </dl>
        </motion.div>

        {/* Security */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="layer-card p-4 md:p-6 min-w-0 max-w-full">
          <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <Key size={16} className="text-amber-500" /> {t('profile.security')}
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 py-3 px-4 bg-surface-2 rounded-lg">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-700 break-words">{t('profile.password')}</p>
                <p className="text-xs text-gray-400 break-words">{t('profile.changePassword')}</p>
              </div>
              <button onClick={() => setShowChangePassword(true)} className="text-xs font-medium shrink-0" style={{ color: 'var(--primary-color)' }}>{t('profile.change')}</button>
            </div>
            <div className="flex items-center justify-between gap-3 py-3 px-4 bg-surface-2 rounded-lg">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-700 break-words">{t('profile.lastLogin')}</p>
                <p className="text-xs text-gray-400 break-words">
                  {employee?.user?.lastLoginAt ? formatDate(employee.user.lastLoginAt, 'long') : 'Unknown'}
                </p>
              </div>
            </div>

            {/* MFA Row */}
            <div className="flex items-center justify-between gap-3 py-3 px-4 bg-surface-2 rounded-lg">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {mfaStatus?.data?.isEnabled
                  ? <ShieldCheck size={16} className="text-emerald-500 shrink-0" />
                  : <ShieldOff size={16} className="text-gray-400 shrink-0" />
                }
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-700 break-words">Two-Factor Authentication</p>
                  <p className="text-xs text-gray-400 break-words">
                    {mfaStatus?.data?.isEnabled
                      ? `Enabled${mfaStatus.data.enabledAt ? ` · ${formatDate(mfaStatus.data.enabledAt, 'short')}` : ''}`
                      : 'Not enabled — add extra security to your account'}
                  </p>
                </div>
              </div>
              {mfaStatus?.data?.isEnabled ? (
                isEmployeeRole ? (
                  <span className="text-[11px] text-gray-400 flex items-center gap-1 shrink-0">
                    <Shield size={12} /> Contact HR to disable
                  </span>
                ) : (
                  <button
                    onClick={() => setShowMfaDisable(true)}
                    className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors shrink-0"
                  >
                    Disable
                  </button>
                )
              ) : (
                <button
                  onClick={() => setShowMfaSetup(true)}
                  className="text-xs font-medium transition-colors shrink-0"
                  style={{ color: 'var(--primary-color)' }}
                >
                  Set Up
                </button>
              )}
            </div>

            {/* Biometric Lock Row — only shown when device supports it */}
            {biometricSupported && (
              <div className="flex items-center justify-between gap-3 py-3 px-4 bg-surface-2 rounded-lg">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <Fingerprint size={16} className={biometricEnabled ? 'text-emerald-500 shrink-0' : 'text-gray-400 shrink-0'} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-700 break-words">Biometric App Lock</p>
                    <p className="text-xs text-gray-400 break-words">
                      {biometricEnabled
                        ? 'App locks after 10 min in background — fingerprint/face to unlock'
                        : 'Lock app with fingerprint or face ID after 10 min idle'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    const next = !biometricEnabled;
                    setBiometricEnabled(next);
                    localStorage.setItem(BIOMETRIC_KEY, next ? '1' : '0');
                    toast.success(next ? 'Biometric lock enabled' : 'Biometric lock disabled');
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${biometricEnabled ? 'bg-emerald-500' : 'bg-gray-200'}`}
                  role="switch"
                  aria-checked={biometricEnabled}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${biometricEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            )}
          </div>
        </motion.div>

        {showMfaSetup && (
          <MFASetupModal onClose={() => setShowMfaSetup(false)} onEnabled={() => refetchMfa()} />
        )}
        {showMfaDisable && (
          <MFADisableModal onClose={() => setShowMfaDisable(false)} onDisabled={() => refetchMfa()} />
        )}

        {/* Address & Emergency */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          className="layer-card p-4 md:p-6 min-w-0 max-w-full">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3 min-w-0">
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2 min-w-0 break-words">
              <MapPin size={16} style={{ color: 'var(--primary-color)' }} /> {t('profile.addressEmergency')}
            </h3>
            {isEmployeeRole && perms.canViewEditProfile && (
              <div className="flex items-center gap-2">
                {(() => {
                  const addrReq = myEditRequests.find(r => r.category === 'ADDRESS' && (r.status === 'PENDING' || r.status === 'APPROVED'));
                  return addrReq ? (
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${addrReq.status === 'PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      Address {addrReq.status === 'PENDING' ? 'pending' : 'approved'}
                    </span>
                  ) : (
                    <button onClick={() => { setRequestDefaultCategory('ADDRESS'); setShowRequestModal(true); }}
                      className="text-xs font-medium flex items-center gap-1" style={{ color: 'var(--primary-color)' }}>
                      <Edit2 size={12} /> Address
                    </button>
                  );
                })()}
                {(() => {
                  const ecReq = myEditRequests.find(r => r.category === 'EMERGENCY_CONTACT' && (r.status === 'PENDING' || r.status === 'APPROVED'));
                  return ecReq ? (
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${ecReq.status === 'PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      Contact {ecReq.status === 'PENDING' ? 'pending' : 'approved'}
                    </span>
                  ) : (
                    <button onClick={() => { setRequestDefaultCategory('EMERGENCY_CONTACT'); setShowRequestModal(true); }}
                      className="text-xs font-medium flex items-center gap-1" style={{ color: 'var(--primary-color)' }}>
                      <Edit2 size={12} /> Emergency Contact
                    </button>
                  );
                })()}
              </div>
            )}
          </div>
          {employee?.address ? (
            <div className="mb-3 space-y-2 min-w-0">
              <div className="min-w-0">
                <p className="text-xs text-gray-400 mb-0.5">Current Address</p>
                <p className="text-sm text-gray-700 break-words [overflow-wrap:anywhere]">
                  {(employee.address as any).line1 && `${(employee.address as any).line1}, `}
                  {(employee.address as any).city && `${(employee.address as any).city}, `}
                  {(employee.address as any).state && `${(employee.address as any).state} `}
                  {(employee.address as any).pincode}
                </p>
              </div>
              {(employee as any).permanentAddress && (
                <div className="min-w-0">
                  <p className="text-xs text-gray-400 mb-0.5">Permanent Address</p>
                  <p className="text-sm text-gray-700 break-words [overflow-wrap:anywhere]">
                    {(employee as any).permanentAddress.line1 && `${(employee as any).permanentAddress.line1}, `}
                    {(employee as any).permanentAddress.city && `${(employee as any).permanentAddress.city}, `}
                    {(employee as any).permanentAddress.state && `${(employee as any).permanentAddress.state} `}
                    {(employee as any).permanentAddress.pincode}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400 mb-4">{t('common.noData')}</p>
          )}
          {employee?.emergencyContact ? (
            <div className="min-w-0">
              <p className="text-xs text-gray-400 mb-1">{t('profile.emergencyContact')}</p>
              <p className="text-sm text-gray-700 break-words [overflow-wrap:anywhere]">
                {(employee.emergencyContact as any).name} ({(employee.emergencyContact as any).relationship}) — {(employee.emergencyContact as any).phone}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-400">{t('common.noData')}</p>
          )}
        </motion.div>

        {/* Bank Details */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="layer-card p-4 md:p-6 min-w-0 max-w-full">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3 min-w-0">
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2 min-w-0 break-words">
              <CreditCard size={16} className="text-emerald-500" /> Bank Details
            </h3>
            {isEmployeeRole ? (() => {
              const bankReq = myEditRequests.find(r => r.category === 'BANK_DETAILS' && (r.status === 'PENDING' || r.status === 'APPROVED'));
              return (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => setShowBankEdit(!showBankEdit)}
                    className="text-xs font-medium flex items-center gap-1" style={{ color: 'var(--primary-color)' }}
                  >
                    {showBankEdit ? <><X size={12} /> Cancel</> : <><Edit2 size={12} /> Edit Branch</>}
                  </button>
                  {bankReq ? (
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${bankReq.status === 'PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {bankReq.status === 'PENDING' ? 'Request pending' : 'Approved — apply now'}
                    </span>
                  ) : (
                    <button
                      onClick={() => { setRequestDefaultCategory('BANK_DETAILS'); setShowRequestModal(true); }}
                      className="text-xs font-medium flex items-center gap-1" style={{ color: 'var(--primary-color)' }}
                    >
                      <Edit2 size={12} /> Other Details
                    </button>
                  )}
                </div>
              );
            })() : (
              <button onClick={() => setShowBankEdit(!showBankEdit)}
                className="text-xs font-medium flex items-center gap-1" style={{ color: 'var(--primary-color)' }}>
                {showBankEdit ? <><X size={12} /> Cancel</> : <><Edit2 size={12} /> Edit</>}
              </button>
            )}
          </div>

          {/* Dual verification status badges */}
          {isReadableBankAccount(employee?.bankAccountNumber) && !showBankEdit && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {(employee as any).bankVerifiedByHr ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  <ShieldCheck size={11} /> Verified by HR
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                  <ShieldOff size={11} /> Awaiting HR Verification
                </span>
              )}
              {(employee as any).bankVerifiedByEmployee ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  <CheckCircle2 size={11} /> Confirmed by You
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                  <Clock size={11} /> Not Yet Confirmed
                </span>
              )}
            </div>
          )}

          {showBankEdit ? (
            <div className="space-y-3">
              {isEmployeeRole ? (
                <>
                  <p className="text-xs text-gray-500">You can update your branch name directly. For other bank details, submit a request to HR.</p>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Branch Name</label>
                    <input value={bankForm.bankBranchName} onChange={e => setBankForm(f => ({ ...f, bankBranchName: e.target.value }))}
                      className="input-glass w-full text-sm" placeholder="e.g. Connaught Place Branch" />
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Account Holder Name</label>
                      <input value={bankForm.accountHolderName} onChange={e => setBankForm(f => ({ ...f, accountHolderName: e.target.value }))}
                        className="input-glass w-full text-sm" placeholder="Full name on account" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Account Type</label>
                      <select value={bankForm.accountType} onChange={e => setBankForm(f => ({ ...f, accountType: e.target.value }))}
                        className="input-glass w-full text-sm">
                        <option value="">Select</option>
                        <option value="SAVINGS">Savings</option>
                        <option value="CURRENT">Current</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Bank Name</label>
                    <input value={bankForm.bankName} onChange={e => setBankForm(f => ({ ...f, bankName: e.target.value }))}
                      className="input-glass w-full text-sm" placeholder="e.g. State Bank of India" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Branch Name</label>
                    <input value={bankForm.bankBranchName} onChange={e => setBankForm(f => ({ ...f, bankBranchName: e.target.value }))}
                      className="input-glass w-full text-sm" placeholder="e.g. Connaught Place Branch" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Account Number</label>
                      <input value={bankForm.bankAccountNumber} onChange={e => setBankForm(f => ({ ...f, bankAccountNumber: e.target.value }))}
                        className="input-glass w-full text-sm font-mono" placeholder="Account number" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">IFSC Code</label>
                      <input value={bankForm.ifscCode} onChange={e => setBankForm(f => ({ ...f, ifscCode: e.target.value.toUpperCase() }))}
                        className="input-glass w-full text-sm font-mono" placeholder="e.g. SBIN0001234" />
                    </div>
                  </div>
                </>
              )}
              <button onClick={handleSaveBankDetails} disabled={savingBank}
                className="btn-primary flex items-center gap-2 text-sm">
                {savingBank ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {isEmployeeRole ? 'Save Branch Name' : 'Save Bank Details'}
              </button>
            </div>
          ) : (employee?.bankName || isReadableBankAccount(employee?.bankAccountNumber)) ? (
            <>
              <dl className="space-y-3 mb-4">
                <ProfileRow label="Account Holder" value={employee?.accountHolderName} />
                <ProfileRow label="Bank" value={employee?.bankName} />
                <ProfileRow label="Branch" value={(employee as any)?.bankBranchName} />
                <ProfileRow label="Account Number" value={isReadableBankAccount(employee?.bankAccountNumber) ? `••••${employee!.bankAccountNumber!.slice(-4)}` : '⚠ Re-entry required by HR'} mono />
                <ProfileRow label="IFSC Code" value={employee?.ifscCode} mono />
                <ProfileRow label="Account Type" value={employee?.accountType} />
              </dl>
              {/* Employee confirm / flag buttons */}
              {isEmployeeRole && (
                <div className="flex gap-2 pt-3 border-t border-gray-100">
                  {(employee as any).bankVerifiedByEmployee ? (
                    <button
                      onClick={async () => {
                        try {
                          await confirmBank({ confirmed: false }).unwrap();
                          toast.success('Bank details flagged — HR has been notified');
                        } catch (err: any) {
                          toast.error(err?.data?.error?.message || 'Failed');
                        }
                      }}
                      disabled={confirmingBank}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      {confirmingBank ? <Loader2 size={12} className="animate-spin" /> : <AlertTriangle size={12} />}
                      Flag as Incorrect
                    </button>
                  ) : (
                    <button
                      onClick={async () => {
                        try {
                          await confirmBank({ confirmed: true }).unwrap();
                          toast.success('Bank details confirmed');
                        } catch (err: any) {
                          toast.error(err?.data?.error?.message || 'Failed');
                        }
                      }}
                      disabled={confirmingBank}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                    >
                      {confirmingBank ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                      Confirm Details Are Correct
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-4">
              <CreditCard size={32} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-400">No bank details added yet</p>
              {isEmployeeRole ? (() => {
                const bankReq = myEditRequests.find(r => r.category === 'BANK_DETAILS' && (r.status === 'PENDING' || r.status === 'APPROVED'));
                return !bankReq ? (
                  <button
                    onClick={() => { setRequestDefaultCategory('BANK_DETAILS'); setShowRequestModal(true); }}
                    className="mt-2 text-xs font-medium"
                    style={{ color: 'var(--primary-color)' }}
                  >
                    + Request to add bank details
                  </button>
                ) : null;
              })() : (
                <button onClick={() => setShowBankEdit(true)}
                  className="mt-2 text-xs font-medium" style={{ color: 'var(--primary-color)' }}>
                  + Add bank details
                </button>
              )}
              {isEmployeeRole && (
                <button onClick={() => setShowBankEdit(!showBankEdit)}
                  className="mt-1 text-xs text-gray-500 font-medium block" onMouseEnter={e => (e.currentTarget.style.color = 'var(--primary-color)')} onMouseLeave={e => (e.currentTarget.style.color = '')}>
                  {showBankEdit ? 'Cancel' : '+ Add branch name'}
                </button>
              )}
            </div>
          )}
        </motion.div>

        {/* EPF Details */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
          className="layer-card p-4 md:p-6 min-w-0 max-w-full">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3 min-w-0">
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2 min-w-0 break-words">
              <Shield size={16} className="text-violet-500" /> EPF Details
              {(() => {
                const enabled = (employee as any)?.epfEnabled;
                return enabled
                  ? <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Active</span>
                  : <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Not enrolled</span>;
              })()}
            </h3>
            {isEmployeeRole ? (() => {
              const epfReq = myEditRequests.find(r => r.category === 'EPF_DETAILS' && (r.status === 'PENDING' || r.status === 'APPROVED'));
              return epfReq ? (
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${epfReq.status === 'PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {epfReq.status === 'PENDING' ? 'Request pending' : 'Approved — apply now'}
                </span>
              ) : (
                <button
                  onClick={() => { setRequestDefaultCategory('EPF_DETAILS'); setShowRequestModal(true); }}
                  className="text-xs font-medium flex items-center gap-1" style={{ color: 'var(--primary-color)' }}
                >
                  <Edit2 size={12} /> Request EPF Update
                </button>
              );
            })() : (
              <button onClick={() => setShowEpfEdit(!showEpfEdit)}
                className="text-xs font-medium flex items-center gap-1" style={{ color: 'var(--primary-color)' }}>
                {showEpfEdit ? <><X size={12} /> Cancel</> : <><Edit2 size={12} /> Edit</>}
              </button>
            )}
          </div>

          {(!isEmployeeRole && showEpfEdit) ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-surface-2 rounded-xl">
                <label className="text-sm text-gray-700 font-medium flex-1">EPF Enabled</label>
                <button
                  onClick={() => setEpfForm(f => ({ ...f, epfEnabled: !f.epfEnabled }))}
                  className={`relative w-10 h-5 rounded-full transition-colors ${epfForm.epfEnabled ? 'bg-emerald-500' : 'bg-gray-300'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${epfForm.epfEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">EPF Member ID (Previous UAN)</label>
                <input value={epfForm.epfMemberId} onChange={e => setEpfForm(f => ({ ...f, epfMemberId: e.target.value }))}
                  className="input-glass w-full text-sm font-mono" placeholder="e.g. 100123456789" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">EPF UAN (HR Assigned)</label>
                <input value={epfForm.epfUan} onChange={e => setEpfForm(f => ({ ...f, epfUan: e.target.value }))}
                  className="input-glass w-full text-sm font-mono" placeholder="UAN number" />
              </div>
              <button onClick={handleSaveEpfDetails} disabled={savingEpf}
                className="btn-primary flex items-center gap-2 text-sm">
                {savingEpf ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save EPF Details
              </button>
            </div>
          ) : (
            <dl className="space-y-3">
              <div className="flex justify-between items-baseline gap-3">
                <dt className="text-xs text-gray-400 shrink-0">EPF Status</dt>
                <dd className="text-sm text-gray-700 min-w-0 text-right break-words [overflow-wrap:anywhere]">
                  {(employee as any)?.epfEnabled
                    ? <span className="inline-flex items-baseline gap-1 text-emerald-600"><ShieldCheck size={13} className="shrink-0 self-center" /> Enrolled — EPF deducted from salary</span>
                    : <span className="inline-flex items-baseline gap-1 text-gray-400"><ShieldOff size={13} className="shrink-0 self-center" /> Not enrolled — EPF not deducted</span>}
                </dd>
              </div>
              {(employee as any)?.epfMemberId && <ProfileRow label="EPF Member ID" value={(employee as any).epfMemberId} mono />}
              {(employee as any)?.epfUan && <ProfileRow label="EPF UAN" value={(employee as any).epfUan} mono />}
              {!(employee as any)?.epfMemberId && !(employee as any)?.epfUan && (
                <p className="text-xs text-gray-400">
                  {isEmployeeRole
                    ? 'No EPF details added. Submit a request to enroll in EPF.'
                    : 'No EPF details. Use Edit to enable EPF and assign UAN.'}
                </p>
              )}
            </dl>
          )}
        </motion.div>

        {/* Documents */}
        {employee?.documents && employee.documents.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
            className="layer-card p-4 md:p-6 min-w-0 max-w-full">
            <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <FileText size={16} style={{ color: 'var(--primary-color)' }} /> My Documents
            </h3>
            <div className="space-y-2">
              {(employee.documents as any[]).map((doc: any) => {
                const statusColor = doc.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700'
                  : doc.status === 'REJECTED' ? 'bg-red-100 text-red-600'
                  : doc.status === 'REUPLOAD_REQUIRED' ? 'bg-amber-100 text-amber-700'
                  : 'bg-gray-100 text-gray-500';
                const label = doc.type?.replace(/_/g, ' ')?.replace(/\b\w/g, (c: string) => c.toUpperCase());
                return (
                  <div key={doc.id} className="flex items-center justify-between py-2 px-3 bg-surface-2 rounded-lg">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText size={13} className="shrink-0" style={{ color: 'var(--primary-color)' }} />
                      <span className="text-sm text-gray-700 truncate">{doc.name || label}</span>
                    </div>
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ml-2 ${statusColor}`}>
                      {doc.status === 'APPROVED' ? 'Verified' : doc.status === 'REJECTED' ? 'Rejected' : doc.status === 'REUPLOAD_REQUIRED' ? 'Re-upload needed' : 'Pending review'}
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

      </div>

      {/* Change Password Modal */}
      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
    </div>
  );
}

function ProfileRow({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex justify-between items-baseline gap-3">
      <dt className="text-xs text-gray-400 shrink-0">{label}</dt>
      <dd
        className={`min-w-0 text-sm text-gray-700 text-right break-words [overflow-wrap:anywhere] ${mono ? 'font-mono' : ''}`}
        data-mono={mono || undefined}
      >
        {value || '—'}
      </dd>
    </div>
  );
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [changePassword, { isLoading }] = useChangePasswordMutation();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });

  const handleSubmit = async () => {
    if (form.newPassword.length < 8) { toast.error(t('profile.passwordMinLength')); return; }
    if (form.newPassword !== form.confirmPassword) { toast.error(t('profile.passwordsDoNotMatch')); return; }
    try {
      const result = await changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword }).unwrap();
      // Replace the stored access token with the fresh one so this session stays valid
      if (result?.data?.accessToken) {
        dispatch(setAccessToken(result.data.accessToken));
      }
      toast.success(t('profile.passwordChanged'));
      onClose();
    } catch (err: any) { toast.error(err?.data?.error?.message || t('profile.failedToChangePassword')); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-display font-semibold text-gray-800">{t('profile.changePassword')}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('profile.currentPassword')}</label>
            <input type="password" value={form.currentPassword} onChange={e => setForm({...form, currentPassword: e.target.value})}
              className="input-glass w-full text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('profile.newPassword')}</label>
            <input type="password" value={form.newPassword} onChange={e => setForm({...form, newPassword: e.target.value})}
              className="input-glass w-full text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('profile.confirmNewPassword')}</label>
            <input type="password" value={form.confirmPassword} onChange={e => setForm({...form, confirmPassword: e.target.value})}
              className="input-glass w-full text-sm" />
          </div>
          <button onClick={handleSubmit} disabled={isLoading} className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />}
            {t('profile.changePassword')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
