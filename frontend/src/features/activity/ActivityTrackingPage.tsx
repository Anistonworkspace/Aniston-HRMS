import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Monitor, Search, Calendar, Eye, Activity, Clock, Mouse, Keyboard,
  WifiOff, X, Maximize2, Radio, Globe, Download, TrendingDown, TrendingUp,
  Camera, Footprints, Info, ChevronDown, ChevronUp, BarChart2, List,
  AlertTriangle, CheckCircle2, MinusCircle, Zap,
} from 'lucide-react';
import { useGetEmployeesQuery } from '../employee/employeeApi';
import {
  useGetActivityBulkSummaryQuery, useGetEmployeeActivityLogsQuery, useGetEmployeeScreenshotsQuery,
  useSetAgentLiveModeMutation, useGetAgentLiveModeQuery, useGetEmployeeAgentStatusQuery,
  useLazyDownloadActivityExcelQuery,
  useGetAgentScreenshotIntervalQuery, useSetAgentScreenshotIntervalMutation, useDeleteAgentActivityByDateMutation,
} from '../attendance/attendanceApi';
import { useGetAgentSetupListQuery } from '../settings/settingsApi';
import { getInitials, cn } from '../../lib/utils';
import { onSocketEvent, offSocketEvent, getSocket } from '../../lib/socket';

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
const RETENTION_DAYS = 30; // must match ACTIVITY_RETENTION_DAYS env var

/** Returns true if a YYYY-MM-DD date string is older than the retention window */
function isExpired(dateStr: string): boolean {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  cutoff.setHours(0, 0, 0, 0);
  return new Date(dateStr + 'T00:00:00.000Z') < cutoff;
}

/** Oldest selectable date = today minus retention days */
function minSelectableDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - RETENTION_DAYS);
  return d.toISOString().split('T')[0];
}

export default function ActivityTrackingPage() {
  const [rawDate, setRawDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedDate, setSelectedDate] = useState(rawDate);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [fullScreenshot, setFullScreenshot] = useState<string | null>(null);

  const dateExpired = isExpired(selectedDate);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleDateChange = (value: string) => {
    setRawDate(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSelectedDate(value), 300);
  };

  const { data: empRes, isLoading: loadingEmps } = useGetEmployeesQuery({ page: 1, limit: 100 });
  const employees = empRes?.data || [];

  const { data: bulkSummaryRes } = useGetActivityBulkSummaryQuery({ date: selectedDate }, { pollingInterval: 120_000 });
  const bulkSummary = bulkSummaryRes?.data;

  const { data: agentSetupRes } = useGetAgentSetupListQuery(undefined, { pollingInterval: 30_000 });
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

  const [liveConnected, setLiveConnected] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const handler = (data: any) => {
      if (data?.employeeId) setLiveConnected(prev => ({ ...prev, [data.employeeId]: true }));
    };
    onSocketEvent('agent:heartbeat', handler);
    return () => { offSocketEvent('agent:heartbeat', handler); };
  }, []);
  useEffect(() => {
    const ticker = setInterval(() => {
      setLiveConnected(prev => Object.keys(prev).length === 0 ? prev : {});
    }, 120_000);
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
            <Monitor size={24} className="text-brand-600" />
            Activity Tracking
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">Desktop agent monitoring — keystrokes, apps, screenshots & productivity</p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={15} className="text-gray-400" />
          <input type="date" value={rawDate} onChange={e => handleDateChange(e.target.value)}
            min={minSelectableDate()}
            max={new Date().toISOString().split('T')[0]}
            className="input-glass text-sm" />
        </div>
      </div>

      {/* ── Retention Notice ── */}
      {dateExpired && (
        <div className="mb-3 flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5 text-amber-500" />
          <div>
            <span className="font-semibold">Data not available.</span> Activity data older than {RETENTION_DAYS} days is automatically deleted per our data retention policy. Please select a date within the last {RETENTION_DAYS} days.
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
                className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-300" />
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5">{filteredEmployees.length} employees shown</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingEmps ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredEmployees.length === 0 ? (
              <p className="text-center text-gray-400 text-xs py-8">No employees found</p>
            ) : (
              (filteredEmployees as any[]).map((emp: any) => (
                <EmployeeRow
                  key={emp.id}
                  employee={emp}
                  isSelected={selectedEmployee?.id === emp.id}
                  bulkSummary={bulkSummary}
                  agentStatus={agentStatusMap[emp.id]}
                  isLiveConnected={!!liveConnected[emp.id]}
                  onClick={() => setSelectedEmployee(emp)}
                />
              ))
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
        isSelected ? 'bg-brand-50 border-l-2 border-l-brand-500' : 'hover:bg-gray-50'
      )}>
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
  const [viewMode, setViewMode] = useState<'overview' | 'timeline' | 'screenshots' | 'live'>('overview');
  const [exporting, setExporting] = useState(false);
  const employeeUserId: string | undefined = employee?.user?.id;
  const dateExpired = isExpired(date);

  const { data: activityRes, isLoading: loadingActivity, isError: activityError } = useGetEmployeeActivityLogsQuery(
    { employeeId: employee.id, date },
    { pollingInterval: viewMode === 'live' ? 15000 : 60000, skip: dateExpired }
  );
  const { data: screenshotRes, isLoading: loadingScreenshots } = useGetEmployeeScreenshotsQuery(
    { employeeId: employee.id, date },
    { pollingInterval: viewMode === 'live' ? 15000 : 120000, skip: dateExpired }
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

  const isConnected = agentStatus?.isActive;
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
            <div className="w-12 h-12 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-lg font-bold flex-shrink-0">
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
            {/* Agent status pill */}
            <div className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium', agentBg, agentLabelColor)}>
              <div className={cn('w-1.5 h-1.5 rounded-full', agentDotColor)} />
              {agentLabel}
              {agentStatus?.lastHeartbeat && !isConnected && (
                <span className="text-gray-400 font-normal ml-1">· {fmtTimeShort(agentStatus.lastHeartbeat)}</span>
              )}
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
            <DeleteDateDataButton employeeId={employee.id} date={date} hasData={hasData} />
          </div>
        </div>

        {/* View mode tabs */}
        <div className="flex bg-gray-100 rounded-lg p-0.5 w-fit mt-3">
          {([
            { key: 'overview', icon: BarChart2, label: 'Overview', live: false },
            { key: 'timeline', icon: List, label: 'Timeline', live: false },
            { key: 'screenshots', icon: Camera, label: 'Screenshots', badge: screenshots.length || null, live: false },
            { key: 'live', icon: Radio, label: 'Live Feed', live: true },
          ] as const).map(tab => (
            <button key={tab.key} onClick={() => setViewMode(tab.key as any)}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                viewMode === tab.key
                  ? tab.live ? 'bg-white text-red-600 shadow-sm' : 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700')}>
              <tab.icon size={13} className={viewMode === tab.key && tab.live ? 'animate-pulse' : ''} />
              {tab.label}
              {'badge' in tab && tab.badge != null && tab.badge > 0 && (
                <span className="text-[9px] bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded-full font-semibold">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Screenshot interval + data management */}
      <ScreenshotIntervalControl employeeId={employee.id} />

      {/* ── Retention Expired State ── */}
      {dateExpired && (
        <div className="layer-card p-10 text-center">
          <AlertTriangle size={40} className="mx-auto text-amber-300 mb-3" />
          <p className="text-sm font-semibold text-gray-600 mb-1">Data deleted — retention policy</p>
          <p className="text-xs text-gray-400">Activity data for <strong>{date}</strong> has been automatically deleted after {RETENTION_DAYS} days.<br />Select a date within the last {RETENTION_DAYS} days to view data.</p>
        </div>
      )}

      {/* ── No Data State ── */}
      {!dateExpired && viewMode !== 'live' && !loadingActivity && !activityError && !hasData && (
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
      {!dateExpired && viewMode !== 'live' && loadingActivity && (
        <div className="layer-card p-10 text-center">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400 mt-2">Loading activity data…</p>
        </div>
      )}

      {/* ── Error ── */}
      {!dateExpired && viewMode !== 'live' && activityError && (
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
              sub="tracked work time" />
            <KpiCard
              icon={MinusCircle} iconBg="bg-amber-50" iconColor="text-amber-600"
              label="Idle Time" value={fmtMinutes(summary.totalIdleMinutes)}
              sub="no input detected" />
            <KpiCard
              icon={Keyboard} iconBg="bg-blue-50" iconColor="text-blue-600"
              label="Keystrokes" value={summary.totalKeystrokes.toLocaleString()}
              sub="keys pressed" />
            <KpiCard
              icon={Mouse} iconBg="bg-purple-50" iconColor="text-purple-600"
              label="Mouse Clicks" value={summary.totalClicks.toLocaleString()}
              sub="click events" />
            <KpiCard
              icon={Footprints} iconBg="bg-indigo-50" iconColor="text-indigo-600"
              label="Mouse Travel" value={`${(summary.totalMouseDistance / 1000).toFixed(1)}k px`}
              sub="cursor distance" />
            <ProductivityRing
              score={summary.productivityScore}
              productiveMinutes={summary.productiveMinutes}
              unproductiveMinutes={summary.unproductiveMinutes}
              neutralMinutes={summary.totalActiveMinutes - summary.productiveMinutes - summary.unproductiveMinutes}
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
                  <Camera size={14} className="text-brand-500" /> Recent Screenshots
                  <span className="text-xs text-gray-400 font-normal">({screenshots.length} total)</span>
                </h3>
                <button onClick={() => setViewMode('screenshots')}
                  className="text-[11px] text-brand-600 hover:underline">View all</button>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {[...screenshots].reverse().slice(0, 4).map((s: any) => (
                  <div key={s.id} className="group relative cursor-pointer rounded-lg overflow-hidden border border-gray-200 hover:border-brand-300 hover:shadow-md transition-all"
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
          onScreenshotClick={onScreenshotClick}
          resetKey={`${employee.id}-${date}`}
        />
      )}

      {/* ── LIVE FEED TAB ── */}
      {viewMode === 'live' && (
        <LiveFeedPanel
          employeeId={employee.id}
          employeeUserId={employeeUserId}
          screenshots={screenshots}
          onScreenshotClick={onScreenshotClick}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI Card
// ─────────────────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, iconBg, iconColor, label, value, sub }: {
  icon: any; iconBg: string; iconColor: string; label: string; value: string; sub: string;
}) {
  return (
    <div className="layer-card p-4">
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center mb-2', iconBg)}>
        <Icon size={16} className={iconColor} />
      </div>
      <p className="text-[11px] text-gray-400 mb-0.5">{label}</p>
      <p className="text-xl font-bold font-mono text-gray-800 leading-tight" data-mono>{value}</p>
      <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Productivity Ring (circular SVG)
// ─────────────────────────────────────────────────────────────────────────────
function ProductivityRing({ score, productiveMinutes, unproductiveMinutes, neutralMinutes }: {
  score: number | null; productiveMinutes: number; unproductiveMinutes: number; neutralMinutes: number;
}) {
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const pct = score ?? 0;
  const offset = circumference - (pct / 100) * circumference;
  const color = pct >= 70 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444';
  const label = pct >= 70 ? 'High' : pct >= 40 ? 'Medium' : 'Low';

  return (
    <div className="layer-card p-4 col-span-1">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
          {pct >= 40 ? <TrendingUp size={16} className="text-indigo-600" /> : <TrendingDown size={16} className="text-red-500" />}
        </div>
      </div>
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
          <BarChart2 size={14} className="text-brand-500" /> Productivity Breakdown
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
        <Activity size={14} className="text-brand-500" /> Top Applications
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
          <List size={14} className="text-brand-500" /> Activity Timeline
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
          className="mt-3 w-full py-2 text-xs font-medium text-brand-600 bg-brand-50 border border-brand-200 rounded-lg hover:bg-brand-100 transition-colors">
          Show all {logs.length} entries ({logs.length - 60} more)
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Live Feed Panel
// ─────────────────────────────────────────────────────────────────────────────
function LiveFeedPanel({ employeeId, employeeUserId, screenshots, onScreenshotClick }: {
  employeeId: string; employeeUserId: string | undefined; screenshots: any[]; onScreenshotClick: (url: string) => void;
}) {
  const [liveData, setLiveData] = useState<any>(null);
  const [feedLog, setFeedLog] = useState<any[]>([]);
  const [interval, setInterval_] = useState(30);
  const [setLiveMode] = useSetAgentLiveModeMutation();
  const { data: liveModeRes } = useGetAgentLiveModeQuery(employeeId, { pollingInterval: 10000 });
  const isLive = liveModeRes?.data?.enabled || false;

  useEffect(() => {
    if (liveModeRes?.data?.intervalSeconds) setInterval_(liveModeRes.data.intervalSeconds);
  }, [liveModeRes?.data?.intervalSeconds]);

  useEffect(() => {
    const handleHeartbeat = (data: any) => {
      if (data.employeeId === employeeId) {
        setLiveData(data);
        setFeedLog(prev => [data, ...prev].slice(0, 50));
      }
    };
    onSocketEvent('agent:heartbeat', handleHeartbeat);
    return () => { offSocketEvent('agent:heartbeat', handleHeartbeat); };
  }, [employeeId]);

  const latestScreenshot = screenshots.length > 0 ? screenshots[screenshots.length - 1] : null;

  return (
    <div className="space-y-3">
      {/* Live Controls */}
      <div className="layer-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn('w-2.5 h-2.5 rounded-full', isLive ? 'bg-red-500 animate-pulse' : 'bg-gray-300')} />
            <h4 className="text-sm font-semibold text-gray-800">{isLive ? 'Live View Active' : 'Live View Off'}</h4>
            {isLive && liveData && (
              <span className="text-[10px] text-gray-400">
                · Last data at {fmtTime(liveData.timestamp)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <select value={interval} onChange={e => setInterval_(Number(e.target.value))}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-300">
              <option value={10}>Every 10s</option>
              <option value={30}>Every 30s</option>
              <option value={60}>Every 60s</option>
            </select>
            {isLive ? (
              <button onClick={() => setLiveMode({ employeeId, enabled: false })}
                className="px-4 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors">
                Stop Live View
              </button>
            ) : (
              <button onClick={() => setLiveMode({ employeeId, enabled: true, intervalSeconds: interval })}
                className="px-4 py-1.5 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors flex items-center gap-1">
                <Radio size={12} /> Start Live View
              </button>
            )}
          </div>
        </div>
        {isLive && (
          <p className="text-[10px] text-gray-400 mt-2">
            Agent captures a screenshot every <strong>{interval}s</strong> and sends activity data in real-time.
          </p>
        )}
      </div>

      {/* Current window info */}
      {liveData && (
        <div className="layer-card p-4">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Monitor size={12} /> Current Activity (live)
          </h4>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-[10px] text-gray-400 mb-1">Application</p>
              <p className="text-sm font-semibold text-gray-800 truncate">{liveData.activeApp || 'Unknown'}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 col-span-1 lg:col-span-1">
              <p className="text-[10px] text-gray-400 mb-1">Status</p>
              <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                liveData.category === 'PRODUCTIVE' ? 'bg-emerald-100 text-emerald-700' :
                liveData.category === 'UNPRODUCTIVE' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600')}>
                {liveData.category || 'NEUTRAL'}
              </span>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-[10px] text-gray-400 mb-1">Keystrokes (batch)</p>
              <p className="text-sm font-bold text-blue-600 font-mono" data-mono>{liveData.keystrokes?.toLocaleString() || 0}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-[10px] text-gray-400 mb-1">Idle Time</p>
              <p className={cn('text-sm font-bold font-mono', liveData.idleSeconds > 120 ? 'text-amber-600' : 'text-gray-700')} data-mono>
                {liveData.idleSeconds > 0 ? `${liveData.idleSeconds}s` : 'Active'}
              </p>
            </div>
          </div>
          {liveData.activeWindow && (
            <div className="mt-2 bg-gray-50 rounded-lg px-3 py-2">
              <p className="text-[10px] text-gray-400 mb-0.5">Window Title</p>
              <p className="text-xs text-gray-700 truncate">{liveData.activeWindow}</p>
            </div>
          )}
        </div>
      )}

      {/* WebRTC Live Screen */}
      <LiveVideoStream employeeId={employeeId} employeeUserId={employeeUserId} />

      {/* Latest Screenshot */}
      <div className="layer-card p-4">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1">
          <Eye size={12} /> Latest Screenshot
        </h4>
        {latestScreenshot ? (
          <div className="relative cursor-pointer rounded-lg overflow-hidden border border-gray-200 hover:border-brand-300 transition-colors"
            onClick={() => onScreenshotClick(`${API_BASE}${latestScreenshot.imageUrl}`)}>
            <img src={`${API_BASE}${latestScreenshot.imageUrl}`} alt="Latest screenshot"
              className="w-full h-auto max-h-96 object-contain bg-gray-900" />
            <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded">
              {fmtTime(latestScreenshot.timestamp)} · {latestScreenshot.activeApp || 'Desktop'}
            </div>
          </div>
        ) : (
          <div className="bg-gray-100 rounded-lg h-40 flex items-center justify-center">
            <p className="text-xs text-gray-400">No screenshots yet</p>
          </div>
        )}
      </div>

      {/* Real-time Feed Log */}
      <div className="layer-card p-4">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1">
          <Activity size={12} /> Real-time Feed
          <span className="text-[10px] text-gray-400 font-normal ml-1">(socket events, newest first)</span>
        </h4>
        {feedLog.length > 0 ? (
          <div className="divide-y divide-gray-50 rounded-lg border border-gray-100 overflow-hidden max-h-64 overflow-y-auto">
            {feedLog.map((entry, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50">
                <span className="text-gray-400 font-mono w-16 flex-shrink-0 text-[10px]" data-mono>{fmtTime(entry.timestamp)}</span>
                <div className={cn('w-2 h-2 rounded-full flex-shrink-0',
                  entry.category === 'PRODUCTIVE' ? 'bg-emerald-500' :
                  entry.category === 'UNPRODUCTIVE' ? 'bg-red-400' : 'bg-gray-300')} />
                <span className="text-gray-700 font-medium w-28 truncate flex-shrink-0 text-[11px]">{entry.activeApp}</span>
                <span className="text-gray-400 truncate flex-1 text-[11px]">{entry.activeWindow}</span>
                {entry.keystrokes > 0 && (
                  <span className="text-blue-500 flex items-center gap-0.5 flex-shrink-0 text-[10px]">
                    <Keyboard size={9} /> {entry.keystrokes}
                  </span>
                )}
                {entry.mouseClicks > 0 && (
                  <span className="text-purple-500 flex items-center gap-0.5 flex-shrink-0 text-[10px]">
                    <Mouse size={9} /> {entry.mouseClicks}
                  </span>
                )}
                {entry.mouseDistance > 0 && (
                  <span className="text-indigo-400 flex items-center gap-0.5 flex-shrink-0 text-[10px]">
                    <Footprints size={9} /> {entry.mouseDistance}px
                  </span>
                )}
              </motion.div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 text-center py-6">
            Waiting for live data… Start the agent on the employee's PC and enable Live View above.
          </p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WebRTC Live Video Stream
// ─────────────────────────────────────────────────────────────────────────────
function LiveVideoStream({ employeeId, employeeUserId }: { employeeId: string; employeeUserId: string | undefined }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const agentSocketIdRef = useRef<string | null>(null);
  const signalHandlerRef = useRef<((data: any) => void) | null>(null);
  const streamErrorHandlerRef = useRef<((data: any) => void) | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: agentStatusRes } = useGetEmployeeAgentStatusQuery(employeeId, { pollingInterval: 15000, skip: !employeeId });
  const agentIsActive = agentStatusRes?.data?.isActive ?? false;
  const lastHeartbeat = agentStatusRes?.data?.lastHeartbeat;

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      const socket = getSocket();
      if (socket) {
        if (signalHandlerRef.current) socket.off('stream:signal', signalHandlerRef.current);
        if (streamErrorHandlerRef.current) socket.off('stream:error', streamErrorHandlerRef.current);
      }
      if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    };
  }, []);

  const stopLiveStream = useCallback(() => {
    const socket = getSocket();
    if (socket && employeeUserId) socket.emit('stream:stop-request', { employeeUserId });
    if (socket) {
      if (signalHandlerRef.current) { socket.off('stream:signal', signalHandlerRef.current); signalHandlerRef.current = null; }
      if (streamErrorHandlerRef.current) { socket.off('stream:error', streamErrorHandlerRef.current); streamErrorHandlerRef.current = null; }
    }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    setStreaming(false); setConnecting(false);
  }, [employeeUserId]);

  const startLiveStream = useCallback(() => {
    if (!employeeUserId) { setError('Employee user account not found'); return; }
    setConnecting(true); setError(null);
    const socket = getSocket();
    if (!socket?.connected) { setError('Real-time connection unavailable. Please refresh.'); setConnecting(false); return; }

    if (signalHandlerRef.current) socket.off('stream:signal', signalHandlerRef.current);
    if (streamErrorHandlerRef.current) socket.off('stream:error', streamErrorHandlerRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    const handleStreamError = (data: any) => {
      if (!data.employeeUserId || data.employeeUserId === employeeUserId) {
        setError(data.message || 'Agent is not connected'); setConnecting(false);
      }
    };
    streamErrorHandlerRef.current = handleStreamError;
    socket.on('stream:error', handleStreamError);

    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] });
    pcRef.current = pc;

    pc.ontrack = (event) => {
      if (videoRef.current && event.streams[0]) {
        videoRef.current.srcObject = event.streams[0];
        setStreaming(true); setConnecting(false);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      }
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) socket.emit('stream:signal', { type: 'ice-candidate', candidate: event.candidate, targetSocketId: agentSocketIdRef.current });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setStreaming(false); setError('Stream disconnected — agent may have gone offline');
      }
    };

    const handleSignal = (data: any) => {
      if (data.type === 'offer' && data.sdp) {
        agentSocketIdRef.current = data.fromSocketId;
        pc.setRemoteDescription(data.sdp)
          .then(() => pc.createAnswer())
          .then(answer => pc.setLocalDescription(answer))
          .then(() => socket.emit('stream:signal', { type: 'answer', sdp: pc.localDescription, targetSocketId: data.fromSocketId }))
          .catch(() => { setError('WebRTC negotiation failed'); setConnecting(false); });
      } else if (data.type === 'ice-candidate' && data.candidate) {
        pc.addIceCandidate(data.candidate).catch(() => {});
      }
    };
    signalHandlerRef.current = handleSignal;
    socket.on('stream:signal', handleSignal);
    socket.emit('stream:request', { employeeUserId });

    timeoutRef.current = setTimeout(() => {
      setConnecting(prev => { if (prev) { setError('Agent did not respond. Make sure the desktop agent is running.'); return false; } return prev; });
    }, 15000);
  }, [employeeUserId]);

  const lastSeenText = lastHeartbeat
    ? `Last seen ${fmtTimeShort(lastHeartbeat)}`
    : 'Never connected';

  return (
    <div className="layer-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
          <Radio size={12} className={streaming ? 'text-red-500 animate-pulse' : 'text-gray-400'} />
          Live Screen Stream
          {streaming && <span className="text-[9px] bg-red-500 text-white px-1.5 py-0.5 rounded-full font-bold animate-pulse ml-1">LIVE</span>}
          {!streaming && (
            <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full font-medium ml-1',
              agentIsActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500')}>
              {agentIsActive ? 'Agent Online' : 'Agent Offline'}
            </span>
          )}
        </h4>
        {!streaming && !connecting ? (
          <button onClick={startLiveStream} disabled={!agentIsActive}
            title={!agentIsActive ? `${lastSeenText}` : 'Start live stream'}
            className={cn('px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1 transition-colors',
              agentIsActive ? 'text-white bg-red-600 hover:bg-red-700' : 'text-gray-400 bg-gray-100 cursor-not-allowed')}>
            <Radio size={12} /> Start Stream
          </button>
        ) : (
          <button onClick={stopLiveStream}
            className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors">
            Stop Stream
          </button>
        )}
      </div>

      {!agentIsActive && !streaming && (
        <div className="mb-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <WifiOff size={12} className="flex-shrink-0" />
          <span>Desktop agent is not running. {lastSeenText}. Ask the employee to start the Aniston Agent app.</span>
        </div>
      )}

      <div className="relative bg-gray-900 rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
        <video ref={videoRef} autoPlay playsInline muted
          className={cn('w-full h-full object-contain', !streaming && 'hidden')} />
        {!streaming && (
          <div className="absolute inset-0 flex items-center justify-center">
            {connecting ? (
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-white text-sm">Connecting to screen…</p>
                <p className="text-gray-400 text-xs mt-1">Waiting for agent to respond</p>
              </div>
            ) : error ? (
              <div className="text-center px-6">
                <WifiOff size={28} className="mx-auto text-red-400 mb-2" />
                <p className="text-red-400 text-sm mb-2">{error}</p>
                {agentIsActive && (
                  <button onClick={startLiveStream} className="text-xs text-white/70 hover:text-white underline">Try again</button>
                )}
              </div>
            ) : (
              <div className="text-center">
                <Monitor size={40} className="mx-auto text-gray-600 mb-2" />
                <p className="text-gray-400 text-sm">Click "Start Stream" to view the employee's screen</p>
                <p className="text-gray-500 text-xs mt-1">Requires the desktop agent to be running</p>
              </div>
            )}
          </div>
        )}
      </div>
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
      <Camera size={14} className="text-brand-500 flex-shrink-0" />
      <span className="text-xs font-medium text-gray-700">Screenshot interval:</span>
      <select value={current} onChange={e => handleChange(Number(e.target.value))} disabled={isLoading}
        className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-300 disabled:opacity-50">
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
// Screenshots Gallery with pagination
// ─────────────────────────────────────────────────────────────────────────────
const SCREENSHOTS_PER_PAGE = 48;

function ScreenshotsGallery({ screenshots, loading, onScreenshotClick, resetKey }: {
  screenshots: any[]; loading: boolean; onScreenshotClick: (url: string) => void; resetKey?: string;
}) {
  const [visible, setVisible] = useState(SCREENSHOTS_PER_PAGE);
  useEffect(() => { setVisible(SCREENSHOTS_PER_PAGE); }, [resetKey]);

  const shown = screenshots.slice(0, visible);
  const hasMore = screenshots.length > visible;

  return (
    <div className="layer-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Camera size={14} className="text-brand-500" />
          Screenshots
          <span className="text-xs text-gray-400 font-normal">({loading ? '…' : screenshots.length} captured)</span>
        </h3>
        {screenshots.length > SCREENSHOTS_PER_PAGE && (
          <span className="text-[10px] text-gray-400">Showing {Math.min(visible, screenshots.length)} of {screenshots.length}</span>
        )}
      </div>
      {shown.length > 0 ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {shown.map((s: any) => (
              <div key={s.id} className="group relative cursor-pointer rounded-lg overflow-hidden border border-gray-200 hover:border-brand-300 hover:shadow-md transition-all"
                onClick={() => onScreenshotClick(`${API_BASE}${s.imageUrl}`)}>
                <img src={`${API_BASE}${s.imageUrl}`} alt={s.activeApp || 'Screenshot'} className="w-full h-28 object-cover" loading="lazy" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <Maximize2 size={18} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
                  <p className="text-[9px] text-white truncate font-medium">{s.activeApp || 'Desktop'}</p>
                  <p className="text-[8px] text-gray-300">{fmtTimeShort(s.timestamp)}</p>
                </div>
              </div>
            ))}
          </div>
          {hasMore && (
            <button onClick={() => setVisible(v => v + SCREENSHOTS_PER_PAGE)}
              className="mt-3 w-full py-2 text-xs font-medium text-brand-600 bg-brand-50 border border-brand-200 rounded-lg hover:bg-brand-100 transition-colors">
              Load more ({screenshots.length - visible} remaining)
            </button>
          )}
        </>
      ) : (
        <div className="text-center py-10">
          <Camera size={32} className="mx-auto text-gray-200 mb-2" />
          <p className="text-xs text-gray-400">No screenshots captured for this date</p>
          <p className="text-[10px] text-gray-300 mt-1">Agent captures screenshots every 10 minutes by default</p>
        </div>
      )}
    </div>
  );
}
