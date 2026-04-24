import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Loader2, Send, CheckCircle2, Info, Building2, MapPin,
  Calendar, Briefcase, Users, Phone, Mail, Plus, FileText, Trash2, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useCreateInvitationMutation, type ExperienceDocField } from '../invitation/invitationApi';
import { useGetDocumentTemplatesQuery } from '../settings/settingsApi';
import {
  useGetDepartmentsQuery,
  useGetDesignationsQuery,
  useGetOfficeLocationsQuery,
  useGetManagersQuery,
  useCreateDepartmentMutation,
  useCreateDesignationMutation,
  useDeleteDepartmentMutation,
  useDeleteDesignationMutation,
} from './employeeDepsApi';
import SearchableSelect from '../../components/ui/SearchableSelect';
import toast from 'react-hot-toast';

interface Props {
  open: boolean;
  onClose: () => void;
}

const WORK_MODES = [
  { value: 'OFFICE', label: 'Office', hint: 'Geofence auto check-in/out' },
  { value: 'HYBRID', label: 'Hybrid', hint: 'Mix of office + remote, manual' },
  { value: 'REMOTE', label: 'Remote', hint: 'Fully remote, manual attendance' },
  { value: 'FIELD_SALES', label: 'Field Sales', hint: 'GPS trail every 60s' },
  { value: 'PROJECT_SITE', label: 'Project Site', hint: 'Photo check-in at site' },
];

const EMPLOYMENT_TYPES = [
  { value: 'FULL_TIME', label: 'Full-Time', hint: 'EPF + ESI + PT eligible' },
  { value: 'PART_TIME', label: 'Part-Time', hint: 'Pro-rated leave, EPF if salary ≤15k' },
  { value: 'CONTRACT', label: 'Contract', hint: 'Typically EPF/ESI exempt' },
  { value: 'INTERN', label: 'Intern', hint: 'Stipend only, intern leave rules' },
];

const ROLES = [
  { value: 'EMPLOYEE', label: 'Employee', hint: 'Standard portal access' },
  { value: 'INTERN', label: 'Intern', hint: 'Limited access — no payroll/org chart' },
  { value: 'MANAGER', label: 'Manager', hint: 'Can approve team leaves & attendance' },
  { value: 'HR', label: 'HR', hint: 'Full employee management access' },
  { value: 'ADMIN', label: 'Admin', hint: 'All settings + HR access' },
];

const EXPERIENCE_LEVELS = [
  { value: 'FRESHER', label: 'Fresher', hint: 'No prior work experience' },
  { value: 'EXPERIENCED', label: 'Experienced', hint: 'Requires experience letter for KYC' },
  { value: 'INTERN', label: 'Intern / Student', hint: 'No experience letter required' },
];

function FieldHint({ text }: { text: string }) {
  return (
    <span className="ml-1 inline-flex items-center">
      <span title={text} className="cursor-help">
        <Info size={11} className="text-gray-400 hover:text-indigo-500 transition-colors" />
      </span>
    </span>
  );
}

export default function CreateEmployeeModal({ open, onClose }: Props) {
  const [createInvitation, { isLoading }] = useCreateInvitationMutation();

  const { data: deptRes, refetch: refetchDepts } = useGetDepartmentsQuery();
  const { data: desigRes, refetch: refetchDesigs } = useGetDesignationsQuery();
  const { data: locRes } = useGetOfficeLocationsQuery();
  const { data: mgrRes } = useGetManagersQuery();
  const { data: docTemplatesRes } = useGetDocumentTemplatesQuery();
  const [createDept] = useCreateDepartmentMutation();
  const [createDesig] = useCreateDesignationMutation();
  const [deleteDept] = useDeleteDepartmentMutation();
  const [deleteDesig] = useDeleteDesignationMutation();

  const departments = (deptRes?.data || []).map((d: any) => ({ value: d.id, label: d.name }));
  const designations = (desigRes?.data || []).map((d: any) => ({ value: d.id, label: d.name, sublabel: d.department?.name }));
  const locations = ((locRes?.data || locRes) instanceof Array ? (locRes?.data || locRes) : []).map((l: any) => ({ value: l.id, label: l.name }));
  const managers = ((mgrRes?.data?.employees || mgrRes?.data || []) as any[]).map((e: any) => ({
    value: e.id,
    label: `${e.firstName} ${e.lastName}`,
    sublabel: e.designation?.name,
  }));

  // Form state
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [employmentType, setEmploymentType] = useState('FULL_TIME');
  const [role, setRole] = useState('EMPLOYEE');
  const [experienceLevel, setExperienceLevel] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [designationId, setDesignationId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [officeLocationId, setOfficeLocationId] = useState('');
  const [workMode, setWorkMode] = useState('OFFICE');
  const [joiningDate, setJoiningDate] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Experience doc fields (for EXPERIENCED employees)
  const [experienceDocFields, setExperienceDocFields] = useState<ExperienceDocField[]>([]);
  const [docFieldsOpen, setDocFieldsOpen] = useState(false);
  const [newDocLabel, setNewDocLabel] = useState('');
  const [newDocRequired, setNewDocRequired] = useState(true);

  // Quick-create mini-dialog
  const [quickCreate, setQuickCreate] = useState<'dept' | 'desig' | null>(null);
  const [quickName, setQuickName] = useState('');
  const [quickLoading, setQuickLoading] = useState(false);

  const [success, setSuccess] = useState<{ email?: string; mobile?: string; code: string } | null>(null);

  // Auto-sync role when employmentType changes to/from INTERN
  useEffect(() => {
    if (employmentType === 'INTERN') {
      setRole('INTERN');
      setExperienceLevel('INTERN');
    } else if (role === 'INTERN') {
      setRole('EMPLOYEE');
      if (experienceLevel === 'INTERN') setExperienceLevel('');
    }
  }, [employmentType]);

  // When experienceLevel becomes EXPERIENCED, seed doc fields from org templates
  useEffect(() => {
    if (experienceLevel === 'EXPERIENCED') {
      const templates = docTemplatesRes?.data || [];
      if (templates.length > 0 && experienceDocFields.length === 0) {
        setExperienceDocFields(templates.map((t: any) => ({ key: t.key, label: t.label, required: t.required })));
      } else if (experienceDocFields.length === 0) {
        // Default fields if no org templates configured
        setExperienceDocFields([{ key: 'experience_letter', label: 'Experience Letter', required: true }]);
      }
      setDocFieldsOpen(true);
    } else {
      setExperienceDocFields([]);
      setDocFieldsOpen(false);
    }
  }, [experienceLevel]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!email.trim() && !mobile.trim()) e.contact = 'Provide at least an email or mobile number';
    if (!employmentType) e.employmentType = 'Employment type is required';
    if (!departmentId) e.departmentId = 'Department is required';
    if (!designationId) e.designationId = 'Designation is required';
    if (!officeLocationId) e.officeLocationId = 'Office location is required';
    if (!workMode) e.workMode = 'Work mode is required';
    if (!joiningDate) e.joiningDate = 'Proposed joining date is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    try {
      const result = await createInvitation({
        email: email.trim() || undefined,
        mobileNumber: mobile.trim() || undefined,
        role,
        employmentType,
        departmentId,
        designationId,
        managerId: managerId || undefined,
        officeLocationId,
        workMode,
        proposedJoiningDate: joiningDate,
        notes: notes.trim() || undefined,
        sendWelcomeEmail: true,
        experienceLevel: experienceLevel || undefined,
        experienceDocFields: experienceLevel === 'EXPERIENCED' && experienceDocFields.length > 0 ? experienceDocFields : undefined,
      }).unwrap();
      setSuccess({
        email: email.trim() || undefined,
        mobile: mobile.trim() || undefined,
        code: result?.data?.employeeCode || 'N/A',
      });
      toast.success('Invitation sent!');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to send invitation');
    }
  };

  const handleQuickCreate = async () => {
    if (!quickName.trim()) return;
    setQuickLoading(true);
    try {
      if (quickCreate === 'dept') {
        const res = await createDept({ name: quickName.trim() }).unwrap();
        setDepartmentId(res.data.id);
        await refetchDepts();
        toast.success(`Department "${quickName}" created`);
      } else if (quickCreate === 'desig') {
        const res = await createDesig({ name: quickName.trim(), departmentId: departmentId || undefined }).unwrap();
        setDesignationId(res.data.id);
        await refetchDesigs();
        toast.success(`Designation "${quickName}" created`);
      }
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to create');
    } finally {
      setQuickLoading(false);
      setQuickCreate(null);
      setQuickName('');
    }
  };

  const handleDeleteDept = async (id: string) => {
    if (!confirm('Delete this department? This cannot be undone.')) return;
    try {
      await deleteDept(id).unwrap();
      if (departmentId === id) setDepartmentId('');
      toast.success('Department deleted');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Cannot delete — department may have employees');
    }
  };

  const handleDeleteDesig = async (id: string) => {
    if (!confirm('Delete this designation? This cannot be undone.')) return;
    try {
      await deleteDesig(id).unwrap();
      if (designationId === id) setDesignationId('');
      toast.success('Designation deleted');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Cannot delete — designation may have employees');
    }
  };

  const handleClose = () => {
    setEmail(''); setMobile(''); setEmploymentType('FULL_TIME'); setRole('EMPLOYEE');
    setExperienceLevel(''); setDepartmentId(''); setDesignationId(''); setManagerId('');
    setOfficeLocationId(''); setWorkMode('OFFICE'); setJoiningDate(''); setNotes('');
    setErrors({}); setSuccess(null); setQuickCreate(null); setQuickName('');
    setExperienceDocFields([]); setDocFieldsOpen(false); setNewDocLabel(''); setNewDocRequired(true);
    onClose();
  };

  const handleAddDocField = () => {
    const label = newDocLabel.trim();
    if (!label) return;
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (experienceDocFields.some(f => f.key === key)) {
      toast.error('A field with that name already exists');
      return;
    }
    setExperienceDocFields(prev => [...prev, { key, label, required: newDocRequired }]);
    setNewDocLabel('');
    setNewDocRequired(true);
  };

  const handleRemoveDocField = (key: string) => {
    setExperienceDocFields(prev => prev.filter(f => f.key !== key));
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={(e) => e.target === e.currentTarget && handleClose()}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-white rounded-2xl shadow-glass-lg w-full max-w-2xl max-h-[92vh] flex flex-col"
        >
          {success ? (
            /* Success State */
            <div className="text-center py-10 px-8">
              <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              </div>
              <h2 className="text-lg font-display font-bold text-gray-900 mb-2">Invitation Sent!</h2>
              <p className="text-sm text-gray-500 mb-4">
                Onboarding invitation sent to{' '}
                <span className="font-medium text-gray-700">{success.email || success.mobile}</span>
              </p>
              <div className="bg-gray-50 rounded-xl p-4 mb-4 text-left space-y-2 max-w-xs mx-auto">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Employee Code</span>
                  <span className="font-mono font-medium text-gray-700" data-mono>{success.code}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Status</span>
                  <span className="text-amber-600 font-medium">Pending Onboarding</span>
                </div>
              </div>
              <button onClick={handleClose} className="btn-primary px-8">Done</button>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 flex-shrink-0">
                <div>
                  <h2 className="text-lg font-display font-semibold text-gray-800">Invite Employee</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Fill all required fields — they pre-configure the employee's account</p>
                </div>
                <button onClick={handleClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                  <X size={18} className="text-gray-400" />
                </button>
              </div>

              {/* Scrollable body */}
              <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-5 space-y-6">

                {/* ── Contact ── */}
                <section>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <Mail size={12} /> Contact
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">
                        Work Email
                        <FieldHint text="Invite link sent here; used as login ID" />
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="input-glass w-full"
                        placeholder="employee@aniston.in"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">
                        Mobile Number
                        <FieldHint text="Used for WhatsApp invite if no email" />
                      </label>
                      <input
                        type="tel"
                        value={mobile}
                        onChange={(e) => setMobile(e.target.value)}
                        className="input-glass w-full"
                        placeholder="9876543210"
                      />
                    </div>
                  </div>
                  {errors.contact && <p className="text-xs text-red-500 mt-1">{errors.contact}</p>}
                </section>

                {/* ── Employment ── */}
                <section>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <Briefcase size={12} /> Employment
                  </h3>
                  <div className="grid grid-cols-3 gap-4">
                    {/* Employment Type */}
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">
                        Employment Type <span className="text-[10px] text-indigo-400 font-normal">(EPF/ESI/PT + leaves)</span> <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={employmentType}
                        onChange={(e) => setEmploymentType(e.target.value)}
                        className={`input-glass w-full text-sm ${errors.employmentType ? 'border-red-300' : ''}`}
                        required
                      >
                        {EMPLOYMENT_TYPES.map((t) => (
                          <option key={t.value} value={t.value} title={t.hint}>{t.label}</option>
                        ))}
                      </select>
                      {EMPLOYMENT_TYPES.find(t => t.value === employmentType) && (
                        <p className="text-[10px] text-indigo-500 mt-0.5">
                          {EMPLOYMENT_TYPES.find(t => t.value === employmentType)!.hint}
                        </p>
                      )}
                      {errors.employmentType && <p className="text-xs text-red-500 mt-1">{errors.employmentType}</p>}
                    </div>

                    {/* Role */}
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">
                        Portal Role
                        <FieldHint text="Determines what the employee can see and do in the HR portal" />
                      </label>
                      <select
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        className="input-glass w-full text-sm"
                      >
                        {ROLES.map((r) => (
                          <option key={r.value} value={r.value} title={r.hint}>{r.label}</option>
                        ))}
                      </select>
                      {ROLES.find(r => r.value === role) && (
                        <p className="text-[10px] text-indigo-500 mt-0.5">
                          {ROLES.find(r => r.value === role)!.hint}
                        </p>
                      )}
                      {employmentType === 'INTERN' && (
                        <p className="text-[10px] text-amber-500 mt-0.5">Auto-set to Intern</p>
                      )}
                    </div>

                    {/* Experience Level */}
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">
                        Experience Level <span className="text-[10px] text-indigo-400 font-normal">(KYC docs)</span>
                      </label>
                      <select
                        value={experienceLevel}
                        onChange={(e) => setExperienceLevel(e.target.value)}
                        className="input-glass w-full text-sm"
                      >
                        <option value="">— Select —</option>
                        {EXPERIENCE_LEVELS.map((l) => (
                          <option key={l.value} value={l.value} title={l.hint}>{l.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </section>

                {/* ── Assignment ── */}
                <section>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <Building2 size={12} /> Assignment
                  </h3>
                  <div className="grid grid-cols-3 gap-4">
                    {/* Department */}
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">
                        Department <span className="text-red-500">*</span>
                        <FieldHint text="Determines leave policy, org chart placement, and team grouping" />
                      </label>
                      <SearchableSelect
                        options={departments}
                        value={departmentId}
                        onChange={setDepartmentId}
                        placeholder="Select dept..."
                        canCreate
                        createLabel="+ Add new department"
                        onCreateClick={() => { setQuickCreate('dept'); setQuickName(''); }}
                        canDelete
                        onDeleteClick={handleDeleteDept}
                        error={errors.departmentId}
                      />
                    </div>

                    {/* Designation */}
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">
                        Designation <span className="text-red-500">*</span>
                        <FieldHint text="Job title on offer letters, payslips, and org chart" />
                      </label>
                      <SearchableSelect
                        options={designations}
                        value={designationId}
                        onChange={setDesignationId}
                        placeholder="Select desig..."
                        canCreate
                        createLabel="+ Add new designation"
                        onCreateClick={() => { setQuickCreate('desig'); setQuickName(''); }}
                        canDelete
                        onDeleteClick={handleDeleteDesig}
                        error={errors.designationId}
                      />
                    </div>

                    {/* Manager */}
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">
                        Reporting Manager
                        <FieldHint text="Routes leave requests and attendance regularization approvals" />
                      </label>
                      <SearchableSelect
                        options={managers}
                        value={managerId}
                        onChange={setManagerId}
                        placeholder="Select manager..."
                      />
                    </div>
                  </div>
                </section>

                {/* ── Work Setup ── */}
                <section>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <MapPin size={12} /> Work Setup
                  </h3>
                  <div className="grid grid-cols-3 gap-4">
                    {/* Work Mode */}
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">
                        Work Mode <span className="text-red-500">*</span>
                        <FieldHint text="Determines attendance method: OFFICE=geofence, FIELD_SALES=GPS trail, PROJECT_SITE=photo, REMOTE/HYBRID=manual" />
                      </label>
                      <select
                        value={workMode}
                        onChange={(e) => setWorkMode(e.target.value)}
                        className={`input-glass w-full text-sm ${errors.workMode ? 'border-red-300' : ''}`}
                        required
                      >
                        {WORK_MODES.map((m) => (
                          <option key={m.value} value={m.value} title={m.hint}>{m.label}</option>
                        ))}
                      </select>
                      {WORK_MODES.find(m => m.value === workMode) && (
                        <p className="text-[10px] text-indigo-500 mt-0.5">
                          {WORK_MODES.find(m => m.value === workMode)!.hint}
                        </p>
                      )}
                      {errors.workMode && <p className="text-xs text-red-500 mt-1">{errors.workMode}</p>}
                    </div>

                    {/* Office Location */}
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">
                        Office Location <span className="text-red-500">*</span>
                        <FieldHint text="Sets the geofence boundary for OFFICE attendance check-in" />
                      </label>
                      <SearchableSelect
                        options={locations}
                        value={officeLocationId}
                        onChange={setOfficeLocationId}
                        placeholder="Select location..."
                        error={errors.officeLocationId}
                      />
                    </div>

                    {/* Joining Date */}
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">
                        Joining Date <span className="text-red-500">*</span>
                        <FieldHint text="Payroll uses this for first-month pro-ration; leave accrual starts from this date" />
                      </label>
                      <input
                        type="date"
                        value={joiningDate}
                        onChange={(e) => setJoiningDate(e.target.value)}
                        className={`input-glass w-full text-sm ${errors.joiningDate ? 'border-red-300' : ''}`}
                        required
                      />
                      {errors.joiningDate && <p className="text-xs text-red-500 mt-1">{errors.joiningDate}</p>}
                    </div>
                  </div>
                </section>

                {/* ── Notes ── */}
                <section>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Notes (optional)</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="input-glass w-full text-sm resize-none"
                    rows={2}
                    placeholder="Any additional notes for HR..."
                    maxLength={1000}
                  />
                </section>

                {/* ── Required Documents (EXPERIENCED only) ── */}
                {experienceLevel === 'EXPERIENCED' && (
                  <section className="border border-amber-200 rounded-xl bg-amber-50/50 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setDocFieldsOpen(prev => !prev)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <FileText size={14} className="text-amber-600" />
                        <span className="text-sm font-medium text-amber-800">
                          Required Documents for This Employee
                        </span>
                        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                          {experienceDocFields.length} field{experienceDocFields.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      {docFieldsOpen ? (
                        <ChevronUp size={14} className="text-amber-600" />
                      ) : (
                        <ChevronDown size={14} className="text-amber-600" />
                      )}
                    </button>

                    {docFieldsOpen && (
                      <div className="px-4 pb-4 space-y-3">
                        <p className="text-xs text-amber-700">
                          These document fields will be required during the employee's KYC process. Defaults come from your org templates.
                        </p>

                        {/* Existing fields */}
                        <div className="space-y-2">
                          {experienceDocFields.map((field) => (
                            <div key={field.key} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-amber-100">
                              <FileText size={12} className="text-gray-400 flex-shrink-0" />
                              <span className="text-sm text-gray-700 flex-1">{field.label}</span>
                              <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={field.required}
                                  onChange={(e) => setExperienceDocFields(prev =>
                                    prev.map(f => f.key === field.key ? { ...f, required: e.target.checked } : f)
                                  )}
                                  className="w-3 h-3 accent-indigo-600"
                                />
                                Required
                              </label>
                              <button
                                type="button"
                                onClick={() => handleRemoveDocField(field.key)}
                                className="p-1 hover:bg-red-50 rounded text-red-400 hover:text-red-600 transition-colors"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>

                        {/* Add new field */}
                        <div className="flex gap-2 items-center">
                          <input
                            type="text"
                            value={newDocLabel}
                            onChange={(e) => setNewDocLabel(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddDocField())}
                            className="input-glass flex-1 text-sm py-1.5"
                            placeholder="e.g. Relieving Letter"
                          />
                          <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer flex-shrink-0">
                            <input
                              type="checkbox"
                              checked={newDocRequired}
                              onChange={(e) => setNewDocRequired(e.target.checked)}
                              className="w-3 h-3 accent-indigo-600"
                            />
                            Required
                          </label>
                          <button
                            type="button"
                            onClick={handleAddDocField}
                            disabled={!newDocLabel.trim()}
                            className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1 flex-shrink-0"
                          >
                            <Plus size={12} />
                            Add
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                )}
              </form>

              {/* Footer */}
              <div className="flex gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
                <button type="button" onClick={handleClose} className="btn-secondary flex-1">Cancel</button>
                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={handleSubmit}
                  disabled={isLoading}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  Send Invitation
                </motion.button>
              </div>
            </>
          )}
        </motion.div>

        {/* Quick-create department/designation mini-dialog */}
        <AnimatePresence>
          {quickCreate && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/20 flex items-center justify-center"
              onClick={(e) => e.target === e.currentTarget && setQuickCreate(null)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-xl shadow-xl p-5 w-80"
              >
                <h4 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <Plus size={14} className="text-indigo-500" />
                  {quickCreate === 'dept' ? 'New Department' : 'New Designation'}
                </h4>
                <input
                  autoFocus
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleQuickCreate()}
                  className="input-glass w-full text-sm mb-3"
                  placeholder={quickCreate === 'dept' ? 'e.g. Engineering' : 'e.g. Software Engineer'}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setQuickCreate(null)}
                    className="btn-secondary flex-1 text-sm py-1.5"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleQuickCreate}
                    disabled={quickLoading || !quickName.trim()}
                    className="btn-primary flex-1 text-sm py-1.5 flex items-center justify-center gap-1"
                  >
                    {quickLoading ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                    Create
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}
