import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  TrendingUp, Clock, Shield, AlertTriangle, CheckCircle,
  RefreshCw, Loader2, Building2, XCircle, FileText, Calendar,
  Download, Bell,
} from 'lucide-react';
import { useTriggerKycExpiryCheckMutation, useGetKycComplianceReportQuery, useTriggerSlaCheckMutation } from './kycApi';
import { useGetKycAnalyticsQuery, useOrgBulkTriggerOcrMutation } from '../documents/documentOcrApi';
import toast from 'react-hot-toast';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

function StatCard({ icon: Icon, label, value, sub, color = 'indigo' }: {
  icon: any; label: string; value: string | number; sub?: string; color?: string;
}) {
  const colorMap: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600',
    green: 'bg-green-50 text-green-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600',
  };
  return (
    <div className="layer-card p-5 flex items-start gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colorMap[color] ?? colorMap.indigo}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-2xl font-bold font-mono text-slate-800">{value}</p>
        <p className="text-sm font-medium text-slate-700 mt-0.5">{label}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function KycAnalyticsPage() {
  const { data: analyticsRes, isLoading, refetch } = useGetKycAnalyticsQuery();
  const [triggerExpiry, { isLoading: checkingExpiry }] = useTriggerKycExpiryCheckMutation();
  const [orgBulkTrigger, { isLoading: bulkScanning }] = useOrgBulkTriggerOcrMutation();
  const [triggerSla, { isLoading: checkingSla }] = useTriggerSlaCheckMutation();
  const [showComplianceModal, setShowComplianceModal] = useState(false);
  const { data: complianceRes, isLoading: loadingCompliance, refetch: refetchCompliance } = useGetKycComplianceReportQuery(undefined, {
    skip: !showComplianceModal,
  });
  const [activeTab, setActiveTab] = useState<'overview' | 'departments' | 'documents'>('overview');

  const d = analyticsRes?.data;

  const handleExpiryCheck = async () => {
    try {
      const res = await triggerExpiry().unwrap();
      const expired = res.data?.expired ?? 0;
      toast.success(expired > 0
        ? `${expired} employee(s) moved to Re-upload Required — KYC expired`
        : 'No expired KYC found');
      refetch();
    } catch { toast.error('Expiry check failed'); }
  };

  const handleSlaCheck = async () => {
    try {
      const res = await triggerSla().unwrap();
      const escalated = res.data?.escalated ?? 0;
      toast.success(escalated > 0
        ? `Escalated ${escalated} employee(s) to HR supervisor`
        : 'No SLA breaches found');
    } catch { toast.error('SLA check failed'); }
  };

  const handleOrgBulkScan = async () => {
    try {
      const res = await orgBulkTrigger().unwrap();
      const { queued, employees } = res.data;
      toast.success(`Queued ${queued} documents across ${employees} employees for re-scan`);
    } catch (err: any) {
      const msg = err?.data?.error?.message || 'Failed to start bulk scan';
      toast.error(msg);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  const ocrStatusData = d?.ocrStatusCounts ? Object.entries(d.ocrStatusCounts).map(([name, value]) => ({ name, value })) : [];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 font-sora">KYC Analytics</h1>
          <p className="text-slate-500 text-sm mt-1">Org-wide KYC compliance, scan quality, and turnaround tracking</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => { setShowComplianceModal(true); refetchCompliance?.(); }}
            className="flex items-center gap-2 px-4 py-2 bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-sm font-medium hover:bg-slate-100 transition-colors"
          >
            <Download className="w-4 h-4" />
            Export Compliance Report
          </button>
          <button
            onClick={handleSlaCheck}
            disabled={checkingSla}
            className="flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 border border-purple-200 rounded-xl text-sm font-medium hover:bg-purple-100 transition-colors disabled:opacity-50"
          >
            {checkingSla ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
            Check SLA Escalations
          </button>
          <button
            onClick={handleOrgBulkScan}
            disabled={bulkScanning}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-xl text-sm font-medium hover:bg-indigo-100 transition-colors disabled:opacity-50"
          >
            {bulkScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Re-scan All Pending
          </button>
          <button
            onClick={handleExpiryCheck}
            disabled={checkingExpiry}
            className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl text-sm font-medium hover:bg-amber-100 transition-colors disabled:opacity-50"
          >
            {checkingExpiry ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
            Check KYC Expiry
          </button>
          <button onClick={() => refetch()} className="btn-secondary text-sm">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* KYC Expiry Alert */}
      {d?.kycExpiry?.next30Days > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-5 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3"
        >
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-800 text-sm">
              {d.kycExpiry.next30Days} employee{d.kycExpiry.next30Days > 1 ? 's' : ''} KYC expiring within 30 days
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              {d.kycExpiry.next60Days} more in 30–60 days · {d.kycExpiry.next90Days} more in 60–90 days.
              Run "Check KYC Expiry" to move expired employees to re-upload queue.
            </p>
          </div>
        </motion.div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={Clock}
          label="Avg Turnaround"
          value={d?.avgTurnaroundHours != null ? `${d.avgTurnaroundHours}h` : '—'}
          sub="Submission → Verification"
          color="indigo"
        />
        <StatCard
          icon={CheckCircle}
          label="Expiring ≤30 Days"
          value={d?.kycExpiry?.next30Days ?? 0}
          sub="Verified KYC approaching expiry"
          color={d?.kycExpiry?.next30Days > 0 ? 'red' : 'green'}
        />
        <StatCard
          icon={Shield}
          label="Flagged OCR Docs"
          value={d?.ocrStatusCounts?.['FLAGGED'] ?? 0}
          sub="Needs HR manual review"
          color="amber"
        />
        <StatCard
          icon={FileText}
          label="Verified OCR Docs"
          value={d?.ocrStatusCounts?.['VERIFIED'] ?? 0}
          sub="Auto-verified by AI"
          color="green"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-slate-100 p-1 rounded-xl w-fit">
        {(['overview', 'departments', 'documents'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${
              activeTab === tab ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Weekly Trend */}
          <div className="layer-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-indigo-600" />
              <h3 className="font-semibold text-slate-800 text-sm">Weekly KYC Trend</h3>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={d?.weeklyTrend ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="approved" stroke="#10b981" strokeWidth={2} name="Approved" dot={false} />
                <Line type="monotone" dataKey="submitted" stroke="#6366f1" strokeWidth={2} name="Submitted" dot={false} />
                <Line type="monotone" dataKey="rejected" stroke="#ef4444" strokeWidth={1.5} name="Rejected" dot={false} strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* OCR Status Distribution */}
          <div className="layer-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-4 h-4 text-indigo-600" />
              <h3 className="font-semibold text-slate-800 text-sm">OCR Status Distribution</h3>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={ocrStatusData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} dataKey="value" nameKey="name" label={({ name, percent }) => `${name} ${Math.round(percent * 100)}%`} labelLine={false}>
                  {ocrStatusData.map((_entry, index) => (
                    <Cell key={index} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {activeTab === 'departments' && (
        <div className="layer-card overflow-x-auto">
          <div className="p-4 border-b border-slate-100 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-indigo-600" />
            <h3 className="font-semibold text-slate-800 text-sm">Department KYC Compliance</h3>
          </div>
          <table className="min-w-full">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="text-left text-xs font-semibold text-slate-500 uppercase px-4 py-3">Department</th>
                <th className="text-right text-xs font-semibold text-slate-500 uppercase px-4 py-3">Total</th>
                <th className="text-right text-xs font-semibold text-slate-500 uppercase px-4 py-3">Verified</th>
                <th className="text-right text-xs font-semibold text-slate-500 uppercase px-4 py-3">Pending</th>
                <th className="text-right text-xs font-semibold text-slate-500 uppercase px-4 py-3">Rejected</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase px-4 py-3">Compliance</th>
              </tr>
            </thead>
            <tbody>
              {(d?.deptCompliance ?? []).map((row: any) => (
                <tr key={row.dept} className="border-b border-slate-50 hover:bg-slate-50/50">
                  <td className="px-4 py-3 text-sm font-medium text-slate-800">{row.dept}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 text-right font-mono">{row.total}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-mono text-green-700">{row.verified}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-mono text-amber-700">{row.pending}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-mono text-red-700">{row.rejected}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${row.compliancePct >= 80 ? 'bg-green-500' : row.compliancePct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                          style={{ width: `${row.compliancePct}%` }}
                        />
                      </div>
                      <span className={`text-xs font-bold font-mono ${row.compliancePct >= 80 ? 'text-green-700' : row.compliancePct >= 50 ? 'text-amber-700' : 'text-red-700'}`}>
                        {row.compliancePct}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(!d?.deptCompliance || d.deptCompliance.length === 0) && (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">No department data</div>
          )}
        </div>
      )}

      {/* Compliance Report Modal */}
      <AnimatePresence>
        {showComplianceModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white rounded-t-2xl">
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-indigo-600" />
                  <h2 className="text-lg font-bold text-slate-900">KYC Compliance Report</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => window.print()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-sm font-medium hover:bg-indigo-100 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download PDF
                  </button>
                  <button onClick={() => setShowComplianceModal(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-lg">&times;</button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {loadingCompliance ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                  </div>
                ) : (() => {
                  const cr = complianceRes?.data;
                  if (!cr) return (
                    <div className="text-center py-12 text-slate-400">
                      <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
                      <p className="text-sm">No compliance data available</p>
                    </div>
                  );
                  return (
                    <>
                      {/* Summary metrics */}
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Summary</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {[
                            { label: 'Total Employees', value: cr.total ?? 0 },
                            { label: 'KYC Verified', value: cr.verified ?? 0 },
                            { label: 'Pending Review', value: cr.pending ?? 0 },
                            { label: 'Compliance %', value: `${cr.compliancePct ?? 0}%` },
                          ].map(({ label, value }) => (
                            <div key={label} className="bg-slate-50 rounded-lg p-3 text-center border border-slate-100">
                              <p className="text-xl font-bold font-mono text-slate-800">{value}</p>
                              <p className="text-xs text-slate-500 mt-0.5">{label}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Department compliance table */}
                      {cr.departments && cr.departments.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Department Compliance</p>
                          <table className="min-w-full border border-slate-200 rounded-lg overflow-hidden text-sm">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-200">
                                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500 uppercase">Department</th>
                                <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500 uppercase">Total</th>
                                <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500 uppercase">Verified</th>
                                <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500 uppercase">Compliance</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cr.departments.map((dept: any) => (
                                <tr key={dept.name} className="border-b border-slate-100 hover:bg-slate-50">
                                  <td className="px-4 py-2 font-medium text-slate-700">{dept.name}</td>
                                  <td className="px-4 py-2 text-right font-mono text-slate-600">{dept.total}</td>
                                  <td className="px-4 py-2 text-right font-mono text-green-700">{dept.verified}</td>
                                  <td className="px-4 py-2 text-right">
                                    <span className={`font-bold font-mono ${(dept.compliancePct ?? 0) >= 80 ? 'text-green-700' : (dept.compliancePct ?? 0) >= 50 ? 'text-amber-700' : 'text-red-700'}`}>
                                      {dept.compliancePct ?? 0}%
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* SLA breaches table */}
                      {cr.slaBreaches && cr.slaBreaches.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                            SLA Breaches ({cr.slaBreaches.length})
                          </p>
                          <table className="min-w-full border border-red-200 rounded-lg overflow-hidden text-sm">
                            <thead>
                              <tr className="bg-red-50 border-b border-red-200">
                                <th className="text-left px-4 py-2 text-xs font-semibold text-red-700 uppercase">Employee</th>
                                <th className="text-left px-4 py-2 text-xs font-semibold text-red-700 uppercase">Status</th>
                                <th className="text-right px-4 py-2 text-xs font-semibold text-red-700 uppercase">Waiting</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cr.slaBreaches.map((breach: any, i: number) => (
                                <tr key={i} className="border-b border-red-100 hover:bg-red-50">
                                  <td className="px-4 py-2 text-slate-700 font-medium">{breach.name || breach.employeeName || '—'}</td>
                                  <td className="px-4 py-2 text-slate-500">{breach.status || breach.kycStatus || '—'}</td>
                                  <td className="px-4 py-2 text-right text-red-600 font-mono font-semibold">{breach.hoursWaiting ?? '?'}h</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {(!cr.departments || cr.departments.length === 0) && (!cr.slaBreaches || cr.slaBreaches.length === 0) && (
                        <p className="text-sm text-slate-400 text-center py-4">Detailed breakdown not available — compliance summary shown above.</p>
                      )}
                    </>
                  );
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {activeTab === 'documents' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Flagged document types */}
          <div className="layer-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <XCircle className="w-4 h-4 text-red-500" />
              <h3 className="font-semibold text-slate-800 text-sm">Most Flagged Document Types</h3>
            </div>
            {(d?.flaggedDocTypes ?? []).length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={d.flaggedDocTypes} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="type" tick={{ fontSize: 10 }} width={110} tickFormatter={(v: string) => v.replace(/_/g, ' ')} />
                  <Tooltip formatter={(v: number) => [`${v} docs`, 'Flagged']} labelFormatter={(v: string) => v.replace(/_/g, ' ')} />
                  <Bar dataKey="count" fill="#ef4444" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-32 text-slate-400 text-sm">No flagged documents</div>
            )}
          </div>

          {/* KYC Expiry Timeline */}
          <div className="layer-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="w-4 h-4 text-amber-600" />
              <h3 className="font-semibold text-slate-800 text-sm">KYC Expiry Forecast</h3>
            </div>
            <div className="space-y-3">
              {[
                { label: 'Expiring in 0–30 days', value: d?.kycExpiry?.next30Days ?? 0, color: 'bg-red-500', bg: 'bg-red-50 border-red-200 text-red-800' },
                { label: 'Expiring in 31–60 days', value: d?.kycExpiry?.next60Days ?? 0, color: 'bg-amber-500', bg: 'bg-amber-50 border-amber-200 text-amber-800' },
                { label: 'Expiring in 61–90 days', value: d?.kycExpiry?.next90Days ?? 0, color: 'bg-yellow-400', bg: 'bg-yellow-50 border-yellow-200 text-yellow-800' },
              ].map(row => (
                <div key={row.label} className={`p-3 rounded-xl border ${row.bg} flex items-center justify-between`}>
                  <span className="text-sm font-medium">{row.label}</span>
                  <span className="text-xl font-bold font-mono">{row.value}</span>
                </div>
              ))}
              <p className="text-xs text-slate-400 mt-2">
                Run "Check KYC Expiry" to move expired employees back to the re-upload queue automatically.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
