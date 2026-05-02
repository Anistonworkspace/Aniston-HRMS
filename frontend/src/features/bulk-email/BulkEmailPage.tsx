import { useState, useMemo, useRef } from 'react';
import {
  Send, Loader2, Search, CheckCircle2, AlertTriangle, X, Users,
  Mail, Smartphone, Clock, Megaphone, DollarSign, FileText, Paperclip,
  ChevronDown, ChevronUp, FlaskConical, Upload, Download, FileSpreadsheet,
  Filter,
} from 'lucide-react';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { cn, getInitials } from '../../lib/utils';
import { useSendUnifiedBulkEmailMutation, useGetBulkEmailPreviewQuery } from '../employee/employeeApi';
import { useGetEmployeesQuery } from '../employee/employeeApi';
import { useGetDepartmentsQuery, useGetDesignationsQuery } from '../employee/employeeDepsApi';
import { useAppSelector } from '../../app/store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RecipientMode = 'selected' | 'filter' | 'manual';

type TemplateType =
  | 'CUSTOM'
  | 'WELCOME'
  | 'PAYROLL_REMINDER'
  | 'ATTENDANCE_REMINDER'
  | 'ANNOUNCEMENT'
  | 'app-download'
  | 'attendance-instructions'
  | 'onboarding-invite';

interface AttachedFile {
  file: File;
  previewName: string;
}

// ---------------------------------------------------------------------------
// Template definitions
// ---------------------------------------------------------------------------

interface TemplateDef {
  value: TemplateType;
  label: string;
  description: string;
  icon: React.ElementType;
  defaultSubject?: string;
  needsCompose: boolean;
  group: 'predefined' | 'custom';
}

const TEMPLATES: TemplateDef[] = [
  { value: 'app-download', label: 'App Download Link', description: 'Send HRMS mobile app install instructions', icon: Smartphone, needsCompose: false, group: 'predefined' },
  { value: 'attendance-instructions', label: 'Attendance Instructions', description: 'Shift info and attendance marking guide', icon: Clock, needsCompose: false, group: 'predefined' },
  { value: 'onboarding-invite', label: 'Onboarding Invite', description: 'Pre-joining invitation with document checklist', icon: Mail, needsCompose: false, group: 'predefined' },
  { value: 'WELCOME', label: 'Welcome Email', description: 'Welcome new team members to the organisation', icon: CheckCircle2, defaultSubject: 'Welcome to the Team!', needsCompose: true, group: 'custom' },
  { value: 'ANNOUNCEMENT', label: 'Announcement', description: 'General org-wide announcement', icon: Megaphone, defaultSubject: 'Important Announcement', needsCompose: true, group: 'custom' },
  { value: 'PAYROLL_REMINDER', label: 'Payroll Reminder', description: 'Remind employees about payroll or payslips', icon: DollarSign, defaultSubject: 'Payroll Reminder — Action Required', needsCompose: true, group: 'custom' },
  { value: 'ATTENDANCE_REMINDER', label: 'Attendance Reminder', description: 'Remind employees to mark attendance', icon: Clock, defaultSubject: 'Reminder: Please Mark Your Attendance', needsCompose: true, group: 'custom' },
  { value: 'CUSTOM', label: 'Custom Email', description: 'Write a completely custom subject and message', icon: FileText, defaultSubject: '', needsCompose: true, group: 'custom' },
];

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PROBATION', label: 'Probation' },
  { value: 'ONBOARDING', label: 'Onboarding' },
  { value: 'INTERN', label: 'Intern' },
  { value: 'NOTICE_PERIOD', label: 'Notice Period' },
];

const ROLE_OPTIONS = [
  { value: 'EMPLOYEE', label: 'Employee' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'HR', label: 'HR' },
  { value: 'INTERN', label: 'Intern' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BulkEmailPage() {
  const user = useAppSelector((s) => s.auth.user);

  // — Template
  const [template, setTemplate] = useState<TemplateDef>(TEMPLATES[0]);

  // — Recipient mode
  const [recipientMode, setRecipientMode] = useState<RecipientMode>('selected');

  // — Selected employees (mode: selected)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [empSearch, setEmpSearch] = useState('');

  // — Filters (mode: filter)
  const [showFilters, setShowFilters] = useState(false);
  const [filterDepts, setFilterDepts] = useState<string[]>([]);
  const [filterDesigs, setFilterDesigs] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [filterRoles, setFilterRoles] = useState<string[]>([]);

  // — Manual emails (mode: manual / onboarding-invite)
  const [manualEmails, setManualEmails] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState('');
  const csvRef = useRef<HTMLInputElement>(null);

  // — Compose
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [testEmail, setTestEmail] = useState(user?.email || '');

  // — Attachments
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const attachRef = useRef<HTMLInputElement>(null);

  // — UI state
  const [showConfirm, setShowConfirm] = useState(false);
  const [successInfo, setSuccessInfo] = useState<{ queued: number; totalMatched?: number } | null>(null);

  // — Data
  const { data: empRes, isLoading: empLoading } = useGetEmployeesQuery({ page: 1, limit: 500 });
  const { data: deptRes } = useGetDepartmentsQuery();
  const { data: desigRes } = useGetDesignationsQuery();
  const employees = empRes?.data ?? [];
  const departments = deptRes?.data ?? [];
  const designations = desigRes?.data ?? [];

  // Filter preview (only relevant in 'filter' mode)
  const previewParams = recipientMode === 'filter' ? {
    ...(filterDepts.length && { departmentIds: filterDepts.join(',') }),
    ...(filterDesigs.length && { designationIds: filterDesigs.join(',') }),
    ...(filterStatuses.length && { statuses: filterStatuses.join(',') }),
    ...(filterRoles.length && { roles: filterRoles.join(',') }),
  } : {};
  const { data: previewRes, isFetching: previewLoading } = useGetBulkEmailPreviewQuery(previewParams, {
    skip: recipientMode !== 'filter',
  });
  const filterCount = previewRes?.data?.recipientCount ?? 0;

  const [sendUnified, { isLoading: sending }] = useSendUnifiedBulkEmailMutation();

  // Filtered employee list for the checkbox panel
  const filteredEmps = useMemo(() => {
    const q = empSearch.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) =>
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
      e.employeeCode.toLowerCase().includes(q) ||
      (e.email || '').toLowerCase().includes(q)
    );
  }, [employees, empSearch]);

  const allSelected = filteredEmps.length > 0 && filteredEmps.every((e) => selectedIds.has(e.id));

  const toggleAll = () => {
    const next = new Set(selectedIds);
    if (allSelected) { filteredEmps.forEach((e) => next.delete(e.id)); }
    else { filteredEmps.forEach((e) => next.add(e.id)); }
    setSelectedIds(next);
  };

  const toggleEmp = (id: string) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };

  const toggleChip = (
    list: string[], set: React.Dispatch<React.SetStateAction<string[]>>, val: string
  ) => set(list.includes(val) ? list.filter((v) => v !== val) : [...list, val]);

  // Recipient count for the badge
  const recipientCount = recipientMode === 'selected'
    ? selectedIds.size
    : recipientMode === 'filter'
      ? filterCount
      : manualEmails.length;

  // Handle template change — auto-fill subject
  const handleTemplateChange = (tpl: TemplateDef) => {
    setTemplate(tpl);
    if (tpl.defaultSubject !== undefined) setSubject(tpl.defaultSubject);
    // onboarding-invite always works in selected or manual mode
    if (tpl.value === 'onboarding-invite' && recipientMode === 'filter') setRecipientMode('selected');
    setSuccessInfo(null);
  };

  // Manual email helpers
  const addEmails = (text: string) => {
    const parsed = text.split(/[,;\n\r]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@') && e.includes('.'));
    const fresh = parsed.filter((e) => !manualEmails.includes(e));
    if (fresh.length) setManualEmails((prev) => [...prev, ...fresh]);
    setEmailInput('');
  };

  const extractEmailsFromRows = (rows: string[][]): string[] => {
    const out: string[] = [];
    for (const row of rows) {
      for (const cell of row) {
        const v = String(cell ?? '').trim().replace(/^["']|["']$/g, '').toLowerCase();
        if (v.includes('@') && v.includes('.') && !manualEmails.includes(v) && !out.includes(v)) out.push(v);
      }
    }
    return out;
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isXlsx = /\.xlsx?$/i.test(file.name);
    const reader = new FileReader();
    if (isXlsx) {
      reader.onload = (ev) => {
        try {
          const data = new Uint8Array(ev.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: 'array' });
          const rows: string[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
          const extracted = extractEmailsFromRows(rows);
          if (extracted.length) { setManualEmails((p) => [...p, ...extracted]); toast.success(`${extracted.length} emails imported`); }
          else toast.error('No valid emails found in file');
        } catch { toast.error('Failed to parse file'); }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = (ev) => {
        const rows = (ev.target?.result as string).split(/\r?\n/).map((l) => l.split(/[,;\t]/));
        const extracted = extractEmailsFromRows(rows);
        if (extracted.length) { setManualEmails((p) => [...p, ...extracted]); toast.success(`${extracted.length} emails imported`); }
        else toast.error('No valid emails found in file');
      };
      reader.readAsText(file);
    }
    if (csvRef.current) csvRef.current.value = '';
  };

  const downloadCsvTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([['Email'], ['john@example.com'], ['jane@example.com']]);
    ws['!cols'] = [{ wch: 35 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Emails');
    XLSX.writeFile(wb, 'email-import-template.xlsx');
  };

  // Attachment helpers
  const handleAttachFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const remaining = 5 - attachments.length;
    if (remaining <= 0) { toast.error('Maximum 5 attachments allowed'); return; }
    const toAdd = files.slice(0, remaining).map((f) => ({ file: f, previewName: f.name }));
    setAttachments((prev) => [...prev, ...toAdd]);
    if (attachRef.current) attachRef.current.value = '';
  };

  const removeAttachment = (idx: number) => setAttachments((prev) => prev.filter((_, i) => i !== idx));

  // Send
  const buildFormData = (isTest = false): FormData => {
    const fd = new FormData();
    fd.append('templateType', template.value);
    fd.append('recipientMode', recipientMode);

    if (isTest && testEmail) fd.append('testEmail', testEmail);

    if (recipientMode === 'selected') {
      fd.append('employeeIds', JSON.stringify(Array.from(selectedIds)));
    } else if (recipientMode === 'filter') {
      if (filterDepts.length) fd.append('filterDepartmentIds', JSON.stringify(filterDepts));
      if (filterDesigs.length) fd.append('filterDesignationIds', JSON.stringify(filterDesigs));
      if (filterStatuses.length) fd.append('filterStatuses', JSON.stringify(filterStatuses));
      if (filterRoles.length) fd.append('filterRoles', JSON.stringify(filterRoles));
    } else if (recipientMode === 'manual') {
      fd.append('manualEmails', JSON.stringify(manualEmails));
    }

    if (template.needsCompose) {
      fd.append('subject', subject);
      fd.append('body', body);
    }

    attachments.forEach((a) => fd.append('attachments', a.file));
    return fd;
  };

  const handleTest = async () => {
    if (!testEmail) { toast.error('Enter a test email address'); return; }
    if (template.needsCompose && (!subject.trim() || !body.trim())) {
      toast.error('Fill in subject and body first'); return;
    }
    try {
      const fd = buildFormData(true);
      await sendUnified(fd).unwrap();
      toast.success(`Test email queued to ${testEmail}`);
    } catch { toast.error('Failed to send test email'); }
  };

  const handleSend = async () => {
    setShowConfirm(false);
    try {
      const fd = buildFormData(false);
      const res = await sendUnified(fd).unwrap();
      setSuccessInfo(res.data ?? { queued: 0 });
      toast.success(res.message || `${res.data?.queued ?? 0} emails queued`);
      setSelectedIds(new Set());
      setManualEmails([]);
    } catch { toast.error('Failed to send emails. Please try again.'); }
  };

  const canSend = (() => {
    if (recipientCount === 0) return false;
    if (template.needsCompose && (!subject.trim() || !body.trim())) return false;
    return true;
  })();

  return (
    <div className="page-container max-w-5xl">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
          <Send className="w-5 h-5 text-brand-600" />
        </div>
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Bulk Email</h1>
          <p className="text-sm text-gray-500">Send templated or custom emails to employees — with optional file attachments</p>
        </div>
      </div>

      {/* Success banner */}
      {successInfo && (
        <div className="mb-6 layer-card border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-emerald-800 font-semibold">
              {successInfo.queued} email{successInfo.queued !== 1 ? 's' : ''} queued successfully
            </p>
            {successInfo.totalMatched !== undefined && successInfo.totalMatched > successInfo.queued && (
              <p className="text-xs text-emerald-600 mt-0.5">
                {successInfo.totalMatched - successInfo.queued} skipped (no email address on file)
              </p>
            )}
          </div>
          <button onClick={() => setSuccessInfo(null)} className="text-xs text-emerald-600 hover:text-emerald-800 font-medium">Dismiss</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── LEFT COLUMN ── */}
        <div className="lg:col-span-2 space-y-5">

          {/* 1. Template picker */}
          <div className="layer-card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-1">Email Template</h2>
            <p className="text-xs text-gray-400 mb-4">Choose a predefined template or compose a custom email</p>

            <div className="mb-3">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-2">Predefined</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {TEMPLATES.filter((t) => t.group === 'predefined').map((tpl) => {
                  const Icon = tpl.icon;
                  const active = template.value === tpl.value;
                  return (
                    <button key={tpl.value} onClick={() => handleTemplateChange(tpl)}
                      className={cn('text-left px-3 py-3 rounded-lg border transition-all', active ? 'border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/20' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50')}
                    >
                      <div className={cn('w-7 h-7 rounded-md flex items-center justify-center mb-2', active ? 'bg-brand-100' : 'bg-gray-100')}>
                        <Icon size={14} className={active ? 'text-brand-600' : 'text-gray-500'} />
                      </div>
                      <p className={cn('text-xs font-semibold', active ? 'text-brand-700' : 'text-gray-800')}>{tpl.label}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{tpl.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-2">Custom / Bulk</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {TEMPLATES.filter((t) => t.group === 'custom').map((tpl) => {
                  const Icon = tpl.icon;
                  const active = template.value === tpl.value;
                  return (
                    <button key={tpl.value} onClick={() => handleTemplateChange(tpl)}
                      className={cn('text-left px-3 py-3 rounded-lg border transition-all flex items-start gap-3', active ? 'border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/20' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50')}
                    >
                      <div className={cn('w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5', active ? 'bg-brand-100' : 'bg-gray-100')}>
                        <Icon size={14} className={active ? 'text-brand-600' : 'text-gray-500'} />
                      </div>
                      <div>
                        <p className={cn('text-xs font-semibold', active ? 'text-brand-700' : 'text-gray-800')}>{tpl.label}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{tpl.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 2. Compose (only for needsCompose templates) */}
          {template.needsCompose && (
            <div className="layer-card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-gray-700">Compose Email</h2>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Subject <span className="text-red-500">*</span></label>
                <input
                  type="text" value={subject} onChange={(e) => setSubject(e.target.value)}
                  placeholder="Enter email subject..." className="input-glass w-full text-sm" maxLength={200}
                />
                <p className="text-[10px] text-gray-400 mt-0.5 text-right">{subject.length}/200</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Message <span className="text-red-500">*</span></label>
                <textarea
                  value={body} onChange={(e) => setBody(e.target.value)}
                  placeholder="Write your email message here..." rows={8}
                  className="input-glass w-full text-sm resize-y min-h-[140px]" maxLength={10000}
                />
                <p className="text-[10px] text-gray-400 mt-0.5 text-right">{body.length}/10000</p>
              </div>
            </div>
          )}

          {/* 3. Attachments */}
          <div className="layer-card p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Paperclip size={15} className="text-gray-400" />
                <h2 className="text-sm font-semibold text-gray-700">Attachments</h2>
                <span className="text-xs text-gray-400">(optional, max 5 files · 10 MB each)</span>
              </div>
              <button
                onClick={() => attachRef.current?.click()}
                disabled={attachments.length >= 5}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Upload size={12} /> Add File
              </button>
              <input ref={attachRef} type="file" multiple className="hidden" onChange={handleAttachFiles} />
            </div>

            {attachments.length === 0 ? (
              <div
                className="border-2 border-dashed border-gray-200 rounded-lg py-6 flex flex-col items-center gap-2 cursor-pointer hover:border-brand-300 hover:bg-brand-50/20 transition-colors"
                onClick={() => attachRef.current?.click()}
              >
                <Paperclip size={20} className="text-gray-300" />
                <p className="text-xs text-gray-400">Click to attach files — they will be sent with every email</p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {attachments.map((a, i) => (
                  <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-full text-xs text-gray-700 max-w-[200px]">
                    <Paperclip size={11} className="text-gray-400 flex-shrink-0" />
                    <span className="truncate">{a.previewName}</span>
                    <button onClick={() => removeAttachment(i)} className="text-gray-400 hover:text-red-500 flex-shrink-0">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 4. Test email */}
          <div className="layer-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <FlaskConical size={15} className="text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-700">Send Test Email</h2>
            </div>
            <div className="flex gap-2">
              <input
                type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)}
                placeholder="your@email.com" className="input-glass flex-1 text-sm"
              />
              <button
                onClick={handleTest}
                disabled={sending || !testEmail}
                className="btn-primary text-sm px-4 disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
              >
                {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Send Test
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5">Preview the email in your inbox before bulk-sending</p>
          </div>
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div className="space-y-5">
          {/* Recipient count badge */}
          <div className="layer-card p-5 text-center">
            <div className="w-12 h-12 rounded-full bg-brand-50 flex items-center justify-center mx-auto mb-2">
              <Users className="w-6 h-6 text-brand-600" />
            </div>
            {recipientMode === 'filter' && previewLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-gray-400 mx-auto" />
            ) : (
              <p className="text-3xl font-display font-bold text-gray-900" data-mono>{recipientCount}</p>
            )}
            <p className="text-sm text-gray-500 mt-1">{recipientCount === 1 ? 'recipient' : 'recipients'}</p>
            {recipientCount === 0 && (
              <p className="text-xs text-amber-600 flex items-center justify-center gap-1 mt-2">
                <AlertTriangle size={12} /> No recipients selected
              </p>
            )}
          </div>

          {/* Recipient mode toggle */}
          <div className="layer-card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Recipients</h2>
            <div className="flex flex-col gap-1.5 mb-4">
              {([
                { mode: 'selected' as RecipientMode, label: 'Select employees', icon: Users },
                { mode: 'filter' as RecipientMode, label: 'Filter by group', icon: Filter, disabled: template.value === 'onboarding-invite' },
                { mode: 'manual' as RecipientMode, label: 'Enter emails manually', icon: Mail },
              ]).map(({ mode, label, icon: Icon, disabled }) => (
                <button key={mode}
                  onClick={() => !disabled && setRecipientMode(mode)}
                  disabled={disabled}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-all text-left',
                    recipientMode === mode ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium' : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50',
                    disabled && 'opacity-40 cursor-not-allowed'
                  )}
                >
                  <Icon size={14} className="flex-shrink-0" />
                  {label}
                </button>
              ))}
            </div>

            {/* Selected employees panel */}
            {recipientMode === 'selected' && (
              <div>
                <div className="relative mb-2">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" value={empSearch} onChange={(e) => setEmpSearch(e.target.value)}
                    placeholder="Search employees..." className="input-glass w-full pl-8 text-xs py-2" />
                </div>
                {empLoading ? (
                  <div className="flex items-center justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-brand-600" /></div>
                ) : (
                  <div className="max-h-64 overflow-y-auto custom-scrollbar">
                    <label className="flex items-center gap-2 px-2 py-2 rounded hover:bg-gray-50 cursor-pointer border-b border-gray-100 mb-1">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll}
                        className="w-3.5 h-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                      <span className="text-xs font-medium text-gray-700">Select all ({filteredEmps.length})</span>
                    </label>
                    {filteredEmps.map((emp) => {
                      const checked = selectedIds.has(emp.id);
                      return (
                        <label key={emp.id} className={cn('flex items-center gap-2 px-2 py-2 rounded cursor-pointer transition-colors', checked ? 'bg-brand-50/50' : 'hover:bg-gray-50')}>
                          <input type="checkbox" checked={checked} onChange={() => toggleEmp(emp.id)}
                            className="w-3.5 h-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500 flex-shrink-0" />
                          <div className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-[10px] font-semibold flex-shrink-0">
                            {getInitials(emp.firstName, emp.lastName)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-gray-800 truncate">{emp.firstName} {emp.lastName}</p>
                            <p className="text-[10px] text-gray-400 truncate">{emp.email}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Filter panel */}
            {recipientMode === 'filter' && (
              <div className="space-y-3">
                <button onClick={() => setShowFilters((v) => !v)}
                  className="flex items-center justify-between w-full text-xs font-medium text-gray-600">
                  <span>Advanced filters {(filterDepts.length + filterDesigs.length + filterStatuses.length + filterRoles.length) > 0 ? `(${filterDepts.length + filterDesigs.length + filterStatuses.length + filterRoles.length} active)` : '(all employees)'}</span>
                  {showFilters ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
                {showFilters && (
                  <div className="space-y-3 pt-2 border-t border-gray-100">
                    {departments.length > 0 && (
                      <div>
                        <p className="text-[10px] font-medium text-gray-500 mb-1.5">Department</p>
                        <div className="flex flex-wrap gap-1">
                          {departments.map((d) => (
                            <button key={d.id} onClick={() => toggleChip(filterDepts, setFilterDepts, d.id)}
                              className={cn('px-2 py-0.5 text-[10px] rounded-full border transition-all', filterDepts.includes(d.id) ? 'bg-brand-100 border-brand-400 text-brand-700 font-medium' : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300')}>{d.name}</button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] font-medium text-gray-500 mb-1.5">Status</p>
                      <div className="flex flex-wrap gap-1">
                        {STATUS_OPTIONS.map((o) => (
                          <button key={o.value} onClick={() => toggleChip(filterStatuses, setFilterStatuses, o.value)}
                            className={cn('px-2 py-0.5 text-[10px] rounded-full border transition-all', filterStatuses.includes(o.value) ? 'bg-brand-100 border-brand-400 text-brand-700 font-medium' : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300')}>{o.label}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium text-gray-500 mb-1.5">Role</p>
                      <div className="flex flex-wrap gap-1">
                        {ROLE_OPTIONS.map((o) => (
                          <button key={o.value} onClick={() => toggleChip(filterRoles, setFilterRoles, o.value)}
                            className={cn('px-2 py-0.5 text-[10px] rounded-full border transition-all', filterRoles.includes(o.value) ? 'bg-brand-100 border-brand-400 text-brand-700 font-medium' : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300')}>{o.label}</button>
                        ))}
                      </div>
                    </div>
                    {(filterDepts.length + filterDesigs.length + filterStatuses.length + filterRoles.length) > 0 && (
                      <button onClick={() => { setFilterDepts([]); setFilterDesigs([]); setFilterStatuses([]); setFilterRoles([]); }}
                        className="text-[10px] text-red-500 hover:text-red-700 font-medium">Clear filters</button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Manual emails panel */}
            {recipientMode === 'manual' && (
              <div className="space-y-3">
                <div className="flex gap-1.5 flex-col">
                  <label className="flex items-center justify-center gap-2 px-3 py-2.5 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-brand-400 hover:bg-brand-50/20 transition-colors">
                    <input ref={csvRef} type="file" className="hidden" accept=".csv,.txt,.xlsx,.xls" onChange={handleCsvUpload} />
                    <FileSpreadsheet size={14} className="text-gray-400" />
                    <span className="text-xs text-gray-500">Import CSV / Excel</span>
                  </label>
                  <button onClick={downloadCsvTemplate} className="flex items-center justify-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-xs text-gray-500 hover:text-brand-600 hover:border-brand-300 transition-colors">
                    <Download size={12} /> Download template
                  </button>
                </div>
                <div className="flex gap-1.5">
                  <input type="text" value={emailInput} onChange={(e) => setEmailInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && emailInput.trim()) { e.preventDefault(); addEmails(emailInput); } }}
                    placeholder="email@example.com, ..." className="input-glass flex-1 text-xs" />
                  <button onClick={() => emailInput.trim() && addEmails(emailInput)} disabled={!emailInput.trim()}
                    className="btn-primary text-xs px-3 disabled:opacity-50">Add</button>
                </div>
                {manualEmails.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-gray-500">{manualEmails.length} email{manualEmails.length !== 1 ? 's' : ''}</span>
                      <button onClick={() => setManualEmails([])} className="text-[10px] text-red-500 hover:text-red-700">Clear all</button>
                    </div>
                    <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto p-1.5 bg-gray-50 rounded-lg">
                      {manualEmails.map((email) => (
                        <span key={email} className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-gray-200 rounded-full text-[10px] text-gray-700">
                          {email}
                          <button onClick={() => setManualEmails((p) => p.filter((e) => e !== email))} className="text-gray-400 hover:text-red-500"><X size={10} /></button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Send button */}
          <button
            onClick={() => setShowConfirm(true)}
            disabled={sending || !canSend}
            className={cn('w-full btn-primary flex items-center justify-center gap-2 py-3 text-sm font-semibold', (!canSend || sending) && 'opacity-50 cursor-not-allowed')}
          >
            {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</> : <><Send className="w-4 h-4" /> Send to {recipientCount} Recipient{recipientCount !== 1 ? 's' : ''}</>}
          </button>
        </div>
      </div>

      {/* Confirm dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-display font-semibold text-gray-900 mb-2">Confirm Bulk Email</h3>
            <p className="text-sm text-gray-600 mb-4">
              Sending <span className="font-semibold text-brand-700">{recipientCount} email{recipientCount !== 1 ? 's' : ''}</span> — template: <span className="font-medium">{template.label}</span>
            </p>
            {template.needsCompose && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 font-medium mb-4">{subject}</div>
            )}
            {attachments.length > 0 && (
              <p className="text-xs text-gray-500 mb-4 flex items-center gap-1"><Paperclip size={12} /> {attachments.length} attachment{attachments.length !== 1 ? 's' : ''} included</p>
            )}
            <p className="text-xs text-gray-400 mb-5">This action cannot be undone. Emails are queued immediately.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowConfirm(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleSend} disabled={sending} className="btn-primary flex items-center gap-1.5 px-5 py-2 text-sm disabled:opacity-50">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {sending ? 'Sending...' : 'Confirm & Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
