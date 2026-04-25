import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { FileText, Plus, Search, Loader2, Eye, Trash2, Shield, ShieldOff, X, Award, UserPlus, Check, Upload, ZoomIn } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import {
  useGetLettersQuery,
  useGetLetterTemplatesQuery,
  useCreateLetterMutation,
  useDeleteLetterMutation,
  useUpdateLetterAssignmentMutation,
  useAssignLetterMutation,
  useUploadLetterFileMutation,
} from './letterApi';
import { useGetEmployeesQuery } from '../employee/employeeApi';
import { useAppSelector } from '../../app/store';
import SecureDocumentViewer from './SecureDocumentViewer';

const LETTER_TYPES = [
  { value: 'OFFER_LETTER', label: 'Offer Letter', color: 'bg-blue-100 text-blue-700' },
  { value: 'JOINING_LETTER', label: 'Joining Letter', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'EXPERIENCE_LETTER', label: 'Experience Letter', color: 'bg-purple-100 text-purple-700' },
  { value: 'RELIEVING_LETTER', label: 'Relieving Letter', color: 'bg-orange-100 text-orange-700' },
  { value: 'SALARY_SLIP_LETTER', label: 'Salary Slip', color: 'bg-cyan-100 text-cyan-700' },
  { value: 'PROMOTION_LETTER', label: 'Promotion Letter', color: 'bg-amber-100 text-amber-700' },
  { value: 'WARNING_LETTER', label: 'Warning Letter', color: 'bg-red-100 text-red-700' },
  { value: 'APPRECIATION_LETTER', label: 'Appreciation', color: 'bg-pink-100 text-pink-700' },
  { value: 'CUSTOM', label: 'Custom Letter', color: 'bg-gray-100 text-gray-700' },
];

const TEMPLATE_COLORS: Record<string, string> = {
  'corporate-classic': 'from-[#1B2A4A] to-[#C8A951]',
  'modern-minimal': 'from-indigo-600 to-indigo-400',
  'bold-executive': 'from-gray-800 to-teal-500',
  'vibrant-tech': 'from-purple-600 to-blue-500',
  'warm-professional': 'from-amber-800 to-amber-500',
  'elegant-formal': 'from-green-800 to-green-500',
  'startup-fresh': 'from-rose-600 to-slate-500',
};

export default function LettersTab() {
  const token = useAppSelector((s) => s.auth.accessToken);
  const { data: lettersRes, isLoading } = useGetLettersQuery();
  const { data: templatesRes, isLoading: templatesLoading } = useGetLetterTemplatesQuery();
  // limit: 500 to load all employees — default pagination is 20 which would miss most employees
  const { data: employeesRes } = useGetEmployeesQuery({ limit: 500 });
  const [createLetter, { isLoading: creating }] = useCreateLetterMutation();
  const [deleteLetter] = useDeleteLetterMutation();
  const [updateAssignment] = useUpdateLetterAssignmentMutation();
  const [assignLetter, { isLoading: assigning }] = useAssignLetterMutation();
  const [uploadLetterFile, { isLoading: uploading }] = useUploadLetterFileMutation();

  const [showCreate, setShowCreate] = useState(false);
  const [createMode, setCreateMode] = useState<'generate' | 'upload'>('generate');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const uploadFileRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [viewLetter, setViewLetter] = useState<any>(null);

  // Preview state — holds blob URL for the generated preview PDF
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Create form state
  const [formType, setFormType] = useState('JOINING_LETTER');
  const [formTitle, setFormTitle] = useState('');
  const [formEmployee, setFormEmployee] = useState('');
  const [formTemplate, setFormTemplate] = useState('modern-minimal');
  const [formDownload, setFormDownload] = useState(false);
  const [formContent, setFormContent] = useState<Record<string, string>>({});
  const [customBody, setCustomBody] = useState('');
  const [empSearch, setEmpSearch] = useState('');
  const [showEmpDropdown, setShowEmpDropdown] = useState(false);
  const empDropdownRef = useRef<HTMLDivElement>(null);

  // Assign-to-more state
  const [assigningLetterId, setAssigningLetterId] = useState<string | null>(null);
  const [assignSearch, setAssignSearch] = useState('');
  const [assignEmpIds, setAssignEmpIds] = useState<string[]>([]);
  const [assignDownload, setAssignDownload] = useState(false);
  const assignDropdownRef = useRef<HTMLDivElement>(null);

  // Close employee dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (empDropdownRef.current && !empDropdownRef.current.contains(e.target as Node)) {
        setShowEmpDropdown(false);
      }
    }
    if (showEmpDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showEmpDropdown]);

  const letters = lettersRes?.data || [];
  const templates = templatesRes?.data?.builtIn || [];
  const employees = employeesRes?.data || [];

  const filteredLetters = useMemo(() => {
    if (!search) return letters;
    const q = search.toLowerCase();
    return letters.filter((l: any) =>
      l.title.toLowerCase().includes(q) ||
      l.type.toLowerCase().includes(q) ||
      l.assignments?.some((a: any) =>
        `${a.employee.firstName} ${a.employee.lastName}`.toLowerCase().includes(q) ||
        a.employee.employeeCode.toLowerCase().includes(q)
      )
    );
  }, [letters, search]);

  const filteredEmployees = useMemo(() => {
    if (!empSearch) return employees.slice(0, 20);
    const q = empSearch.toLowerCase();
    return employees.filter((e: any) =>
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
      e.employeeCode.toLowerCase().includes(q) ||
      e.email.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [employees, empSearch]);

  const selectedEmployee = employees.find((e: any) => e.id === formEmployee);

  const buildContent = useCallback(() => {
    const { salary, designation, department, joiningDate, lastWorkingDate, resignationDate, ...customRest } = formContent;
    const content: Record<string, any> = {};
    if (salary) content.salary = salary;
    if (designation) content.designation = designation;
    if (department) content.department = department;
    if (joiningDate) content.joiningDate = joiningDate;
    if (lastWorkingDate) content.lastWorkingDate = lastWorkingDate;
    if (resignationDate) content.resignationDate = resignationDate;
    if (customBody.trim()) content.customBody = customBody.trim();
    if (Object.keys(customRest).length > 0) content.customFields = customRest;
    return content;
  }, [formContent, customBody]);

  const handleCreate = async () => {
    if (!formTitle.trim()) { toast.error('Title is required'); return; }
    if (!formEmployee) { toast.error('Please select an employee'); return; }

    try {
      await createLetter({
        type: formType,
        title: formTitle.trim(),
        employeeId: formEmployee,
        templateSlug: formTemplate,
        downloadAllowed: formDownload,
        content: buildContent(),
      }).unwrap();
      toast.success('Letter created and assigned');
      setShowCreate(false);
      resetForm();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to create letter');
    }
  };

  const handlePreview = async () => {
    if (!formTitle.trim()) { toast.error('Title is required'); return; }
    if (!formEmployee) { toast.error('Please select an employee'); return; }

    setPreviewing(true);
    try {
      const response = await fetch('/api/letters/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          type: formType,
          title: formTitle.trim(),
          employeeId: formEmployee,
          templateSlug: formTemplate,
          content: buildContent(),
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        toast.error(err?.error?.message || 'Preview failed');
        return;
      }

      const blob = await response.blob();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch {
      toast.error('Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const resetForm = () => {
    setFormType('JOINING_LETTER');
    setFormTitle('');
    setFormEmployee('');
    setFormTemplate('modern-minimal');
    setFormDownload(false);
    setFormContent({});
    setCustomBody('');
    setEmpSearch('');
    setUploadFile(null);
    setCreateMode('generate');
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
  };

  const handleUpload = async () => {
    if (!formTitle.trim()) { toast.error('Title is required'); return; }
    if (!formEmployee) { toast.error('Please select an employee'); return; }
    if (!uploadFile) { toast.error('Please select a PDF file'); return; }

    try {
      const fd = new FormData();
      fd.append('file', uploadFile);
      fd.append('type', formType);
      fd.append('title', formTitle.trim());
      fd.append('employeeId', formEmployee);
      fd.append('downloadAllowed', String(formDownload));
      await uploadLetterFile(fd).unwrap();
      toast.success('Letter uploaded and assigned');
      setShowCreate(false);
      resetForm();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to upload letter');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this letter?')) return;
    try {
      await deleteLetter(id).unwrap();
      toast.success('Letter deleted');
    } catch { toast.error('Failed to delete'); }
  };

  const handleToggleDownload = async (assignmentId: string, current: boolean) => {
    try {
      await updateAssignment({ assignmentId, downloadAllowed: !current }).unwrap();
      toast.success(`Download ${!current ? 'enabled' : 'disabled'}`);
    } catch { toast.error('Failed to update'); }
  };

  const handleAssign = async () => {
    if (!assigningLetterId || assignEmpIds.length === 0) {
      toast.error('Select at least one employee');
      return;
    }
    try {
      await assignLetter({ id: assigningLetterId, body: { employeeIds: assignEmpIds, downloadAllowed: assignDownload } }).unwrap();
      toast.success(`Letter assigned to ${assignEmpIds.length} employee${assignEmpIds.length > 1 ? 's' : ''}`);
      setAssigningLetterId(null);
      setAssignEmpIds([]);
      setAssignSearch('');
      setAssignDownload(false);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to assign');
    }
  };

  const assignFilteredEmployees = useMemo(() => {
    // Exclude employees already assigned to the letter being assigned
    const currentLetter = assigningLetterId ? letters.find((l: any) => l.id === assigningLetterId) : null;
    const alreadyAssigned = new Set((currentLetter?.assignments || []).map((a: any) => a.employee.id));
    const available = employees.filter((e: any) => !alreadyAssigned.has(e.id));
    if (!assignSearch) return available.slice(0, 20);
    const q = assignSearch.toLowerCase();
    return available.filter((e: any) =>
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
      e.employeeCode.toLowerCase().includes(q) ||
      e.email.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [employees, assignSearch, assigningLetterId, letters]);

  const getTypeInfo = (type: string) => LETTER_TYPES.find((t) => t.value === type) || LETTER_TYPES[8];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search letters..."
            className="input-glass w-full pl-9 text-sm"
          />
        </div>
        <button onClick={() => setShowCreate(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors">
          <Plus size={16} /> Issue Letter
        </button>
      </div>

      {/* Create Letter Modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="layer-card p-5 space-y-5 border-l-4 border-indigo-500">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                  <Award size={16} className="text-indigo-600" /> Issue New Letter
                </h4>
                <button onClick={() => { setShowCreate(false); resetForm(); }} className="text-gray-400 hover:text-gray-600">
                  <X size={18} />
                </button>
              </div>

              {/* Mode toggle */}
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
                <button
                  onClick={() => setCreateMode('generate')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${createMode === 'generate' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <FileText size={13} /> Generate from Template
                </button>
                <button
                  onClick={() => setCreateMode('upload')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${createMode === 'upload' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <Upload size={13} /> Upload PDF
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Title */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Letter Title *</label>
                  <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)}
                    className="input-glass w-full text-sm" placeholder="e.g. Offer Letter - Priya Sharma" />
                </div>

                {/* Type */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Letter Type *</label>
                  <select value={formType} onChange={(e) => setFormType(e.target.value)}
                    className="input-glass w-full text-sm">
                    {LETTER_TYPES.map((lt) => (
                      <option key={lt.value} value={lt.value}>{lt.label}</option>
                    ))}
                  </select>
                </div>

                {/* Employee */}
                <div className="relative" ref={empDropdownRef}>
                  <label className="block text-xs text-gray-500 mb-1">Assign to Employee *</label>
                  {selectedEmployee ? (
                    <div className="input-glass w-full text-sm flex items-center justify-between">
                      <span>{selectedEmployee.firstName} {selectedEmployee.lastName} ({selectedEmployee.employeeCode})</span>
                      <button onClick={() => { setFormEmployee(''); setEmpSearch(''); }} className="text-gray-400 hover:text-red-500">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <input
                        value={empSearch}
                        onChange={(e) => { setEmpSearch(e.target.value); setShowEmpDropdown(true); }}
                        onFocus={() => setShowEmpDropdown(true)}
                        className="input-glass w-full text-sm"
                        placeholder="Search employee..."
                      />
                      {showEmpDropdown && filteredEmployees.length > 0 && (
                        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {filteredEmployees.map((emp: any) => (
                            <button key={emp.id} onClick={() => {
                              setFormEmployee(emp.id);
                              setEmpSearch('');
                              setShowEmpDropdown(false);
                            }} className="w-full text-left px-3 py-2 hover:bg-indigo-50 text-sm">
                              <span className="font-medium">{emp.firstName} {emp.lastName}</span>
                              <span className="text-gray-400 ml-2">{emp.employeeCode}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Download Permission */}
                <div className="flex items-center gap-3 pt-5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={formDownload} onChange={(e) => setFormDownload(e.target.checked)}
                      className="accent-indigo-600 w-4 h-4" />
                    <span className="text-sm text-gray-700">Allow employee to download</span>
                  </label>
                </div>
              </div>

              {/* Upload PDF section — upload mode only */}
              {createMode === 'upload' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">PDF File *</label>
                  <input
                    ref={uploadFileRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  />
                  {uploadFile ? (
                    <div className="flex items-center gap-2 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                      <FileText size={16} className="text-indigo-600 shrink-0" />
                      <span className="text-sm text-indigo-800 truncate flex-1">{uploadFile.name}</span>
                      <button onClick={() => setUploadFile(null)} className="text-gray-400 hover:text-red-500 shrink-0">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => uploadFileRef.current?.click()}
                      className="w-full border-2 border-dashed border-gray-200 hover:border-indigo-300 rounded-lg p-4 text-sm text-gray-500 hover:text-indigo-600 transition-colors flex items-center justify-center gap-2"
                    >
                      <Upload size={16} /> Click to select PDF
                    </button>
                  )}
                  <p className="text-xs text-gray-400 mt-1">Max 10 MB · PDF only</p>
                </div>
              )}

              {/* Template Gallery — generate mode only */}
              {createMode === 'generate' && <div>
                <label className="block text-xs text-gray-500 mb-2">Choose Template</label>
                {templatesLoading ? (
                  <div className="flex items-center gap-2 py-4">
                    <Loader2 size={16} className="animate-spin text-indigo-600" />
                    <span className="text-xs text-gray-500">Loading templates...</span>
                  </div>
                ) : templates.length === 0 ? (
                  <div className="text-sm text-gray-400 py-4">No templates available. Templates will auto-create when you issue your first letter.</div>
                ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                  {templates.map((t: any) => (
                    <button
                      key={t.slug}
                      onClick={() => setFormTemplate(t.slug)}
                      className={`relative rounded-xl overflow-hidden border-2 transition-all ${
                        formTemplate === t.slug
                          ? 'border-indigo-500 ring-2 ring-indigo-200 scale-105'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className={`h-20 bg-gradient-to-br ${TEMPLATE_COLORS[t.slug] || 'from-gray-400 to-gray-600'}`}>
                        <div className="h-full flex flex-col items-center justify-center p-2">
                          <div className="w-6 h-0.5 bg-white/60 rounded mb-1" />
                          <div className="w-10 h-0.5 bg-white/40 rounded mb-1" />
                          <div className="w-8 h-0.5 bg-white/30 rounded" />
                        </div>
                      </div>
                      <div className="p-1.5 bg-white">
                        <p className="text-[10px] font-medium text-gray-700 truncate text-center">{t.name}</p>
                      </div>
                      {formTemplate === t.slug && (
                        <div className="absolute top-1 right-1 w-4 h-4 bg-indigo-600 rounded-full flex items-center justify-center">
                          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                            <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
                )}
              </div>}

              {/* Optional Fields — generate mode only */}
              {createMode === 'generate' && (formType === 'OFFER_LETTER' || formType === 'PROMOTION_LETTER') && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Salary / CTC (optional)</label>
                  <input value={formContent.salary || ''} onChange={(e) => setFormContent({ ...formContent, salary: e.target.value })}
                    className="input-glass w-full text-sm" placeholder="e.g. 600000" />
                </div>
              )}
              {createMode === 'generate' && formType === 'WARNING_LETTER' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Reason for Warning</label>
                  <textarea value={formContent.reason || ''} onChange={(e) => setFormContent({ ...formContent, reason: e.target.value })}
                    className="input-glass w-full text-sm" rows={2} placeholder="Describe the reason..." />
                </div>
              )}
              {createMode === 'generate' && formType === 'APPRECIATION_LETTER' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Achievement Description</label>
                  <textarea value={formContent.achievement || ''} onChange={(e) => setFormContent({ ...formContent, achievement: e.target.value })}
                    className="input-glass w-full text-sm" rows={2} placeholder="Describe the achievement..." />
                </div>
              )}

              {/* Custom body — available for all template types */}
              {createMode === 'generate' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    {formType === 'CUSTOM' ? 'Letter Body *' : 'Custom Letter Body (optional — overrides default template text)'}
                  </label>
                  <textarea
                    value={customBody}
                    onChange={(e) => setCustomBody(e.target.value)}
                    className="input-glass w-full text-sm"
                    rows={formType === 'CUSTOM' ? 5 : 4}
                    placeholder={formType === 'CUSTOM'
                      ? 'Write the letter content...'
                      : 'Leave empty to use the default template text, or type here to replace it with your own wording...'}
                  />
                </div>
              )}

              <div className="flex gap-2 pt-1 flex-wrap">
                {createMode === 'generate' ? (
                  <>
                    <button onClick={handlePreview} disabled={previewing || creating}
                      className="bg-gray-700 hover:bg-gray-800 text-white text-sm font-medium px-5 py-2 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50">
                      {previewing ? <Loader2 size={14} className="animate-spin" /> : <ZoomIn size={14} />}
                      {previewing ? 'Generating Preview...' : 'Preview'}
                    </button>
                    <button onClick={handleCreate} disabled={creating || previewing}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50">
                      {creating ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                      {creating ? 'Generating...' : 'Generate & Issue'}
                    </button>
                  </>
                ) : (
                  <button onClick={handleUpload} disabled={uploading}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2 rounded-lg flex items-center gap-2 transition-colors">
                    {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    {uploading ? 'Uploading...' : 'Upload & Assign'}
                  </button>
                )}
                <button onClick={() => { setShowCreate(false); resetForm(); }} className="btn-secondary text-sm">Cancel</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Letters List */}
      {filteredLetters.length === 0 ? (
        <div className="layer-card p-12 text-center">
          <FileText size={40} className="mx-auto text-gray-300 mb-3" />
          <h4 className="font-semibold text-gray-600">No letters issued yet</h4>
          <p className="text-sm text-gray-400 mt-1">Click "Issue Letter" to create and assign letters to employees.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredLetters.map((letter: any) => {
            const typeInfo = getTypeInfo(letter.type);
            const isAssigning = assigningLetterId === letter.id;
            return (
              <div key={letter.id} className="layer-card p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeInfo.color}`}>
                        {typeInfo.label}
                      </span>
                      <h4 className="text-sm font-semibold text-gray-800">{letter.title}</h4>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-500 mt-1">
                      <span>Template: {letter.template?.name || 'Default'}</span>
                      <span>Issued: {new Date(letter.createdAt).toLocaleDateString('en-IN')}</span>
                      <span>By: {letter.issuedBy?.email}</span>
                    </div>

                    {/* Assigned employees */}
                    <div className="flex flex-wrap gap-2 mt-2">
                      {letter.assignments?.map((a: any) => (
                        <div key={a.id} className="flex items-center gap-1.5 bg-gray-50 rounded-full px-2.5 py-1 text-xs">
                          <span className="font-medium text-gray-700">{a.employee.firstName} {a.employee.lastName}</span>
                          <span className="text-gray-400">{a.employee.employeeCode}</span>
                          <button
                            onClick={() => handleToggleDownload(a.id, a.downloadAllowed)}
                            title={a.downloadAllowed ? 'Download allowed — click to revoke' : 'Download blocked — click to allow'}
                            className={`ml-1 p-0.5 rounded ${a.downloadAllowed ? 'text-emerald-600 hover:text-red-500' : 'text-red-500 hover:text-emerald-600'}`}
                          >
                            {a.downloadAllowed ? <Shield size={12} /> : <ShieldOff size={12} />}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 ml-3 shrink-0">
                    <button onClick={() => setViewLetter(letter)} title="View"
                      className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                      <Eye size={16} />
                    </button>
                    <button
                      onClick={() => {
                        if (isAssigning) {
                          setAssigningLetterId(null);
                          setAssignEmpIds([]);
                          setAssignSearch('');
                        } else {
                          setAssigningLetterId(letter.id);
                          setAssignEmpIds([]);
                          setAssignSearch('');
                        }
                      }}
                      title="Assign to more employees"
                      className={`p-1.5 rounded-lg transition-colors ${isAssigning ? 'text-indigo-600 bg-indigo-50' : 'text-gray-400 hover:text-indigo-600 hover:bg-indigo-50'}`}
                    >
                      <UserPlus size={16} />
                    </button>
                    <button onClick={() => handleDelete(letter.id)} title="Delete"
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* Inline assign panel */}
                <AnimatePresence>
                  {isAssigning && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                        <p className="text-xs font-semibold text-gray-600">Assign to more employees</p>

                        {/* Employee search */}
                        <div className="relative" ref={assignDropdownRef}>
                          <input
                            value={assignSearch}
                            onChange={(e) => setAssignSearch(e.target.value)}
                            placeholder="Search employee by name or code..."
                            className="input-glass w-full text-sm"
                          />
                          {assignFilteredEmployees.length > 0 && (
                            <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                              {assignFilteredEmployees.map((emp: any) => {
                                const selected = assignEmpIds.includes(emp.id);
                                return (
                                  <button key={emp.id}
                                    onClick={() => setAssignEmpIds(prev =>
                                      selected ? prev.filter(id => id !== emp.id) : [...prev, emp.id]
                                    )}
                                    className={`w-full text-left px-3 py-2 hover:bg-indigo-50 text-sm flex items-center justify-between ${selected ? 'bg-indigo-50' : ''}`}
                                  >
                                    <span>
                                      <span className="font-medium">{emp.firstName} {emp.lastName}</span>
                                      <span className="text-gray-400 ml-2 text-xs">{emp.employeeCode}</span>
                                    </span>
                                    {selected && <Check size={14} className="text-indigo-600 shrink-0" />}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Selected employees chips */}
                        {assignEmpIds.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {assignEmpIds.map(id => {
                              const emp = employees.find((e: any) => e.id === id);
                              if (!emp) return null;
                              return (
                                <span key={id} className="flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs rounded-full px-2.5 py-1">
                                  {emp.firstName} {emp.lastName}
                                  <button onClick={() => setAssignEmpIds(prev => prev.filter(i => i !== id))}
                                    className="hover:text-red-500 ml-0.5">
                                    <X size={11} />
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        )}

                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-600">
                            <input type="checkbox" checked={assignDownload} onChange={e => setAssignDownload(e.target.checked)}
                              className="accent-indigo-600 w-3.5 h-3.5" />
                            Allow download
                          </label>
                          <button
                            onClick={handleAssign}
                            disabled={assigning || assignEmpIds.length === 0}
                            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
                          >
                            {assigning ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
                            {assigning ? 'Assigning...' : `Assign${assignEmpIds.length > 0 ? ` (${assignEmpIds.length})` : ''}`}
                          </button>
                          <button onClick={() => { setAssigningLetterId(null); setAssignEmpIds([]); setAssignSearch(''); }}
                            className="text-xs text-gray-400 hover:text-gray-600">
                            Cancel
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      {/* Secure Viewer — HR/Admin can always download */}
      {viewLetter && (
        <SecureDocumentViewer
          streamUrl={`/letters/${viewLetter.id}/stream`}
          title={viewLetter.title}
          downloadAllowed={true}
          downloadUrl={`/letters/${viewLetter.id}/download`}
          onClose={() => setViewLetter(null)}
        />
      )}

      {/* Preview Modal */}
      <AnimatePresence>
        {previewUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-3 bg-gray-900 text-white">
              <div className="flex items-center gap-2">
                <Eye size={16} className="text-indigo-400" />
                <span className="text-sm font-semibold">Letter Preview — {formTitle || 'Untitled'}</span>
                <span className="text-xs text-gray-400 ml-2">Review before issuing to employee</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  {creating ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  {creating ? 'Issuing...' : 'Issue to Employee'}
                </button>
                <button
                  onClick={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }}
                  className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors"
                >
                  <X size={13} /> Back to Edit
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <iframe
                src={previewUrl}
                className="w-full h-full border-0"
                title="Letter Preview"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
