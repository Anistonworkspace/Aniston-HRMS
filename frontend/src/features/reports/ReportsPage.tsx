import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart3, Users, Calendar, DollarSign, Briefcase, PieChart,
  FileSpreadsheet, Loader2, ShieldCheck, Download, ChevronDown,
} from 'lucide-react';
import { useGetHeadcountQuery, useGetAttendanceSummaryQuery, useGetPayrollSummaryQuery, useGetRecruitmentFunnelQuery } from './reportApi';
import { useGetPayrollRunsQuery } from '../payroll/payrollApi';
import { formatCurrency } from '../../lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart as RPieChart, Pie, Cell } from 'recharts';
import { useAuthDownload } from '../../hooks/useAuthDownload';
import toast from 'react-hot-toast';

const COLORS = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#64748b'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

// Generate last 5 financial year options from current date
function getFinancialYears(): string[] {
  const now = new Date();
  const curMonth = now.getMonth() + 1; // 1-based
  // FY starts April. If current month >= April, FY start is current year; else previous year.
  const fyStart = curMonth >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  return Array.from({ length: 5 }, (_, i) => {
    const s = fyStart - i;
    return `${s}-${String(s + 1).slice(2)}`;
  });
}

export default function ReportsPage() {
  const { data: headcountRes, isLoading: headcountLoading, isError: headcountError } = useGetHeadcountQuery();
  const { data: attendanceRes, isLoading: attendanceLoading } = useGetAttendanceSummaryQuery({});
  const { data: payrollRes, isLoading: payrollLoading } = useGetPayrollSummaryQuery();
  const { data: recruitRes, isLoading: recruitLoading } = useGetRecruitmentFunnelQuery();
  const { data: runsRes } = useGetPayrollRunsQuery();
  const { download: authDownload, downloading } = useAuthDownload();

  // Statutory compliance state
  const [epfRunId, setEpfRunId] = useState('');
  const [esiRunId, setEsiRunId] = useState('');
  const [form24qFY, setForm24qFY] = useState(getFinancialYears()[0]);
  const [form24qQ, setForm24qQ] = useState('Q1');

  const isLoading = headcountLoading || attendanceLoading || payrollLoading || recruitLoading;

  if (isLoading) {
    return (
      <div className="page-container flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
          <p className="text-sm text-gray-400">Loading reports...</p>
        </div>
      </div>
    );
  }

  if (headcountError) {
    return (
      <div className="page-container">
        <div className="layer-card p-8 text-center">
          <p className="text-red-500">Failed to load reports. Please try again.</p>
        </div>
      </div>
    );
  }

  const headcount = headcountRes?.data;
  const attendance = attendanceRes?.data;
  const payroll = payrollRes?.data;
  const recruit = recruitRes?.data;

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-display font-bold text-gray-900">Reports & Analytics</h1>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => authDownload('/reports/headcount?format=xlsx', 'employee-directory.xlsx')}
          disabled={!!downloading}
          className="btn-secondary flex items-center gap-2 text-sm"
        >
          {downloading ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
          Export Excel
        </motion.button>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="stat-card">
          <Users size={20} className="text-brand-500 mb-2" />
          <p className="text-2xl font-bold font-mono text-gray-900" data-mono>{headcount?.total || 0}</p>
          <p className="text-sm text-gray-500">Total Headcount</p>
        </div>
        <div className="stat-card">
          <Calendar size={20} className="text-emerald-500 mb-2" />
          <p className="text-2xl font-bold font-mono text-gray-900" data-mono>
            {attendance?.statusBreakdown?.find((s: any) => s.status === 'PRESENT')?.count || 0}
          </p>
          <p className="text-sm text-gray-500">Present This Month</p>
        </div>
        <div className="stat-card">
          <DollarSign size={20} className="text-blue-500 mb-2" />
          <p className="text-lg font-bold font-mono text-gray-900" data-mono>
            {payroll?.monthlyTrend?.length ? formatCurrency(payroll.monthlyTrend[payroll.monthlyTrend.length - 1].net) : '—'}
          </p>
          <p className="text-sm text-gray-500">Last Net Payroll</p>
        </div>
        <div className="stat-card">
          <Briefcase size={20} className="text-purple-500 mb-2" />
          <p className="text-2xl font-bold font-mono text-gray-900" data-mono>{recruit?.openJobs || 0}</p>
          <p className="text-sm text-gray-500">Open Positions</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Department distribution */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="layer-card p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <PieChart size={16} className="text-brand-500" /> Department Distribution
          </h2>
          {headcount?.byDepartment && headcount.byDepartment.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <RPieChart>
                <Pie
                  data={headcount.byDepartment}
                  dataKey="count"
                  nameKey="department"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={({ department, count }) => `${department}: ${count}`}
                  labelLine={false}
                >
                  {headcount.byDepartment.map((_: any, i: number) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </RPieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-gray-400 text-center py-12">No data</p>
          )}
        </motion.div>

        {/* Work mode breakdown */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="layer-card p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <BarChart3 size={16} className="text-teal-500" /> Work Mode Distribution
          </h2>
          {headcount?.byWorkMode && headcount.byWorkMode.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={headcount.byWorkMode}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="workMode" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-gray-400 text-center py-12">No data</p>
          )}
        </motion.div>

        {/* Gender breakdown */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="layer-card p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">Gender Distribution</h2>
          {headcount?.byGender && headcount.byGender.length > 0 ? (
            <div className="space-y-3">
              {headcount.byGender.map((g: any) => {
                const pct = headcount.total > 0 ? Math.round((g.count / headcount.total) * 100) : 0;
                return (
                  <div key={g.gender}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">{g.gender}</span>
                      <span className="font-mono text-gray-800" data-mono>{g.count} ({pct}%)</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className="bg-brand-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-12">No data</p>
          )}
        </motion.div>

        {/* Payroll trend */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="layer-card p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <DollarSign size={16} className="text-emerald-500" /> Payroll Trend
          </h2>
          {payroll?.monthlyTrend && payroll.monthlyTrend.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={payroll.monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 100000).toFixed(0)}L`} />
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
                <Bar dataKey="gross" fill="#93c5fd" name="Gross" radius={[4, 4, 0, 0]} />
                <Bar dataKey="net" fill="#6366f1" name="Net" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-gray-400 text-center py-12">No payroll data yet</p>
          )}
        </motion.div>

        {/* Recruitment funnel */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="layer-card p-6 lg:col-span-2">
          <h2 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Briefcase size={16} className="text-purple-500" /> Recruitment Pipeline
          </h2>
          {recruit?.pipeline && recruit.pipeline.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {recruit.pipeline.map((stage: any, i: number) => (
                <div key={stage.stage} className="text-center px-4 py-3 bg-surface-2 rounded-lg flex-1 min-w-[120px]">
                  <p className="text-lg font-bold font-mono text-gray-900" data-mono>{stage.count}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{stage.stage.replace('_', ' ')}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">No recruitment data yet</p>
          )}
        </motion.div>
      </div>

      {/* ── Statutory Compliance Exports ─────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="layer-card p-6 mt-6"
      >
        <h2 className="text-base font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <ShieldCheck size={18} className="text-indigo-500" />
          Statutory Compliance Exports
        </h2>
        <p className="text-xs text-gray-500 mb-5">
          Download government-format reports for EPF, ESI, and TDS (Form 24Q) filing.
        </p>

        <div className="grid md:grid-cols-3 gap-5">

          {/* EPF ECR Challan */}
          <div className="border border-blue-100 bg-blue-50/50 rounded-xl p-5 flex flex-col gap-3">
            <div>
              <p className="font-semibold text-blue-800 text-sm">EPF ECR Challan</p>
              <p className="text-xs text-blue-600 mt-0.5">
                Employee Contribution Register — EPFO ECR format (12% EPF/EPS)
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-gray-600">Select Payroll Run</label>
              <div className="relative">
                <select
                  value={epfRunId}
                  onChange={(e) => setEpfRunId(e.target.value)}
                  className="input-glass w-full text-sm pr-8 appearance-none"
                >
                  <option value="">— Select month —</option>
                  {(runsRes?.data || []).map((run: any) => (
                    <option key={run.id} value={run.id}>
                      {MONTHS[run.month - 1]} {run.year} ({run.status})
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              disabled={!epfRunId || downloading === `/reports/epf-challan?payrollRunId=${epfRunId}`}
              onClick={() => {
                if (!epfRunId) { toast.error('Please select a payroll run'); return; }
                const run = (runsRes?.data || []).find((r: any) => r.id === epfRunId);
                const label = run ? `${MONTHS[run.month - 1]}-${run.year}` : epfRunId;
                authDownload(`/reports/epf-challan?payrollRunId=${epfRunId}`, `EPF-ECR-${label}.xlsx`);
              }}
              className="btn-primary flex items-center justify-center gap-2 text-sm mt-auto disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {downloading === `/reports/epf-challan?payrollRunId=${epfRunId}`
                ? <Loader2 size={15} className="animate-spin" />
                : <Download size={15} />}
              Download EPF Challan
            </motion.button>
          </div>

          {/* ESI Return */}
          <div className="border border-emerald-100 bg-emerald-50/50 rounded-xl p-5 flex flex-col gap-3">
            <div>
              <p className="font-semibold text-emerald-800 text-sm">ESI Return</p>
              <p className="text-xs text-emerald-600 mt-0.5">
                ESIC contribution return — Employee 0.75% + Employer 3.25% (Gross ≤ ₹21,000)
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-gray-600">Select Payroll Run</label>
              <div className="relative">
                <select
                  value={esiRunId}
                  onChange={(e) => setEsiRunId(e.target.value)}
                  className="input-glass w-full text-sm pr-8 appearance-none"
                >
                  <option value="">— Select month —</option>
                  {(runsRes?.data || []).map((run: any) => (
                    <option key={run.id} value={run.id}>
                      {MONTHS[run.month - 1]} {run.year} ({run.status})
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              disabled={!esiRunId || downloading === `/reports/esi-return?payrollRunId=${esiRunId}`}
              onClick={() => {
                if (!esiRunId) { toast.error('Please select a payroll run'); return; }
                const run = (runsRes?.data || []).find((r: any) => r.id === esiRunId);
                const label = run ? `${MONTHS[run.month - 1]}-${run.year}` : esiRunId;
                authDownload(`/reports/esi-return?payrollRunId=${esiRunId}`, `ESI-Return-${label}.xlsx`);
              }}
              className="btn-primary flex items-center justify-center gap-2 text-sm mt-auto disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg,#059669,#047857)' }}
            >
              {downloading === `/reports/esi-return?payrollRunId=${esiRunId}`
                ? <Loader2 size={15} className="animate-spin" />
                : <Download size={15} />}
              Download ESI Return
            </motion.button>
          </div>

          {/* Form 24Q — TDS Return */}
          <div className="border border-purple-100 bg-purple-50/50 rounded-xl p-5 flex flex-col gap-3">
            <div>
              <p className="font-semibold text-purple-800 text-sm">Form 24Q (TDS Return)</p>
              <p className="text-xs text-purple-600 mt-0.5">
                Quarterly TDS summary — PAN, income, TDS deducted per employee
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-gray-600">Financial Year</label>
              <div className="relative">
                <select
                  value={form24qFY}
                  onChange={(e) => setForm24qFY(e.target.value)}
                  className="input-glass w-full text-sm pr-8 appearance-none"
                >
                  {getFinancialYears().map((fy) => (
                    <option key={fy} value={fy}>FY {fy}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-gray-600">Quarter</label>
              <div className="relative">
                <select
                  value={form24qQ}
                  onChange={(e) => setForm24qQ(e.target.value)}
                  className="input-glass w-full text-sm pr-8 appearance-none"
                >
                  {QUARTERS.map((q) => (
                    <option key={q} value={q}>
                      {q === 'Q1' ? 'Q1 (Apr–Jun)' : q === 'Q2' ? 'Q2 (Jul–Sep)' : q === 'Q3' ? 'Q3 (Oct–Dec)' : 'Q4 (Jan–Mar)'}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              disabled={downloading === `/reports/form-24q?financialYear=${form24qFY}&quarter=${form24qQ}`}
              onClick={() => {
                authDownload(
                  `/reports/form-24q?financialYear=${form24qFY}&quarter=${form24qQ}`,
                  `Form-24Q-${form24qQ}-FY${form24qFY}.xlsx`
                );
              }}
              className="btn-primary flex items-center justify-center gap-2 text-sm mt-auto disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}
            >
              {downloading === `/reports/form-24q?financialYear=${form24qFY}&quarter=${form24qQ}`
                ? <Loader2 size={15} className="animate-spin" />
                : <Download size={15} />}
              Download Form 24Q
            </motion.button>
          </div>

        </div>

        <p className="text-xs text-gray-400 mt-4">
          EPF &amp; ESI challans are derived from completed payroll runs. Form 24Q aggregates TDS from all completed runs in the selected quarter.
          Verify PAN/UAN details in employee profiles before filing.
        </p>
      </motion.div>
    </div>
  );
}
