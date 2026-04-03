import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { DollarSign, Play, Download, Eye, Plus, Calendar, Upload, FileSpreadsheet, Loader2, Filter, ChevronDown, ChevronUp, IndianRupee, TrendingDown, Briefcase, FileText } from 'lucide-react';
import {
  useGetPayrollRunsQuery,
  useCreatePayrollRunMutation,
  useProcessPayrollMutation,
  useGetMyPayslipsQuery,
  useGetPayrollRecordsQuery,
  useAmendPayrollRecordMutation,
  useImportSalariesMutation,
} from './payrollApi';
import { cn, formatCurrency, formatDate } from '../../lib/utils';
import { useAppSelector } from '../../app/store';
import toast from 'react-hot-toast';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STATUS_MAP: Record<string, { label: string; class: string }> = {
  DRAFT: { label: 'Draft', class: 'badge-warning' },
  PROCESSING: { label: 'Processing', class: 'badge-info' },
  COMPLETED: { label: 'Completed', class: 'badge-success' },
  LOCKED: { label: 'Locked', class: 'badge-neutral' },
};

export default function PayrollPage() {
  const user = useAppSelector((state) => state.auth.user);
  const isHR = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role || '');

  if (isHR) return <PayrollAdminView />;
  return <PayrollEmployeeView />;
}

function PayrollAdminView() {
  const { data: runsRes, isLoading } = useGetPayrollRunsQuery();
  const [createRun] = useCreatePayrollRunMutation();
  const [processPayroll] = useProcessPayrollMutation();
  const [importSalaries] = useImportSalariesMutation();
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);
  const runs = runsRes?.data || [];

  const handleCreateRun = async () => {
    const now = new Date();
    try {
      await createRun({ month: now.getMonth() + 1, year: now.getFullYear() }).unwrap();
      toast.success('Payroll run created');
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

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Payroll</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage salary processing and payslips</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const apiBase = import.meta.env.VITE_API_URL === '/api' ? '/api' : (import.meta.env.VITE_API_URL || '/api');
              window.open(`${apiBase}/payroll/template`, '_blank');
            }}
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
            onClick={handleCreateRun}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={18} />
            New Payroll Run
          </motion.button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="stat-card">
          <DollarSign size={20} className="text-emerald-500 mb-2" />
          <p className="text-sm text-gray-500">Total Runs</p>
          <p className="text-2xl font-bold font-mono text-gray-900" data-mono>{runs.length}</p>
        </div>
        <div className="stat-card">
          <Calendar size={20} className="text-blue-500 mb-2" />
          <p className="text-sm text-gray-500">Latest</p>
          <p className="text-lg font-bold text-gray-900">
            {runs[0] ? `${MONTH_NAMES[runs[0].month - 1]} ${runs[0].year}` : '—'}
          </p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-gray-500">Last Gross</p>
          <p className="text-lg font-bold font-mono text-gray-900" data-mono>
            {runs[0]?.totalGross ? formatCurrency(Number(runs[0].totalGross)) : '—'}
          </p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-gray-500">Last Net</p>
          <p className="text-lg font-bold font-mono text-emerald-600" data-mono>
            {runs[0]?.totalNet ? formatCurrency(Number(runs[0].totalNet)) : '—'}
          </p>
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
              <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Net</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Status</th>
              <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td colSpan={6} className="px-4 py-4"><div className="h-4 bg-gray-100 rounded animate-pulse w-3/4" /></td>
                </tr>
              ))
            ) : runs.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-gray-400 text-sm">
                  No payroll runs yet. Create one to get started.
                </td>
              </tr>
            ) : (
              runs.map((run: any, index: number) => (
                <motion.tr
                  key={run.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="border-b border-gray-50 hover:bg-surface-2/50 transition-colors"
                >
                  <td className="px-4 py-3.5">
                    <p className="text-sm font-medium text-gray-800">
                      {MONTH_NAMES[run.month - 1]} {run.year}
                    </p>
                    {run.processedAt && (
                      <p className="text-xs text-gray-400">Processed {formatDate(run.processedAt)}</p>
                    )}
                  </td>
                  <td className="px-4 py-3.5 hidden md:table-cell">
                    <span className="text-sm font-mono text-gray-600" data-mono>{run._count?.records || 0}</span>
                  </td>
                  <td className="px-4 py-3.5 text-right hidden sm:table-cell">
                    <span className="text-sm font-mono text-gray-600" data-mono>
                      {run.totalGross ? formatCurrency(Number(run.totalGross)) : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <span className="text-sm font-mono font-medium text-gray-800" data-mono>
                      {run.totalNet ? formatCurrency(Number(run.totalNet)) : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`badge ${STATUS_MAP[run.status]?.class || 'badge-neutral'}`}>
                      {STATUS_MAP[run.status]?.label || run.status}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {run.status === 'DRAFT' && (
                        <button
                          aria-label="Process payroll"
                          onClick={() => handleProcess(run.id)}
                          className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1"
                        >
                          <Play size={14} /> Process
                        </button>
                      )}
                      {(run.status === 'COMPLETED' || run.status === 'LOCKED') && (
                        <>
                          <button
                            aria-label="Download salary slip"
                            onClick={() => {
                              const apiBase = import.meta.env.VITE_API_URL === '/api' ? '/api' : (import.meta.env.VITE_API_URL || '/api');
                              window.open(`${apiBase}/payroll/runs/${run.id}/export`, '_blank');
                            }}
                            className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1"
                          >
                            <Download size={14} /> Excel
                          </button>
                          <button
                            aria-label="View details"
                            onClick={() => setViewingRunId(viewingRunId === run.id ? null : run.id)}
                            className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                          >
                            <Eye size={14} /> {viewingRunId === run.id ? 'Hide' : 'View'}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </motion.tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Payroll Records Panel */}
      {viewingRunId && (
        <PayrollRecordsPanel runId={viewingRunId} onClose={() => setViewingRunId(null)} />
      )}
    </div>
  );
}

function PayrollRecordsPanel({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { data: recordsRes, isLoading } = useGetPayrollRecordsQuery(runId);
  const [amendRecord] = useAmendPayrollRecordMutation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [amendForm, setAmendForm] = useState<any>({});
  const records = recordsRes?.data || [];

  const handleAmend = async (recordId: string) => {
    if (!amendForm.reason) {
      toast.error('Please provide an amendment reason');
      return;
    }
    try {
      await amendRecord({ recordId, data: amendForm }).unwrap();
      toast.success('Payroll record amended');
      setEditingId(null);
      setAmendForm({});
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to amend');
    }
  };

  const apiBase = import.meta.env.VITE_API_URL === '/api' ? '/api' : (import.meta.env.VITE_API_URL || '/api');

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
      <div className="layer-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Payroll Records ({records.length} employees)</h3>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">&times; Close</button>
        </div>

        {isLoading ? (
          <div className="p-8 text-center"><Loader2 size={20} className="animate-spin text-gray-400 mx-auto" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left text-xs text-gray-500 px-4 py-2">Employee</th>
                  <th className="text-right text-xs text-gray-500 px-4 py-2">Basic</th>
                  <th className="text-right text-xs text-gray-500 px-4 py-2">HRA</th>
                  <th className="text-right text-xs text-gray-500 px-4 py-2">Gross</th>
                  <th className="text-right text-xs text-gray-500 px-4 py-2">EPF</th>
                  <th className="text-right text-xs text-gray-500 px-4 py-2">TDS</th>
                  <th className="text-right text-xs text-gray-500 px-4 py-2">LOP</th>
                  <th className="text-right text-xs text-gray-500 px-4 py-2 font-bold">Net</th>
                  <th className="text-center text-xs text-gray-500 px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((rec: any) => (
                  <tr key={rec.id} className="border-b border-gray-50 hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800 text-xs">{rec.employee?.firstName} {rec.employee?.lastName}</p>
                      <p className="text-[10px] text-gray-400">{rec.employee?.employeeCode} · {rec.employee?.department?.name || '-'}</p>
                      {rec.amendedAt && (
                        <p className="text-[10px] text-amber-600 mt-0.5">Amended: {rec.amendmentReason}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs" data-mono>{formatCurrency(Number(rec.basic))}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs" data-mono>{formatCurrency(Number(rec.hra))}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs" data-mono>{formatCurrency(Number(rec.grossSalary))}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-gray-500" data-mono>{formatCurrency(Number(rec.epfEmployee || 0))}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-gray-500" data-mono>{formatCurrency(Number(rec.tds || 0))}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs" data-mono>
                      {rec.lopDays > 0 ? <span className="text-red-500">{rec.lopDays}d / {formatCurrency(Number(rec.lopDeduction || 0))}</span> : '-'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-bold text-emerald-600" data-mono>{formatCurrency(Number(rec.netSalary))}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => window.open(`${apiBase}/payroll/records/${rec.id}/pdf`, '_blank')}
                          className="text-[10px] text-brand-600 hover:text-brand-700 px-2 py-1 rounded bg-brand-50"
                        >
                          PDF
                        </button>
                        <button
                          onClick={() => {
                            setEditingId(editingId === rec.id ? null : rec.id);
                            setAmendForm({ grossSalary: Number(rec.grossSalary), netSalary: Number(rec.netSalary), lopDays: rec.lopDays, reason: '' });
                          }}
                          className="text-[10px] text-amber-600 hover:text-amber-700 px-2 py-1 rounded bg-amber-50"
                        >
                          Amend
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Amendment form */}
        {editingId && (
          <div className="p-4 border-t border-amber-200 bg-amber-50/50">
            <p className="text-xs font-semibold text-amber-700 mb-3">Amend Payroll Record</p>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Gross Salary</label>
                <input type="number" value={amendForm.grossSalary || ''} onChange={e => setAmendForm({ ...amendForm, grossSalary: Number(e.target.value) })}
                  className="input-glass text-xs w-full" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Net Salary</label>
                <input type="number" value={amendForm.netSalary || ''} onChange={e => setAmendForm({ ...amendForm, netSalary: Number(e.target.value) })}
                  className="input-glass text-xs w-full" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">LOP Days</label>
                <input type="number" value={amendForm.lopDays ?? ''} onChange={e => setAmendForm({ ...amendForm, lopDays: Number(e.target.value) })}
                  className="input-glass text-xs w-full" />
              </div>
            </div>
            <div className="mb-3">
              <label className="block text-[10px] text-gray-500 mb-1">Reason for Amendment *</label>
              <input value={amendForm.reason || ''} onChange={e => setAmendForm({ ...amendForm, reason: e.target.value })}
                className="input-glass text-xs w-full" placeholder="e.g., LOP correction, bonus adjustment" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleAmend(editingId)} className="btn-primary text-xs px-4 py-2">Save Amendment</button>
              <button onClick={() => { setEditingId(null); setAmendForm({}); }} className="btn-secondary text-xs px-4 py-2">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

const FULL_MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function PayrollEmployeeView() {
  const now = new Date();
  const [filterMonth, setFilterMonth] = useState<number>(0); // 0 = All months
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

  // Generate year options (current year down to 3 years back)
  const yearOptions = Array.from({ length: 4 }, (_, i) => now.getFullYear() - i);

  // Summary stats from current filtered payslips
  const totalNet = payslips.reduce((sum: number, s: any) => sum + Number(s.netSalary || 0), 0);
  const totalDeductions = payslips.reduce((sum: number, s: any) =>
    sum + Number(s.epfEmployee || 0) + Number(s.esiEmployee || 0) +
    Number(s.professionalTax || 0) + Number(s.tds || 0) + Number(s.lopDeduction || 0), 0);
  const latestSlip = payslips[0];

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">My Payslips</h1>
          <p className="text-gray-500 text-sm mt-0.5">View and download your salary slips</p>
        </div>
      </div>

      {/* Summary cards */}
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

      {/* Filters */}
      <div className="layer-card p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Filter size={14} />
            <span className="font-medium">Filters</span>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Month</label>
            <select
              value={filterMonth}
              onChange={(e) => setFilterMonth(Number(e.target.value))}
              className="input-glass text-sm py-1.5 px-3 min-w-[140px]"
            >
              <option value={0}>All Months</option>
              {FULL_MONTH_NAMES.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Year</label>
            <select
              value={filterYear}
              onChange={(e) => setFilterYear(Number(e.target.value))}
              className="input-glass text-sm py-1.5 px-3 min-w-[100px]"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {(filterMonth > 0) && (
            <button
              onClick={() => { setFilterMonth(0); }}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium"
            >
              Clear filters
            </button>
          )}

          {isFetching && <Loader2 size={14} className="animate-spin text-gray-400" />}
        </div>
      </div>

      {/* Payslips list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="layer-card p-5 animate-pulse">
              <div className="flex justify-between items-center">
                <div className="space-y-2 flex-1">
                  <div className="h-4 bg-gray-100 rounded w-1/4" />
                  <div className="h-3 bg-gray-100 rounded w-2/3" />
                </div>
                <div className="h-8 bg-gray-100 rounded w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : payslips.length === 0 ? (
        <div className="layer-card p-12 text-center">
          <DollarSign size={40} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm text-gray-500 font-medium">No payslips found</p>
          <p className="text-xs text-gray-400 mt-1">
            {filterMonth > 0
              ? `No payslip for ${FULL_MONTH_NAMES[filterMonth - 1]} ${filterYear}. Try changing the filters.`
              : `No payslips have been generated for ${filterYear} yet. Contact HR if you believe this is an error.`}
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
              <motion.div
                key={slip.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.04 }}
                className="layer-card overflow-hidden"
              >
                {/* Payslip header row */}
                <div
                  className="flex items-center justify-between p-5 cursor-pointer hover:bg-surface-2/50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : slip.id)}
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                      <IndianRupee size={18} className="text-brand-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800">
                        {FULL_MONTH_NAMES[month - 1]} {year}
                      </p>
                      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-1">
                        <span className="text-xs text-gray-400">
                          Gross: <span className="font-mono text-gray-600" data-mono>{formatCurrency(gross)}</span>
                        </span>
                        <span className="text-xs text-gray-400">
                          Deductions: <span className="font-mono text-red-500" data-mono>{formatCurrency(totalDed)}</span>
                        </span>
                        <span className="text-xs text-gray-400">
                          Net: <span className="font-mono font-semibold text-emerald-600" data-mono>{formatCurrency(net)}</span>
                        </span>
                        {slip.lopDays > 0 && (
                          <span className="text-xs text-red-400">LOP: {slip.lopDays} day(s)</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(`${apiBase}/payroll/records/${slip.id}/pdf`, '_blank');
                      }}
                      className="btn-secondary flex items-center gap-1.5 text-xs py-2 px-3"
                    >
                      <Download size={13} />
                      Download
                    </button>
                    {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    className="border-t border-gray-100"
                  >
                    <div className="p-5 bg-gray-50/50">
                      {/* Working days info */}
                      <div className="flex gap-6 mb-4 text-xs">
                        <div>
                          <span className="text-gray-400">Working Days: </span>
                          <span className="font-mono font-medium text-gray-700" data-mono>{slip.workingDays || '—'}</span>
                        </div>
                        <div>
                          <span className="text-gray-400">Present Days: </span>
                          <span className="font-mono font-medium text-gray-700" data-mono>{slip.presentDays ?? '—'}</span>
                        </div>
                        {slip.lopDays > 0 && (
                          <div>
                            <span className="text-gray-400">LOP Days: </span>
                            <span className="font-mono font-medium text-red-500" data-mono>{slip.lopDays}</span>
                          </div>
                        )}
                        {(otherEarnings.sundaysWorked || 0) > 0 && (
                          <div>
                            <span className="text-gray-400">Sundays Worked: </span>
                            <span className="font-mono font-medium text-gray-700" data-mono>{otherEarnings.sundaysWorked}</span>
                          </div>
                        )}
                      </div>

                      {/* Two-column: Earnings + Deductions */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Earnings */}
                        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                          <div className="px-4 py-2.5 bg-emerald-50 border-b border-emerald-100">
                            <p className="text-xs font-semibold text-emerald-700">Earnings</p>
                          </div>
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

                        {/* Deductions */}
                        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                          <div className="px-4 py-2.5 bg-red-50 border-b border-red-100">
                            <p className="text-xs font-semibold text-red-700">Deductions</p>
                          </div>
                          <div className="divide-y divide-gray-50">
                            {epf > 0 && <PayslipRow label="EPF (Employee)" amount={epf} isDeduction />}
                            {esi > 0 && <PayslipRow label="ESI (Employee)" amount={esi} isDeduction />}
                            {pt > 0 && <PayslipRow label="Professional Tax" amount={pt} isDeduction />}
                            {tds > 0 && <PayslipRow label="TDS" amount={tds} isDeduction />}
                            {lopDed > 0 && <PayslipRow label="LOP Deduction" amount={lopDed} isDeduction />}
                            {totalDed === 0 && (
                              <div className="px-4 py-2.5 text-xs text-gray-400">No deductions</div>
                            )}
                            <div className="px-4 py-2.5 bg-red-50/50 flex justify-between">
                              <span className="text-xs font-semibold text-gray-700">Total Deductions</span>
                              <span className="text-xs font-bold font-mono text-red-500" data-mono>{formatCurrency(totalDed)}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Net Pay highlight */}
                      <div className="mt-4 bg-brand-600 rounded-xl p-4 flex items-center justify-between">
                        <span className="text-sm font-semibold text-white">Net Pay</span>
                        <span className="text-xl font-bold font-mono text-white" data-mono>{formatCurrency(net)}</span>
                      </div>

                      {/* Download button at bottom */}
                      <div className="mt-4 flex justify-end">
                        <button
                          onClick={() => window.open(`${apiBase}/payroll/records/${slip.id}/pdf`, '_blank')}
                          className="btn-primary flex items-center gap-2 text-sm"
                        >
                          <Download size={14} />
                          Download Salary Slip (PDF)
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
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
