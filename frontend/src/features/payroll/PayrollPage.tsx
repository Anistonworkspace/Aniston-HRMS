import { useState } from 'react';
import { motion } from 'framer-motion';
import { DollarSign, Play, Download, Eye, Plus, Calendar } from 'lucide-react';
import {
  useGetPayrollRunsQuery,
  useCreatePayrollRunMutation,
  useProcessPayrollMutation,
  useGetMyPayslipsQuery,
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
                          onClick={() => handleProcess(run.id)}
                          className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1"
                        >
                          <Play size={14} /> Process
                        </button>
                      )}
                      {run.status === 'COMPLETED' && (
                        <button className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
                          <Eye size={14} /> View
                        </button>
                      )}
                    </div>
                  </td>
                </motion.tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PayrollEmployeeView() {
  const { data: payslipsRes, isLoading } = useGetMyPayslipsQuery();
  const payslips = payslipsRes?.data || [];

  return (
    <div className="page-container">
      <h1 className="text-2xl font-display font-bold text-gray-900 mb-6">My Payslips</h1>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="layer-card p-4 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : payslips.length === 0 ? (
        <div className="layer-card p-12 text-center">
          <DollarSign size={40} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm text-gray-400">No payslips available yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {payslips.map((slip: any) => (
            <motion.div
              key={slip.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="layer-card p-5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-800">
                    {MONTH_NAMES[(slip.payrollRun?.month || 1) - 1]} {slip.payrollRun?.year}
                  </p>
                  <div className="flex gap-6 mt-2 text-sm">
                    <div>
                      <span className="text-gray-400">Gross: </span>
                      <span className="font-mono text-gray-600" data-mono>{formatCurrency(Number(slip.grossSalary))}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Deductions: </span>
                      <span className="font-mono text-red-500" data-mono>
                        {formatCurrency(
                          Number(slip.epfEmployee || 0) + Number(slip.esiEmployee || 0) +
                          Number(slip.professionalTax || 0) + Number(slip.tds || 0) +
                          Number(slip.lopDeduction || 0)
                        )}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400">Net: </span>
                      <span className="font-mono font-semibold text-emerald-600" data-mono>
                        {formatCurrency(Number(slip.netSalary))}
                      </span>
                    </div>
                  </div>
                  {slip.lopDays > 0 && (
                    <p className="text-xs text-red-400 mt-1">LOP: {slip.lopDays} days</p>
                  )}
                </div>
                <button
                  onClick={() => window.open(`/api/payroll/records/${slip.id}/pdf`, '_blank')}
                  className="btn-secondary flex items-center gap-1.5 text-sm"
                >
                  <Download size={14} />
                  PDF
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
