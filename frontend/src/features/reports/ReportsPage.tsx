import { useState } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, Users, Calendar, DollarSign, Briefcase, PieChart, FileSpreadsheet, Loader2 } from 'lucide-react';
import { useGetHeadcountQuery, useGetAttendanceSummaryQuery, useGetPayrollSummaryQuery, useGetRecruitmentFunnelQuery } from './reportApi';
import { formatCurrency } from '../../lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart as RPieChart, Pie, Cell } from 'recharts';
import { useAuthDownload } from '../../hooks/useAuthDownload';

const COLORS = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#64748b'];

export default function ReportsPage() {
  const { data: headcountRes, isLoading: headcountLoading, isError: headcountError } = useGetHeadcountQuery();
  const { data: attendanceRes, isLoading: attendanceLoading } = useGetAttendanceSummaryQuery({});
  const { data: payrollRes, isLoading: payrollLoading } = useGetPayrollSummaryQuery();
  const { data: recruitRes, isLoading: recruitLoading } = useGetRecruitmentFunnelQuery();
  const { download: authDownload, downloading } = useAuthDownload();

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
    </div>
  );
}
