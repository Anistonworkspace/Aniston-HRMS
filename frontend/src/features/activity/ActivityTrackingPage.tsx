import { useState, useMemo, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Monitor, Search, Calendar, Eye, Activity, Clock, Mouse, Keyboard,
  WifiOff, X, Maximize2, Globe, Download, TrendingDown, TrendingUp,
  Camera, Footprints, Info, ChevronDown, ChevronUp, BarChart2, List,
  AlertTriangle, MinusCircle, Zap, RefreshCcw,
} from 'lucide-react';
import { useGetEmployeesQuery } from '../employee/employeeApi';
import {
  useGetActivityBulkSummaryQuery, useGetEmployeeActivityLogsQuery, useGetEmployeeScreenshotsQuery,
  useLazyDownloadActivityExcelQuery,
  useGetAgentScreenshotIntervalQuery, useSetAgentScreenshotIntervalMutation, useDeleteAgentActivityByDateMutation,
  useDeleteAgentScreenshotMutation, useLazyGetAgentStatusForRefreshQuery,
  useGetAgentReportQuery, useGetAgentRetentionConfigQuery,
  attendanceApi,
} from '../attendance/attendanceApi';
import { useGetAgentSetupListQuery } from '../settings/settingsApi';
import { getInitials, cn } from '../../lib/utils';
import { onSocketEvent, offSocketEvent } from '../../lib/socket';
import { useAppSelector, useAppDispatch } from '../../app/store';

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:4000/api').replace('/api', '');

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' });
}
function fmtTimeShort(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
}
function fmtMinutes(mins: number) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page root
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true if a YYYY-MM-DD date string is older than the retention window */
function isExpired(dateStr: string, retentionDays: number): boolean {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  cutoff.setHours(0, 0, 0, 0);
  return new Date(dateStr + 'T00:00:00.000Z') < cutoff;
}

/** Oldest selectable date = today minus retention days */
function minSelectableDate(retentionDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() - retentionDays);
  return d.toISOString().split('T')[0];
}

export default function ActivityTrackingPage() {
  const [rawDate, setRawDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedDate, setSelectedDate] = useState(rawDate);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [fullScreenshot, setFullScreenshot] = useState<string | null>(null);

  const { data: retentionRes } = useGetAgentRetentionConfigQuery();
  const retentionDays = retentionRes?.data?.activityRetentionDays ?? 30;

  const dateExpired = isExpired(selectedDate, retentionDays);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleDateChange = (value: string) => {
    setRawDate(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSelectedDate(value), 300);
  };

  const [empPage, setEmpPage] = useState(1);
  const PAGE_SIZE = 50;
  const { data: empRes, isLoading: loadingEmps, isFetching: fetchingMoreEmps } = useGetEmployeesQuery({ page: 1, limit: empPage * PAGE_SIZE });
  const employees = empRes?.data || [];
  const empTotal = empRes?.meta?.total ?? 0;
  const hasMoreEmps = employees.length < empTotal;

  const { data: bulkSummaryRes } = useGetActivityBulkSummaryQuery({ date: selectedDate }, { pollingInterval: 120_000 });
  const bulkSummary = bulkSummaryRes?.data;

  const currentUser = useAppSelector(s => s.auth.user);
  // ACT-006: MANAGER role cannot call /agent/setup/employees (403) — skip the query
  const canViewAgentSetup = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'ADMIN' || currentUser?.role === 'HR';
  const { data: agentSetupRes } = useGetAgentSetupListQuery(undefined, { pollingInterval: 30_000, skip: !canViewAgentSetup });
  const agentStatusMap = useMemo(() => {
    const map: Record<string, { isPaired: boolean; isActive: boolean; lastHeartbeat: string | null }> = {};
    for (const emp of agentSetupRes?.data || []) {
      map[emp.id] = {
        isPaired: !!emp.agentPairedAt,
        isActive: emp.agentStatus?.isActive ?? false,
        lastHeartbeat: emp.agentStatus?.lastHeartbeat ?? null,
      };
    }
    return map;
  }, [agentSetupRes]);

  // ACT-003: Track per-employee heartbeat timestamps so we can expire them individually.
  // Old approach: bulk-clear all employees every 2 minutes — caused false "offline" for ALL
  // employees simultaneously every 2 minutes regardless of when each last had a heartbeat.
  const [liveHeartbeats, setLiveHeartbeats] = useState<Record<string, number>>({});
  useEffect(() => {
    const handler = (data: any) => {
      if (data?.employeeId) setLiveHeartbeats(prev => ({ ...prev, [data.employeeId]: Date.now() }));
    };
    onSocketEvent('agent:heartbeat', handler);
    return () => { offSocketEvent('agent:heartbeat', handler); };
  }, []);
  // Expire per-employee entries that haven't had a heartbeat in >2 minutes (120s)
  const liveConnected = useMemo(() => {
    const cutoff = Date.now() - 120_000;
    const result: Record<string, boolean> = {};
    for (const [id, ts] of Object.entries(liveHeartbeats)) {
      if (ts > cutoff) result[id] = true;
    }
    return result;
  }, [liveHeartbeats]);
  useEffect(() => {
    // Only force re-render when at least one entry has crossed the 2-minute expiry threshold.
    // Avoids triple re-render cascade (ticker → liveConnected → onlineCount) every 30s when
    // no entries are expiring (e.g. no agents connected, or all heartbeats are fresh).
    const ticker = setInterval(() => {
      setLiveHeartbeats(prev => {
        const cutoff = Date.now() - 120_000;
        const hasExpired = Object.values(prev).some(ts => ts <= cutoff);
        return hasExpired ? { ...prev } : prev;
      });
    }, 30_000);
    return () => clearInterval(ticker);
  }, []);

  // Org-level counters for the header bar
  const { onlineCount, activeCount, noAgentCount } = useMemo(() => {
    const onlineIds = new Set<string>();
    for (const [id, s] of Object.entries(agentStatusMap)) {
      if (s.isActive) onlineIds.add(id);
    }
    for (const id of Object.keys(liveConnected)) onlineIds.add(id);

    let active = 0;
    for (const s of Object.values(bulkSummary || {})) {
      if (s.logCount > 0) active++;
    }
    const noAgent = employees.filter((e: any) => !agentStatusMap[e.id]?.isPaired).length;
    return { onlineCount: onlineIds.size, activeCount: active, noAgentCount: noAgent };
  }, [agentStatusMap, liveConnected, bulkSummary, employees]);

  const filteredEmployees = useMemo(() => {
    if (!searchQuery.trim()) return employees;
    const q = searchQuery.toLowerCase();
    return (employees as any[]).filter((e: any) =>
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
      e.employeeCode?.toLowerCase().includes(q) ||
      e.department?.name?.toLowerCase().includes(q)
    );
  }, [employees, searchQuery]);

  return (
    <div className="page-container">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900 flex items-center gap-2">
            <Monitor size={24} style={{ color: 'var(--primary-color)' }} />
            Activity Tracking
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">Desktop agent monitoring — keystrokes, apps, screenshots & productivity</p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={15} className="text-gray-400" />
          <input type="date" value={rawDate} onChange={e => handleDateChange(e.target.value)}
            min={minSelectableDate(retentionDays)}
            max={new Date().toISOString().split('T')[0]}
            className="input-glass text-sm" />
        </div>
      </div>


      {/* ── Retention Notice ── */}
      {dateExpired && (
        <div className="mb-3 flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5 text-amber-500" />
          <div>
            <span className="font-semibold">Data not available.</span> Activity data older than {retentionDays} days is automatically deleted per our data retention policy. Please select a date within the last {retentionDays} days.
          </div>
        </div>
      )}

      {/* ── Summary Bar ── */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="layer-card px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
            <Zap size={18} />
          </div>
          <div>
            <p className="text-xl font-bold text-gray-800 font-mono" data-mono>{onlineCount}</p>
            <p className="text-[11px] text-gray-400">Agent online now</p>
          </div>
        </div>
        <div className="layer-card px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
            <Activity size={18} />
          </div>
          <div>
            <p className="text-xl font-bold text-gray-800 font-mono" data-mono>{activeCount}</p>
            <p className="text-[11px] text-gray-400">Active today</p>
          </div>
        </div>
        <div className="layer-card px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={18} />
          </div>
          <div>
            <p className="text-xl font-bold text-gray-800 font-mono" data-mono>{noAgentCount}</p>
            <p className="text-[11px] text-gray-400">No agent installed</p>
          </div>
        </div>
      </div>

      <div className="flex gap-4 h-[calc(100vh-270px)]">
        {/* ── Left: Employee List ── */}
        <div className="w-80 flex-shrink-0 layer-card flex flex-col overflow-hidden">
          <div className="p-3 border-b border-gray-100">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by name, code, dept…"
                className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none" />
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5">{filteredEmployees.length} employees shown</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingEmps ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--primary-color)', borderTopColor: 'transparent' }} />
              </div>
            ) : filteredEmployees.length === 0 ? (
              <p className="text-center text-gray-400 text-xs py-8">No employees found</p>
            ) : (
              <>
                {(filteredEmployees as any[]).map((emp: any) => (
                  <EmployeeRow
                    key={emp.id}
                    employee={emp}
                    isSelected={selectedEmployee?.id === emp.id}
                    bulkSummary={bulkSummary}
                    agentStatus={agentStatusMap[emp.id]}
                    isLiveConnected={!!liveConnected[emp.id]}
                    onClick={() => setSelectedEmployee(emp)}
                  />
                ))}
                {hasMoreEmps && !searchQuery.trim() && (
                  <button
                    onClick={() => setEmpPage(p => p + 1)}
                    disabled={fetchingMoreEmps}
                    className="w-full py-2 text-xs text-indigo-600 hover:text-indigo-800 disabled:text-gray-400 border-t border-gray-100 flex items-center justify-center gap-1.5">
                    {fetchingMoreEmps
                      ? <><div className="w-3 h-3 border border-indigo-400 border-t-transparent rounded-full animate-spin" /> Loading…</>
                      : `Load more (${empTotal - employees.length} remaining)`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Right: Detail Panel ── */}
        <div className="flex-1 overflow-y-auto">
          {selectedEmployee ? (
            <ActivityDetail
              employee={selectedEmployee}
              date={selectedDate}
              onScreenshotClick={setFullScreenshot}
              agentStatus={agentStatusMap[selectedEmployee.id]}
            />
          ) : (
            <div className="flex items-center justify-center h-full layer-card">
              <div className="text-center">
                <Monitor size={48} className="mx-auto text-gray-200 mb-3" />
                <h3 className="text-base font-semibold text-gray-600 mb-1">Select an Employee</h3>
                <p className="text-sm text-gray-400">Click any employee from the left to view their full activity report</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Fullscreen Screenshot Modal ── */}
      {fullScreenshot && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setFullScreenshot(null)}>
          <button className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors" onClick={() => setFullScreenshot(null)}>
            <X size={24} />
          </button>
          <img src={fullScreenshot} alt="Screenshot" className="max-w-full max-h-full object-contain rounded-xl shadow-2xl" />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Employee List Row
// ─────────────────────────────────────────────────────────────────────────────
function EmployeeRow({ employee, isSelected, bulkSummary, agentStatus, isLiveConnected, onClick }: {
  employee: any; isSelected: boolean;
  bulkSummary: Record<string, { logCount: number; totalActiveMinutes: number; totalIdleMinutes: number; productivityScore: number | null }> | undefined;
  agentStatus?: { isPaired: boolean; isActive: boolean; lastHeartbeat: string | null };
  isLiveConnected?: boolean;
  onClick: () => void;
}) {
  const summary = bulkSummary?.[employee.id];
  const hasActivity = !!summary && summary.logCount > 0;
  const score = summary?.productivityScore ?? null;

  const isConnected = isLiveConnected || agentStatus?.isActive;
  const isPaired = agentStatus?.isPaired;

  const dotColor = isConnected ? 'bg-emerald-500 animate-pulse' : isPaired ? 'bg-red-400' : 'bg-gray-300';
  const statusLabel = isConnected ? 'Online' : isPaired ? 'Offline' : 'No agent';
  const statusColor = isConnected ? 'text-emerald-600' : isPaired ? 'text-red-500' : 'text-gray-400';

  const scoreColor = score === null ? 'text-gray-300'
    : score >= 70 ? 'text-emerald-600'
    : score >= 40 ? 'text-amber-500'
    : 'text-red-500';

  return (
    <button onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors border-b border-gray-50',
        isSelected ? 'border-l-2' : 'hover:bg-gray-50'
      )}
      style={isSelected ? { background: 'var(--primary-highlighted-color)', borderLeftColor: 'var(--primary-color)' } : {}}
      >
      {/* Avatar */}
      <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
        hasActivity ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500')}>
        {getInitials(employee.firstName, employee.lastName)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate leading-tight">
          {employee.firstName} {employee.lastName}
        </p>
        <div className="flex items-center gap-1 mt-0.5">
          <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', dotColor)} />
          <span className={cn('text-[10px] font-medium', statusColor)}>{statusLabel}</span>
          <span className="text-[10px] text-gray-300 mx-0.5">·</span>
          <span className="text-[10px] text-gray-400 truncate">{employee.employeeCode}</span>
          {employee.workMode && (
            <><span className="text-[10px] text-gray-300 mx-0.5">·</span>
            <span className="text-[10px] text-gray-400">{employee.workMode}</span></>
          )}
        </div>
      </div>

      {/* Right: score + time */}
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0 text-right">
        {hasActivity ? (
          <>
            <span className={cn('text-[11px] font-bold font-mono', scoreColor)} data-mono>
              {score !== null ? `${score}%` : '—'}
            </span>
            <span className="text-[9px] text-gray-400">{fmtMinutes(summary.totalActiveMinutes)} active</span>
          </>
        ) : (
          <span className="text-[9px] text-gray-300">No data</span>
        )}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity Detail — full right panel
// ─────────────────────────────────────────────────────────────────────────────
function ActivityDetail({ employee, date, onScreenshotClick, agentStatus }: {
  employee: any; date: string; onScreenshotClick: (url: string) => void;
  agentStatus?: { isPaired: boolean; isActive: boolean; lastHeartbeat: string | null };
}) {
  const [viewMode, setViewMode] = useState<'overview' | 'timeline' | 'screenshots' | 'report'>('overview');
  const [exporting, setExporting] = useState(false);
  const [showExportRange, setShowExportRange] = useState(false);
  const [showDeleteRange, setShowDeleteRange] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [liveStatus, setLiveStatus] = useState<{ isActive: boolean; lastHeartbeat: string | null } | null>(null);
  const [triggerStatusRefresh] = useLazyGetAgentStatusForRefreshQuery();
  const dispatch = useAppDispatch();
  const { data: retentionCfg } = useGetAgentRetentionConfigQuery();
  const dateExpired = isExpired(date, retentionCfg?.data?.activityRetentionDays ?? 30);
  const currentUser = useAppSelector(s => s.auth.user);
  const isAdminOrSuperAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'ADMIN';

  // MED-003: When a heartbeat arrives for this employee, invalidate the RTK cache so
  // the overview/timeline tabs refresh automatically without the user manually reloading.
  useEffect(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const handleHeartbeat = (data: any) => {
      if (data?.employeeId !== employee.id) return;
      if (date !== todayStr) return; // only invalidate today's data
      dispatch(attendanceApi.util.invalidateTags([
        { type: 'Attendance', id: `agent-screenshots-${employee.id}-${date}` },
        'Attendance',
      ]));
    };
    onSocketEvent('agent:heartbeat', handleHeartbeat);
    return () => { offSocketEvent('agent:heartbeat', handleHeartbeat); };
  }, [employee.id, date, dispatch]);

  const { data: intervalRes } = useGetAgentScreenshotIntervalQuery(employee.id);
  const screenshotIntervalSeconds = intervalRes?.data?.intervalSeconds ?? 600;

  const { data: activityRes, isLoading: loadingActivity, isError: activityError } = useGetEmployeeActivityLogsQuery(
    { employeeId: employee.id, date },
    { pollingInterval: 60000, skip: dateExpired }
  );
  const { data: screenshotRes, isLoading: loadingScreenshots, isFetching: fetchingScreenshots } = useGetEmployeeScreenshotsQuery(
    { employeeId: employee.id, date },
    { pollingInterval: 120000, skip: dateExpired }
  );
  const [triggerExport] = useLazyDownloadActivityExcelQuery();

  const summary = activityRes?.data?.summary;
  const logs = activityRes?.data?.logs || [];
  const screenshots = screenshotRes?.data || [];
  const hasData = !!summary && summary.logCount > 0;

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await triggerExport({ employeeId: employee.id, date });
      if (result.error) { toast.error('Export failed. Please try again.'); return; }
      if (result.data) {
        const url = URL.createObjectURL(result.data);
        const a = document.createElement('a');
        a.href = url;
        a.download = `activity-${employee.employeeCode || employee.id}-${date}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch {
      toast.error('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleRefreshStatus = async () => {
    setRefreshing(true);
    try {
      // ACT-005: { preferCacheValue: false } forces a fresh network request each time the
      // user clicks Refresh — without this the lazy query returns stale cached data.
      const result = await triggerStatusRefresh(employee.id, false).unwrap();
      setLiveStatus({ isActive: result.data.isActive, lastHeartbeat: result.data.lastHeartbeat });
      // ACT-004: Auto-clear liveStatus after 60s so the UI falls back to the polled status
      // rather than showing stale "clicked refresh" data indefinitely.
      setTimeout(() => setLiveStatus(null), 60_000);
      if (result.data.isActive) {
        toast.success('Agent is online');
      } else {
        toast(`Agent is offline${result.data.lastHeartbeat ? ` — last seen ${fmtDateTime(result.data.lastHeartbeat)}` : ''}`, { icon: '⚠️' });
      }
    } catch {
      toast.error('Could not reach server. Check your connection.');
    } finally {
      setRefreshing(false);
    }
  };

  // Live status from refresh overrides the polled status from the setup list
  const effectiveStatus = liveStatus ?? agentStatus;
  const isConnected = effectiveStatus?.isActive;
  const isPaired = agentStatus?.isPaired;
  const agentDotColor = isConnected ? 'bg-emerald-500 animate-pulse' : isPaired ? 'bg-red-400' : 'bg-gray-300';
  const agentLabel = isConnected ? 'Agent Online' : isPaired ? 'Agent Offline' : 'Not Installed';
  const agentLabelColor = isConnected ? 'text-emerald-700' : isPaired ? 'text-red-600' : 'text-gray-400';
  const agentBg = isConnected ? 'bg-emerald-50 border-emerald-200' : isPaired ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200';

  return (
    <div className="space-y-3">

      {/* ── Employee Identity Card ── */}
      <div className="layer-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0" style={{ background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' }}>
              {getInitials(employee.firstName, employee.lastName)}
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-800 leading-tight">{employee.firstName} {employee.lastName}</h2>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                <span className="text-xs text-gray-500 font-mono" data-mono>{employee.employeeCode}</span>
                {employee.designation?.name && <><span className="text-gray-300 text-xs">·</span><span className="text-xs text-gray-500">{employee.designation.name}</span></>}
                {employee.department?.name && <><span className="text-gray-300 text-xs">·</span><span className="text-xs text-gray-500">{employee.department.name}</span></>}
                {employee.workMode && <><span className="text-gray-300 text-xs">·</span><span className="text-xs text-gray-500">{employee.workMode}</span></>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Agent status pill + Reconnect button */}
            <div className="flex items-center gap-1.5">
              <div className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium', agentBg, agentLabelColor)}>
                <div className={cn('w-1.5 h-1.5 rounded-full', agentDotColor)} />
                {agentLabel}
                {effectiveStatus?.lastHeartbeat && !isConnected && (
                  <span className="text-gray-400 font-normal ml-1">· {fmtTimeShort(effectiveStatus.lastHeartbeat)}</span>
                )}
              </div>
              <button
                onClick={handleRefreshStatus}
                disabled={refreshing}
                title="Refresh agent status"
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-full hover:bg-gray-100 transition-colors disabled:opacity-50">
                <RefreshCcw size={11} className={refreshing ? 'animate-spin' : ''} />
                {!isConnected && isPaired ? 'Reconnect' : 'Refresh'}
              </button>
            </div>

            {/* Date badge */}
            <div className="text-right px-3 py-1 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-[10px] text-gray-400">Date</p>
              <p className="text-xs font-mono font-semibold text-gray-700" data-mono>{date}</p>
            </div>

            {/* Export */}
            {hasData && !dateExpired && (
              <button onClick={handleExport} disabled={exporting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50">
                {exporting
                  ? <div className="w-3 h-3 border border-emerald-600 border-t-transparent rounded-full animate-spin" />
                  : <Download size={12} />}
                Export Excel
              </button>
            )}
            {hasData && !dateExpired && (
              <button onClick={() => setShowExportRange(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors">
                <Download size={12} /> Export Range
              </button>
            )}
            {hasData && (
              <button onClick={() => setShowDeleteRange(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors">
                <X size={12} /> Delete Range
              </button>
            )}
            <DeleteDateDataButton employeeId={employee.id} date={date} hasData={hasData} />
          </div>
        </div>

        {/* View mode tabs */}
        <div className="flex bg-gray-100 rounded-lg p-0.5 w-fit mt-3">
          {([
            { key: 'overview', icon: BarChart2, label: 'Overview' },
            { key: 'timeline', icon: List, label: 'Timeline' },
            { key: 'screenshots', icon: Camera, label: 'Screenshots', badge: screenshots.length || null },
            { key: 'report', icon: TrendingUp, label: 'Monthly Report' },
          ] as const).map(tab => (
            <button key={tab.key} onClick={() => setViewMode(tab.key as any)}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                viewMode === tab.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
              <tab.icon size={13} />
              {tab.label}
              {'badge' in tab && tab.badge != null && tab.badge > 0 && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' }}>{tab.badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Screenshot interval — ADMIN/SUPER_ADMIN only (HR cannot change interval) */}
      {isAdminOrSuperAdmin && <ScreenshotIntervalControl employeeId={employee.id} />}

      {/* ── Retention Expired State ── */}
      {dateExpired && (
        <div className="layer-card p-10 text-center">
          <AlertTriangle size={40} className="mx-auto text-amber-300 mb-3" />
          <p className="text-sm font-semibold text-gray-600 mb-1">Data deleted — retention policy</p>
          <p className="text-xs text-gray-400">Activity data for <strong>{date}</strong> has been automatically deleted after {retentionCfg?.data?.activityRetentionDays ?? 30} days.<br />Select a date within the last {retentionCfg?.data?.activityRetentionDays ?? 30} days to view data.</p>
        </div>
      )}

      {/* ── No Data State ── */}
      {!dateExpired && viewMode !== 'report' && !loadingActivity && !activityError && !hasData && (
        <div className="layer-card p-10 text-center">
          <Monitor size={40} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-semibold text-gray-500 mb-1">No activity recorded for {date}</p>
          <p className="text-xs text-gray-400 mb-3">The desktop agent hasn't sent any data for this date.</p>
          {agentStatus?.isPaired ? (
            <p className={cn('text-xs font-medium', isConnected ? 'text-emerald-600' : 'text-gray-500')}>
              {isConnected
                ? '● Agent is currently online — data will appear shortly'
                : agentStatus.lastHeartbeat
                  ? `Last seen: ${fmtDateTime(agentStatus.lastHeartbeat)}`
                  : 'Agent paired but has never connected'}
            </p>
          ) : (
            <p className="text-xs text-amber-600 font-medium">⚠ Agent not installed — share the setup code with this employee</p>
          )}
        </div>
      )}

      {/* ── Loading ── */}
      {!dateExpired && viewMode !== 'report' && loadingActivity && (
        <div className="layer-card p-10 text-center">
          <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mx-auto" style={{ borderColor: 'var(--primary-color)', borderTopColor: 'transparent' }} />
          <p className="text-sm text-gray-400 mt-2">Loading activity data…</p>
        </div>
      )}

      {/* ── Error ── */}
      {!dateExpired && viewMode !== 'report' && activityError && (
        <div className="layer-card p-10 text-center">
          <WifiOff size={36} className="mx-auto text-red-300 mb-3" />
          <p className="text-sm text-red-500 mb-1">Failed to load activity data</p>
          <p className="text-xs text-gray-400">Check your connection or try again later</p>
        </div>
      )}

      {/* ── OVERVIEW TAB ── */}
      {!dateExpired && viewMode === 'overview' && hasData && summary && (
        <>
          {/* KPI Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiCard
              icon={Clock} iconBg="bg-emerald-50" iconColor="text-emerald-600"
              label="Active Time" value={fmtMinutes(summary.totalActiveMinutes)}
              sub="tracked work time"
              infoText="Sum of all 30-second activity ticks where the system was not idle. Each tick = 30s of recorded work. Total = number of ticks × 30s ÷ 60." />
            <KpiCard
              icon={MinusCircle} iconBg="bg-amber-50" iconColor="text-amber-600"
              label="Idle Time" value={fmtMinutes(summary.totalIdleMinutes)}
              sub="no input detected"
              infoText="Per-tick idle time: the shorter of (system idle counter, 30s). Idle means no keyboard or mouse input detected for that 30s window. Total idle ≠ total active — both are independent measures." />
            <KpiCard
              icon={Keyboard} iconBg="bg-blue-50" iconColor="text-blue-600"
              label="Keystrokes" value={summary.totalKeystrokes.toLocaleString()}
              sub="keys pressed"
              infoText="Keyboard activity detected by the desktop agent across the day. Counts keys that were pressed within each 5-second poll window — fast repeated presses of the same key count as 1 per window, so this is an activity indicator rather than an exact keystroke count." />
            <KpiCard
              icon={Mouse} iconBg="bg-purple-50" iconColor="text-purple-600"
              label="Mouse Clicks" value={summary.totalClicks.toLocaleString()}
              sub="click events"
              infoText="Total mouse button click events (left + right + middle) captured by the desktop agent across the entire day." />
            <KpiCard
              icon={Footprints} iconBg="bg-indigo-50" iconColor="text-indigo-600"
              label="Mouse Travel" value={`${(summary.totalMouseDistance / 1000).toFixed(1)}k px`}
              sub="cursor distance"
              infoText="Total cursor travel distance in pixels accumulated across the day. Measured as the sum of Euclidean distances between consecutive mouse positions." />
            <ProductivityRing
              score={summary.productivityScore}
              productiveMinutes={summary.productiveMinutes}
              unproductiveMinutes={summary.unproductiveMinutes}
              neutralMinutes={Math.max(0, summary.totalActiveMinutes - summary.productiveMinutes - summary.unproductiveMinutes)}
            />
          </div>

          {/* Productivity Breakdown bar */}
          <ProductivityBreakdownBar
            productiveMinutes={summary.productiveMinutes}
            unproductiveMinutes={summary.unproductiveMinutes}
            totalMinutes={summary.totalActiveMinutes}
          />

          {/* Top Applications */}
          {summary.topApps?.length > 0 && (
            <AppDrilldown topApps={summary.topApps} logs={logs} />
          )}

          {/* Screenshots preview (last 4) */}
          {screenshots.length > 0 && (
            <div className="layer-card p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Camera size={14} style={{ color: 'var(--primary-color)' }} /> Recent Screenshots
                  <span className="text-xs text-gray-400 font-normal">({screenshots.length} total)</span>
                </h3>
                <button onClick={() => setViewMode('screenshots')}
                  className="text-[11px] hover:underline" style={{ color: 'var(--primary-color)' }}>View all</button>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {[...screenshots].reverse().slice(0, 4).map((s: any) => (
                  <div key={s.id} className="group relative cursor-pointer rounded-lg overflow-hidden border border-gray-200 hover:shadow-md transition-all" onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--primary-color)')} onMouseLeave={e => (e.currentTarget.style.borderColor = '')}
                    onClick={() => onScreenshotClick(`${API_BASE}${s.imageUrl}`)}>
                    <img src={`${API_BASE}${s.imageUrl}`} alt={s.activeApp || 'Screenshot'} className="w-full h-24 object-cover" loading="lazy" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <Maximize2 size={16} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1">
                      <p className="text-[9px] text-white truncate">{s.activeApp || 'Desktop'}</p>
                      <p className="text-[8px] text-gray-300">{fmtTimeShort(s.timestamp)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── TIMELINE TAB ── */}
      {!dateExpired && viewMode === 'timeline' && hasData && (
        <ActivityTimeline logs={logs} />
      )}

      {/* ── SCREENSHOTS TAB ── */}
      {!dateExpired && viewMode === 'screenshots' && (
        <ScreenshotsGallery
          screenshots={screenshots}
          loading={loadingScreenshots}
          fetching={fetchingScreenshots}
          onScreenshotClick={onScreenshotClick}
          resetKey={`${employee.id}-${date}`}
          employeeId={employee.id}
          date={date}
          intervalSeconds={screenshotIntervalSeconds}
        />
      )}

      {/* ── MONTHLY REPORT TAB ── HIGH-003 */}
      {viewMode === 'report' && (
        <MonthlyReportPanel employeeId={employee.id} employeeName={`${employee.firstName} ${employee.lastName}`} retentionDays={retentionCfg?.data?.activityRetentionDays ?? 30} />
      )}

      {showExportRange && (
        <ExportRangeModal employeeId={employee.id} employeeCode={employee.employeeCode || employee.id} retentionDays={retentionCfg?.data?.activityRetentionDays ?? 30} onClose={() => setShowExportRange(false)} />
      )}
      {showDeleteRange && (
        <DeleteRangeModal employeeId={employee.id} retentionDays={retentionCfg?.data?.activityRetentionDays ?? 30} onClose={() => setShowDeleteRange(false)} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI Card
// ─────────────────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, iconBg, iconColor, label, value, sub, infoText }: {
  icon: any; iconBg: string; iconColor: string; label: string; value: string; sub: string; infoText?: string;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const handleInfoClick = () => {
    if (!showInfo && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.left - 220, window.innerWidth - 272));
      setTooltipPos({ top: rect.bottom + 6 + window.scrollY, left });
    }
    setShowInfo(s => !s);
  };

  useEffect(() => {
    if (!showInfo) return;
    const handler = (e: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node) &&
          btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setShowInfo(false);
      }
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowInfo(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', keyHandler); };
  }, [showInfo]);

  return (
    <div className="layer-card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', iconBg)}>
          <Icon size={16} className={iconColor} />
        </div>
        {infoText && (
          <button ref={btnRef} onClick={handleInfoClick} className="text-gray-300 hover:text-gray-500 transition-colors" title="How is this calculated?">
            <Info size={13} />
          </button>
        )}
      </div>
      <p className="text-[11px] text-gray-400 mb-0.5">{label}</p>
      <p className="text-xl font-bold font-mono text-gray-800 leading-tight" data-mono>{value}</p>
      <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>
      {/* UI-001: Render tooltip via fixed positioning so it escapes overflow:hidden ancestors */}
      {showInfo && infoText && (
        <div
          ref={tooltipRef}
          className="fixed z-[9999] w-64 bg-white border border-gray-200 rounded-xl shadow-2xl p-3 text-[11px] text-gray-600 leading-relaxed"
          style={{ top: tooltipPos.top, left: tooltipPos.left }}>
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <span className="font-semibold text-gray-800 text-xs">{label} — How it's calculated</span>
            <button onClick={() => setShowInfo(false)} className="text-gray-300 hover:text-gray-500 flex-shrink-0"><X size={12} /></button>
          </div>
          {infoText}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Productivity Ring (circular SVG)
// ─────────────────────────────────────────────────────────────────────────────
function ProductivityRing({ score, productiveMinutes, unproductiveMinutes, neutralMinutes }: {
  score: number | null; productiveMinutes: number; unproductiveMinutes: number; neutralMinutes: number;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const handleInfoClick = () => {
    if (!showInfo && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.left - 220, window.innerWidth - 272));
      setTooltipPos({ top: rect.bottom + 6 + window.scrollY, left });
    }
    setShowInfo(s => !s);
  };

  useEffect(() => {
    if (!showInfo) return;
    const handler = (e: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node) &&
          btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setShowInfo(false);
      }
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowInfo(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', keyHandler); };
  }, [showInfo]);

  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const pct = score ?? 0;
  const offset = circumference - (pct / 100) * circumference;
  const color = pct >= 70 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444';
  const label = pct >= 70 ? 'High' : pct >= 40 ? 'Medium' : 'Low';

  return (
    <div className="layer-card p-4 col-span-1">
      <div className="flex items-center justify-between mb-1">
        <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
          {pct >= 40 ? <TrendingUp size={16} className="text-indigo-600" /> : <TrendingDown size={16} className="text-red-500" />}
        </div>
        <button ref={btnRef} onClick={handleInfoClick} className="text-gray-300 hover:text-gray-500 transition-colors" title="How is this calculated?">
          <Info size={13} />
        </button>
      </div>
      {showInfo && (
        <div ref={tooltipRef} className="fixed z-[9999] w-64 bg-white border border-gray-200 rounded-xl shadow-2xl p-3 text-[11px] text-gray-600 leading-relaxed"
          style={{ top: tooltipPos.top, left: tooltipPos.left }}>
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <span className="font-semibold text-gray-800 text-xs">Productivity — How it's calculated</span>
            <button onClick={() => setShowInfo(false)} className="text-gray-300 hover:text-gray-500 flex-shrink-0"><X size={12} /></button>
          </div>
          Score = 60% weight on activity ratio (active ÷ (active + idle)) + 40% weight on productive ratio (productive app time ÷ total active time). Apps are categorised as Productive (e.g. VS Code, Excel, Teams), Unproductive (e.g. Netflix, Discord), or Neutral. Score 70%+ = High, 40–69% = Medium, &lt;40% = Low.
        </div>
      )}
      <p className="text-[11px] text-gray-400 mb-1">Productivity</p>
      {score === null ? (
        <p className="text-xl font-bold text-gray-300">—</p>
      ) : (
        <div className="flex items-center gap-2">
          <svg width="48" height="48" className="flex-shrink-0 -rotate-90">
            <circle cx="24" cy="24" r={radius} stroke="#e5e7eb" strokeWidth="5" fill="none" />
            <circle cx="24" cy="24" r={radius} stroke={color} strokeWidth="5" fill="none"
              strokeDasharray={circumference} strokeDashoffset={offset}
              strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
          </svg>
          <div>
            <p className="text-xl font-bold font-mono leading-tight" style={{ color }} data-mono>{pct}%</p>
            <p className="text-[10px] font-medium" style={{ color }}>{label}</p>
            <div className="mt-0.5 space-y-0.5">
              <p className="text-[9px] text-emerald-600">{productiveMinutes}m productive</p>
              {unproductiveMinutes > 0 && <p className="text-[9px] text-red-400">{unproductiveMinutes}m unproductive</p>}
              {neutralMinutes > 0 && <p className="text-[9px] text-gray-400">{neutralMinutes}m neutral</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Productivity Breakdown Bar
// ─────────────────────────────────────────────────────────────────────────────
function ProductivityBreakdownBar({ productiveMinutes, unproductiveMinutes, totalMinutes }: {
  productiveMinutes: number; unproductiveMinutes: number; totalMinutes: number;
}) {
  if (totalMinutes === 0) return null;
  const neutralMinutes = Math.max(0, totalMinutes - productiveMinutes - unproductiveMinutes);
  const prodPct = Math.round((productiveMinutes / totalMinutes) * 100);
  const unprodPct = Math.round((unproductiveMinutes / totalMinutes) * 100);
  const neutralPct = 100 - prodPct - unprodPct;

  return (
    <div className="layer-card p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <BarChart2 size={14} style={{ color: 'var(--primary-color)' }} /> Productivity Breakdown
          <span className="text-[10px] text-gray-400 font-normal">— what this employee did today</span>
        </h3>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Productive ({productiveMinutes}m)</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Unproductive ({unproductiveMinutes}m)</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300 inline-block" /> Neutral ({neutralMinutes}m)</span>
        </div>
      </div>
      <div className="h-6 rounded-full overflow-hidden flex bg-gray-100">
        {prodPct > 0 && (
          <motion.div initial={{ width: 0 }} animate={{ width: `${prodPct}%` }}
            className="h-full bg-emerald-500 flex items-center justify-center transition-all"
            title={`Productive: ${productiveMinutes}m (${prodPct}%)`}>
            {prodPct > 8 && <span className="text-[9px] text-white font-medium">{prodPct}%</span>}
          </motion.div>
        )}
        {unprodPct > 0 && (
          <motion.div initial={{ width: 0 }} animate={{ width: `${unprodPct}%` }}
            className="h-full bg-red-400 flex items-center justify-center transition-all"
            title={`Unproductive: ${unproductiveMinutes}m (${unprodPct}%)`}>
            {unprodPct > 8 && <span className="text-[9px] text-white font-medium">{unprodPct}%</span>}
          </motion.div>
        )}
        {neutralPct > 0 && (
          <motion.div initial={{ width: 0 }} animate={{ width: `${neutralPct}%` }}
            className="h-full bg-gray-300 flex items-center justify-center transition-all"
            title={`Neutral: ${neutralMinutes}m (${neutralPct}%)`}>
            {neutralPct > 8 && <span className="text-[9px] text-gray-600 font-medium">{neutralPct}%</span>}
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// App Drilldown — clickable horizontal bars → expands session list
// ─────────────────────────────────────────────────────────────────────────────
function AppDrilldown({ topApps, logs }: { topApps: any[]; logs: any[] }) {
  const [expandedApp, setExpandedApp] = useState<string | null>(null);

  const categoryForApp = (appName: string): 'PRODUCTIVE' | 'NEUTRAL' | 'UNPRODUCTIVE' => {
    const log = logs.find(l => l.activeApp === appName);
    return log?.category || 'NEUTRAL';
  };

  const getAppLogs = (appName: string) =>
    logs.filter(l => l.activeApp === appName).sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

  const isBrowser = (app: string) => {
    const l = app.toLowerCase();
    return l.includes('chrome') || l.includes('edge') || l.includes('firefox') || l.includes('brave');
  };

  const categoryColor = (cat: string) =>
    cat === 'PRODUCTIVE' ? 'bg-emerald-500' : cat === 'UNPRODUCTIVE' ? 'bg-red-400' : 'bg-gray-400';

  const categoryBadge = (cat: string) =>
    cat === 'PRODUCTIVE'
      ? 'bg-emerald-100 text-emerald-700'
      : cat === 'UNPRODUCTIVE'
        ? 'bg-red-100 text-red-600'
        : 'bg-gray-100 text-gray-500';

  const maxMinutes = topApps[0]?.minutes || 1;

  return (
    <div className="layer-card p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
        <Activity size={14} style={{ color: 'var(--primary-color)' }} /> Top Applications
      </h3>
      <p className="text-[10px] text-gray-400 mb-3">Click any app to see individual sessions with timestamps and keystrokes</p>
      <div className="space-y-1.5">
        {topApps.slice(0, 10).map((app: any, i: number) => {
          const cat = categoryForApp(app.app);
          const pct = Math.max(4, (app.minutes / maxMinutes) * 100);
          const isExpanded = expandedApp === app.app;
          const appLogs = isExpanded ? getAppLogs(app.app) : [];

          return (
            <div key={i} className="rounded-lg border border-transparent hover:border-gray-100 transition-colors">
              <button onClick={() => setExpandedApp(isExpanded ? null : app.app)}
                className="w-full flex items-center gap-3 py-1.5 px-1 text-left">
                {/* Rank */}
                <span className="text-[10px] text-gray-300 w-4 flex-shrink-0 font-mono" data-mono>{i + 1}</span>
                {/* App name */}
                <span className="text-xs text-gray-700 w-28 truncate flex-shrink-0 font-medium">{app.app}</span>
                {/* Bar */}
                <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                    className={cn('h-full rounded-full flex items-center justify-end pr-1.5', categoryColor(cat))}>
                    {pct > 12 && <span className="text-[8px] text-white font-mono" data-mono>{app.minutes}m</span>}
                  </motion.div>
                </div>
                {/* Duration */}
                <span className="text-[10px] text-gray-500 w-10 text-right font-mono flex-shrink-0" data-mono>{app.minutes}m</span>
                {/* Category badge */}
                <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0', categoryBadge(cat))}>
                  {cat === 'PRODUCTIVE' ? 'Productive' : cat === 'UNPRODUCTIVE' ? 'Unproductive' : 'Neutral'}
                </span>
                {isBrowser(app.app) && <Globe size={11} className="text-blue-400 flex-shrink-0" />}
                {isExpanded ? <ChevronUp size={12} className="text-gray-400 flex-shrink-0" /> : <ChevronDown size={12} className="text-gray-400 flex-shrink-0" />}
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="mx-6 mb-2 border border-gray-100 rounded-lg overflow-hidden">
                      {/* Session list header */}
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-[10px] text-gray-400 font-medium">
                        <span className="w-14">Time</span>
                        <span className="flex-1">Window / Page Title</span>
                        <span className="w-12 text-right">Dur.</span>
                        <span className="w-12 text-right">Keys</span>
                        <span className="w-10 text-right">Idle</span>
                      </div>
                      <div className="max-h-52 overflow-y-auto divide-y divide-gray-50">
                        {appLogs.length === 0 ? (
                          <p className="text-[10px] text-gray-400 text-center py-4">No detailed logs</p>
                        ) : appLogs.slice(0, 50).map((log: any, j: number) => (
                          <div key={j} className="flex items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-gray-50">
                            <span className="text-gray-400 font-mono w-14 flex-shrink-0" data-mono>{fmtTimeShort(log.timestamp)}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-gray-700 truncate">{log.activeWindow || '—'}</p>
                              {log.activeUrl && <p className="text-blue-500 truncate text-[9px]">{log.activeUrl}</p>}
                            </div>
                            <span className="text-gray-400 font-mono w-12 text-right flex-shrink-0" data-mono>{log.durationSeconds}s</span>
                            <span className={cn('font-mono w-12 text-right flex-shrink-0', log.keystrokes > 0 ? 'text-blue-500' : 'text-gray-300')} data-mono>
                              {log.keystrokes > 0 ? log.keystrokes : '—'}
                            </span>
                            <span className={cn('font-mono w-10 text-right flex-shrink-0', log.idleSeconds > 60 ? 'text-amber-500' : 'text-gray-300')} data-mono>
                              {log.idleSeconds > 0 ? `${log.idleSeconds}s` : '—'}
                            </span>
                          </div>
                        ))}
                        {appLogs.length > 50 && (
                          <p className="text-[10px] text-gray-400 text-center py-2">… {appLogs.length - 50} more entries</p>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity Timeline Tab — full chronological log
// ─────────────────────────────────────────────────────────────────────────────
function ActivityTimeline({ logs }: { logs: any[] }) {
  const [showAll, setShowAll] = useState(false);
  const displayed = showAll ? [...logs].reverse() : [...logs].reverse().slice(0, 60);

  const categoryDot = (cat: string) =>
    cat === 'PRODUCTIVE' ? 'bg-emerald-500' : cat === 'UNPRODUCTIVE' ? 'bg-red-400' : 'bg-gray-300';

  const categoryRowBg = (cat: string) =>
    cat === 'UNPRODUCTIVE' ? 'bg-red-50/40' : '';

  return (
    <div className="layer-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <List size={14} style={{ color: 'var(--primary-color)' }} /> Activity Timeline
          <span className="text-[10px] text-gray-400 font-normal">— most recent first</span>
        </h3>
        <div className="flex items-center gap-3 text-[10px] text-gray-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Productive</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Unproductive</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300 inline-block" /> Neutral</span>
          <span className="text-gray-300">·</span>
          <span>{logs.length} entries total</span>
        </div>
      </div>

      {/* Table header */}
      <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 rounded-lg mb-1 text-[10px] text-gray-400 font-medium">
        <span className="w-20 flex-shrink-0">Time (IST)</span>
        <span className="w-2 flex-shrink-0" />
        <span className="w-28 flex-shrink-0">Application</span>
        <span className="flex-1">Window Title</span>
        <span className="w-10 text-right flex-shrink-0">Dur.</span>
        <span className="w-12 text-right flex-shrink-0">Keys</span>
        <span className="w-10 text-right flex-shrink-0">Clicks</span>
        <span className="w-12 text-right flex-shrink-0">Mouse</span>
        <span className="w-12 text-right flex-shrink-0">Idle</span>
      </div>

      <div className="divide-y divide-gray-50 rounded-lg border border-gray-100 overflow-hidden">
        {displayed.map((log: any, i: number) => (
          <div key={i} className={cn('flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-gray-50 transition-colors', categoryRowBg(log.category))}>
            <span className="text-gray-400 font-mono w-20 flex-shrink-0 text-[11px]" data-mono>{fmtTime(log.timestamp)}</span>
            <div className={cn('w-2 h-2 rounded-full flex-shrink-0', categoryDot(log.category))} />
            <span className="text-gray-800 font-medium w-28 truncate flex-shrink-0 text-[11px]">{log.activeApp || '—'}</span>
            <span className="text-gray-500 truncate flex-1 text-[11px]">{log.activeWindow || '—'}</span>
            <span className="text-gray-400 font-mono w-10 text-right flex-shrink-0 text-[10px]" data-mono>{log.durationSeconds}s</span>
            <span className={cn('font-mono w-12 text-right flex-shrink-0 text-[10px]', log.keystrokes > 0 ? 'text-blue-500' : 'text-gray-200')} data-mono>
              {log.keystrokes > 0 ? log.keystrokes.toLocaleString() : '—'}
            </span>
            <span className={cn('font-mono w-10 text-right flex-shrink-0 text-[10px]', log.mouseClicks > 0 ? 'text-purple-500' : 'text-gray-200')} data-mono>
              {log.mouseClicks > 0 ? log.mouseClicks : '—'}
            </span>
            <span className={cn('font-mono w-12 text-right flex-shrink-0 text-[10px]', log.mouseDistance > 0 ? 'text-indigo-400' : 'text-gray-200')} data-mono>
              {log.mouseDistance > 0 ? `${log.mouseDistance}px` : '—'}
            </span>
            <span className={cn('font-mono w-12 text-right flex-shrink-0 text-[10px]', log.idleSeconds > 60 ? 'text-amber-500' : 'text-gray-200')} data-mono>
              {log.idleSeconds > 0 ? `${log.idleSeconds}s` : '—'}
            </span>
          </div>
        ))}
      </div>

      {logs.length > 60 && !showAll && (
        <button onClick={() => setShowAll(true)}
          className="mt-3 w-full py-2 text-xs font-medium rounded-lg border transition-colors"
          style={{ color: 'var(--primary-color)', background: 'var(--primary-highlighted-color)', borderColor: 'var(--ui-border-color)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--primary-highlighted-color)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--primary-highlighted-color)')}>
          Show all {logs.length} entries ({logs.length - 60} more)
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Monthly Report Panel — HIGH-003
// ─────────────────────────────────────────────────────────────────────────────
function MonthlyReportPanel({ employeeId, employeeName, retentionDays }: { employeeId: string; employeeName: string; retentionDays: number }) {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  const todayStr = today.toISOString().split('T')[0];
  const [fromDate, setFromDate] = useState(firstOfMonth);
  const [toDate, setToDate] = useState(todayStr);

  const { data: reportRes, isLoading, isError } = useGetAgentReportQuery(
    { employeeId, from: fromDate, to: toDate },
    { skip: !employeeId }
  );
  const report = reportRes?.data;

  const gradeColor = (g: string) =>
    g === 'A+' || g === 'A' ? 'text-emerald-600' : g === 'B+' || g === 'B' ? 'text-blue-600' : g === 'C' ? 'text-amber-600' : 'text-red-500';

  return (
    <div className="space-y-3">
      {/* Range selector */}
      <div className="layer-card p-4 flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            min={minSelectableDate(retentionDays)} max={todayStr} className="input-glass text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            min={fromDate} max={todayStr} className="input-glass text-sm" />
        </div>
        <div className="flex gap-2">
          {[{ label: 'This month', fn: () => { setFromDate(firstOfMonth); setToDate(todayStr); } },
            { label: 'Last 7 days', fn: () => { const d = new Date(); d.setDate(d.getDate() - 6); setFromDate(d.toISOString().split('T')[0]); setToDate(todayStr); } },
            { label: 'Last 30 days', fn: () => { const d = new Date(); d.setDate(d.getDate() - 29); setFromDate(d.toISOString().split('T')[0]); setToDate(todayStr); } },
          ].map(p => (
            <button key={p.label} onClick={p.fn} className="py-1.5 px-3 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="layer-card p-10 text-center">
          <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mx-auto" style={{ borderColor: 'var(--primary-color)', borderTopColor: 'transparent' }} />
          <p className="text-sm text-gray-400 mt-2">Loading productivity report…</p>
        </div>
      )}

      {isError && (
        <div className="layer-card p-10 text-center">
          <WifiOff size={36} className="mx-auto text-red-300 mb-3" />
          <p className="text-sm text-red-500">Failed to load report. Try adjusting the date range.</p>
        </div>
      )}

      {report && !isLoading && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="layer-card p-4">
              <p className="text-[11px] text-gray-400 mb-1">Total Active</p>
              <p className="text-xl font-bold font-mono text-gray-800" data-mono>{fmtMinutes(report.summary.totalActiveMins)}</p>
              <p className="text-[10px] text-gray-400">{report.summary.daysWithData} days with data</p>
            </div>
            <div className="layer-card p-4">
              <p className="text-[11px] text-gray-400 mb-1">Avg Daily Score</p>
              <p className={cn('text-xl font-bold font-mono', gradeColor(report.summary.grade))} data-mono>
                {report.summary.averageDailyScore}%
              </p>
              <p className={cn('text-[11px] font-semibold', gradeColor(report.summary.grade))}>Grade {report.summary.grade}</p>
            </div>
            <div className="layer-card p-4">
              <p className="text-[11px] text-gray-400 mb-1">Productive Time</p>
              <p className="text-xl font-bold font-mono text-emerald-600" data-mono>{fmtMinutes(report.summary.totalProductiveMins)}</p>
              <p className="text-[10px] text-gray-400">of {fmtMinutes(report.summary.totalActiveMins)} active</p>
            </div>
            <div className="layer-card p-4">
              <p className="text-[11px] text-gray-400 mb-1">Unproductive</p>
              <p className="text-xl font-bold font-mono text-red-500" data-mono>{fmtMinutes(report.summary.totalUnproductiveMins)}</p>
              <p className="text-[10px] text-gray-400">distractions tracked</p>
            </div>
          </div>

          {/* Day-by-day breakdown */}
          {report.days.length > 0 && (
            <div className="layer-card p-4">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <BarChart2 size={12} /> Daily Breakdown
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] text-gray-400 border-b border-gray-100">
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium text-right">Active</th>
                      <th className="pb-2 font-medium text-right">Productive</th>
                      <th className="pb-2 font-medium text-right">Score</th>
                      <th className="pb-2 font-medium text-right">Grade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {report.days.filter(d => d.activeMinutes > 0).map(d => (
                      <tr key={d.date} className="hover:bg-gray-50">
                        <td className="py-1.5 font-mono text-gray-600" data-mono>{d.date}</td>
                        <td className="py-1.5 text-right text-gray-700">{fmtMinutes(d.activeMinutes)}</td>
                        <td className="py-1.5 text-right text-emerald-600">{fmtMinutes(d.productiveMinutes)}</td>
                        <td className="py-1.5 text-right font-mono font-semibold" data-mono
                          style={{ color: d.productivityScore !== null && d.productivityScore >= 70 ? '#10b981' : d.productivityScore !== null && d.productivityScore >= 40 ? '#f59e0b' : '#ef4444' }}>
                          {d.productivityScore !== null ? `${d.productivityScore}%` : '—'}
                        </td>
                        <td className={cn('py-1.5 text-right font-semibold', gradeColor(d.grade))}>{d.grade}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Top apps over range */}
          {report.topApps.length > 0 && (
            <div className="layer-card p-4">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <Monitor size={12} /> Top Applications ({fromDate} → {toDate})
              </h4>
              <div className="space-y-2">
                {report.topApps.slice(0, 8).map(app => (
                  <div key={app.app} className="flex items-center gap-2">
                    <span className="text-xs text-gray-700 w-40 truncate flex-shrink-0">{app.app}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2">
                      <div className="h-2 rounded-full transition-all" style={{ width: `${app.percentage}%`, background: 'var(--primary-color)' }} />
                    </div>
                    <span className="text-[10px] text-gray-500 w-10 text-right flex-shrink-0">{fmtMinutes(app.minutes)}</span>
                    <span className="text-[10px] text-gray-400 w-8 text-right flex-shrink-0">{app.percentage}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {report.days.filter(d => d.activeMinutes > 0).length === 0 && (
            <div className="layer-card p-10 text-center">
              <Activity size={40} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm text-gray-500">No activity data for the selected range</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Screenshot Interval Control
// ─────────────────────────────────────────────────────────────────────────────
function ScreenshotIntervalControl({ employeeId }: { employeeId: string }) {
  const { data: intervalRes } = useGetAgentScreenshotIntervalQuery(employeeId);
  const [setInterval, { isLoading }] = useSetAgentScreenshotIntervalMutation();
  const current = intervalRes?.data?.intervalSeconds ?? 600;

  const options = [
    { value: 60, label: '1 min' },
    { value: 300, label: '5 min' },
    { value: 600, label: '10 min' },
    { value: 900, label: '15 min' },
    { value: 1800, label: '30 min' },
    { value: 3600, label: '60 min' },
  ];

  const handleChange = async (val: number) => {
    try {
      await setInterval({ employeeId, intervalSeconds: val }).unwrap();
      toast.success(`Screenshot interval set to ${options.find(o => o.value === val)?.label}`);
    } catch {
      toast.error('Failed to update screenshot interval');
    }
  };

  return (
    <div className="layer-card p-3 flex items-center gap-3">
      <Camera size={14} style={{ color: 'var(--primary-color)' }} className="flex-shrink-0" />
      <span className="text-xs font-medium text-gray-700">Screenshot interval:</span>
      <select value={current} onChange={e => handleChange(Number(e.target.value))} disabled={isLoading}
        className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none disabled:opacity-50">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span className="text-[10px] text-gray-400">Current: {options.find(o => o.value === current)?.label ?? `${current}s`}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete Date Data Button
// ─────────────────────────────────────────────────────────────────────────────
function DeleteDateDataButton({ employeeId, date, hasData }: { employeeId: string; date: string; hasData: boolean }) {
  const [deleteData, { isLoading }] = useDeleteAgentActivityByDateMutation();
  const [confirming, setConfirming] = useState(false);

  if (!hasData) return null;

  const handleDelete = async () => {
    try {
      const result = await deleteData({ employeeId, date }).unwrap();
      toast.success(`Deleted ${result.data.logsDeleted} logs and ${result.data.screenshotsDeleted} screenshots for ${date}`);
      setConfirming(false);
    } catch {
      toast.error('Failed to delete data');
      setConfirming(false);
    }
  };

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-red-600 font-medium">Delete all data for {date}?</span>
        <button onClick={handleDelete} disabled={isLoading}
          className="px-2.5 py-1 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50">
          {isLoading ? 'Deleting…' : 'Confirm'}
        </button>
        <button onClick={() => setConfirming(false)}
          className="px-2.5 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button onClick={() => setConfirming(true)}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors">
      <X size={12} /> Delete Date Data
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Export Range Modal
// ─────────────────────────────────────────────────────────────────────────────
function ExportRangeModal({ employeeId, employeeCode, retentionDays, onClose }: { employeeId: string; employeeCode: string; retentionDays: number; onClose: () => void }) {
  const today = new Date().toISOString().split('T')[0];
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().split('T')[0];
  });
  const [toDate, setToDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [triggerExport] = useLazyDownloadActivityExcelQuery();
  const abortRef = useRef<AbortController | null>(null); // HIGH-008: cancel in-flight exports on modal close

  // HIGH-008: Cancel any in-flight export requests when the modal unmounts
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const setPreset = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days + 1);
    setFromDate(from.toISOString().split('T')[0]);
    setToDate(to.toISOString().split('T')[0]);
  };

  const handleExport = async () => {
    const from = new Date(fromDate + 'T00:00:00Z');
    const to = new Date(toDate + 'T00:00:00Z');
    if (from > to) { toast.error('From date must be before To date'); return; }
    const maxDays = 31;
    const diffDays = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (diffDays > maxDays) { toast.error(`Range too large — max ${maxDays} days at once`); return; }

    abortRef.current = new AbortController();
    setLoading(true);
    const dates: string[] = [];
    const cur = new Date(from);
    while (cur <= to) {
      dates.push(cur.toISOString().split('T')[0]);
      cur.setDate(cur.getDate() + 1);
    }

    let exported = 0;
    for (const date of dates) {
      if (abortRef.current?.signal.aborted) break;
      try {
        const result = await triggerExport({ employeeId, date });
        if (result.data) {
          const url = URL.createObjectURL(result.data);
          const a = document.createElement('a');
          a.href = url;
          a.download = `activity-${employeeCode}-${date}.xlsx`;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(url);
          exported++;
        }
      } catch { /* skip empty dates */ }
      await new Promise(r => setTimeout(r, 300)); // small delay between downloads
    }
    toast.success(`Exported ${exported} file(s) for ${fromDate} → ${toDate}`);
    setLoading(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-96" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <Download size={16} style={{ color: 'var(--primary-color)' }} /> Export Activity Range
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="flex gap-2 mb-4">
          {[{ label: 'This week', days: 7 }, { label: '2 weeks', days: 14 }, { label: 'This month', days: 30 }].map(p => (
            <button key={p.label} onClick={() => setPreset(p.days)}
              className="flex-1 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              {p.label}
            </button>
          ))}
        </div>

        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              min={minSelectableDate(retentionDays)} max={today} className="input-glass text-sm w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              min={minSelectableDate(retentionDays)} max={today} className="input-glass text-sm w-full" />
          </div>
        </div>

        <p className="text-[10px] text-gray-400 mb-4">One Excel file per day will be downloaded. Max 31 days.</p>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors">Cancel</button>
          <button onClick={handleExport} disabled={loading}
            className="flex-1 py-2 text-sm font-medium text-white rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
            style={{ background: 'var(--primary-color)' }}>
            {loading ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Exporting…</> : <><Download size={14} /> Export</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete Range Modal
// ─────────────────────────────────────────────────────────────────────────────
function DeleteRangeModal({ employeeId, retentionDays, onClose }: { employeeId: string; retentionDays: number; onClose: () => void }) {
  const today = new Date().toISOString().split('T')[0];
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().split('T')[0];
  });
  const [toDate, setToDate] = useState(today);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleteData] = useDeleteAgentActivityByDateMutation();
  const dispatch = useAppDispatch();

  const setPreset = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days + 1);
    setFromDate(from.toISOString().split('T')[0]);
    setToDate(to.toISOString().split('T')[0]);
  };

  const handleDelete = async () => {
    const from = new Date(fromDate + 'T00:00:00Z');
    const to = new Date(toDate + 'T00:00:00Z');
    if (from > to) { toast.error('From date must be before To date'); return; }

    setLoading(true);
    const dates: string[] = [];
    const cur = new Date(from);
    while (cur <= to) {
      dates.push(cur.toISOString().split('T')[0]);
      cur.setDate(cur.getDate() + 1);
    }

    let totalLogs = 0, totalScreenshots = 0;
    for (const date of dates) {
      try {
        const result = await deleteData({ employeeId, date }).unwrap();
        totalLogs += result.data?.logsDeleted || 0;
        totalScreenshots += result.data?.screenshotsDeleted || 0;
      } catch { /* skip empty dates */ }
    }
    // HIGH-004: Force invalidation of all activity-related cache after the full delete loop.
    // The per-mutation invalidatesTags fires after each individual delete but RTK dedups them;
    // this final explicit invalidation ensures the UI refreshes once when the modal closes.
    dispatch(attendanceApi.util.invalidateTags(['Attendance']));
    toast.success(`Deleted ${totalLogs} logs and ${totalScreenshots} screenshots (${fromDate} → ${toDate})`);
    setLoading(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-96" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-red-700 flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-500" /> Delete Activity Range
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {!confirming ? (
          <>
            <div className="flex gap-2 mb-4">
              {[{ label: 'This week', days: 7 }, { label: '2 weeks', days: 14 }, { label: 'This month', days: 30 }].map(p => (
                <button key={p.label} onClick={() => setPreset(p.days)}
                  className="flex-1 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  {p.label}
                </button>
              ))}
            </div>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
                <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                  min={minSelectableDate(retentionDays)} max={today} className="input-glass text-sm w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                  min={minSelectableDate(retentionDays)} max={today} className="input-glass text-sm w-full" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200">Cancel</button>
              <button onClick={() => setConfirming(true)} className="flex-1 py-2 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700">
                Review & Delete
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
              <p className="text-sm font-semibold text-red-700 mb-1">⚠ This is permanent</p>
              <p className="text-xs text-red-600">Delete ALL activity logs and screenshots from <strong>{fromDate}</strong> to <strong>{toDate}</strong>? This also deletes screenshot files from disk. Cannot be undone.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirming(false)} className="flex-1 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl">Back</button>
              <button onClick={handleDelete} disabled={loading}
                className="flex-1 py-2 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
                {loading ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Deleting…</> : 'Confirm Delete'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Screenshots Gallery with pagination
// ─────────────────────────────────────────────────────────────────────────────
const SCREENSHOTS_PER_PAGE = 48;

function ScreenshotCard({ s, employeeId, date, onScreenshotClick, onDeleted }: {
  s: any; employeeId: string; date: string; onScreenshotClick: (url: string) => void; onDeleted: (id: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteScreenshot, { isLoading: deleting }] = useDeleteAgentScreenshotMutation();

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      // ACT-001: pass employeeId + date so RTK Query can invalidate the screenshots cache tag
      await deleteScreenshot({ screenshotId: s.id, employeeId, date }).unwrap();
      toast.success('Screenshot deleted');
      onDeleted(s.id);
    } catch {
      toast.error('Failed to delete screenshot');
    } finally {
      setConfirmDelete(false);
    }
  };

  return (
    <div key={s.id} className="group relative rounded-lg overflow-hidden border border-gray-200 hover:shadow-md transition-all"
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--primary-color)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = '')}>
      <div className="cursor-pointer" onClick={() => onScreenshotClick(`${API_BASE}${s.imageUrl}`)}>
        <img src={`${API_BASE}${s.imageUrl}`} alt={s.activeApp || 'Screenshot'} className="w-full h-28 object-cover" loading="lazy" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
          <Maximize2 size={18} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
        <p className="text-[9px] text-white truncate font-medium">{s.activeApp || 'Desktop'}</p>
        <p className="text-[8px] text-gray-300">{fmtTimeShort(s.timestamp)}</p>
      </div>
      {/* Delete button — top-right, shown on hover */}
      {!confirmDelete ? (
        <button
          onClick={e => { e.stopPropagation(); setConfirmDelete(true); }}
          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 hover:bg-red-600 text-white rounded-md p-1"
          title="Delete screenshot">
          <X size={11} />
        </button>
      ) : (
        <div className="absolute top-1 right-1 flex items-center gap-1 bg-black/80 rounded-md px-1.5 py-1 z-10" onClick={e => e.stopPropagation()}>
          <span className="text-[9px] text-white">Delete?</span>
          <button onClick={handleDelete} disabled={deleting}
            className="text-[9px] text-red-400 hover:text-red-300 font-semibold disabled:opacity-50">
            {deleting ? '…' : 'Yes'}
          </button>
          <button onClick={e => { e.stopPropagation(); setConfirmDelete(false); }}
            className="text-[9px] text-gray-300 hover:text-white">No</button>
        </div>
      )}
    </div>
  );
}

function ScreenshotsGallery({ screenshots, loading, fetching, onScreenshotClick, resetKey, employeeId, date, intervalSeconds }: {
  screenshots: any[]; loading: boolean; fetching?: boolean; onScreenshotClick: (url: string) => void; resetKey?: string; employeeId: string; date: string; intervalSeconds?: number;
}) {
  const [visible, setVisible] = useState(SCREENSHOTS_PER_PAGE);
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  useEffect(() => { setVisible(SCREENSHOTS_PER_PAGE); setDeleted(new Set()); }, [resetKey]);

  const filtered = screenshots.filter(s => !deleted.has(s.id));
  const shown = filtered.slice(0, visible);
  const hasMore = filtered.length > visible;

  return (
    <div className="layer-card p-4 relative">
      {/* MED-007: overlay while refetching on date change so stale screenshots don't mislead */}
      {fetching && !loading && (
        <div className="absolute inset-0 bg-white/70 backdrop-blur-[2px] rounded-xl z-10 flex items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            Loading screenshots…
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Camera size={14} style={{ color: 'var(--primary-color)' }} />
          Screenshots
          <span className="text-xs text-gray-400 font-normal">({loading || fetching ? '…' : filtered.length} captured)</span>
        </h3>
        {filtered.length > SCREENSHOTS_PER_PAGE && (
          <span className="text-[10px] text-gray-400">Showing {Math.min(visible, filtered.length)} of {filtered.length}</span>
        )}
      </div>
      {shown.length > 0 ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {shown.map((s: any) => (
              <ScreenshotCard key={s.id} s={s} employeeId={employeeId} date={date} onScreenshotClick={onScreenshotClick}
                onDeleted={id => setDeleted(prev => new Set([...prev, id]))} />
            ))}
          </div>
          {hasMore && (
            <button onClick={() => setVisible(v => v + SCREENSHOTS_PER_PAGE)}
              className="mt-3 w-full py-2 text-xs font-medium rounded-lg border transition-colors"
              style={{ color: 'var(--primary-color)', background: 'var(--primary-highlighted-color)', borderColor: 'var(--ui-border-color)' }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
              Load more ({filtered.length - visible} remaining)
            </button>
          )}
        </>
      ) : (
        <div className="text-center py-10">
          <Camera size={32} className="mx-auto text-gray-200 mb-2" />
          <p className="text-xs text-gray-400">No screenshots captured for this date</p>
          <p className="text-[10px] text-gray-300 mt-1">
            Agent captures screenshots every {intervalSeconds && intervalSeconds < 60
              ? `${intervalSeconds}s`
              : `${Math.round((intervalSeconds ?? 600) / 60)} min`}
          </p>
        </div>
      )}
    </div>
  );
}
