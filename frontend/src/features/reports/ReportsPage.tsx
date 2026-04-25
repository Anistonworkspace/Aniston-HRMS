import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays, Users, Briefcase, FileSpreadsheet, Loader2, Download,
  Search, X, ChevronLeft, ChevronRight, Filter, TrendingUp, UserCheck,
  Clock, AlertCircle, CheckCircle2, XCircle, UserMinus,
} from 'lucide-react';
import { useGetAttendanceDetailQuery, useGetLeaveDetailQuery, useGetHeadcountQuery, useGetRecruitmentFunnelQuery } from './reportApi';
import { useGetDepartmentsQuery } from '../employee/employeeDepsApi';
import { useAuthDownload } from '../../hooks/useAuthDownload';
import { PieChart as RPieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const COLORS = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#64748b'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STATUS_COLORS: Record<string, string> = {
  PRESENT: 'bg-emerald-100 text-emerald-700',
  ABSENT: 'bg-red-100 text-red-700',
  HALF_DAY: 'bg-blue-100 text-blue-700',
  HOLIDAY: 'bg-purple-100 text-purple-700',
  WEEKEND: 'bg-gray-100 text-gray-500',
  ON_LEAVE: 'bg-indigo-100 text-indigo-700',
  WORK_FROM_HOME: 'bg-teal-100 text-teal-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  PENDING: 'bg-amber-100 text-amber-700',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-600',
};

type Tab = 'attendance' | 'leave' | 'headcount' | 'recruitment';

// ── Full-screen detail modal ─────────────────────────────────────────────────
interface DetailModalProps {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}

function DetailModal({ title, isOpen, onClose, children }: DetailModalProps) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="overflow-auto flex-1 p-6">{children}</div>
      </motion.div>
    </div>
  );
}

// ── Attendance Tab ────────────────────────────────────────────────────────────
function AttendanceTab() {
  const today = new Date();
  const [from, setFrom] = useState(() => {
    const d = new Date(today.getFullYear(), today.getMonth(), 1);
    return d.toISOString().split('T')[0];
  });
  const [to, setTo] = useState(() => today.toISOString().split('T')[0]);
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPage, setModalPage] = useState(1);

  const { data: deptRes } = useGetDepartmentsQuery();
  const { download: authDownload, downloading } = useAuthDownload();

  const previewParams = { from, to, departmentId: deptFilter || undefined, status: statusFilter || undefined, page: 1, limit: 10 };
  const modalParams = { from, to, departmentId: deptFilter || undefined, status: statusFilter || undefined, page: modalPage, limit: 50 };

  const { data: previewRes, isLoading: previewLoading } = useGetAttendanceDetailQuery(previewParams);
  const { data: modalRes, isLoading: modalLoading } = useGetAttendanceDetailQuery(modalParams, { skip: !modalOpen });

  const summary = previewRes?.data?.summary;
  const previewRecords = previewRes?.data?.records || [];
  const modalRecords = modalRes?.data?.records || [];
  const modalMeta = modalRes?.data?.meta;

  function handleExport() {
    const p = new URLSearchParams({ from, to, ...(deptFilter && { departmentId: deptFilter }), ...(statusFilter && { status: statusFilter }), format: 'xlsx' });
    authDownload(`/reports/attendance-detail?${p.toString()}`, `Attendance-Report-${from}-to-${to}.xlsx`);
  }

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input-glass text-sm px-3 py-2" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input-glass text-sm px-3 py-2" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Department</label>
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="input-glass text-sm px-3 py-2 min-w-[160px]">
            <option value="">All Departments</option>
            {(deptRes?.data || []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-glass text-sm px-3 py-2 min-w-[130px]">
            <option value="">All Statuses</option>
            {['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'HOLIDAY', 'LEAVE'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </div>
        <button onClick={handleExport} disabled={!!downloading} className="flex items-center gap-2 text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50 mt-auto">
          {downloading ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
          Export Excel
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Present', value: summary?.present || 0, color: 'text-emerald-600', bg: 'bg-emerald-50', icon: UserCheck },
          { label: 'Absent', value: summary?.absent || 0, color: 'text-red-600', bg: 'bg-red-50', icon: UserMinus },
          { label: 'Half Day', value: summary?.halfDay || 0, color: 'text-amber-600', bg: 'bg-amber-50', icon: Clock },
          { label: 'On Leave', value: summary?.onLeave || 0, color: 'text-blue-600', bg: 'bg-blue-50', icon: AlertCircle },
        ].map(({ label, value, color, bg, icon: Icon }) => (
          <div key={label} className={`${bg} rounded-xl p-4 flex items-center gap-3`}>
            <Icon size={18} className={color} />
            <div>
              <p className={`text-xl font-bold font-mono ${color}`} data-mono>{value}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Preview table */}
      <div className="layer-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-800">Preview (last 10 records)</p>
          <button onClick={() => setModalOpen(true)} className="text-xs text-brand-600 hover:text-brand-700 font-medium transition-colors">
            View Full Report →
          </button>
        </div>
        {previewLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 size={20} className="animate-spin text-brand-500" /></div>
        ) : previewRecords.length === 0 ? (
          <div className="text-center py-10 text-sm text-gray-400">No records found for the selected period</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                <tr>
                  {['Employee', 'Department', 'Date', 'Status', 'Check-in', 'Check-out', 'Hours'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {previewRecords.map((r: any) => (
                  <tr key={r.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{r.employeeName}<span className="ml-1.5 text-xs text-gray-400 font-mono" data-mono>{r.employeeCode}</span></td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.department}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap font-mono text-xs" data-mono>{new Date(r.date).toLocaleDateString('en-IN')}</td>
                    <td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-600'}`}>{r.status.replace('_', ' ')}</span></td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs" data-mono>{r.checkIn ? new Date(r.checkIn).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs" data-mono>{r.checkOut ? new Date(r.checkOut).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs" data-mono>{r.totalHours != null ? `${Number(r.totalHours).toFixed(1)}h` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Full report modal */}
      <DetailModal title={`Attendance Report: ${from} to ${to}`} isOpen={modalOpen} onClose={() => { setModalOpen(false); setModalPage(1); }}>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">Total records: <span className="font-semibold text-gray-800">{modalMeta?.total || 0}</span></p>
            <button onClick={handleExport} disabled={!!downloading} className="flex items-center gap-1.5 text-xs font-medium bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-50">
              {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              Export All
            </button>
          </div>
          {modalLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-brand-500" /></div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                    <tr>
                      {['#', 'Employee', 'Department', 'Designation', 'Date', 'Status', 'Check-in', 'Check-out', 'Hours'].map((h) => (
                        <th key={h} className="px-4 py-3 text-left whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {modalRecords.map((r: any, idx: number) => (
                      <tr key={r.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-2.5 text-xs text-gray-400 font-mono" data-mono>{(modalPage - 1) * 50 + idx + 1}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">{r.employeeName}<span className="ml-1.5 text-xs text-gray-400 font-mono" data-mono>{r.employeeCode}</span></td>
                        <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{r.department}</td>
                        <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap text-xs">{r.designation || '—'}</td>
                        <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap font-mono text-xs" data-mono>{new Date(r.date).toLocaleDateString('en-IN')}</td>
                        <td className="px-4 py-2.5"><span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-600'}`}>{r.status.replace('_', ' ')}</span></td>
                        <td className="px-4 py-2.5 text-gray-600 font-mono text-xs" data-mono>{r.checkIn ? new Date(r.checkIn).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                        <td className="px-4 py-2.5 text-gray-600 font-mono text-xs" data-mono>{r.checkOut ? new Date(r.checkOut).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                        <td className="px-4 py-2.5 text-gray-600 font-mono text-xs" data-mono>{r.totalHours != null ? `${Number(r.totalHours).toFixed(1)}h` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Pagination */}
              {modalMeta && modalMeta.totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <p className="text-xs text-gray-500">Page {modalPage} of {modalMeta.totalPages}</p>
                  <div className="flex gap-2">
                    <button disabled={modalPage === 1} onClick={() => setModalPage((p) => p - 1)} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors">
                      <ChevronLeft size={13} /> Prev
                    </button>
                    <button disabled={modalPage >= modalMeta.totalPages} onClick={() => setModalPage((p) => p + 1)} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors">
                      Next <ChevronRight size={13} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DetailModal>
    </div>
  );
}

// ── Leave Tab ─────────────────────────────────────────────────────────────────
function LeaveTab() {
  const curYear = new Date().getFullYear();
  const [year, setYear] = useState(curYear);
  const [month, setMonth] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPage, setModalPage] = useState(1);

  const { data: deptRes } = useGetDepartmentsQuery();
  const { download: authDownload, downloading } = useAuthDownload();

  const params = {
    year,
    ...(month !== null && { month }),
    ...(status && { status }),
    ...(deptFilter && { departmentId: deptFilter }),
  };

  const { data: previewRes, isLoading: previewLoading } = useGetLeaveDetailQuery({ ...params, page: 1, limit: 10 });
  const { data: modalRes, isLoading: modalLoading } = useGetLeaveDetailQuery({ ...params, page: modalPage, limit: 50 }, { skip: !modalOpen });

  const summary = previewRes?.data?.summary;
  const previewRecords = previewRes?.data?.records || [];
  const modalRecords = modalRes?.data?.records || [];
  const modalMeta = modalRes?.data?.meta;
  const leaveTypes = previewRes?.data?.leaveTypes || [];

  function handleExport() {
    const p = new URLSearchParams({
      year: String(year),
      ...(month !== null && { month: String(month) }),
      ...(status && { status }),
      ...(deptFilter && { departmentId: deptFilter }),
      format: 'xlsx',
    });
    authDownload(`/reports/leave-detail?${p.toString()}`, `Leave-Report-${year}${month !== null ? `-${MONTHS[month - 1]}` : ''}.xlsx`);
  }

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Year</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="input-glass text-sm px-3 py-2">
            {[curYear, curYear - 1, curYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Month</label>
          <select value={month ?? ''} onChange={(e) => setMonth(e.target.value === '' ? null : Number(e.target.value))} className="input-glass text-sm px-3 py-2 min-w-[130px]">
            <option value="">All Months</option>
            {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Department</label>
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="input-glass text-sm px-3 py-2 min-w-[160px]">
            <option value="">All Departments</option>
            {(deptRes?.data || []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input-glass text-sm px-3 py-2 min-w-[130px]">
            <option value="">All Statuses</option>
            {['APPROVED', 'PENDING', 'REJECTED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button onClick={handleExport} disabled={!!downloading} className="flex items-center gap-2 text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50 mt-auto">
          {downloading ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
          Export Excel
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Requests', value: summary?.total || 0, color: 'text-gray-700', bg: 'bg-gray-50', icon: CalendarDays },
          { label: 'Approved', value: summary?.approved || 0, color: 'text-emerald-600', bg: 'bg-emerald-50', icon: CheckCircle2 },
          { label: 'Pending', value: summary?.pending || 0, color: 'text-amber-600', bg: 'bg-amber-50', icon: Clock },
          { label: 'Rejected', value: summary?.rejected || 0, color: 'text-red-600', bg: 'bg-red-50', icon: XCircle },
        ].map(({ label, value, color, bg, icon: Icon }) => (
          <div key={label} className={`${bg} rounded-xl p-4 flex items-center gap-3`}>
            <Icon size={18} className={color} />
            <div>
              <p className={`text-xl font-bold font-mono ${color}`} data-mono>{value}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Leave type breakdown chips */}
      {leaveTypes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {leaveTypes.map((lt: any) => (
            <span key={lt.id} className="text-xs bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full font-medium">{lt.name}</span>
          ))}
        </div>
      )}

      {/* Preview table */}
      <div className="layer-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-800">Preview (last 10 records)</p>
          <button onClick={() => setModalOpen(true)} className="text-xs text-brand-600 hover:text-brand-700 font-medium transition-colors">
            View Full Report →
          </button>
        </div>
        {previewLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 size={20} className="animate-spin text-brand-500" /></div>
        ) : previewRecords.length === 0 ? (
          <div className="text-center py-10 text-sm text-gray-400">No leave records found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                <tr>
                  {['Employee', 'Department', 'Leave Type', 'From', 'To', 'Days', 'Status'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {previewRecords.map((r: any) => (
                  <tr key={r.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{r.employeeName}<span className="ml-1.5 text-xs text-gray-400 font-mono" data-mono>{r.employeeCode}</span></td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.department}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.leaveType}</td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs" data-mono>{new Date(r.startDate).toLocaleDateString('en-IN')}</td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs" data-mono>{new Date(r.endDate).toLocaleDateString('en-IN')}</td>
                    <td className="px-4 py-3 text-gray-700 font-mono text-xs font-semibold" data-mono>{r.days}</td>
                    <td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-600'}`}>{r.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Full report modal */}
      <DetailModal title={`Leave Report: ${year}${month !== null ? ` — ${MONTHS[month - 1]}` : ''}`} isOpen={modalOpen} onClose={() => { setModalOpen(false); setModalPage(1); }}>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">Total records: <span className="font-semibold text-gray-800">{modalMeta?.total || 0}</span></p>
            <button onClick={handleExport} disabled={!!downloading} className="flex items-center gap-1.5 text-xs font-medium bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-50">
              {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              Export All
            </button>
          </div>
          {modalLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-brand-500" /></div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                    <tr>
                      {['#', 'Employee', 'Department', 'Leave Type', 'From', 'To', 'Days', 'Status', 'Reason'].map((h) => (
                        <th key={h} className="px-4 py-3 text-left whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {modalRecords.map((r: any, idx: number) => (
                      <tr key={r.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-2.5 text-xs text-gray-400 font-mono" data-mono>{(modalPage - 1) * 50 + idx + 1}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">{r.employeeName}<span className="ml-1.5 text-xs text-gray-400 font-mono" data-mono>{r.employeeCode}</span></td>
                        <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{r.department}</td>
                        <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{r.leaveType}</td>
                        <td className="px-4 py-2.5 text-gray-600 font-mono text-xs" data-mono>{new Date(r.startDate).toLocaleDateString('en-IN')}</td>
                        <td className="px-4 py-2.5 text-gray-600 font-mono text-xs" data-mono>{new Date(r.endDate).toLocaleDateString('en-IN')}</td>
                        <td className="px-4 py-2.5 text-gray-700 font-mono text-xs font-semibold" data-mono>{r.days}</td>
                        <td className="px-4 py-2.5"><span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-600'}`}>{r.status}</span></td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs max-w-[200px] truncate">{r.reason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {modalMeta && modalMeta.totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <p className="text-xs text-gray-500">Page {modalPage} of {modalMeta.totalPages}</p>
                  <div className="flex gap-2">
                    <button disabled={modalPage === 1} onClick={() => setModalPage((p) => p - 1)} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors">
                      <ChevronLeft size={13} /> Prev
                    </button>
                    <button disabled={modalPage >= modalMeta.totalPages} onClick={() => setModalPage((p) => p + 1)} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors">
                      Next <ChevronRight size={13} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DetailModal>
    </div>
  );
}

// ── Headcount Tab ─────────────────────────────────────────────────────────────
function HeadcountTab() {
  const { data: headcountRes, isLoading } = useGetHeadcountQuery();
  const { download: authDownload, downloading } = useAuthDownload();
  const headcount = headcountRes?.data;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
          {[
            { label: 'Total Employees', value: headcount?.total || 0, color: 'text-brand-600', bg: 'bg-brand-50', icon: Users },
            { label: 'Active', value: headcount?.byStatus?.find((s: any) => s.status === 'ACTIVE')?.count || 0, color: 'text-emerald-600', bg: 'bg-emerald-50', icon: CheckCircle2 },
            { label: 'On Probation', value: headcount?.byStatus?.find((s: any) => s.status === 'PROBATION')?.count || 0, color: 'text-amber-600', bg: 'bg-amber-50', icon: Clock },
            { label: 'Departments', value: headcount?.byDepartment?.length || 0, color: 'text-indigo-600', bg: 'bg-indigo-50', icon: Filter },
          ].map(({ label, value, color, bg, icon: Icon }) => (
            <div key={label} className={`${bg} rounded-xl p-4 flex items-center gap-3`}>
              <Icon size={18} className={color} />
              <div>
                <p className={`text-xl font-bold font-mono ${color}`} data-mono>{value}</p>
                <p className="text-xs text-gray-500">{label}</p>
              </div>
            </div>
          ))}
        </div>
        <button onClick={() => authDownload('/reports/headcount?format=xlsx', 'employee-directory.xlsx')} disabled={!!downloading} className="flex items-center gap-2 text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50 ml-4 shrink-0">
          {downloading ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
          Export Directory
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-brand-500" /></div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-5">
          {/* Department distribution */}
          <div className="layer-card p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">Department Distribution</h3>
            {headcount?.byDepartment?.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <RPieChart>
                  <Pie data={headcount.byDepartment} dataKey="count" nameKey="department" cx="50%" cy="50%" outerRadius={80} label={({ department, count }: any) => `${department}: ${count}`} labelLine={false}>
                    {headcount.byDepartment.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </RPieChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-gray-400 text-center py-12">No data</p>}
          </div>

          {/* Status breakdown */}
          <div className="layer-card p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">Employee Status</h3>
            {headcount?.byStatus?.length > 0 ? (
              <div className="space-y-3">
                {headcount.byStatus.map((s: any) => {
                  const pct = headcount.total > 0 ? Math.round((s.count / headcount.total) * 100) : 0;
                  return (
                    <div key={s.status}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">{s.status}</span>
                        <span className="font-mono text-gray-800 text-xs" data-mono>{s.count} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div className="bg-brand-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-sm text-gray-400 text-center py-12">No data</p>}
          </div>

          {/* Work mode */}
          <div className="layer-card p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">Work Mode</h3>
            {headcount?.byWorkMode?.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={headcount.byWorkMode}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="workMode" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-gray-400 text-center py-8">No data</p>}
          </div>

          {/* Gender breakdown */}
          <div className="layer-card p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">Gender Distribution</h3>
            {headcount?.byGender?.length > 0 ? (
              <div className="space-y-3">
                {headcount.byGender.map((g: any) => {
                  const pct = headcount.total > 0 ? Math.round((g.count / headcount.total) * 100) : 0;
                  return (
                    <div key={g.gender}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">{g.gender || 'Not specified'}</span>
                        <span className="font-mono text-gray-800 text-xs" data-mono>{g.count} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div className="bg-purple-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-sm text-gray-400 text-center py-12">No data</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Recruitment Tab ───────────────────────────────────────────────────────────
function RecruitmentTab() {
  const { data: recruitRes, isLoading } = useGetRecruitmentFunnelQuery();
  const recruit = recruitRes?.data;

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Open Positions', value: recruit?.openJobs || 0, color: 'text-brand-600', bg: 'bg-brand-50' },
          { label: 'Total Applications', value: recruit?.totalApplications || 0, color: 'text-indigo-600', bg: 'bg-indigo-50' },
          { label: 'Pipeline Stages', value: recruit?.pipeline?.length || 0, color: 'text-purple-600', bg: 'bg-purple-50' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className={`${bg} rounded-xl p-4`}>
            <p className={`text-2xl font-bold font-mono ${color}`} data-mono>{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-brand-500" /></div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-5">
          {/* Pipeline stages table */}
          <div className="layer-card overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800">Pipeline Breakdown</h3>
            </div>
            <div className="divide-y divide-gray-50">
              {(recruit?.pipeline || []).map((stage: any) => {
                const pct = recruit.totalApplications > 0 ? Math.round((stage.count / recruit.totalApplications) * 100) : 0;
                return (
                  <div key={stage.stage} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50/50 transition-colors">
                    <div className="flex-1">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-700 font-medium">{stage.stage.replace(/_/g, ' ')}</span>
                        <span className="font-mono text-gray-600 text-xs" data-mono>{stage.count} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div className="bg-brand-500 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
              {(!recruit?.pipeline?.length) && (
                <div className="text-center py-10 text-sm text-gray-400">No recruitment data yet</div>
              )}
            </div>
          </div>

          {/* Pipeline chart */}
          <div className="layer-card p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">Pipeline Chart</h3>
            {recruit?.pipeline?.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={recruit.pipeline.map((s: any) => ({ ...s, stage: s.stage.replace(/_/g, ' ') }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="stage" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Applications" />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-gray-400 text-center py-12">No data</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ReportsPage ──────────────────────────────────────────────────────────
const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: 'attendance', label: 'Attendance Report', icon: CalendarDays },
  { key: 'leave', label: 'Leave Report', icon: Clock },
  { key: 'headcount', label: 'Headcount Report', icon: Users },
  { key: 'recruitment', label: 'Recruitment Report', icon: Briefcase },
];

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('attendance');

  return (
    <div className="page-container space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">HR analytics — attendance, leave, headcount & recruitment</p>
        </div>
        <TrendingUp size={24} className="text-brand-500" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === key
                ? 'bg-white text-brand-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon size={15} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
        >
          {activeTab === 'attendance' && <AttendanceTab />}
          {activeTab === 'leave' && <LeaveTab />}
          {activeTab === 'headcount' && <HeadcountTab />}
          {activeTab === 'recruitment' && <RecruitmentTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
