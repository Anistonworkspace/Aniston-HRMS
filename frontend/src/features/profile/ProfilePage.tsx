import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { User, Mail, Phone, Building2, MapPin, Shield, Edit2, Key, Loader2, Save, X, UserMinus, AlertTriangle, Clock, CheckCircle2, CreditCard, MessageSquare, ShieldCheck, ShieldOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useAppDispatch } from '../../app/store';
import { setAccessToken } from '../auth/authSlice';
import { useGetMeQuery, useChangePasswordMutation, useGetMfaStatusQuery } from '../auth/authApi';
import { MFASetupModal, MFADisableModal } from '../auth/MFASetupModal';
import { useUpdateEmployeeMutation, useGetEmployeeQuery } from '../employee/employeeApi';
import { useSubmitResignationMutation } from '../exit/exitApi';
import { useCreateTicketMutation, useGetMyTicketsQuery, useUpdateTicketMutation } from '../helpdesk/helpdeskApi';
import { getInitials, formatDate, getUploadUrl } from '../../lib/utils';
import toast from 'react-hot-toast';

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
  const [submitResignation, { isLoading: resigning }] = useSubmitResignationMutation();
  const [createTicket, { isLoading: requestingEdit }] = useCreateTicketMutation();
  const [updateTicket] = useUpdateTicketMutation();
  const [showEdit, setShowEdit] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showMfaSetup, setShowMfaSetup] = useState(false);
  const [showMfaDisable, setShowMfaDisable] = useState(false);
  const { data: mfaStatus, refetch: refetchMfa } = useGetMfaStatusQuery();

  // One-time edit flow:
  // - First fill (no phone/DOB yet): "Edit Profile" → opens modal directly
  // - After fill: "Request Edit" → creates helpdesk ticket
  // - Ticket OPEN/IN_PROGRESS: "Request Pending" (disabled)
  // - Ticket RESOLVED (HR approved): "Edit Profile" → opens modal; on save, ticket is CLOSED
  const hasFilledProfile = !!(employee?.phone && employee?.dateOfBirth &&
    employee?.phone !== '0000000000');

  // Only fetch tickets for employee/intern roles — admins/HR don't need this
  const isEmployeeRole = ['EMPLOYEE', 'INTERN'].includes(user?.role || '');
  const { data: ticketsRes } = useGetMyTicketsQuery(undefined, { skip: !isEmployeeRole });
  const myTickets: any[] = (ticketsRes?.data as any[]) || [];
  const editRequestTickets = myTickets.filter((t: any) => t.subject === 'Profile Edit Request');
  const openEditTicket = editRequestTickets.find((t: any) => ['OPEN', 'IN_PROGRESS'].includes(t.status));
  const resolvedEditTicket = !openEditTicket && editRequestTickets.find((t: any) => ['RESOLVED'].includes(t.status));

  const [showResignModal, setShowResignModal] = useState(false);
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
    emergencyContact: { name: '', phone: '', relationship: '', email: '' },
    address: { line1: '', city: '', state: '', pincode: '' },
  });
  const [bankForm, setBankForm] = useState({
    bankAccountNumber: '',
    bankName: '',
    ifscCode: '',
    accountHolderName: '',
    accountType: '',
  });
  const [showBankEdit, setShowBankEdit] = useState(false);
  const [savingBank, setSavingBank] = useState(false);

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
        emergencyContact: {
          name: (employee.emergencyContact as any)?.name || '',
          phone: (employee.emergencyContact as any)?.phone || '',
          relationship: (employee.emergencyContact as any)?.relationship || '',
          email: (employee.emergencyContact as any)?.email || '',
        },
        address: (employee.address as any) || { line1: '', city: '', state: '', pincode: '' },
      });
      setBankForm({
        bankAccountNumber: employee.bankAccountNumber || '',
        bankName: employee.bankName || '',
        ifscCode: employee.ifscCode || '',
        accountHolderName: employee.accountHolderName || '',
        accountType: employee.accountType || '',
      });
    }
  }, [employee]);

  const handleSaveProfile = async () => {
    if (!user?.employeeId) return;
    try {
      await updateEmployee({ id: user.employeeId, data: form as any }).unwrap();
      // If this edit was granted via a resolved helpdesk ticket, close it so the
      // employee must request again for any future edits.
      if (resolvedEditTicket?.id) {
        try { await updateTicket({ id: resolvedEditTicket.id, data: { status: 'CLOSED' } }).unwrap(); } catch { /* non-blocking */ }
      }
      toast.success(t('profile.profileUpdated'));
      setShowEdit(false);
    } catch { toast.error(t('profile.failedToUpdate')); }
  };

  const handleRequestEdit = async () => {
    try {
      await createTicket({
        subject: 'Profile Edit Request',
        description: 'I would like to update my profile details. Please approve this request.',
        category: 'HR',
        priority: 'MEDIUM',
      }).unwrap();
      toast.success('Edit request submitted to HR');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to submit request');
    }
  };

  const handleSaveBankDetails = async () => {
    if (!user?.employeeId) return;
    setSavingBank(true);
    try {
      // Strip empty accountType — Zod rejects '' for enum fields
      const bankData: any = { ...bankForm };
      if (!bankData.accountType) delete bankData.accountType;
      await updateEmployee({ id: user.employeeId, data: bankData }).unwrap();
      toast.success('Bank details saved');
      setShowBankEdit(false);
    } catch { toast.error('Failed to save bank details'); }
    finally { setSavingBank(false); }
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
          className="layer-card p-4 mb-6 border border-brand-200 bg-brand-50/50"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center shrink-0">
              <CheckCircle2 size={20} className="text-brand-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-gray-900">{t('profile.welcomeMessage')}</h3>
              <p className="text-xs text-gray-500 mt-1">{t('profile.fillDetails')}</p>
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-gray-500">{t('profile.profileCompletion')}</span>
                  <span className="font-mono font-semibold text-brand-600" data-mono>{completionPct}%</span>
                </div>
                <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-600 rounded-full transition-all duration-500"
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
        className="layer-card p-6 mb-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
          <div className="relative">
            <div className="w-24 h-24 rounded-2xl bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-3xl font-display">
              {employee?.avatar ? (
                <img src={getUploadUrl(employee.avatar)} alt="" className="w-full h-full rounded-2xl object-cover" />
              ) : (
                getInitials(user?.firstName, user?.lastName)
              )}
            </div>
          </div>
          <div className="text-center sm:text-left flex-1">
            <h2 className="text-xl font-display font-bold text-gray-900">
              {user?.firstName} {user?.lastName}
            </h2>
            <p className="text-gray-500 text-sm mt-0.5">
              {employee?.designation?.name || 'No designation'} · {employee?.department?.name || 'No department'}
            </p>
            <div className="flex flex-wrap gap-3 mt-3 justify-center sm:justify-start">
              <span className="flex items-center gap-1.5 text-sm text-gray-500">
                <Mail size={14} className="text-gray-400" /> {user?.email}
              </span>
              {employee?.phone && (
                <span className="flex items-center gap-1.5 text-sm text-gray-500">
                  <Phone size={14} className="text-gray-400" /> {employee.phone}
                </span>
              )}
              <span className="flex items-center gap-1.5 text-sm text-gray-500">
                <Shield size={14} className="text-gray-400" /> {user?.role?.replace(/_/g, ' ')}
              </span>
              {employee?.employeeCode && (
                <span className="flex items-center gap-1.5 text-sm text-gray-500 font-mono" data-mono>
                  {employee.employeeCode}
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {/* State 1: Profile not filled yet — free first edit */}
            {!hasFilledProfile && (
              <button onClick={() => setShowEdit(true)} className="btn-secondary flex items-center gap-2 text-sm">
                <Edit2 size={14} /> {t('profile.editProfile')}
              </button>
            )}
            {/* State 2: Profile filled, open ticket pending HR review */}
            {hasFilledProfile && openEditTicket && (
              <button disabled className="btn-secondary flex items-center gap-2 text-sm opacity-60 cursor-not-allowed"
                title="Your edit request is pending HR approval.">
                <Clock size={14} /> Request Pending
              </button>
            )}
            {/* State 3: Profile filled, HR approved (resolved ticket) — allow one edit */}
            {hasFilledProfile && resolvedEditTicket && (
              <button onClick={() => setShowEdit(true)} className="btn-secondary flex items-center gap-2 text-sm ring-2 ring-emerald-400"
                title="HR has approved your edit request. You can edit your profile once.">
                <Edit2 size={14} /> Edit Profile
              </button>
            )}
            {/* State 4: Profile filled, no open/resolved ticket — must request */}
            {hasFilledProfile && !openEditTicket && !resolvedEditTicket && (
              <button
                onClick={handleRequestEdit}
                disabled={requestingEdit}
                className="btn-secondary flex items-center gap-2 text-sm"
                title="Your profile is complete. Submit a request to HR to edit it."
              >
                {requestingEdit ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
                Request Edit
              </button>
            )}
            {employee && !employee.exitStatus && employee.status !== 'TERMINATED' && (
              <button onClick={() => setShowResignModal(true)} className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
                <UserMinus size={14} /> {t('profile.submitResignation')}
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

      {/* Resign Modal */}
      {showResignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setShowResignModal(false)}>
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

      {/* Edit Profile Modal */}
      {showEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" onClick={() => setShowEdit(false)}>
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

      <div className="grid md:grid-cols-2 gap-6">
        {/* Employment info */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="layer-card p-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Building2 size={16} className="text-brand-500" /> {t('profile.employmentDetails')}
          </h3>
          <dl className="space-y-3">
            <ProfileRow label={t('profile.employeeCode')} value={employee?.employeeCode} mono />
            <ProfileRow label={t('common.department')} value={employee?.department?.name} />
            <ProfileRow label={t('common.designation')} value={employee?.designation?.name} />
            <ProfileRow label={t('profile.workMode')} value={employee?.workMode?.replace(/_/g, ' ')} />
            <ProfileRow label={t('profile.joiningDate')} value={employee?.joiningDate ? formatDate(employee.joiningDate, 'long') : undefined} />
            <ProfileRow label={t('common.status')} value={employee?.status} />
            <ProfileRow label={t('common.manager')} value={employee?.manager ? `${employee.manager.firstName} ${employee.manager.lastName}` : undefined} />
          </dl>
        </motion.div>

        {/* Personal info */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="layer-card p-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <User size={16} className="text-brand-500" /> {t('profile.personalInfo')}
          </h3>
          <dl className="space-y-3">
            <ProfileRow label={t('common.email')} value={user?.email} />
            <ProfileRow label={t('common.phone')} value={employee?.phone} />
            <ProfileRow label={t('profile.personalEmail')} value={employee?.personalEmail} />
            <ProfileRow label={t('profile.dateOfBirth')} value={employee?.dateOfBirth ? formatDate(employee.dateOfBirth, 'long') : undefined} />
            <ProfileRow label={t('profile.gender')} value={employee?.gender} />
            <ProfileRow label={t('profile.bloodGroup')} value={employee?.bloodGroup} />
            <ProfileRow label={t('profile.maritalStatus')} value={employee?.maritalStatus} />
          </dl>
        </motion.div>

        {/* Security */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="layer-card p-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Key size={16} className="text-amber-500" /> {t('profile.security')}
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-3 px-4 bg-surface-2 rounded-lg">
              <div>
                <p className="text-sm font-medium text-gray-700">{t('profile.password')}</p>
                <p className="text-xs text-gray-400">{t('profile.changePassword')}</p>
              </div>
              <button onClick={() => setShowChangePassword(true)} className="text-xs text-brand-600 hover:text-brand-700 font-medium">{t('profile.change')}</button>
            </div>
            <div className="flex items-center justify-between py-3 px-4 bg-surface-2 rounded-lg">
              <div>
                <p className="text-sm font-medium text-gray-700">{t('profile.lastLogin')}</p>
                <p className="text-xs text-gray-400">
                  {employee?.user?.lastLoginAt ? formatDate(employee.user.lastLoginAt, 'long') : 'Unknown'}
                </p>
              </div>
            </div>

            {/* MFA Row */}
            <div className="flex items-center justify-between py-3 px-4 bg-surface-2 rounded-lg">
              <div className="flex items-center gap-3">
                {mfaStatus?.data?.isEnabled
                  ? <ShieldCheck size={16} className="text-emerald-500" />
                  : <ShieldOff size={16} className="text-gray-400" />
                }
                <div>
                  <p className="text-sm font-medium text-gray-700">Two-Factor Authentication</p>
                  <p className="text-xs text-gray-400">
                    {mfaStatus?.data?.isEnabled
                      ? `Enabled${mfaStatus.data.enabledAt ? ` · ${formatDate(mfaStatus.data.enabledAt, 'short')}` : ''}`
                      : 'Not enabled — add extra security to your account'}
                  </p>
                </div>
              </div>
              {mfaStatus?.data?.isEnabled ? (
                <button
                  onClick={() => setShowMfaDisable(true)}
                  className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
                >
                  Disable
                </button>
              ) : (
                <button
                  onClick={() => setShowMfaSetup(true)}
                  className="text-xs text-brand-600 hover:text-brand-700 font-medium transition-colors"
                >
                  Set Up
                </button>
              )}
            </div>
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
          className="layer-card p-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <MapPin size={16} className="text-brand-500" /> {t('profile.addressEmergency')}
          </h3>
          {employee?.address ? (
            <div className="mb-4">
              <p className="text-xs text-gray-400 mb-1">{t('common.address')}</p>
              <p className="text-sm text-gray-700">
                {(employee.address as any).line1 && `${(employee.address as any).line1}, `}
                {(employee.address as any).city && `${(employee.address as any).city}, `}
                {(employee.address as any).state && `${(employee.address as any).state} `}
                {(employee.address as any).pincode}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-400 mb-4">{t('common.noData')}</p>
          )}
          {employee?.emergencyContact ? (
            <div>
              <p className="text-xs text-gray-400 mb-1">{t('profile.emergencyContact')}</p>
              <p className="text-sm text-gray-700">
                {(employee.emergencyContact as any).name} ({(employee.emergencyContact as any).relationship}) — {(employee.emergencyContact as any).phone}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-400">{t('common.noData')}</p>
          )}
        </motion.div>

        {/* Bank Details */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="layer-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <CreditCard size={16} className="text-emerald-500" /> Bank Details
            </h3>
            <button onClick={() => setShowBankEdit(!showBankEdit)}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1">
              {showBankEdit ? <><X size={12} /> Cancel</> : <><Edit2 size={12} /> Edit</>}
            </button>
          </div>

          {showBankEdit ? (
            <div className="space-y-3">
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
              <button onClick={handleSaveBankDetails} disabled={savingBank}
                className="btn-primary flex items-center gap-2 text-sm">
                {savingBank ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Bank Details
              </button>
            </div>
          ) : employee?.bankAccountNumber ? (
            <dl className="space-y-3">
              <ProfileRow label="Account Holder" value={employee.accountHolderName} />
              <ProfileRow label="Bank" value={employee.bankName} />
              <ProfileRow label="Account Number" value={employee.bankAccountNumber ? `••••${employee.bankAccountNumber.slice(-4)}` : undefined} mono />
              <ProfileRow label="IFSC Code" value={employee.ifscCode} mono />
              <ProfileRow label="Account Type" value={employee.accountType} />
            </dl>
          ) : (
            <div className="text-center py-4">
              <CreditCard size={32} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-400">No bank details added yet</p>
              <button onClick={() => setShowBankEdit(true)}
                className="mt-2 text-xs text-brand-600 hover:text-brand-700 font-medium">
                + Add bank details
              </button>
            </div>
          )}
        </motion.div>

      </div>

      {/* Change Password Modal */}
      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
    </div>
  );
}

function ProfileRow({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className={`text-sm text-gray-700 ${mono ? 'font-mono' : ''}`} data-mono={mono || undefined}>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
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
