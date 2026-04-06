import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DollarSign, Play, Download, Eye, Plus, Calendar, Upload, FileSpreadsheet,
  Loader2, Filter, ChevronDown, ChevronUp, IndianRupee, TrendingDown,
  Briefcase, FileText, Lock, Unlock, CheckCircle2, XCircle, AlertTriangle,
  Search, Users, BarChart3, Shield, PlusCircle, Trash2, Clock,
} from 'lucide-react';
import {
  useGetPayrollRunsQuery,
  useCreatePayrollRunMutation,
  useProcessPayrollMutation,
  useGetMyPayslipsQuery,
  useGetPayrollRecordsQuery,
  useAmendPayrollRecordMutation,
  useImportSalariesMutation,
  useLockPayrollRunMutation,
  useUnlockPayrollRunMutation,
} from './payrollApi';
import {
  useGetRunAdjustmentsQuery,
  useCreateAdjustmentMutation,
  useApproveAdjustmentMutation,
  useDeleteAdjustmentMutation,
} from './adjustmentApi';
import { cn, formatCurrency, formatDate } from '../../lib/utils';
import { useAppSelector } from '../../app/store';
import toast from 'react-hot-toast';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const STATUS_MAP: Record<string, { label: string; class: string; icon: any }> = {
  DRAFT: { label: 'Draft', class: 'badge-warning', icon: FileText },
  PROCESSING: { label: 'Processing', class: 'badge-info', icon: Loader2 },
  REVIEW: { label: 'In Review', class: 'bg-purple-50 text-purple-700 border-purple-200', icon: Eye },
  APPROVED: { label: 'Approved', class: 'bg-blue-50 text-blue-700 border-blue-200', icon: CheckCircle2 },
  COMPLETED: { label: 'Completed', class: 'badge-success', icon: CheckCircle2 },
  LOCKED: { label: 'Locked', class: 'badge-neutral', icon: Lock },
};

const ADJUSTMENT_TYPES = [
  { value: 'ARREARS', label: 'Arrears' },
  { value: 'REIMBURSEMENT', label: 'Reimbursement' },
  { value: 'BONUS', label: 'Bonus' },
  { value: 'INCENTIVE', label: 'Incentive' },
  { value: 'ADVANCE_DEDUCTION', label: 'Advance Deduction' },
  { value: 'LOAN_RECOVERY', label: 'Loan Recovery' },
  { value: 'OTHER', label: 'Other' },
];

export default function PayrollPage() {
  const user = useAppSelector((state) => state.auth.user);
  const isHR = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role || '');

  if (isHR) return <PayrollAdminView />;
  return <PayrollEmployeeView />;
}

// ════════════════════════════════════════════════════════════════════
// ADMIN VIEW
// ════════════════════════════════════════════════════════════════════

function PayrollAdminView() {
  const user = useAppSelector((state) => state.auth.user);
  const { data: runsRes, isLoading } = useGetPayrollRunsQuery();
  const [createRun] = useCreatePayrollRunMutation();
  const [processPayroll] = useProcessPayrollMutation();
  const [importSalaries] = useImportSalariesMutation();
  const [lockRun] = useLockPayrollRunMutation();
  const [unlockRun] = useUnlockPayrollRunMutation();
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);
  const [showNewRun, setShowNewRun] = useState(false);
  const [newRunMonth, setNewRunMonth] = useState(new Date().getMonth() + 1);
  const [newRunYear, setNewRunYear] = useState(new Date().getFullYear());
  const [searchTerm, setSearchTerm] = useState('');
  const runs = runsRes?.data || [];

  const filteredRuns = useMemo(() => {
    if (!searchTerm) return runs;
    const term = searchTerm.toLowerCase();
    return runs.filter((r: any) =>
      `${MONTH_NAMES[r.month - 1]} ${r.year}`.toLowerCase().includes(term) ||
      r.status.toLowerCase().includes(term)
    );
  }, [runs, searchTerm]);

  // Summary stats
  const completedRuns = runs.filter((r: any) => ['COMPLETED', 'LOCKED'].includes(r.status));
  const totalGrossAll = completedRuns.reduce((s: number, r: any) => s + Number(r.totalGross || 0), 0);
  const totalNetAll = completedRuns.reduce((s: number, r: any) => s + Number(r.totalNet || 0), 0);
  const totalDeductionsAll = completedRuns.reduce((s: number, r: any) => s + Number(r.totalDeductions || 0), 0);

  const handleCreateRun = async () => {
    try {
      await createRun({ month: newRunMonth, year: newRunYear }).unwrap();
      toast.success(`Payroll run created for ${MONTH_NAMES[newRunMonth - 1]} ${newRunYear}`);
      setShowNewRun(false);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to create payroll run');
    }
  };

  const handleProcess = async (runId: string) => {
    try {
      const result = await processPayroll(runId).unwrap();
      toast.success(`Payroll processed — ${result.data.processed} employees`);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to process payroll');
    }
  };

  const handleLock = async (runId: string) => {
    try {
      await lockRun(runId).unwrap();
      toast.success('Payroll run locked');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to lock');
    }
  };

  const handleUnlock = async (runId: string) => {
    try {
      await unlockRun(runId).unwrap();
      toast.success('Payroll run unlocked for corrections');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to unlock');
    }
  };

  const apiBase = import.meta.env.VITE_API_URL === '/api' ? '/api' : (import.meta.env.VITE_API_URL || '/api');

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Payroll</h1>
          <p className="text-gray-500 text-sm mt-0.5">Enterprise salary processing & compliance</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => window.open(`${apiBase}/payroll/template`, '_blank')}
            className="btn-secondary text-sm flex items-center gap-1.5"
          >
            <FileSpreadsheet size={14} /> Download Template
          </button>
          <label className="btn-secondary text-sm flex items-center gap-1.5 cursor-pointer">
            <Upload size={14} /> Import Salaries
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const formData = new FormData();
              formData.append('file', file);
              try {
                const result = await importSalaries(formData).unwrap();
                toast.success(result.message || 'Import complete');
              } catch (err: unknown) {
                const message = (err as { data?: { error?: { message?: string } } })?.data?.error?.message;
                toast.error(message || 'Import failed');
              }
              e.target.value = '';
            }} />
          </label>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowNewRun(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={18} />
            New Payroll Run
          </motion.button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <div className="stat-card">
          <div className="flex items-center justify-between mb-2">
            <BarChart3 size={18} className="text-brand-500" />
            <span className="text-[10px] font-medium text-gray-400 uppercase">Runs</span>
          </div>
          <p className="text-2xl font-bold font-mono text-gray-900" data-mono>{runs.length}</p>
          <p className="text-[10px] text-gray-500 mt-1">{completedRuns.length} completed</p>
        </div>
        <div className="stat-card">
          <div className="flex items-center justify-between mb-2">
            <Calendar size={18} className="text-blue-500" />
            <span className="text-[10px] font-medium text-gray-400 uppercase">Latest</span>
          </div>
          <p className="text-lg font-bold text-gray-900">
            {runs[0] ? `${MONTH_NAMES[runs[0].month - 1]} ${runs[0].year}` : '—'}
          </p>
          <p className="text-[10px] text-gray-500 mt-1">{runs[0] ? STATUS_MAP[runs[0].status]?.label : 'No runs'}</p>
        </div>
        <div className="stat-card">
          <div className="flex items-center justify-between mb-2">
            <DollarSign size={18} className="text-emerald-500" />
            <span className="text-[10px] font-medium text-gray-400 uppercase">Total Gross</span>
          </div>
          <p className="text-lg font-bold font-mono text-gray-900" data-mono>
            {totalGrossAll > 0 ? formatCurrency(totalGrossAll) : '—'}
          </p>
        </div>
        <div className="stat-card">
          <div className="flex items-center justify-between mb-2">
            <IndianRupee size={18} className="text-emerald-600" />
            <span className="text-[10px] font-medium text-gray-400 uppercase">Total Net</span>
          </div>
          <p className="text-lg font-bold font-mono text-emerald-600" data-mono>
            {totalNetAll > 0 ? formatCurrency(totalNetAll) : '—'}
          </p>
        </div>
        <div className="stat-card">
          <div className="flex items-center justify-between mb-2">
            <TrendingDown size={18} className="text-red-400" />
            <span className="text-[10px] font-medium text-gray-400 uppercase">Total Deductions</span>
          </div>
          <p className="text-lg font-bold font-mono text-red-500" data-mono>
            {totalDeductionsAll > 0 ? formatCurrency(totalDeductionsAll) : '—'}
          </p>
        </div>
      </div>

      {/* New Payroll Run Modal */}
      <AnimatePresence>
        {showNewRun && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="layer-card p-5 mb-6 border-l-4 border-brand-500"
          >
            <h3 className="text-sm font-semibold text-gray-800 mb-4">Create New Payroll Run</h3>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Month</label>
                <select value={newRunMonth} onChange={e => setNewRunMonth(Number(e.target.value))} className="input-glass text-sm py-2 px-3 min-w-[160px]">
                  {FULL_MONTH_NAMES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Year</label>
                <select value={newRunYear} onChange={e => setNewRunYear(Number(e.target.value))} className="input-glass text-sm py-2 px-3 min-w-[100px]">
                  {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={handleCreateRun} className="btn-primary text-sm px-5 py-2">Create Run</button>
                <button onClick={() => setShowNewRun(false)} className="btn-secondary text-sm px-4 py-2">Cancel</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search + Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search payroll runs..."
            className="input-glass text-sm py-2 pl-9 pr-3 w-full"
          />
        </div>
      </div>

      {/* Payroll runs table */}
      <div className="data-table">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Period</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 hidden md:table-cell">Employees</th>
              <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Gross</th>
              <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 hidden lg:table-cell">Deductions</th>
              <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Net</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Status</th>
              <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td colSpan={7} className="px-4 py-4"><div className="h-4 bg-gray-100 rounded animate-pulse w-3/4" /></td>
                </tr>
              ))
            ) : filteredRuns.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-gray-500 text-sm">
                  {searchTerm ? 'No runs match your search.' : 'No payroll runs yet. Create one to get started.'}
                </td>
              </tr>
            ) : (
              filteredRuns.map((run: any, index: number) => {
                const StatusIcon = STATUS_MAP[run.status]?.icon || FileText;
                return (
                  <motion.tr
                    key={run.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                    className={cn(
                      'border-b border-gray-50 hover:bg-surface-2/50 transition-colors',
                      viewingRunId === run.id && 'bg-brand-50/30'
                    )}
                  >
                    <td className="px-4 py-3.5">
                      <p className="text-sm font-medium text-gray-800">
                        {MONTH_NAMES[run.month - 1]} {run.year}
                      </p>
                      {run.processedAt && (
                        <p className="text-[10px] text-gray-500">Processed {formatDate(run.processedAt)}</p>
                      )}
                    </td>
                    <td className="px-4 py-3.5 hidden md:table-cell">
                      <div className="flex items-center gap-1.5">
                        <Users size={12} className="text-gray-400" />
                        <span className="text-sm font-mono text-gray-600" data-mono>{run._count?.records || 0}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-right hidden sm:table-cell">
                      <span className="text-sm font-mono text-gray-600" data-mono>
                        {run.totalGross ? formatCurrency(Number(run.totalGross)) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right hidden lg:table-cell">
                      <span className="text-sm font-mono text-red-500" data-mono>
                        {run.totalDeductions ? formatCurrency(Number(run.totalDeductions)) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span className="text-sm font-mono font-medium text-gray-800" data-mono>
                        {run.totalNet ? formatCurrency(Number(run.totalNet)) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border', STATUS_MAP[run.status]?.class || 'badge-neutral')}>
                        <StatusIcon size={11} />
                        {STATUS_MAP[run.status]?.label || run.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        {run.status === 'DRAFT' && (
                          <button
                            onClick={() => handleProcess(run.id)}
                            className="text-xs text-white bg-brand-600 hover:bg-brand-700 px-3 py-1.5 rounded-lg font-medium flex items-center gap-1 transition-colors"
                          >
                            <Play size={12} /> Process
                          </button>
                        )}
                        {run.status === 'COMPLETED' && (
                          <button
                            onClick={() => handleLock(run.id)}
                            className="text-xs text-amber-700 bg-amber-50 hover:bg-amber-100 px-2.5 py-1.5 rounded-lg font-medium flex items-center gap-1 transition-colors"
                          >
                            <Lock size={11} /> Lock
                          </button>
                        )}
                        {run.status === 'LOCKED' && user?.role === 'SUPER_ADMIN' && (
                          <button
                            onClick={() => handleUnlock(run.id)}
                            className="text-xs text-purple-700 bg-purple-50 hover:bg-purple-100 px-2.5 py-1.5 rounded-lg font-medium flex items-center gap-1 transition-colors"
                          >
                            <Unlock size={11} /> Unlock
                          </button>
                        )}
                        {['COMPLETED', 'LOCKED'].includes(run.status) && (
                          <>
                            <button
                              onClick={() => window.open(`${apiBase}/payroll/runs/${run.id}/export`, '_blank')}
                              className="text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1.5 rounded-lg font-medium flex items-center gap-1 transition-colors"
                            >
                              <Download size={11} /> Excel
                            </button>
                            <button
                              onClick={() => window.open(`${apiBase}/payroll/runs/${run.id}/bank-file`, '_blank')}
                              className="text-xs text-blue-700 bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg font-medium flex items-center gap-1 transition-colors"
                            >
                              <Briefcase size={11} /> Bank File
                            </button>
                            <button
                              onClick={() => setViewingRunId(viewingRunId === run.id ? null : run.id)}
                              className="text-xs text-gray-600 bg-gray-50 hover:bg-gray-100 px-2.5 py-1.5 rounded-lg font-medium flex items-center gap-1 transition-colors"
                            >
                              <Eye size={11} /> {viewingRunId === run.id ? 'Hide' : 'View'}
                            </button>
                          </>
                        )}
                        {run.status === 'DRAFT' && (
                          <button
                            onClick={() => setViewingRunId(viewingRunId === run.id ? null : run.id)}
                            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5 rounded-lg flex items-center gap-1"
                          >
                            <PlusCircle size={11} /> Adjustments
                          </button>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Payroll Records / Adjustments Panel */}
      <AnimatePresence>
        {viewingRunId && (
          <PayrollRecordsPanel
            runId={viewingRunId}
            runStatus={runs.find((r: any) => r.id === viewingRunId)?.status || 'DRAFT'}
            onClose={() => setViewingRunId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// PAYROLL RECORDS PANEL (with adjustments)
// ════════════════════════════════════════════════════════════════════

function PayrollRecordsPanel({ runId, runStatus, onClose }: { runId: string; runStatus: string; onClose: () => void }) {
  const { data: recordsRes, isLoading } = useGetPayrollRecordsQuery(runId);
  const { data: adjustmentsRes } = useGetRunAdjustmentsQuery(runId);
  const [amendRecord] = useAmendPayrollRecordMutation();
  const [createAdjustment] = useCreateAdjustmentMutation();
  const [approveAdj] = useApproveAdjustmentMutation();
  const [deleteAdj] = useDeleteAdjustmentMutation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [amendForm, setAmendForm] = useState<any>({});
  const [showAdjForm, setShowAdjForm] = useState(false);
  const [adjForm, setAdjForm] = useState({ employeeId: '', type: 'BONUS', componentName: '', amount: '', isDeduction: false, reason: '' });
  const [searchRecords, setSearchRecords] = useState('');
  const [activeTab, setActiveTab] = useState<'records' | 'adjustments'>('records');
  const records = recordsRes?.data || [];
  const adjustments = adjustmentsRes?.data || [];

  const filteredRecords = useMemo(() => {
    if (!searchRecords) return records;
    const term = searchRecords.toLowerCase();
    return records.filter((r: any) =>
      `${r.employee?.firstName} ${r.employee?.lastName}`.toLowerCase().includes(term) ||
      r.employee?.employeeCode?.toLowerCase().includes(term) ||
      r.employee?.department?.name?.toLowerCase().includes(term)
    );
  }, [records, searchRecords]);

  const handleAmend = async (recordId: string) => {
    if (!amendForm.reason) { toast.error('Please provide an amendment reason'); return; }
    try {
      await amendRecord({ recordId, data: amendForm }).unwrap();
      toast.success('Payroll record amended');
      setEditingId(null);
      setAmendForm({});
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to amend'); }
  };

  const handleAddAdjustment = async () => {
    if (!adjForm.employeeId || !adjForm.componentName || !adjForm.amount || !adjForm.reason) {
      toast.error('Please fill all required fields');
      return;
    }
    try {
      await createAdjustment({
        payrollRunId: runId,
        employeeId: adjForm.employeeId,
        type: adjForm.type,
        componentName: adjForm.componentName,
        amount: Number(adjForm.amount),
        isDeduction: adjForm.isDeduction,
        reason: adjForm.reason,
      }).unwrap();
      toast.success('Adjustment added');
      setShowAdjForm(false);
      setAdjForm({ employeeId: '', type: 'BONUS', componentName: '', amount: '', isDeduction: false, reason: '' });
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to add adjustment'); }
  };

  const apiBase = import.meta.env.VITE_API_URL === '/api' ? '/api' : (import.meta.env.VITE_API_URL || '/api');
  const canAmend = ['COMPLETED'].includes(runStatus);
  const canAdjust = ['DRAFT', 'REVIEW'].includes(runStatus);

  // Summary
  const totalGross = records.reduce((s: number, r: any) => s + Number(r.grossSalary || 0), 0);
  const totalNet = records.reduce((s: number, r: any) => s + Number(r.netSalary || 0), 0);
  const totalDeductions = records.reduce((s: number, r: any) =>
    s + Number(r.epfEmployee || 0) + Number(r.esiEmployee || 0) + Number(r.professionalTax || 0) + Number(r.tds || 0) + Number(r.lopDeduction || 0), 0);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="mt-6">
      <div className="layer-card overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-4">
            <h3 className="text-sm font-semibold text-gray-700">Payroll Details</h3>
            <div className="flex items-center gap-1 bg-white rounded-lg border border-gray-200 p-0.5">
              <button
                onClick={() => setActiveTab('records')}
                className={cn('text-xs px-3 py-1.5 rounded-md font-medium transition-colors', activeTab === 'records' ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-700')}
              >
                Records ({records.length})
              </button>
              <button
                onClick={() => setActiveTab('adjustments')}
                className={cn('text-xs px-3 py-1.5 rounded-md font-medium transition-colors', activeTab === 'adjustments' ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-700')}
              >
                Adjustments ({adjustments.length})
              </button>
            </div>
          </div>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">&times; Close</button>
        </div>

        {/* Summary bar */}
        {records.length > 0 && activeTab === 'records' && (
          <div className="flex flex-wrap gap-6 px-5 py-3 bg-white border-b border-gray-100 text-xs">
            <div><span className="text-gray-500">Employees:</span> <span className="font-mono font-medium" data-mono>{records.length}</span></div>
            <div><span className="text-gray-500">Total Gross:</span> <span className="font-mono font-medium text-gray-800" data-mono>{formatCurrency(totalGross)}</span></div>
            <div><span className="text-gray-500">Total Deductions:</span> <span className="font-mono font-medium text-red-500" data-mono>{formatCurrency(totalDeductions)}</span></div>
            <div><span className="text-gray-500">Total Net:</span> <span className="font-mono font-bold text-emerald-600" data-mono>{formatCurrency(totalNet)}</span></div>
          </div>
        )}

        {activeTab === 'records' ? (
          <>
            {/* Search records */}
            <div className="px-5 py-3 border-b border-gray-100">
              <div className="relative max-w-xs">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={searchRecords}
                  onChange={e => setSearchRecords(e.target.value)}
                  placeholder="Search by name, code, department..."
                  className="input-glass text-xs py-2 pl-8 pr-3 w-full"
                />
              </div>
            </div>

            {isLoading ? (
              <div className="p-8 text-center"><Loader2 size={20} className="animate-spin text-gray-400 mx-auto" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left text-xs text-gray-500 px-4 py-2.5">Employee</th>
                      <th className="text-right text-xs text-gray-500 px-4 py-2.5">Basic</th>
                      <th className="text-right text-xs text-gray-500 px-4 py-2.5">HRA</th>
                      <th className="text-right text-xs text-gray-500 px-4 py-2.5">Gross</th>
                      <th className="text-right text-xs text-gray-500 px-4 py-2.5">EPF</th>
                      <th className="text-right text-xs text-gray-500 px-4 py-2.5">ESI</th>
                      <th className="text-right text-xs text-gray-500 px-4 py-2.5">PT</th>
                      <th className="text-right text-xs text-gray-500 px-4 py-2.5">TDS</th>
                      <th className="text-right text-xs text-gray-500 px-4 py-2.5">LOP</th>
                      <th className="text-right text-xs text-gray-500 px-4 py-2.5 font-bold">Net</th>
                      <th className="text-center text-xs text-gray-500 px-4 py-2.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.map((rec: any) => (
                      <tr key={rec.id} className={cn('border-b border-gray-50 hover:bg-surface-2 transition-colors', editingId === rec.id && 'bg-amber-50/30')}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-800 text-xs">{rec.employee?.firstName} {rec.employee?.lastName}</p>
                          <p className="text-[10px] text-gray-500">{rec.employee?.employeeCode} · {rec.employee?.department?.name || '-'}</p>
                          {rec.amendedAt && (
                            <p className="text-[10px] text-amber-600 mt-0.5 flex items-center gap-0.5">
                              <AlertTriangle size={9} /> Amended: {rec.amendmentReason}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs" data-mono>{formatCurrency(Number(rec.basic))}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs" data-mono>{formatCurrency(Number(rec.hra))}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs font-medium" data-mono>{formatCurrency(Number(rec.grossSalary))}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-gray-500" data-mono>{formatCurrency(Number(rec.epfEmployee || 0))}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-gray-500" data-mono>{formatCurrency(Number(rec.esiEmployee || 0))}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-gray-500" data-mono>{formatCurrency(Number(rec.professionalTax || 0))}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-gray-500" data-mono>{formatCurrency(Number(rec.tds || 0))}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs" data-mono>
                          {rec.lopDays > 0 ? <span className="text-red-500">{rec.lopDays}d</span> : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs font-bold text-emerald-600" data-mono>{formatCurrency(Number(rec.netSalary))}</td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => window.open(`${apiBase}/payroll/records/${rec.id}/pdf`, '_blank')}
                              className="text-[10px] text-brand-600 hover:text-brand-700 px-2 py-1 rounded bg-brand-50 font-medium"
                            >
                              PDF
                            </button>
                            {canAmend && (
                              <button
                                onClick={() => {
                                  setEditingId(editingId === rec.id ? null : rec.id);
                                  setAmendForm({ grossSalary: Number(rec.grossSalary), netSalary: Number(rec.netSalary), lopDays: rec.lopDays, reason: '' });
                                }}
                                className="text-[10px] text-amber-600 hover:text-amber-700 px-2 py-1 rounded bg-amber-50 font-medium"
                              >
                                Amend
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Amendment form */}
            <AnimatePresence>
              {editingId && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="p-4 border-t border-amber-200 bg-amber-50/50">
                    <p className="text-xs font-semibold text-amber-700 mb-3 flex items-center gap-1"><AlertTriangle size={12} /> Amend Payroll Record</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">Gross Salary</label>
                        <input type="number" value={amendForm.grossSalary || ''} onChange={e => setAmendForm({ ...amendForm, grossSalary: Number(e.target.value) })} className="input-glass text-xs w-full" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">Net Salary</label>
                        <input type="number" value={amendForm.netSalary || ''} onChange={e => setAmendForm({ ...amendForm, netSalary: Number(e.target.value) })} className="input-glass text-xs w-full" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">LOP Days</label>
                        <input type="number" value={amendForm.lopDays ?? ''} onChange={e => setAmendForm({ ...amendForm, lopDays: Number(e.target.value) })} className="input-glass text-xs w-full" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">Reason *</label>
                        <input value={amendForm.reason || ''} onChange={e => setAmendForm({ ...amendForm, reason: e.target.value })} className="input-glass text-xs w-full" placeholder="e.g., LOP correction" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleAmend(editingId)} className="btn-primary text-xs px-4 py-2">Save Amendment</button>
                      <button onClick={() => { setEditingId(null); setAmendForm({}); }} className="btn-secondary text-xs px-4 py-2">Cancel</button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        ) : (
          /* Adjustments Tab */
          <div className="p-5">
            {canAdjust && (
              <div className="mb-4">
                {!showAdjForm ? (
                  <button onClick={() => setShowAdjForm(true)} className="btn-primary text-xs flex items-center gap-1.5">
                    <PlusCircle size={13} /> Add Adjustment
                  </button>
                ) : (
                  <div className="layer-card p-4 border-l-4 border-blue-500">
                    <p className="text-xs font-semibold text-gray-700 mb-3">New Adjustment</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">Employee ID *</label>
                        <select value={adjForm.employeeId} onChange={e => setAdjForm({ ...adjForm, employeeId: e.target.value })} className="input-glass text-xs w-full">
                          <option value="">Select employee...</option>
                          {records.map((r: any) => (
                            <option key={r.employeeId} value={r.employeeId}>
                              {r.employee?.employeeCode} — {r.employee?.firstName} {r.employee?.lastName}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">Type</label>
                        <select value={adjForm.type} onChange={e => setAdjForm({ ...adjForm, type: e.target.value })} className="input-glass text-xs w-full">
                          {ADJUSTMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">Component Name *</label>
                        <input value={adjForm.componentName} onChange={e => setAdjForm({ ...adjForm, componentName: e.target.value })} className="input-glass text-xs w-full" placeholder="e.g., Arrears - Basic" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">Amount (INR) *</label>
                        <input type="number" value={adjForm.amount} onChange={e => setAdjForm({ ...adjForm, amount: e.target.value })} className="input-glass text-xs w-full" placeholder="0" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">Direction</label>
                        <div className="flex gap-2 mt-1">
                          <button
                            onClick={() => setAdjForm({ ...adjForm, isDeduction: false })}
                            className={cn('text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors', !adjForm.isDeduction ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-white text-gray-500 border-gray-200')}
                          >
                            + Addition
                          </button>
                          <button
                            onClick={() => setAdjForm({ ...adjForm, isDeduction: true })}
                            className={cn('text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors', adjForm.isDeduction ? 'bg-red-50 text-red-700 border-red-200' : 'bg-white text-gray-500 border-gray-200')}
                          >
                            - Deduction
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">Reason *</label>
                        <input value={adjForm.reason} onChange={e => setAdjForm({ ...adjForm, reason: e.target.value })} className="input-glass text-xs w-full" placeholder="Reason for adjustment" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleAddAdjustment} className="btn-primary text-xs px-4 py-2">Add Adjustment</button>
                      <button onClick={() => setShowAdjForm(false)} className="btn-secondary text-xs px-4 py-2">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Adjustments list */}
            {adjustments.length === 0 ? (
              <div className="text-center py-8">
                <Shield size={32} className="mx-auto text-gray-200 mb-2" />
                <p className="text-sm text-gray-500">No adjustments for this payroll run</p>
                <p className="text-xs text-gray-400 mt-1">Add arrears, bonuses, or deductions before processing</p>
              </div>
            ) : (
              <div className="space-y-2">
                {adjustments.map((adj: any) => (
                  <div key={adj.id} className={cn('flex items-center justify-between p-3 rounded-lg border', adj.isDeduction ? 'bg-red-50/50 border-red-100' : 'bg-emerald-50/50 border-emerald-100')}>
                    <div className="flex items-center gap-3">
                      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold', adj.isDeduction ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600')}>
                        {adj.isDeduction ? '-' : '+'}
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-800">{adj.componentName}</p>
                        <p className="text-[10px] text-gray-500">
                          {adj.employee?.employeeCode} · {adj.employee?.firstName} {adj.employee?.lastName} · {adj.type.replace(/_/g, ' ')}
                        </p>
                        <p className="text-[10px] text-gray-400">{adj.reason}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={cn('font-mono text-sm font-bold', adj.isDeduction ? 'text-red-600' : 'text-emerald-600')} data-mono>
                        {adj.isDeduction ? '-' : '+'}{formatCurrency(Number(adj.amount))}
                      </span>
                      <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium',
                        adj.approvalStatus === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' :
                        adj.approvalStatus === 'REJECTED' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                      )}>
                        {adj.approvalStatus}
                      </span>
                      {adj.approvalStatus === 'PENDING' && (
                        <div className="flex gap-1">
                          <button
                            onClick={async () => { try { await approveAdj({ id: adj.id, status: 'APPROVED' }).unwrap(); toast.success('Approved'); } catch { toast.error('Failed'); } }}
                            className="text-emerald-600 hover:bg-emerald-100 p-1 rounded"
                          >
                            <CheckCircle2 size={14} />
                          </button>
                          <button
                            onClick={async () => { try { await approveAdj({ id: adj.id, status: 'REJECTED' }).unwrap(); toast.success('Rejected'); } catch { toast.error('Failed'); } }}
                            className="text-red-600 hover:bg-red-100 p-1 rounded"
                          >
                            <XCircle size={14} />
                          </button>
                          {canAdjust && (
                            <button
                              onClick={async () => { try { await deleteAdj(adj.id).unwrap(); toast.success('Deleted'); } catch { toast.error('Failed'); } }}
                              className="text-gray-400 hover:text-red-500 hover:bg-red-50 p-1 rounded"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ════════════════════════════════════════════════════════════════════
// EMPLOYEE VIEW
// ════════════════════════════════════════════════════════════════════

function PayrollEmployeeView() {
  const now = new Date();
  const [filterMonth, setFilterMonth] = useState<number>(0);
  const [filterYear, setFilterYear] = useState<number>(now.getFullYear());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const queryParams = {
    ...(filterMonth > 0 && { month: filterMonth }),
    ...(filterYear > 0 && { year: filterYear }),
  };
  const { data: payslipsRes, isLoading, isFetching } = useGetMyPayslipsQuery(
    Object.keys(queryParams).length > 0 ? queryParams : undefined
  );
  const payslips = payslipsRes?.data || [];

  const apiBase = import.meta.env.VITE_API_URL === '/api' ? '/api' : (import.meta.env.VITE_API_URL || '/api');
  const yearOptions = Array.from({ length: 4 }, (_, i) => now.getFullYear() - i);

  const totalNet = payslips.reduce((sum: number, s: any) => sum + Number(s.netSalary || 0), 0);
  const totalDeductions = payslips.reduce((sum: number, s: any) =>
    sum + Number(s.epfEmployee || 0) + Number(s.esiEmployee || 0) +
    Number(s.professionalTax || 0) + Number(s.tds || 0) + Number(s.lopDeduction || 0), 0);
  const latestSlip = payslips[0];

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">My Payslips</h1>
          <p className="text-gray-500 text-sm mt-0.5">View and download your salary slips</p>
        </div>
      </div>

      {payslips.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="stat-card">
            <FileText size={18} className="text-brand-500 mb-2" />
            <p className="text-xs text-gray-500">Total Payslips</p>
            <p className="text-2xl font-bold font-mono text-gray-900" data-mono>{payslips.length}</p>
          </div>
          <div className="stat-card">
            <Calendar size={18} className="text-blue-500 mb-2" />
            <p className="text-xs text-gray-500">Latest</p>
            <p className="text-lg font-bold text-gray-900">
              {latestSlip ? `${MONTH_NAMES[(latestSlip.payrollRun?.month || 1) - 1]} ${latestSlip.payrollRun?.year}` : '—'}
            </p>
          </div>
          <div className="stat-card">
            <IndianRupee size={18} className="text-emerald-500 mb-2" />
            <p className="text-xs text-gray-500">Latest Net Pay</p>
            <p className="text-lg font-bold font-mono text-emerald-600" data-mono>
              {latestSlip ? formatCurrency(Number(latestSlip.netSalary)) : '—'}
            </p>
          </div>
          <div className="stat-card">
            <TrendingDown size={18} className="text-red-400 mb-2" />
            <p className="text-xs text-gray-500">Total Deductions ({filterYear})</p>
            <p className="text-lg font-bold font-mono text-red-500" data-mono>
              {formatCurrency(totalDeductions)}
            </p>
          </div>
        </div>
      )}

      <div className="layer-card p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Filter size={14} />
            <span className="font-medium">Filters</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Month</label>
            <select value={filterMonth} onChange={(e) => setFilterMonth(Number(e.target.value))} className="input-glass text-sm py-1.5 px-3 min-w-[140px]">
              <option value={0}>All Months</option>
              {FULL_MONTH_NAMES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Year</label>
            <select value={filterYear} onChange={(e) => setFilterYear(Number(e.target.value))} className="input-glass text-sm py-1.5 px-3 min-w-[100px]">
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          {filterMonth > 0 && (
            <button onClick={() => setFilterMonth(0)} className="text-xs text-brand-600 hover:text-brand-700 font-medium">Clear filters</button>
          )}
          {isFetching && <Loader2 size={14} className="animate-spin text-gray-400" />}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="layer-card p-5 animate-pulse">
              <div className="flex justify-between items-center">
                <div className="space-y-2 flex-1"><div className="h-4 bg-gray-100 rounded w-1/4" /><div className="h-3 bg-gray-100 rounded w-2/3" /></div>
                <div className="h-8 bg-gray-100 rounded w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : payslips.length === 0 ? (
        <div className="layer-card p-12 text-center">
          <DollarSign size={40} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm text-gray-500 font-medium">No payslips found</p>
          <p className="text-xs text-gray-500 mt-1">
            {filterMonth > 0
              ? `No payslip for ${FULL_MONTH_NAMES[filterMonth - 1]} ${filterYear}. Try changing the filters.`
              : `No payslips have been generated for ${filterYear} yet.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {payslips.map((slip: any, index: number) => {
            const isExpanded = expandedId === slip.id;
            const gross = Number(slip.grossSalary || 0);
            const net = Number(slip.netSalary || 0);
            const basic = Number(slip.basic || 0);
            const hra = Number(slip.hra || 0);
            const epf = Number(slip.epfEmployee || 0);
            const esi = Number(slip.esiEmployee || 0);
            const pt = Number(slip.professionalTax || 0);
            const tds = Number(slip.tds || 0);
            const lopDed = Number(slip.lopDeduction || 0);
            const totalDed = epf + esi + pt + tds + lopDed;
            const otherEarnings = slip.otherEarnings || {};
            const da = Number(otherEarnings.da || 0);
            const ta = Number(otherEarnings.ta || 0);
            const medical = Number(otherEarnings.medical || 0);
            const special = Number(otherEarnings.special || 0);
            const sundayBonus = Number(otherEarnings.sundayBonus || 0);
            const month = slip.payrollRun?.month || 1;
            const year = slip.payrollRun?.year || now.getFullYear();

            return (
              <motion.div key={slip.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }} className="layer-card overflow-hidden">
                <div className="flex items-center justify-between p-5 cursor-pointer hover:bg-surface-2/50 transition-colors" onClick={() => setExpandedId(isExpanded ? null : slip.id)}>
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                      <IndianRupee size={18} className="text-brand-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800">{FULL_MONTH_NAMES[month - 1]} {year}</p>
                      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-1">
                        <span className="text-xs text-gray-500">Gross: <span className="font-mono text-gray-600" data-mono>{formatCurrency(gross)}</span></span>
                        <span className="text-xs text-gray-500">Deductions: <span className="font-mono text-red-500" data-mono>{formatCurrency(totalDed)}</span></span>
                        <span className="text-xs text-gray-500">Net: <span className="font-mono font-semibold text-emerald-600" data-mono>{formatCurrency(net)}</span></span>
                        {slip.lopDays > 0 && <span className="text-xs text-red-400">LOP: {slip.lopDays} day(s)</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                    <button onClick={(e) => { e.stopPropagation(); window.open(`${apiBase}/payroll/records/${slip.id}/pdf`, '_blank'); }} className="btn-secondary flex items-center gap-1.5 text-xs py-2 px-3">
                      <Download size={13} /> Download
                    </button>
                    {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                  </div>
                </div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-t border-gray-100 overflow-hidden">
                      <div className="p-5 bg-gray-50/50">
                        <div className="flex gap-6 mb-4 text-xs">
                          <div><span className="text-gray-500">Working Days: </span><span className="font-mono font-medium text-gray-700" data-mono>{slip.workingDays || '—'}</span></div>
                          <div><span className="text-gray-500">Present Days: </span><span className="font-mono font-medium text-gray-700" data-mono>{slip.presentDays ?? '—'}</span></div>
                          {slip.lopDays > 0 && <div><span className="text-gray-500">LOP Days: </span><span className="font-mono font-medium text-red-500" data-mono>{slip.lopDays}</span></div>}
                          {(otherEarnings.sundaysWorked || 0) > 0 && <div><span className="text-gray-500">Sundays Worked: </span><span className="font-mono font-medium text-gray-700" data-mono>{otherEarnings.sundaysWorked}</span></div>}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                            <div className="px-4 py-2.5 bg-emerald-50 border-b border-emerald-100"><p className="text-xs font-semibold text-emerald-700">Earnings</p></div>
                            <div className="divide-y divide-gray-50">
                              <PayslipRow label="Basic Salary" amount={basic} />
                              <PayslipRow label="HRA" amount={hra} />
                              {da > 0 && <PayslipRow label="Dearness Allowance" amount={da} />}
                              {ta > 0 && <PayslipRow label="Transport Allowance" amount={ta} />}
                              {medical > 0 && <PayslipRow label="Medical Allowance" amount={medical} />}
                              {special > 0 && <PayslipRow label="Special Allowance" amount={special} />}
                              {sundayBonus > 0 && <PayslipRow label="Sunday Bonus" amount={sundayBonus} />}
                              <div className="px-4 py-2.5 bg-emerald-50/50 flex justify-between">
                                <span className="text-xs font-semibold text-gray-700">Total Earnings</span>
                                <span className="text-xs font-bold font-mono text-emerald-600" data-mono>{formatCurrency(gross)}</span>
                              </div>
                            </div>
                          </div>

                          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                            <div className="px-4 py-2.5 bg-red-50 border-b border-red-100"><p className="text-xs font-semibold text-red-700">Deductions</p></div>
                            <div className="divide-y divide-gray-50">
                              {epf > 0 && <PayslipRow label="EPF (Employee)" amount={epf} isDeduction />}
                              {esi > 0 && <PayslipRow label="ESI (Employee)" amount={esi} isDeduction />}
                              {pt > 0 && <PayslipRow label="Professional Tax" amount={pt} isDeduction />}
                              {tds > 0 && <PayslipRow label="TDS" amount={tds} isDeduction />}
                              {lopDed > 0 && <PayslipRow label="LOP Deduction" amount={lopDed} isDeduction />}
                              {totalDed === 0 && <div className="px-4 py-2.5 text-xs text-gray-500">No deductions</div>}
                              <div className="px-4 py-2.5 bg-red-50/50 flex justify-between">
                                <span className="text-xs font-semibold text-gray-700">Total Deductions</span>
                                <span className="text-xs font-bold font-mono text-red-500" data-mono>{formatCurrency(totalDed)}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 bg-brand-600 rounded-xl p-4 flex items-center justify-between">
                          <span className="text-sm font-semibold text-white">Net Pay</span>
                          <span className="text-xl font-bold font-mono text-white" data-mono>{formatCurrency(net)}</span>
                        </div>

                        <div className="mt-4 flex justify-end">
                          <button onClick={() => window.open(`${apiBase}/payroll/records/${slip.id}/pdf`, '_blank')} className="btn-primary flex items-center gap-2 text-sm">
                            <Download size={14} /> Download Salary Slip (PDF)
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PayslipRow({ label, amount, isDeduction }: { label: string; amount: number; isDeduction?: boolean }) {
  return (
    <div className="px-4 py-2 flex justify-between items-center">
      <span className="text-xs text-gray-600">{label}</span>
      <span className={cn('text-xs font-mono', isDeduction ? 'text-red-500' : 'text-gray-800')} data-mono>
        {isDeduction ? '- ' : ''}{formatCurrency(amount)}
      </span>
    </div>
  );
}
