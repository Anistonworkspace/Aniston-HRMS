import { useState, useEffect } from 'react';
import { Send, Loader2, Users, Mail, AlertTriangle, CheckCircle2, FlaskConical, ChevronDown, ChevronUp } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import { useSendEnhancedBulkEmailMutation, useGetBulkEmailPreviewQuery } from '../employee/employeeApi';
import { useGetDepartmentsQuery, useGetDesignationsQuery } from '../employee/employeeDepsApi';

type TemplateType = 'WELCOME' | 'PAYROLL_REMINDER' | 'ATTENDANCE_REMINDER' | 'ANNOUNCEMENT' | 'CUSTOM';

const TEMPLATE_OPTIONS: { value: TemplateType; label: string; description: string; defaultSubject: string }[] = [
  {
    value: 'WELCOME',
    label: 'Welcome',
    description: 'Welcome email for new team members',
    defaultSubject: 'Welcome to the Team!',
  },
  {
    value: 'PAYROLL_REMINDER',
    label: 'Payroll Reminder',
    description: 'Remind employees about payroll submission or processing',
    defaultSubject: 'Payroll Reminder — Action Required',
  },
  {
    value: 'ATTENDANCE_REMINDER',
    label: 'Attendance Reminder',
    description: 'Remind employees to mark their attendance',
    defaultSubject: 'Reminder: Please Mark Your Attendance',
  },
  {
    value: 'ANNOUNCEMENT',
    label: 'Announcement',
    description: 'General company-wide or team announcement',
    defaultSubject: 'Important Announcement',
  },
  {
    value: 'CUSTOM',
    label: 'Custom',
    description: 'Write a fully custom email from scratch',
    defaultSubject: '',
  },
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
  { value: 'ADMIN', label: 'Admin' },
  { value: 'INTERN', label: 'Intern' },
];

export default function BulkEmailPage() {
  const [templateType, setTemplateType] = useState<TemplateType>('CUSTOM');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [successInfo, setSuccessInfo] = useState<{ queued: number; totalMatched: number } | null>(null);

  // Recipient filters
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [selectedDesigs, setSelectedDesigs] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);

  const { data: deptRes } = useGetDepartmentsQuery();
  const { data: desigRes } = useGetDesignationsQuery();

  const departments = deptRes?.data ?? [];
  const designations = desigRes?.data ?? [];

  // Build preview query params — only pass if non-empty
  const previewParams = {
    ...(selectedDepts.length && { departmentIds: selectedDepts.join(',') }),
    ...(selectedDesigs.length && { designationIds: selectedDesigs.join(',') }),
    ...(selectedStatuses.length && { statuses: selectedStatuses.join(',') }),
    ...(selectedRoles.length && { roles: selectedRoles.join(',') }),
  };

  const { data: previewRes, isFetching: previewLoading } = useGetBulkEmailPreviewQuery(previewParams);
  const recipientCount = previewRes?.data?.recipientCount ?? 0;

  const [sendBulkEmail, { isLoading: sending }] = useSendEnhancedBulkEmailMutation();

  // Auto-fill subject when template changes
  useEffect(() => {
    const tpl = TEMPLATE_OPTIONS.find((t) => t.value === templateType);
    if (tpl?.defaultSubject) setSubject(tpl.defaultSubject);
  }, [templateType]);

  const toggleItem = (
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    value: string
  ) => {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  const handleSend = async () => {
    if (!subject.trim() || !body.trim()) {
      toast.error('Subject and body are required');
      return;
    }
    setShowConfirm(false);
    try {
      const res = await sendBulkEmail({
        templateType,
        subject: subject.trim(),
        body: body.trim(),
        recipientFilter: {
          ...(selectedDepts.length && { departmentIds: selectedDepts }),
          ...(selectedDesigs.length && { designationIds: selectedDesigs }),
          ...(selectedStatuses.length && { statuses: selectedStatuses }),
          ...(selectedRoles.length && { roles: selectedRoles }),
        },
      }).unwrap();
      setSuccessInfo(res.data);
      toast.success(res.message || `${res.data.queued} emails queued`);
    } catch {
      toast.error('Failed to send emails. Please try again.');
    }
  };

  const handleTestEmail = async () => {
    if (!testEmail || !subject.trim() || !body.trim()) {
      toast.error('Fill in subject, body and test email address first');
      return;
    }
    try {
      const res = await sendBulkEmail({
        templateType,
        subject: subject.trim(),
        body: body.trim(),
        testEmail,
      }).unwrap();
      toast.success(res.message || 'Test email queued');
    } catch {
      toast.error('Failed to send test email');
    }
  };

  const canSend = subject.trim().length > 0 && body.trim().length > 0 && recipientCount > 0;

  return (
    <div className="page-container max-w-4xl">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
          <Mail className="w-5 h-5 text-brand-600" />
        </div>
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Bulk Email</h1>
          <p className="text-sm text-gray-500">Send targeted emails to filtered groups of employees</p>
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
            <p className="text-xs text-emerald-600 mt-0.5">
              {successInfo.totalMatched} employees matched your filter
              {successInfo.totalMatched > successInfo.queued && ` (${successInfo.totalMatched - successInfo.queued} skipped — no email address)`}
            </p>
          </div>
          <button onClick={() => setSuccessInfo(null)} className="text-xs text-emerald-600 hover:text-emerald-800 font-medium">
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — compose */}
        <div className="lg:col-span-2 space-y-5">
          {/* Template Type */}
          <div className="layer-card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Email Template</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {TEMPLATE_OPTIONS.map((tpl) => {
                const active = templateType === tpl.value;
                return (
                  <button
                    key={tpl.value}
                    onClick={() => setTemplateType(tpl.value)}
                    className={cn(
                      'text-left px-4 py-3 rounded-lg border transition-all text-sm',
                      active
                        ? 'border-brand-500 bg-brand-50/50 ring-2 ring-brand-500/20'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    )}
                  >
                    <p className={cn('font-semibold', active ? 'text-brand-700' : 'text-gray-800')}>
                      {tpl.label}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{tpl.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Subject */}
          <div className="layer-card p-5">
            <label className="block text-sm font-semibold text-gray-700 mb-2" htmlFor="email-subject">
              Subject <span className="text-red-500">*</span>
            </label>
            <input
              id="email-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Enter email subject..."
              className="input-glass w-full text-sm"
              maxLength={200}
            />
            <p className="text-xs text-gray-400 mt-1 text-right">{subject.length}/200</p>
          </div>

          {/* Body */}
          <div className="layer-card p-5">
            <label className="block text-sm font-semibold text-gray-700 mb-2" htmlFor="email-body">
              Message Body <span className="text-red-500">*</span>
            </label>
            <textarea
              id="email-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your email message here..."
              rows={10}
              className="input-glass w-full text-sm resize-y min-h-[160px]"
              maxLength={10000}
            />
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-gray-400">
                Plain text — line breaks will be preserved
              </p>
              <p className="text-xs text-gray-400">{body.length}/10000</p>
            </div>
          </div>

          {/* Test Email */}
          <div className="layer-card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-gray-400" />
              Send Test Email
            </h2>
            <div className="flex gap-2">
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="your@email.com"
                className="input-glass flex-1 text-sm"
              />
              <button
                onClick={handleTestEmail}
                disabled={sending || !testEmail || !subject.trim() || !body.trim()}
                className="btn-primary text-sm px-4 disabled:opacity-50 flex items-center gap-1.5"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Test
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              Send yourself a preview before bulk-sending to employees
            </p>
          </div>
        </div>

        {/* Right column — filters + send */}
        <div className="space-y-5">
          {/* Recipient Preview */}
          <div className="layer-card p-5 text-center">
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 rounded-full bg-brand-50 flex items-center justify-center">
                <Users className="w-6 h-6 text-brand-600" />
              </div>
              {previewLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              ) : (
                <p className="text-3xl font-display font-bold text-gray-900" data-mono>
                  {recipientCount}
                </p>
              )}
              <p className="text-sm text-gray-500">
                {recipientCount === 1 ? 'recipient' : 'recipients'}
              </p>
              {recipientCount === 0 && !previewLoading && (
                <p className="text-xs text-amber-600 flex items-center gap-1 mt-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  No matching employees
                </p>
              )}
            </div>
          </div>

          {/* Recipient Filters */}
          <div className="layer-card p-5">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center justify-between w-full text-sm font-semibold text-gray-700 mb-1"
            >
              <span>Recipient Filters</span>
              {showFilters ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>
            <p className="text-xs text-gray-400 mb-3">
              {selectedDepts.length + selectedDesigs.length + selectedStatuses.length + selectedRoles.length === 0
                ? 'No filters — all employees will receive the email'
                : `${selectedDepts.length + selectedDesigs.length + selectedStatuses.length + selectedRoles.length} filter(s) applied`}
            </p>

            {showFilters && (
              <div className="space-y-4 pt-1 border-t border-gray-100">
                {/* Departments */}
                {departments.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-1.5">Departments</p>
                    <div className="flex flex-wrap gap-1.5">
                      {departments.map((dept) => {
                        const active = selectedDepts.includes(dept.id);
                        return (
                          <button
                            key={dept.id}
                            onClick={() => toggleItem(selectedDepts, setSelectedDepts, dept.id)}
                            className={cn(
                              'px-2.5 py-1 text-xs rounded-full border transition-all',
                              active
                                ? 'bg-brand-100 border-brand-400 text-brand-700 font-medium'
                                : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'
                            )}
                          >
                            {dept.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Designations */}
                {designations.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-1.5">Designations</p>
                    <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                      {designations.map((desig) => {
                        const active = selectedDesigs.includes(desig.id);
                        return (
                          <button
                            key={desig.id}
                            onClick={() => toggleItem(selectedDesigs, setSelectedDesigs, desig.id)}
                            className={cn(
                              'px-2.5 py-1 text-xs rounded-full border transition-all',
                              active
                                ? 'bg-brand-100 border-brand-400 text-brand-700 font-medium'
                                : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'
                            )}
                          >
                            {desig.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Statuses */}
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-1.5">Employment Status</p>
                  <div className="flex flex-wrap gap-1.5">
                    {STATUS_OPTIONS.map((opt) => {
                      const active = selectedStatuses.includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          onClick={() => toggleItem(selectedStatuses, setSelectedStatuses, opt.value)}
                          className={cn(
                            'px-2.5 py-1 text-xs rounded-full border transition-all',
                            active
                              ? 'bg-brand-100 border-brand-400 text-brand-700 font-medium'
                              : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'
                          )}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Roles */}
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-1.5">Role</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ROLE_OPTIONS.map((opt) => {
                      const active = selectedRoles.includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          onClick={() => toggleItem(selectedRoles, setSelectedRoles, opt.value)}
                          className={cn(
                            'px-2.5 py-1 text-xs rounded-full border transition-all',
                            active
                              ? 'bg-brand-100 border-brand-400 text-brand-700 font-medium'
                              : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'
                          )}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Clear filters */}
                {(selectedDepts.length + selectedDesigs.length + selectedStatuses.length + selectedRoles.length) > 0 && (
                  <button
                    onClick={() => {
                      setSelectedDepts([]);
                      setSelectedDesigs([]);
                      setSelectedStatuses([]);
                      setSelectedRoles([]);
                    }}
                    className="text-xs text-red-500 hover:text-red-700 font-medium"
                  >
                    Clear all filters
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Send button */}
          <button
            onClick={() => {
              if (!canSend) {
                if (!subject.trim() || !body.trim()) {
                  toast.error('Subject and body are required');
                } else {
                  toast.error('No matching recipients. Adjust your filters.');
                }
                return;
              }
              setShowConfirm(true);
            }}
            disabled={sending}
            className={cn(
              'w-full btn-primary flex items-center justify-center gap-2 py-3 text-sm font-semibold',
              sending && 'opacity-50 cursor-not-allowed'
            )}
          >
            {sending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
            ) : (
              <><Send className="w-4 h-4" /> Send to {recipientCount} Employee{recipientCount !== 1 ? 's' : ''}</>
            )}
          </button>
        </div>
      </div>

      {/* Confirm dialog */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-bulk-email-title"
        >
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 id="confirm-bulk-email-title" className="text-lg font-display font-semibold text-gray-900 mb-2">
              Confirm Bulk Email
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              You are about to send <span className="font-semibold text-brand-700">{recipientCount} email{recipientCount !== 1 ? 's' : ''}</span>{' '}
              with the subject:
            </p>
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 font-medium mb-5">
              {subject}
            </div>
            <p className="text-xs text-gray-400 mb-5">This action cannot be undone. Emails will be queued immediately.</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending}
                className="btn-primary flex items-center gap-1.5 px-5 py-2 text-sm disabled:opacity-50"
              >
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
