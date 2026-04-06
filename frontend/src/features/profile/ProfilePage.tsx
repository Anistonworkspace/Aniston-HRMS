import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { User, Mail, Phone, Building2, MapPin, Calendar, Shield, Edit2, Key, Loader2, Save, X, Camera, Upload, UserMinus, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
import { useAppSelector, useAppDispatch } from '../../app/store';
import { useGetMeQuery, useChangePasswordMutation } from '../auth/authApi';
import { useUpdateEmployeeMutation, useGetEmployeeQuery } from '../employee/employeeApi';
import { useSubmitResignationMutation } from '../exit/exitApi';
import { getInitials, formatDate } from '../../lib/utils';
import toast from 'react-hot-toast';

export default function ProfilePage() {
  const user = useAppSelector((s) => s.auth.user);
  const [searchParams] = useSearchParams();
  const isOnboarding = searchParams.get('onboarding') === 'true';
  const { data: meRes, isLoading } = useGetMeQuery();
  const me = meRes?.data;

  // Fetch full employee data if employeeId exists
  const { data: empRes } = useGetEmployeeQuery(user?.employeeId || '', { skip: !user?.employeeId });
  const employee = empRes?.data;

  const [updateEmployee, { isLoading: updating }] = useUpdateEmployeeMutation();
  const [submitResignation, { isLoading: resigning }] = useSubmitResignationMutation();
  const [showEdit, setShowEdit] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showResignModal, setShowResignModal] = useState(false);
  const [resignForm, setResignForm] = useState({ reason: '', lastWorkingDate: '' });

  const [form, setForm] = useState({
    phone: '',
    personalEmail: '',
    bloodGroup: '',
    maritalStatus: '',
    emergencyContact: { name: '', phone: '', relationship: '' },
    address: { street: '', city: '', state: '', pincode: '' },
  });

  useEffect(() => {
    if (employee) {
      setForm({
        phone: employee.phone || '',
        personalEmail: employee.personalEmail || '',
        bloodGroup: employee.bloodGroup || '',
        maritalStatus: employee.maritalStatus || '',
        emergencyContact: (employee.emergencyContact as any) || { name: '', phone: '', relationship: '' },
        address: (employee.address as any) || { street: '', city: '', state: '', pincode: '' },
      });
    }
  }, [employee]);

  const handleSaveProfile = async () => {
    if (!user?.employeeId) return;
    try {
      await updateEmployee({ id: user.employeeId, data: form as any }).unwrap();
      toast.success('Profile updated');
      setShowEdit(false);
    } catch { toast.error('Failed to update'); }
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

  // Profile completion calculation
  const completionItems = useMemo(() => {
    if (!employee) return [];
    const items = [
      { label: 'Personal details', done: !!(employee.phone && employee.phone !== '0000000000' && employee.dateOfBirth) },
      { label: 'Emergency contact', done: !!(employee.emergencyContact && (employee.emergencyContact as any)?.name) },
      { label: 'Address', done: !!(employee.address && (employee.address as any)?.city) },
      { label: 'Personal email', done: !!employee.personalEmail },
      { label: 'Blood group', done: !!employee.bloodGroup },
    ];
    return items;
  }, [employee]);

  const completionPct = completionItems.length > 0
    ? Math.round((completionItems.filter(i => i.done).length / completionItems.length) * 100)
    : 0;

  return (
    <div className="page-container">
      <h1 className="text-2xl font-display font-bold text-gray-900 mb-6">My Profile</h1>

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
              <h3 className="text-sm font-semibold text-gray-900">Welcome! Please complete your profile to get started.</h3>
              <p className="text-xs text-gray-500 mt-1">Fill in your personal details, emergency contact, and address to finish onboarding.</p>
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-gray-500">Profile completion</span>
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
                      {item.done ? 'Done' : 'Incomplete'}: {item.label}
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
                <img src={employee.avatar} alt="" className="w-full h-full rounded-2xl object-cover" />
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
          <div className="flex gap-2">
            <button onClick={() => setShowEdit(!showEdit)} className="btn-secondary flex items-center gap-2 text-sm">
              {showEdit ? <><X size={14} /> Cancel</> : <><Edit2 size={14} /> Edit Profile</>}
            </button>
            {employee && !employee.exitStatus && employee.status !== 'TERMINATED' && (
              <button onClick={() => setShowResignModal(true)} className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
                <UserMinus size={14} /> Submit Resignation
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
                {employee.exitStatus === 'PENDING' && 'Resignation Pending Approval'}
                {employee.exitStatus === 'APPROVED' && 'Resignation Approved'}
                {employee.exitStatus === 'NO_DUES_PENDING' && 'Exit Approved — No Dues Pending'}
                {employee.exitStatus === 'COMPLETED' && 'Exit Completed'}
              </p>
              <p className="text-xs text-gray-500">
                {employee.lastWorkingDate && `Last working date: ${new Date(employee.lastWorkingDate).toLocaleDateString('en-IN')}`}
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
              <h3 className="text-lg font-display font-semibold text-gray-800">Submit Resignation</h3>
              <button onClick={() => setShowResignModal(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 text-amber-700 text-xs mb-4">
              <AlertTriangle size={14} />
              This will notify HR and begin the exit process.
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Reason *</label>
                <textarea
                  value={resignForm.reason}
                  onChange={e => setResignForm({ ...resignForm, reason: e.target.value })}
                  className="input-glass w-full text-sm" rows={3}
                  placeholder="Please provide your reason for resignation..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Proposed Last Working Date *</label>
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
                  if (!resignForm.reason || !resignForm.lastWorkingDate) { toast.error('Please fill all fields'); return; }
                  try {
                    await submitResignation(resignForm).unwrap();
                    toast.success('Resignation submitted — HR has been notified');
                    setShowResignModal(false);
                    setResignForm({ reason: '', lastWorkingDate: '' });
                  } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to submit'); }
                }}
                disabled={resigning}
                className="w-full bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                {resigning ? <Loader2 size={16} className="animate-spin" /> : <UserMinus size={16} />}
                {resigning ? 'Submitting...' : 'Confirm Resignation'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Edit profile form */}
      {showEdit && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
          className="layer-card p-6 mb-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-4">Edit Personal Information</h3>
          <div className="space-y-4 max-w-2xl">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Phone</label>
                <input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})}
                  className="input-glass w-full text-sm" placeholder="+91 XXXXXXXXXX" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Personal Email</label>
                <input value={form.personalEmail} onChange={e => setForm({...form, personalEmail: e.target.value})}
                  className="input-glass w-full text-sm" placeholder="personal@email.com" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Blood Group</label>
                <select value={form.bloodGroup} onChange={e => setForm({...form, bloodGroup: e.target.value})} className="input-glass w-full text-sm">
                  <option value="">Select</option>
                  {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg => <option key={bg} value={bg}>{bg}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Marital Status</label>
                <select value={form.maritalStatus} onChange={e => setForm({...form, maritalStatus: e.target.value})} className="input-glass w-full text-sm">
                  <option value="">Select</option>
                  <option value="Single">Single</option>
                  <option value="Married">Married</option>
                  <option value="Divorced">Divorced</option>
                  <option value="Widowed">Widowed</option>
                </select>
              </div>
            </div>

            <h4 className="text-xs font-semibold text-gray-600 pt-2">Address</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <input value={form.address.street} onChange={e => setForm({...form, address: {...form.address, street: e.target.value}})}
                  className="input-glass w-full text-sm" placeholder="Street address" />
              </div>
              <input value={form.address.city} onChange={e => setForm({...form, address: {...form.address, city: e.target.value}})}
                className="input-glass w-full text-sm" placeholder="City" />
              <input value={form.address.state} onChange={e => setForm({...form, address: {...form.address, state: e.target.value}})}
                className="input-glass w-full text-sm" placeholder="State" />
              <input value={form.address.pincode} onChange={e => setForm({...form, address: {...form.address, pincode: e.target.value}})}
                className="input-glass w-full text-sm" placeholder="Pincode" />
            </div>

            <h4 className="text-xs font-semibold text-gray-600 pt-2">Emergency Contact</h4>
            <div className="grid grid-cols-3 gap-4">
              <input value={form.emergencyContact.name} onChange={e => setForm({...form, emergencyContact: {...form.emergencyContact, name: e.target.value}})}
                className="input-glass w-full text-sm" placeholder="Name" />
              <input value={form.emergencyContact.phone} onChange={e => setForm({...form, emergencyContact: {...form.emergencyContact, phone: e.target.value}})}
                className="input-glass w-full text-sm" placeholder="Phone" />
              <input value={form.emergencyContact.relationship} onChange={e => setForm({...form, emergencyContact: {...form.emergencyContact, relationship: e.target.value}})}
                className="input-glass w-full text-sm" placeholder="Relationship" />
            </div>

            <button onClick={handleSaveProfile} disabled={updating} className="btn-primary flex items-center gap-2 text-sm">
              {updating ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save Changes
            </button>
          </div>
        </motion.div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Employment info */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="layer-card p-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Building2 size={16} className="text-brand-500" /> Employment Details
          </h3>
          <dl className="space-y-3">
            <ProfileRow label="Employee Code" value={employee?.employeeCode} mono />
            <ProfileRow label="Department" value={employee?.department?.name} />
            <ProfileRow label="Designation" value={employee?.designation?.name} />
            <ProfileRow label="Work Mode" value={employee?.workMode?.replace(/_/g, ' ')} />
            <ProfileRow label="Joining Date" value={employee?.joiningDate ? formatDate(employee.joiningDate, 'long') : undefined} />
            <ProfileRow label="Status" value={employee?.status} />
            <ProfileRow label="Manager" value={employee?.manager ? `${employee.manager.firstName} ${employee.manager.lastName}` : undefined} />
          </dl>
        </motion.div>

        {/* Personal info */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="layer-card p-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <User size={16} className="text-brand-500" /> Personal Information
          </h3>
          <dl className="space-y-3">
            <ProfileRow label="Email" value={user?.email} />
            <ProfileRow label="Phone" value={employee?.phone} />
            <ProfileRow label="Personal Email" value={employee?.personalEmail} />
            <ProfileRow label="Date of Birth" value={employee?.dateOfBirth ? formatDate(employee.dateOfBirth, 'long') : undefined} />
            <ProfileRow label="Gender" value={employee?.gender} />
            <ProfileRow label="Blood Group" value={employee?.bloodGroup} />
            <ProfileRow label="Marital Status" value={employee?.maritalStatus} />
          </dl>
        </motion.div>

        {/* Security */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="layer-card p-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Key size={16} className="text-amber-500" /> Security
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-3 px-4 bg-surface-2 rounded-lg">
              <div>
                <p className="text-sm font-medium text-gray-700">Password</p>
                <p className="text-xs text-gray-400">Change your account password</p>
              </div>
              <button onClick={() => setShowChangePassword(true)} className="text-xs text-brand-600 hover:text-brand-700 font-medium">Change</button>
            </div>
            <div className="flex items-center justify-between py-3 px-4 bg-surface-2 rounded-lg">
              <div>
                <p className="text-sm font-medium text-gray-700">Last Login</p>
                <p className="text-xs text-gray-400">
                  {employee?.user?.lastLoginAt ? formatDate(employee.user.lastLoginAt, 'long') : 'Unknown'}
                </p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Address & Emergency */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          className="layer-card p-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <MapPin size={16} className="text-brand-500" /> Address & Emergency Contact
          </h3>
          {employee?.address ? (
            <div className="mb-4">
              <p className="text-xs text-gray-400 mb-1">Address</p>
              <p className="text-sm text-gray-700">
                {(employee.address as any).street && `${(employee.address as any).street}, `}
                {(employee.address as any).city && `${(employee.address as any).city}, `}
                {(employee.address as any).state && `${(employee.address as any).state} `}
                {(employee.address as any).pincode}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-400 mb-4">No address provided</p>
          )}
          {employee?.emergencyContact ? (
            <div>
              <p className="text-xs text-gray-400 mb-1">Emergency Contact</p>
              <p className="text-sm text-gray-700">
                {(employee.emergencyContact as any).name} ({(employee.emergencyContact as any).relationship}) — {(employee.emergencyContact as any).phone}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No emergency contact provided</p>
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
  const [changePassword, { isLoading }] = useChangePasswordMutation();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });

  const handleSubmit = async () => {
    if (form.newPassword.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    if (form.newPassword !== form.confirmPassword) { toast.error('Passwords do not match'); return; }
    try {
      await changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword }).unwrap();
      toast.success('Password changed successfully');
      onClose();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to change password'); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-display font-semibold text-gray-800">Change Password</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Current Password</label>
            <input type="password" value={form.currentPassword} onChange={e => setForm({...form, currentPassword: e.target.value})}
              className="input-glass w-full text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">New Password</label>
            <input type="password" value={form.newPassword} onChange={e => setForm({...form, newPassword: e.target.value})}
              className="input-glass w-full text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Confirm New Password</label>
            <input type="password" value={form.confirmPassword} onChange={e => setForm({...form, confirmPassword: e.target.value})}
              className="input-glass w-full text-sm" />
          </div>
          <button onClick={handleSubmit} disabled={isLoading} className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />}
            Change Password
          </button>
        </div>
      </motion.div>
    </div>
  );
}
