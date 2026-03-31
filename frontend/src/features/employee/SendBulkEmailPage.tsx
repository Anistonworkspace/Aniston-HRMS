import { useState, useMemo } from 'react';
import { Send, Loader2, Search, CheckCircle2, Smartphone, Clock, Users } from 'lucide-react';
import { useGetEmployeesQuery } from './employeeApi';
import { useSendBulkEmailMutation } from './employeeBulkApi';
import toast from 'react-hot-toast';
import { cn, getInitials } from '../../lib/utils';

type TemplateType = 'app-download' | 'attendance-instructions';

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
];

export default function SendBulkEmailPage() {
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateType | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [successCount, setSuccessCount] = useState<number | null>(null);

  const { data: employeeRes, isLoading: loadingEmployees } = useGetEmployeesQuery({ page: 1, limit: 500 });
  const [sendBulkEmail, { isLoading: sending }] = useSendBulkEmailMutation();

  const employees = employeeRes?.data ?? [];

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

  const handleSend = async () => {
    if (!selectedTemplate || selectedIds.size === 0) return;
    try {
      const res = await sendBulkEmail({
        employeeIds: Array.from(selectedIds),
        templateType: selectedTemplate,
      }).unwrap();
      const count = res.data?.queued ?? selectedIds.size;
      setSuccessCount(count);
      toast.success(`${count} emails queued successfully`);
      setSelectedIds(new Set());
    } catch {
      toast.error('Failed to send emails. Please try again.');
    }
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center">
            <Send className="w-5 h-5 text-brand-600" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold text-gray-900">Send App & Attendance Emails</h1>
            <p className="text-sm text-gray-500">Send app download link or attendance instructions to employees</p>
          </div>
        </div>
      </div>

      {/* Success banner */}
      {successCount !== null && (
        <div className="mb-6 layer-card border-emerald-200 bg-emerald-50 p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <p className="text-sm text-emerald-800 font-medium">
            {successCount} email{successCount !== 1 ? 's' : ''} queued successfully!
          </p>
          <button
            onClick={() => setSuccessCount(null)}
            className="ml-auto text-xs text-emerald-600 hover:text-emerald-800 font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Template Selection */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Select Email Template</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {templates.map((t) => {
            const Icon = t.icon;
            const active = selectedTemplate === t.type;
            return (
              <button
                key={t.type}
                onClick={() => setSelectedTemplate(t.type)}
                className={cn(
                  'layer-card p-5 text-left transition-all duration-200 cursor-pointer',
                  active
                    ? 'border-brand-500 ring-2 ring-brand-500/20 bg-brand-50/40'
                    : 'hover:border-gray-200'
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
                      active ? 'bg-brand-100 text-brand-600' : 'bg-gray-100 text-gray-500'
                    )}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className={cn('font-semibold text-sm', active ? 'text-brand-700' : 'text-gray-800')}>
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

      {/* Employee Selection */}
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
            <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
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
                className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
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
                      checked ? 'bg-brand-50/50' : 'hover:bg-gray-50'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleEmployee(emp.id)}
                      className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                    />
                    {/* Avatar */}
                    <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
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

      {/* Send Button */}
      <div className="mt-6 flex justify-end">
        <button
          onClick={handleSend}
          disabled={selectedIds.size === 0 || !selectedTemplate || sending}
          className={cn(
            'btn-primary flex items-center gap-2 px-6 py-3 text-sm font-semibold',
            (selectedIds.size === 0 || !selectedTemplate || sending) && 'opacity-50 cursor-not-allowed'
          )}
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {sending
            ? 'Sending...'
            : `Send to ${selectedIds.size} Employee${selectedIds.size !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}
