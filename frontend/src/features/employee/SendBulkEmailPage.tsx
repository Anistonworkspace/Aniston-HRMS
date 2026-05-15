import { useState, useMemo, useRef } from 'react';
import { Send, Loader2, Search, CheckCircle2, Smartphone, Clock, Users, Mail, Upload, X, AlertTriangle, FileSpreadsheet, Download } from 'lucide-react';
import { useGetEmployeesQuery } from './employeeApi';
import { useSendBulkEmailMutation, useSendBulkOnboardingInviteMutation } from './employeeBulkApi';
import toast from 'react-hot-toast';
import { cn, getInitials } from '../../lib/utils';
import * as XLSX from 'xlsx';

type TemplateType = 'app-download' | 'attendance-instructions' | 'onboarding-invite';

const templates: { type: TemplateType; icon: React.ElementType; title: string; description: string }[] = [
  {
    type: 'app-download',
    icon: Smartphone,
    title: 'App Download Link',
    description: 'Sends install link with instructions to download the HRMS mobile app',
  },
  {
    type: 'attendance-instructions',
    icon: Clock,
    title: 'Attendance Instructions',
    description: 'Sends shift info and attendance marking guide',
  },
  {
    type: 'onboarding-invite',
    icon: Mail,
    title: 'Onboarding Invite',
    description: 'Sends onboarding invitation with pre-joining document checklist',
  },
];

export default function SendBulkEmailPage() {
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateType | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [successCount, setSuccessCount] = useState<number | null>(null);
  const [skippedInfo, setSkippedInfo] = useState<{ skipped: number; errors: string[] } | null>(null);

  // Onboarding invite specific state
  const [onboardingEmails, setOnboardingEmails] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState('');
  const [emailSource, setEmailSource] = useState<'employees' | 'manual'>('employees');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: employeeRes, isLoading: loadingEmployees } = useGetEmployeesQuery({ page: 1, limit: 500 });
  const [sendBulkEmail, { isLoading: sending }] = useSendBulkEmailMutation();
  const [sendBulkOnboarding, { isLoading: sendingOnboarding }] = useSendBulkOnboardingInviteMutation();

  const employees = employeeRes?.data ?? [];
  const isSending = sending || sendingOnboarding;
  const isOnboarding = selectedTemplate === 'onboarding-invite';

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return employees;
    const q = searchQuery.toLowerCase();
    return employees.filter(
      (e) =>
        e.firstName.toLowerCase().includes(q) ||
        e.lastName.toLowerCase().includes(q) ||
        e.employeeCode.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q)
    );
  }, [employees, searchQuery]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((e) => selectedIds.has(e.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      const next = new Set(selectedIds);
      filtered.forEach((e) => next.delete(e.id));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      filtered.forEach((e) => next.add(e.id));
      setSelectedIds(next);
    }
  };

  const toggleEmployee = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  // Add emails from text input (comma/newline/semicolon separated)
  const addEmails = (text: string) => {
    const newEmails = text
      .split(/[,;\n\r]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e && e.includes('@') && !onboardingEmails.includes(e));
    if (newEmails.length > 0) {
      setOnboardingEmails([...onboardingEmails, ...newEmails]);
    }
    setEmailInput('');
  };

  const removeEmail = (email: string) => {
    setOnboardingEmails(onboardingEmails.filter((e) => e !== email));
  };

  // Download sample Excel template
  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Email'],
      ['john@example.com'],
      ['jane@example.com'],
    ]);
    ws['!cols'] = [{ wch: 35 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Emails');
    XLSX.writeFile(wb, 'bulk-email-template.xlsx');
  };

  // Extract emails from parsed rows (shared between CSV and Excel)
  const extractEmailsFromRows = (rows: string[][]) => {
    const extracted: string[] = [];
    for (const row of rows) {
      for (const cell of row) {
        const trimmed = String(cell ?? '').trim().replace(/^["']|["']$/g, '');
        if (trimmed.includes('@') && trimmed.includes('.')) {
          const lower = trimmed.toLowerCase();
          if (!onboardingEmails.includes(lower) && !extracted.includes(lower)) {
            extracted.push(lower);
          }
        }
      }
    }
    return extracted;
  };

  // Handle CSV/Excel file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isExcel = /\.xlsx?$/i.test(file.name);

    if (isExcel) {
      // Parse Excel binary with SheetJS
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = new Uint8Array(event.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
          const extracted = extractEmailsFromRows(rows);

          if (extracted.length > 0) {
            setOnboardingEmails([...onboardingEmails, ...extracted]);
            toast.success(`${extracted.length} email${extracted.length !== 1 ? 's' : ''} extracted from file`);
          } else {
            toast.error('No valid emails found in the file');
          }
        } catch {
          toast.error('Failed to parse Excel file');
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      // Parse CSV/TXT as text
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        if (!text) return;

        const lines = text.split(/\r?\n/);
        const rows = lines.map((line) => line.split(/[,;\t]/));
        const extracted = extractEmailsFromRows(rows);

        if (extracted.length > 0) {
          setOnboardingEmails([...onboardingEmails, ...extracted]);
          toast.success(`${extracted.length} email${extracted.length !== 1 ? 's' : ''} extracted from file`);
        } else {
          toast.error('No valid emails found in the file');
        }
      };
      reader.readAsText(file);
    }

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSend = async () => {
    if (!selectedTemplate) return;

    if (isOnboarding) {
      // Collect emails — from selected employees or manual list
      let emails: string[] = [];

      if (emailSource === 'employees') {
        emails = employees
          .filter((e) => selectedIds.has(e.id) && e.email)
          .map((e) => e.email);
      } else {
        emails = onboardingEmails;
      }

      if (emails.length === 0) {
        toast.error('No emails to send. Select employees or add emails.');
        return;
      }

      try {
        const res = await sendBulkOnboarding({ emails }).unwrap();
        setSuccessCount(res.data.sentCount);
        if (res.data.skippedCount > 0) {
          setSkippedInfo({ skipped: res.data.skippedCount, errors: res.data.errors });
        }
        toast.success(res.message || `${res.data.sentCount} invitations sent`);
        setSelectedIds(new Set());
        setOnboardingEmails([]);
      } catch {
        toast.error('Failed to send onboarding invites. Please try again.');
      }
    } else {
      if (selectedIds.size === 0) return;
      try {
        const res = await sendBulkEmail({
          employeeIds: Array.from(selectedIds),
          templateType: selectedTemplate as 'app-download' | 'attendance-instructions',
        }).unwrap();
        const count = res.data?.queued ?? selectedIds.size;
        setSuccessCount(count);
        toast.success(`${count} emails queued successfully`);
        setSelectedIds(new Set());
      } catch {
        toast.error('Failed to send emails. Please try again.');
      }
    }
  };

  const sendCount = isOnboarding && emailSource === 'manual'
    ? onboardingEmails.length
    : selectedIds.size;

  return (
    <div className="page-container">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--primary-highlighted-color)' }}>
            <Send className="w-5 h-5" style={{ color: 'var(--primary-color)' }} />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold text-gray-900">Send Bulk Emails</h1>
            <p className="text-sm text-gray-500">Send app links, attendance instructions, or onboarding invites in bulk</p>
          </div>
        </div>
      </div>

      {/* Success banner */}
      {successCount !== null && (
        <div className="mb-6 layer-card border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-emerald-800 font-medium">
              {successCount} email{successCount !== 1 ? 's' : ''} queued successfully!
            </p>
            {skippedInfo && skippedInfo.skipped > 0 && (
              <div className="mt-2">
                <p className="text-xs text-amber-700 font-medium">{skippedInfo.skipped} skipped:</p>
                <ul className="mt-1 space-y-0.5">
                  {skippedInfo.errors.slice(0, 5).map((err, i) => (
                    <li key={i} className="text-xs text-amber-600">{err}</li>
                  ))}
                  {skippedInfo.errors.length > 5 && (
                    <li className="text-xs text-amber-500">...and {skippedInfo.errors.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}
          </div>
          <button
            onClick={() => { setSuccessCount(null); setSkippedInfo(null); }}
            className="text-xs text-emerald-600 hover:text-emerald-800 font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Template Selection */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Select Email Template</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {templates.map((t) => {
            const Icon = t.icon;
            const active = selectedTemplate === t.type;
            return (
              <button
                key={t.type}
                onClick={() => {
                  setSelectedTemplate(t.type);
                  setSuccessCount(null);
                  setSkippedInfo(null);
                }}
                className={cn(
                  'layer-card p-5 text-left transition-all duration-200 cursor-pointer',
                  active ? '' : 'hover:border-gray-200'
                )}
                style={active ? { borderColor: 'var(--primary-color)' } : undefined}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
                      active ? '' : 'bg-gray-100 text-gray-500'
                    )}
                    style={active ? { background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' } : undefined}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className={cn('font-semibold text-sm', active ? '' : 'text-gray-800')}
                      style={active ? { color: 'var(--primary-color)' } : undefined}>
                      {t.title}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">{t.description}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Onboarding: Email Source Toggle */}
      {isOnboarding && (
        <div className="mb-4">
          <div className="flex gap-2 p-1 bg-gray-100 rounded-lg w-fit">
            <button
              onClick={() => setEmailSource('employees')}
              className={cn(
                'px-4 py-2 rounded-md text-sm font-medium transition-all',
                emailSource === 'employees'
                  ? 'bg-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              )}
              style={emailSource === 'employees' ? { color: 'var(--primary-color)' } : undefined}
            >
              <Users className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              Select Employees
            </button>
            <button
              onClick={() => setEmailSource('manual')}
              className={cn(
                'px-4 py-2 rounded-md text-sm font-medium transition-all',
                emailSource === 'manual'
                  ? 'bg-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              )}
              style={emailSource === 'manual' ? { color: 'var(--primary-color)' } : undefined}
            >
              <Upload className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              Upload / Enter Emails
            </button>
          </div>
          {emailSource === 'manual' && (
            <p className="text-xs text-gray-400 mt-2 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              Use this for candidates not yet in the system — perfect for migrating to HRMS
            </p>
          )}
        </div>
      )}

      {/* Manual Email Entry / CSV Upload (only for onboarding-invite + manual source) */}
      {isOnboarding && emailSource === 'manual' && (
        <div className="layer-card p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Mail className="w-4 h-4 text-gray-500" />
            Add Emails for Onboarding
          </h2>

          {/* CSV/Excel Upload + Download Template */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <label
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer transition-colors"
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".csv,.txt,.xlsx,.xls"
                onChange={handleFileUpload}
              />
              <FileSpreadsheet className="w-5 h-5 text-gray-400" />
              <span className="text-sm text-gray-500">
                Upload CSV / Excel file with emails
              </span>
            </label>
            <button
              onClick={downloadTemplate}
              className="flex items-center justify-center gap-2 px-4 py-3 border border-gray-300 rounded-lg text-sm text-gray-600 transition-colors"
            >
              <Download className="w-4 h-4" />
              Download Template
            </button>
          </div>

          {/* Manual text input */}
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && emailInput.trim()) {
                  e.preventDefault();
                  addEmails(emailInput);
                }
              }}
              placeholder="Type emails separated by comma, semicolon, or press Enter"
              className="input-glass flex-1 text-sm"
            />
            <button
              onClick={() => emailInput.trim() && addEmails(emailInput)}
              disabled={!emailInput.trim()}
              className="btn-primary text-sm px-4 disabled:opacity-50"
            >
              Add
            </button>
          </div>

          {/* Email chips */}
          {onboardingEmails.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-500 font-medium">
                  {onboardingEmails.length} email{onboardingEmails.length !== 1 ? 's' : ''} added
                </span>
                <button
                  onClick={() => setOnboardingEmails([])}
                  className="text-xs text-red-500 hover:text-red-700 font-medium"
                >
                  Clear All
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto p-2 bg-gray-50 rounded-lg">
                {onboardingEmails.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-gray-200 rounded-full text-xs text-gray-700"
                  >
                    {email}
                    <button
                      onClick={() => removeEmail(email)}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Employee Selection (for non-onboarding templates OR onboarding with employee source) */}
      {(!isOnboarding || emailSource === 'employees') && (
        <div className="layer-card p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-700">Select Employees</h2>
              {selectedIds.size > 0 && (
                <span className="badge badge-success text-xs">{selectedIds.size} selected</span>
              )}
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name, code, or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input-glass w-full pl-9 pr-4 py-2 text-sm"
              />
            </div>
          </div>

          {loadingEmployees ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--primary-color)' }} />
            </div>
          ) : employees.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">No employees found</div>
          ) : (
            <>
              {/* Select All */}
              <label className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 cursor-pointer border-b border-gray-100 mb-1">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-sm font-medium text-gray-700">
                  Select All ({filtered.length} employee{filtered.length !== 1 ? 's' : ''})
                </span>
              </label>

              {/* Employee list */}
              <div className="max-h-96 overflow-y-auto">
                {filtered.map((emp) => {
                  const checked = selectedIds.has(emp.id);
                  return (
                    <label
                      key={emp.id}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors',
                        checked ? 'bg-gray-50' : 'hover:bg-gray-50'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleEmployee(emp.id)}
                        className="w-4 h-4 rounded border-gray-300"
                      />
                      {/* Avatar */}
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0" style={{ background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' }}>
                        {getInitials(emp.firstName, emp.lastName)}
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">
                          {emp.firstName} {emp.lastName}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {emp.email}
                        </p>
                      </div>
                      <span className="text-xs text-gray-400 font-mono hidden sm:block" data-mono>
                        {emp.employeeCode}
                      </span>
                      {emp.department && (
                        <span className="badge text-xs bg-gray-50 text-gray-600 border border-gray-200 hidden md:inline-flex">
                          {emp.department.name}
                        </span>
                      )}
                    </label>
                  );
                })}

                {filtered.length === 0 && (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    No employees match your search
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Send Button */}
      <div className="mt-6 flex justify-end">
        <button
          onClick={handleSend}
          disabled={sendCount === 0 || !selectedTemplate || isSending}
          className={cn(
            'btn-primary flex items-center gap-2 px-6 py-3 text-sm font-semibold',
            (sendCount === 0 || !selectedTemplate || isSending) && 'opacity-50 cursor-not-allowed'
          )}
        >
          {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {isSending
            ? 'Sending...'
            : isOnboarding
              ? `Send Onboarding Invite to ${sendCount} Email${sendCount !== 1 ? 's' : ''}`
              : `Send to ${sendCount} Employee${sendCount !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}
