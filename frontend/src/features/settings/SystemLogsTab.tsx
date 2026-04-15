import { useState, useCallback } from 'react';
import {
  AlertTriangle, AlertCircle, Info, Bug, RefreshCw, Download, Search,
  ChevronDown, ChevronRight, Copy, Filter, X, Terminal, Server, Zap,
  Clock, BarChart2, CheckCircle2, Wifi, WifiOff, Loader2, FileText,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';
import {
  useGetSystemLogSummaryQuery,
  useGetSystemLogsQuery,
  useGetAiServiceLogsQuery,
} from './settingsApi';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LogEntry {
  id:         string;
  timestamp:  string;
  level:      'error' | 'warn' | 'info' | 'debug';
  message:    string;
  service:    string;
  source:     string;
  requestId?: string;
  userId?:    string;
  stack?:     string;
  meta?:      Record<string, unknown>;
}

type LogLevel  = 'error' | 'warn' | 'info' | 'debug' | '';
type LogSource = 'backend' | 'api' | 'email' | 'kyc' | 'auth' | 'payroll' | 'jobs' |
                 'backup' | 'whatsapp' | 'agent' | 'ai' | '';

interface Filters {
  level:    LogLevel;
  source:   LogSource;
  search:   string;
  dateFrom: string;
  dateTo:   string;
}

const EMPTY_FILTERS: Filters = { level: '', source: '', search: '', dateFrom: '', dateTo: '' };

// ── Helpers ───────────────────────────────────────────────────────────────────

function levelBadge(level: string) {
  const map: Record<string, { cls: string; icon: React.ElementType; label: string }> = {
    error: { cls: 'bg-red-100 text-red-700 border-red-200',     icon: AlertCircle,  label: 'ERROR' },
    warn:  { cls: 'bg-amber-100 text-amber-700 border-amber-200', icon: AlertTriangle, label: 'WARN'  },
    info:  { cls: 'bg-blue-100 text-blue-700 border-blue-200',   icon: Info,         label: 'INFO'  },
    debug: { cls: 'bg-gray-100 text-gray-600 border-gray-200',   icon: Bug,          label: 'DEBUG' },
  };
  const cfg = map[level] ?? map.info;
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border whitespace-nowrap', cfg.cls)}>
      <Icon size={10} />
      {cfg.label}
    </span>
  );
}

function sourceBadge(source: string) {
  const colours: Record<string, string> = {
    email:    'bg-purple-50 text-purple-700 border-purple-200',
    kyc:      'bg-teal-50 text-teal-700 border-teal-200',
    auth:     'bg-indigo-50 text-indigo-700 border-indigo-200',
    payroll:  'bg-emerald-50 text-emerald-700 border-emerald-200',
    jobs:     'bg-orange-50 text-orange-700 border-orange-200',
    backup:   'bg-yellow-50 text-yellow-700 border-yellow-200',
    whatsapp: 'bg-green-50 text-green-700 border-green-200',
    agent:    'bg-sky-50 text-sky-700 border-sky-200',
    ai:       'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
    api:      'bg-slate-50 text-slate-600 border-slate-200',
  };
  const cls = colours[source] ?? 'bg-gray-50 text-gray-500 border-gray-200';
  return (
    <span className={cn('inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border', cls)}>
      {source}
    </span>
  );
}

function formatTs(ts: string) {
  try {
    return new Date(ts).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
  } catch {
    return ts;
  }
}

function copyText(text: string, label = 'Copied') {
  navigator.clipboard.writeText(text).then(() => toast.success(label)).catch(() => toast.error('Copy failed'));
}

// ── Expandable Row ────────────────────────────────────────────────────────────

function LogRow({ entry }: { entry: LogEntry }) {
  const [open, setOpen] = useState(false);

  const fullText = [
    `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.source}] ${entry.message}`,
    entry.requestId ? `  requestId: ${entry.requestId}` : '',
    entry.userId    ? `  userId: ${entry.userId}`        : '',
    entry.stack     ? `\n  Stack:\n  ${entry.stack.replace(/\n/g, '\n  ')}` : '',
    entry.meta      ? `\n  Meta: ${JSON.stringify(entry.meta, null, 2)}` : '',
  ].filter(Boolean).join('\n');

  return (
    <>
      <tr
        onClick={() => setOpen(o => !o)}
        className={cn(
          'border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors',
          entry.level === 'error' && 'bg-red-50/30 hover:bg-red-50/50',
          entry.level === 'warn'  && 'bg-amber-50/20 hover:bg-amber-50/40',
        )}
      >
        <td className="py-2 pl-3 pr-2 w-5">
          {open
            ? <ChevronDown size={13} className="text-gray-400" />
            : <ChevronRight size={13} className="text-gray-400" />}
        </td>
        <td className="py-2 pr-3 whitespace-nowrap text-xs text-gray-500 font-mono">
          {formatTs(entry.timestamp)}
        </td>
        <td className="py-2 pr-3">{levelBadge(entry.level)}</td>
        <td className="py-2 pr-3">{sourceBadge(entry.source)}</td>
        <td className="py-2 pr-3 text-xs text-gray-800 max-w-md truncate font-mono">
          {entry.message}
        </td>
        <td className="py-2 pr-3 text-xs text-gray-400 font-mono truncate hidden xl:table-cell">
          {entry.requestId ?? '—'}
        </td>
        <td className="py-2 pr-3 text-center">
          <button
            onClick={e => { e.stopPropagation(); copyText(fullText); }}
            className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
            title="Copy log line"
          >
            <Copy size={12} />
          </button>
        </td>
      </tr>

      {open && (
        <tr className="border-b border-gray-100 bg-gray-50">
          <td colSpan={7} className="px-4 py-3">
            <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-3 py-2 bg-gray-100 border-b border-gray-200">
                <div className="flex items-center gap-2">
                  {levelBadge(entry.level)}
                  <span className="text-xs text-gray-500 font-mono">{entry.id}</span>
                </div>
                <button
                  onClick={() => copyText(fullText, 'Full entry copied')}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded px-2 py-0.5 bg-white hover:bg-gray-50"
                >
                  <Copy size={11} /> Copy all
                </button>
              </div>

              {/* Message */}
              <div className="px-3 py-2 border-b border-gray-100">
                <p className="text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Message</p>
                <p className="text-sm text-gray-800 font-mono whitespace-pre-wrap break-all">{entry.message}</p>
              </div>

              {/* Meta grid */}
              {(entry.requestId || entry.userId || entry.service) && (
                <div className="px-3 py-2 border-b border-gray-100 flex flex-wrap gap-4">
                  {entry.service    && <div><p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Service</p><p className="text-xs font-mono text-gray-700">{entry.service}</p></div>}
                  {entry.requestId  && <div><p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Request ID</p><p className="text-xs font-mono text-gray-700">{entry.requestId}</p></div>}
                  {entry.userId     && <div><p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">User ID</p><p className="text-xs font-mono text-gray-700">{entry.userId}</p></div>}
                </div>
              )}

              {/* Stack trace */}
              {entry.stack && (
                <div className="px-3 py-2 border-b border-gray-100">
                  <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wide mb-1">Stack Trace</p>
                  <pre className="text-[11px] text-red-700 bg-red-50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto font-mono">{entry.stack}</pre>
                </div>
              )}

              {/* Metadata */}
              {entry.meta && Object.keys(entry.meta).length > 0 && (
                <div className="px-3 py-2">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Metadata</p>
                  <pre className="text-[11px] text-gray-700 bg-gray-50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto font-mono">
                    {JSON.stringify(entry.meta, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Summary Cards ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, icon: Icon, cls }: {
  label: string;
  value: string | number;
  sub?:  string;
  icon:  React.ElementType;
  cls:   string;
}) {
  return (
    <div className={cn('rounded-xl border p-4 flex items-start gap-3', cls)}>
      <div className="p-2 rounded-lg bg-white/60">
        <Icon size={18} />
      </div>
      <div>
        <p className="text-2xl font-bold font-mono">{value}</p>
        <p className="text-xs font-medium opacity-75">{label}</p>
        {sub && <p className="text-[10px] opacity-60 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── AI Service Panel ──────────────────────────────────────────────────────────

function AiServiceLogsPanel() {
  const { data, isLoading, refetch } = useGetAiServiceLogsQuery(200);
  const result = data?.data;
  const available = result?.available ?? false;
  const logs: LogEntry[] = (result?.logs ?? []).map((entry: any, i: number) => ({
    id:        `ai:${i}`,
    timestamp: entry.timestamp ?? new Date().toISOString(),
    level:     (entry.level ?? 'info').toLowerCase() as LogEntry['level'],
    message:   entry.message ?? '',
    service:   entry.service ?? 'ai-service',
    source:    'ai',
    stack:     entry.stack,
    meta:      (({ timestamp, level, message, service, stack, ...rest }) =>
      Object.keys(rest).length ? rest : undefined)(entry),
  }));

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-fuchsia-600" />
          <h3 className="text-sm font-semibold text-gray-800">AI Service Logs</h3>
          {available
            ? <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 border border-green-200 rounded-full px-2 py-0.5"><Wifi size={10} />Connected</span>
            : <span className="flex items-center gap-1 text-xs text-red-500 bg-red-50 border border-red-200 rounded-full px-2 py-0.5"><WifiOff size={10} />Unavailable</span>}
        </div>
        <button onClick={() => refetch()} className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
          <RefreshCw size={11} /> Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
          <Loader2 size={16} className="animate-spin" /> Loading AI service logs…
        </div>
      ) : !available ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          <p className="font-semibold mb-1">AI service not reachable</p>
          <p className="text-xs">{result?.error ?? 'Could not connect to the AI OCR service. It may be stopped or the /ai/logs endpoint is not available in the current deployment.'}</p>
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-6 text-gray-400 text-sm">No AI service logs found.</div>
      ) : (
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="w-5 py-2 pl-3" />
                <th className="py-2 pr-3 text-left font-semibold text-gray-500 whitespace-nowrap">Timestamp</th>
                <th className="py-2 pr-3 text-left font-semibold text-gray-500">Level</th>
                <th className="py-2 pr-3 text-left font-semibold text-gray-500">Message</th>
                <th className="py-2 pr-3 w-8" />
              </tr>
            </thead>
            <tbody>
              {logs.slice(0, 100).map(e => <LogRow key={e.id} entry={e} />)}
            </tbody>
          </table>
          {logs.length > 100 && (
            <div className="text-center py-2 text-xs text-gray-400 border-t border-gray-100">
              Showing first 100 of {logs.length} entries
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function SystemLogsTab() {
  const [filters, setFilters]         = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied]         = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage]               = useState(1);
  const [showAi, setShowAi]           = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Build query params from applied filters
  const queryParams = {
    page,
    limit: 50,
    level:    applied.level    || undefined,
    source:   applied.source   || undefined,
    search:   applied.search   || undefined,
    dateFrom: applied.dateFrom || undefined,
    dateTo:   applied.dateTo   || undefined,
  };

  const { data: logsData,    isLoading: logsLoading, isFetching, refetch: refetchLogs } =
    useGetSystemLogsQuery(queryParams, { pollingInterval: autoRefresh ? 10_000 : 0 });

  const { data: summaryData, isLoading: summaryLoading, refetch: refetchSummary } =
    useGetSystemLogSummaryQuery(undefined, { pollingInterval: autoRefresh ? 15_000 : 0 });

  const summary  = summaryData?.data;
  const entries: LogEntry[] = logsData?.data ?? [];
  const meta     = logsData?.meta;

  // ── Filter helpers ──────────────────────────────────────────────────────────
  const applyFilters = useCallback(() => {
    setApplied(filters);
    setPage(1);
  }, [filters]);

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  }, []);

  const quickFilter = (level: LogLevel) => {
    const f = { ...EMPTY_FILTERS, level };
    setFilters(f);
    setApplied(f);
    setPage(1);
  };

  const quickDate = (hours: number) => {
    const from = new Date(Date.now() - hours * 3_600_000).toISOString();
    const f = { ...EMPTY_FILTERS, dateFrom: from };
    setFilters(f);
    setApplied(f);
    setPage(1);
  };

  // ── Auto-refresh toggle ─────────────────────────────────────────────────────
  const toggleAutoRefresh = () => {
    setAutoRefresh(v => {
      if (!v) toast.success('Auto-refresh ON (every 10 s)');
      else     toast('Auto-refresh OFF');
      return !v;
    });
  };

  // ── Download ────────────────────────────────────────────────────────────────
  const download = (fmt: 'txt' | 'json') => {
    const params = new URLSearchParams();
    if (applied.level)    params.set('level',    applied.level);
    if (applied.source)   params.set('source',   applied.source);
    if (applied.search)   params.set('search',   applied.search);
    if (applied.dateFrom) params.set('dateFrom', applied.dateFrom);
    if (applied.dateTo)   params.set('dateTo',   applied.dateTo);
    params.set('format', fmt);
    params.set('sort', 'desc');
    // Use the token from localStorage for auth
    const token = localStorage.getItem('accessToken');
    const url   = `/api/settings/system-logs/download?${params.toString()}`;
    const a     = document.createElement('a');
    a.href = url;
    if (token) {
      // Trigger via fetch with auth header
      fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.blob())
        .then(blob => {
          const burl = URL.createObjectURL(blob);
          a.href = burl;
          a.download = `system-logs-${new Date().toISOString().slice(0, 10)}.${fmt}`;
          a.click();
          URL.revokeObjectURL(burl);
        })
        .catch(() => toast.error('Download failed'));
    }
  };

  const hasActiveFilters = Object.values(applied).some(Boolean);

  return (
    <div className="space-y-5">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-display font-bold text-gray-900 flex items-center gap-2">
            <Terminal size={20} className="text-indigo-600" />
            System Logs
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Backend runtime logs — errors, warnings, startup events, job failures.
            Distinct from Audit Logs (user actions).
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={toggleAutoRefresh}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              autoRefresh
                ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50',
            )}
          >
            <Zap size={12} />
            {autoRefresh ? 'Live' : 'Auto-refresh'}
          </button>
          <button
            onClick={() => { refetchLogs(); refetchSummary(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
          >
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
            Refresh
          </button>
          <div className="relative group">
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50">
              <Download size={12} /> Download
            </button>
            <div className="absolute right-0 top-full mt-1 w-32 bg-white border border-gray-200 rounded-lg shadow-lg z-20 hidden group-hover:block">
              <button onClick={() => download('txt')}  className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2"><FileText size={12} /> As .txt</button>
              <button onClick={() => download('json')} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2"><FileText size={12} /> As .json</button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Summary cards ─────────────────────────────────────────────────── */}
      {summaryLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-100 bg-gray-50 h-20 animate-pulse" />
          ))}
        </div>
      ) : summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard label="Total Entries" value={summary.total ?? 0}       icon={BarChart2}    cls="border-indigo-100 bg-indigo-50 text-indigo-700" />
          <SummaryCard label="Errors"        value={summary.errorCount ?? 0}  icon={AlertCircle}  cls="border-red-100 bg-red-50 text-red-700" />
          <SummaryCard label="Warnings"      value={summary.warnCount ?? 0}   icon={AlertTriangle} cls="border-amber-100 bg-amber-50 text-amber-700" />
          <SummaryCard
            label="Last Event"
            value={summary.lastUpdated ? formatTs(summary.lastUpdated).split(',')[0] : '—'}
            sub={summary.lastUpdated ? formatTs(summary.lastUpdated).split(',')[1]?.trim() : undefined}
            icon={Clock}
            cls="border-green-100 bg-green-50 text-green-700"
          />
        </div>
      )}

      {/* ── Active sources ─────────────────────────────────────────────────── */}
      {summary?.sources?.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500 font-medium flex items-center gap-1"><Server size={12} /> Active sources:</span>
          {(summary.sources as string[]).map(s => (
            <button key={s} onClick={() => { const f = { ...EMPTY_FILTERS, source: s as LogSource }; setFilters(f); setApplied(f); setPage(1); }} className="text-xs">
              {sourceBadge(s)}
            </button>
          ))}
        </div>
      )}

      {/* ── Quick filters ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-400">Quick:</span>
        {(['error', 'warn', 'info'] as LogLevel[]).map(l => (
          <button key={l} onClick={() => quickFilter(l)} className={cn('text-xs px-2 py-1 rounded-md border transition-colors', applied.level === l ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50')}>
            {l === 'error' ? 'Errors only' : l === 'warn' ? 'Warnings only' : 'Info only'}
          </button>
        ))}
        <button onClick={() => quickDate(24)} className={cn('text-xs px-2 py-1 rounded-md border transition-colors', 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50')}>Last 24 h</button>
        <button onClick={() => quickDate(168)} className={cn('text-xs px-2 py-1 rounded-md border transition-colors', 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50')}>Last 7 days</button>
        {hasActiveFilters && (
          <button onClick={clearFilters} className="text-xs px-2 py-1 rounded-md bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 flex items-center gap-1">
            <X size={10} /> Clear
          </button>
        )}
      </div>

      {/* ── Filter panel ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
          <Filter size={12} /> Filters
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {/* Search */}
          <div className="relative sm:col-span-2">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search message, stack, metadata…"
              value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && applyFilters()}
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-300 outline-none"
            />
          </div>

          {/* Level */}
          <select
            value={filters.level}
            onChange={e => setFilters(f => ({ ...f, level: e.target.value as LogLevel }))}
            className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-300 outline-none"
          >
            <option value="">All levels</option>
            <option value="error">Error</option>
            <option value="warn">Warn</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
          </select>

          {/* Source */}
          <select
            value={filters.source}
            onChange={e => setFilters(f => ({ ...f, source: e.target.value as LogSource }))}
            className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-300 outline-none"
          >
            <option value="">All sources</option>
            <option value="api">API requests</option>
            <option value="auth">Auth / JWT</option>
            <option value="email">Email / SMTP</option>
            <option value="kyc">KYC / OCR</option>
            <option value="payroll">Payroll</option>
            <option value="jobs">Job queues</option>
            <option value="backup">Backup</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="agent">Agent</option>
            <option value="ai">AI service</option>
            <option value="backend">Backend</option>
          </select>

          {/* Date from */}
          <input
            type="datetime-local"
            value={filters.dateFrom}
            onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
            className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-300 outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={applyFilters}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-1.5"
          >
            <CheckCircle2 size={12} /> Apply
          </button>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 flex items-center gap-1">
              <X size={11} /> Clear filters
            </button>
          )}
          {hasActiveFilters && (
            <span className="text-xs text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">
              Filters active
            </span>
          )}
        </div>
      </div>

      {/* ── Log table ──────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        {logsLoading ? (
          <div className="flex items-center justify-center gap-2 text-gray-400 text-sm py-16">
            <Loader2 size={18} className="animate-spin" /> Loading logs…
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 text-gray-400 py-16">
            <Terminal size={32} className="opacity-30" />
            <p className="text-sm">No log entries found.</p>
            {hasActiveFilters && (
              <button onClick={clearFilters} className="text-xs text-indigo-500 hover:underline">
                Clear filters
              </button>
            )}
            {!hasActiveFilters && (
              <p className="text-xs text-gray-400 max-w-xs text-center">
                Logs are written to <code className="font-mono bg-gray-100 px-1 rounded">backend/logs/app.log</code> as the server receives requests. Start using the app and refresh.
              </p>
            )}
          </div>
        ) : (
          <>
            {isFetching && (
              <div className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-50 border-b border-indigo-100 text-indigo-600 text-xs">
                <Loader2 size={11} className="animate-spin" /> Refreshing…
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                  <tr>
                    <th className="w-5 py-2.5 pl-3" />
                    <th className="py-2.5 pr-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Timestamp</th>
                    <th className="py-2.5 pr-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Level</th>
                    <th className="py-2.5 pr-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Source</th>
                    <th className="py-2.5 pr-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Message</th>
                    <th className="py-2.5 pr-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide hidden xl:table-cell">Request ID</th>
                    <th className="py-2.5 pr-3 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {entries.map(entry => <LogRow key={entry.id} entry={entry} />)}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {meta && meta.totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
                <span className="text-xs text-gray-500">
                  {((meta.page - 1) * meta.limit) + 1}–{Math.min(meta.page * meta.limit, meta.total)} of {meta.total} entries
                </span>
                <div className="flex items-center gap-1">
                  <button
                    disabled={!meta.hasPrev}
                    onClick={() => setPage(p => p - 1)}
                    className="px-3 py-1 text-xs border border-gray-200 rounded-md bg-white disabled:opacity-40 hover:bg-gray-50"
                  >
                    Prev
                  </button>
                  <span className="px-2 text-xs text-gray-600 font-mono">
                    {meta.page} / {meta.totalPages}
                  </span>
                  <button
                    disabled={!meta.hasNext}
                    onClick={() => setPage(p => p + 1)}
                    className="px-3 py-1 text-xs border border-gray-200 rounded-md bg-white disabled:opacity-40 hover:bg-gray-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── AI Service Logs toggle ─────────────────────────────────────────── */}
      <div className="border-t border-gray-200 pt-4">
        <button
          onClick={() => setShowAi(v => !v)}
          className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-indigo-600 transition-colors"
        >
          {showAi ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <Zap size={15} className="text-fuchsia-500" />
          AI / OCR Service Logs
          <span className="text-xs text-gray-400">(proxied from Python container)</span>
        </button>
        {showAi && <AiServiceLogsPanel />}
      </div>
    </div>
  );
}
