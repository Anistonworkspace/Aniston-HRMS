import { useState } from 'react';
import { motion } from 'framer-motion';
import { Bug, Trash2, RefreshCw, AlertTriangle, ChevronDown, ChevronUp, Smartphone, X } from 'lucide-react';
import { useGetCrashReportsQuery, useGetCrashStatsQuery, useDeleteCrashReportMutation, useClearAllCrashReportsMutation } from './crashReportApi';
import toast from 'react-hot-toast';

const TYPE_COLORS: Record<string, string> = {
  JAVA_CRASH:           'bg-red-100 text-red-700',
  NATIVE_CRASH:         'bg-red-100 text-red-700',
  JS_ERROR:             'bg-amber-100 text-amber-700',
  UNHANDLED_REJECTION:  'bg-orange-100 text-orange-700',
};

export default function CrashReportsTab() {
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const { data: reportsRes, isLoading, refetch } = useGetCrashReportsQuery({ page, limit: 50 });
  const { data: statsRes } = useGetCrashStatsQuery();
  const [deleteReport] = useDeleteCrashReportMutation();
  const [clearAll, { isLoading: clearing }] = useClearAllCrashReportsMutation();

  const reports = reportsRes?.data || [];
  const meta    = reportsRes?.meta;
  const stats   = statsRes?.data;

  const handleDelete = async (id: string) => {
    try {
      await deleteReport(id).unwrap();
      toast.success('Report deleted');
    } catch {
      toast.error('Failed to delete report');
    }
  };

  const handleClearAll = async () => {
    try {
      await clearAll().unwrap();
      toast.success('All crash reports cleared');
      setConfirmClear(false);
    } catch {
      toast.error('Failed to clear reports');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-display font-bold text-gray-900 flex items-center gap-2">
            <Bug className="w-5 h-5 text-red-500" /> App Crash Reports
          </h2>
          <p className="text-sm text-gray-400 mt-0.5">Native Android + JS error reports from the mobile app</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          {reports.length > 0 && (
            <button
              onClick={() => setConfirmClear(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600 hover:bg-red-100 transition-colors"
            >
              <Trash2 className="w-4 h-4" /> Clear All
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="layer-card p-4 text-center">
            <p className="text-2xl font-display font-bold text-gray-900" data-mono>{stats.total}</p>
            <p className="text-xs text-gray-400 mt-0.5">Total Reports</p>
          </div>
          <div className="layer-card p-4 text-center">
            <p className="text-2xl font-display font-bold text-red-600" data-mono>{stats.last24h}</p>
            <p className="text-xs text-gray-400 mt-0.5">Last 24 Hours</p>
          </div>
          <div className="layer-card p-4 text-center">
            <p className="text-2xl font-display font-bold text-amber-600" data-mono>{stats.last7d}</p>
            <p className="text-xs text-gray-400 mt-0.5">Last 7 Days</p>
          </div>
          <div className="layer-card p-4 text-center">
            <p className="text-2xl font-display font-bold text-indigo-600" data-mono>
              {stats.byType[0]?.type?.replace('_', ' ') || '—'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">Most Common</p>
          </div>
        </div>
      )}

      {/* By Type breakdown */}
      {stats?.byType && stats.byType.length > 0 && (
        <div className="layer-card p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">By Error Type</h3>
          <div className="flex flex-wrap gap-2">
            {stats.byType.map(t => (
              <span key={t.type} className={`px-3 py-1 rounded-full text-xs font-medium ${TYPE_COLORS[t.type] || 'bg-gray-100 text-gray-600'}`}>
                {t.type.replace(/_/g, ' ')} — {t._count.id}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Reports List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : reports.length === 0 ? (
        <div className="layer-card p-12 text-center">
          <Bug className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500">No crash reports</p>
          <p className="text-xs text-gray-400 mt-1">Reports from the Android app will appear here automatically</p>
        </div>
      ) : (
        <div className="space-y-2">
          {reports.map(report => (
            <motion.div
              key={report.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="layer-card overflow-hidden"
            >
              <div className="p-4 flex items-start gap-3">
                <span className={`px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 mt-0.5 ${TYPE_COLORS[report.type] || 'bg-gray-100 text-gray-600'}`}>
                  {report.type.replace(/_/g, ' ')}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{report.message}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 flex-wrap">
                    {report.employee && (
                      <span className="font-medium text-gray-600">{report.employee.user.name} ({report.employee.employeeCode})</span>
                    )}
                    <span className="flex items-center gap-1">
                      <Smartphone className="w-3 h-3" />
                      {report.device || report.platform || 'Android'}
                      {report.osVersion ? ` ${report.osVersion}` : ''}
                    </span>
                    <span>v{report.appVersion || '—'}</span>
                    <span>{new Date(report.createdAt).toLocaleString('en-IN')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {report.stack && (
                    <button
                      onClick={() => setExpanded(expanded === report.id ? null : report.id)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                      title="View stack trace"
                    >
                      {expanded === report.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(report.id)}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                    title="Delete report"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {expanded === report.id && report.stack && (
                <div className="border-t border-gray-100 bg-gray-950 p-4">
                  <pre className="text-xs text-green-400 font-mono overflow-x-auto whitespace-pre-wrap break-words max-h-64">
                    {report.stack}
                  </pre>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm disabled:opacity-40 hover:bg-gray-50 transition-colors">
            Previous
          </button>
          <span className="text-sm text-gray-500">Page {page} of {meta.totalPages}</span>
          <button disabled={page >= meta.totalPages} onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm disabled:opacity-40 hover:bg-gray-50 transition-colors">
            Next
          </button>
        </div>
      )}

      {/* Clear All Confirmation */}
      {confirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0" />
              <h3 className="font-display font-bold text-gray-900">Clear All Reports?</h3>
            </div>
            <p className="text-sm text-gray-500 mb-5">This will permanently delete all {meta?.total} crash reports. This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmClear(false)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleClearAll} disabled={clearing}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-60">
                {clearing ? 'Clearing…' : 'Clear All'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
