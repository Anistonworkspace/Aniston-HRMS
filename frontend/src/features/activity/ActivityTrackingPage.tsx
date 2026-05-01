import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Monitor, Search, Calendar, Eye, Activity, Clock, Mouse, Keyboard,
  WifiOff, X, Maximize2, Radio, Globe, Download, TrendingDown, TrendingUp, Camera,
} from 'lucide-react';
import { useGetEmployeesQuery } from '../employee/employeeApi';
import {
  useGetActivityBulkSummaryQuery, useGetEmployeeActivityLogsQuery, useGetEmployeeScreenshotsQuery,
  useSetAgentLiveModeMutation, useGetAgentLiveModeQuery, useGetEmployeeAgentStatusQuery,
  useLazyDownloadActivityExcelQuery,
} from '../attendance/attendanceApi';
import { getInitials, cn } from '../../lib/utils';
import { onSocketEvent, offSocketEvent, getSocket } from '../../lib/socket';

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:4000/api').replace('/api', '');

export default function ActivityTrackingPage() {
  const [rawDate, setRawDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedDate, setSelectedDate] = useState(rawDate);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [fullScreenshot, setFullScreenshot] = useState<string | null>(null);

  // 300 ms debounce on date — avoids a burst of API calls while the user scrolls the date picker
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleDateChange = (value: string) => {
    setRawDate(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSelectedDate(value), 300);
  };

  const { data: empRes, isLoading: loadingEmps } = useGetEmployeesQuery({ page: 1, limit: 100 });
  const employees = empRes?.data || [];

  // Bug #9: Single query for all employees' activity summaries — replaces per-row N+1 API calls
  const { data: bulkSummaryRes } = useGetActivityBulkSummaryQuery({ date: selectedDate }, { pollingInterval: 120_000 });
  const bulkSummary = bulkSummaryRes?.data;

  // All employees are trackable (enterprise agent setup)
  const trackableEmployees = employees;

  const filteredEmployees = useMemo(() => {
    if (!searchQuery.trim()) return trackableEmployees;
    const q = searchQuery.toLowerCase();
    return trackableEmployees.filter((e: any) =>
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
      e.employeeCode?.toLowerCase().includes(q)
    );
  }, [trackableEmployees, searchQuery]);

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900 flex items-center gap-2">
            <Monitor size={24} className="text-brand-600" />
            Activity Tracking
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Monitor employee desktop activity, screenshots & productivity
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-gray-400" />
            <input type="date" value={rawDate} onChange={e => handleDateChange(e.target.value)}
              className="input-glass text-sm" />
          </div>
        </div>
      </div>

      <div className="flex gap-4 h-[calc(100vh-180px)]">
        {/* Left: Employee List */}
        <div className="w-80 flex-shrink-0 layer-card flex flex-col overflow-hidden">
          <div className="p-3 border-b border-gray-100">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search employees..."
                className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-300" />
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{filteredEmployees.length} trackable employees</p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loadingEmps ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredEmployees.length === 0 ? (
              <p className="text-center text-gray-400 text-xs py-8">No employees found</p>
            ) : (
              filteredEmployees.map((emp: any) => (
                <EmployeeRow
                  key={emp.id}
                  employee={emp}
                  isSelected={selectedEmployee?.id === emp.id}
                  bulkSummary={bulkSummary}
                  onClick={() => setSelectedEmployee(emp)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right: Activity Detail */}
        <div className="flex-1 overflow-y-auto">
          {selectedEmployee ? (
            <ActivityDetail
              employee={selectedEmployee}
              date={selectedDate}
              onScreenshotClick={setFullScreenshot}
            />
          ) : (
            <div className="flex items-center justify-center h-full layer-card">
              <div className="text-center">
                <Monitor size={48} className="mx-auto text-gray-200 mb-3" />
                <h3 className="text-lg font-semibold text-gray-600 mb-1">Select an Employee</h3>
                <p className="text-sm text-gray-400">Click an employee from the left to view their activity</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Fullscreen Screenshot Modal */}
      {fullScreenshot && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setFullScreenshot(null)}>
          <button className="absolute top-4 right-4 text-white/70 hover:text-white" onClick={() => setFullScreenshot(null)}>
            <X size={24} />
          </button>
          <img src={fullScreenshot} alt="Screenshot" className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      )}
    </div>
  );
}

// ---------- Employee Row with live status ----------
// Bug #9: uses shared bulkSummary (one query for all rows) instead of per-row API calls
function EmployeeRow({ employee, isSelected, bulkSummary, onClick }: {
  employee: any; isSelected: boolean;
  bulkSummary: Record<string, { logCount: number; totalActiveMinutes: number; totalIdleMinutes: number; productivityScore?: number | null }> | undefined;
  onClick: () => void;
}) {
  const summary = bulkSummary?.[employee.id];
  const hasActivity = summary && summary.logCount > 0;
  // Flag employees with <40% productivity (at least 30min active so we don't penalize light days)
  const isLowProductivity = hasActivity && typeof summary.productivityScore === 'number' &&
    summary.productivityScore < 40 && summary.totalActiveMinutes >= 30;

  return (
    <button onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-b border-gray-50',
        isSelected ? 'bg-brand-50 border-l-2 border-l-brand-500' : 'hover:bg-gray-50'
      )}>
      <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
        hasActivity ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500')}>
        {getInitials(employee.firstName, employee.lastName)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-gray-800 truncate">{employee.firstName} {employee.lastName}</p>
          {isLowProductivity && (
            <span className="flex-shrink-0 flex items-center gap-0.5 text-[9px] bg-red-50 text-red-500 px-1.5 py-0.5 rounded-full font-medium"
              title={`Low productivity: ${summary.productivityScore}%`}>
              <TrendingDown size={8} /> {summary.productivityScore}%
            </span>
          )}
        </div>
        <p className="text-[10px] text-gray-400">{employee.employeeCode} · {employee.workMode}</p>
      </div>
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
        {hasActivity ? (
          <>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[9px] text-emerald-600 font-medium">{summary.totalActiveMinutes}m</span>
            </div>
            <span className="text-[9px] text-gray-400">{summary.logCount} logs</span>
          </>
        ) : (
          <span className="text-[9px] text-gray-300">No activity</span>
        )}
      </div>
    </button>
  );
}

// ---------- Activity Detail Panel ----------
function ActivityDetail({ employee, date, onScreenshotClick }: {
  employee: any; date: string; onScreenshotClick: (url: string) => void;
}) {
  const [viewMode, setViewMode] = useState<'activity' | 'screenshots' | 'live'>('activity');
  const [exporting, setExporting] = useState(false);
  const employeeUserId: string | undefined = employee?.user?.id;
  const { data: activityRes, isLoading: loadingActivity, isError: activityError } = useGetEmployeeActivityLogsQuery(
    { employeeId: employee.id, date },
    { pollingInterval: viewMode === 'live' ? 15000 : 60000 }
  );
  const { data: screenshotRes, isLoading: loadingScreenshots } = useGetEmployeeScreenshotsQuery(
    { employeeId: employee.id, date },
    { pollingInterval: viewMode === 'live' ? 15000 : 60000 }
  );
  const [triggerExport] = useLazyDownloadActivityExcelQuery();

  const summary = activityRes?.data?.summary;
  const logs = activityRes?.data?.logs || [];
  const screenshots = screenshotRes?.data || [];

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await triggerExport({ employeeId: employee.id, date });
      if (result.error) {
        toast.error('Failed to export activity data. Please try again.');
        return;
      }
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
      toast.error('Failed to export activity data. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Employee Header + View Toggle */}
      <div className="layer-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-lg font-bold">
              {getInitials(employee.firstName, employee.lastName)}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-800">{employee.firstName} {employee.lastName}</h2>
              <p className="text-xs text-gray-400">{employee.employeeCode} · {employee.designation?.name || 'Employee'} · {employee.workMode}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs text-gray-400">Tracking Date</p>
              <p className="text-sm font-mono font-medium text-gray-700" data-mono>{date}</p>
            </div>
            {summary && summary.logCount > 0 && (
              <button onClick={handleExport} disabled={exporting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50"
                title="Export activity log to Excel">
                {exporting
                  ? <div className="w-3 h-3 border border-emerald-600 border-t-transparent rounded-full animate-spin" />
                  : <Download size={12} />}
                Export
              </button>
            )}
          </div>
        </div>
        {/* View mode toggle */}
        <div className="flex bg-gray-100 rounded-lg p-0.5 w-fit">
          <button onClick={() => setViewMode('activity')}
            className={cn('flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all',
              viewMode === 'activity' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            <Activity size={14} /> Activity Log
          </button>
          <button onClick={() => setViewMode('screenshots')}
            className={cn('flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all',
              viewMode === 'screenshots' ? 'bg-white text-brand-600 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            <Camera size={14} /> Screenshots
            {screenshotRes?.data && screenshotRes.data.length > 0 && (
              <span className="ml-1 text-[10px] bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded-full font-semibold">
                {screenshotRes.data.length}
              </span>
            )}
          </button>
          <button onClick={() => setViewMode('live')}
            className={cn('flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all',
              viewMode === 'live' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            <Radio size={14} className={viewMode === 'live' ? 'animate-pulse' : ''} /> Live Feed
          </button>
        </div>
      </div>

      {/* Screenshots Tab */}
      {viewMode === 'screenshots' && (
        <ScreenshotsGallery screenshots={screenshots} loading={loadingScreenshots} onScreenshotClick={onScreenshotClick} />
      )}

      {/* Live Feed Mode */}
      {viewMode === 'live' && (
        <LiveFeedPanel employeeId={employee.id} employeeUserId={employeeUserId} screenshots={screenshots} onScreenshotClick={onScreenshotClick} />
      )}

      {viewMode === 'activity' && (loadingActivity ? (
        <div className="layer-card p-12 text-center">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400 mt-2">Loading activity data...</p>
        </div>
      ) : activityError ? (
        <div className="layer-card p-12 text-center">
          <WifiOff size={40} className="mx-auto text-red-300 mb-3" />
          <p className="text-sm text-red-500 mb-1">Failed to load activity data</p>
          <p className="text-xs text-gray-400">Check your connection or try again later</p>
        </div>
      ) : !summary || summary.logCount === 0 ? (
        <div className="layer-card p-12 text-center">
          <Monitor size={40} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm text-gray-500 mb-1">No activity recorded</p>
          <p className="text-xs text-gray-400">The desktop agent hasn't sent any data for this date</p>
        </div>
      ) : (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            <StatCard icon={Clock} label="Active Time" value={`${summary.totalActiveMinutes}m`} color="emerald" />
            <StatCard icon={Clock} label="Idle Time" value={`${summary.totalIdleMinutes}m`} color="amber" />
            <StatCard icon={Keyboard} label="Keystrokes" value={summary.totalKeystrokes?.toLocaleString() || '0'} color="blue" />
            <StatCard icon={Mouse} label="Mouse Clicks" value={summary.totalClicks?.toLocaleString() || '0'} color="purple" />
            <ProductivityScoreCard score={summary.productivityScore ?? null} productiveMinutes={summary.productiveMinutes ?? 0} unproductiveMinutes={summary.unproductiveMinutes ?? 0} />
          </div>

          {/* Top Applications — clickable for URL drilldown */}
          {summary.topApps?.length > 0 && (
            <AppDrilldown topApps={summary.topApps} logs={logs} />
          )}

          {/* Activity Timeline */}
          {logs.length > 0 && (
            <div className="layer-card p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Activity Timeline</h3>
              <div className="max-h-60 overflow-y-auto space-y-1">
                {logs.slice(-30).reverse().map((log: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 text-xs py-1.5 border-b border-gray-50 last:border-0">
                    <span className="text-gray-400 font-mono w-16 flex-shrink-0" data-mono>
                      {new Date(log.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' })}
                    </span>
                    <div className={cn('w-2 h-2 rounded-full flex-shrink-0',
                      log.category === 'PRODUCTIVE' ? 'bg-emerald-500' :
                      log.category === 'UNPRODUCTIVE' ? 'bg-red-400' : 'bg-gray-300'
                    )} />
                    <span className="text-gray-700 truncate flex-1">{log.activeApp || 'Unknown'}</span>
                    <span className="text-gray-400 truncate max-w-[200px]">{log.activeWindow || ''}</span>
                    {log.keystrokes > 0 && (
                      <span className="text-blue-400 flex items-center gap-0.5 flex-shrink-0" title="Keystrokes">
                        <Keyboard size={9} /> <span className="font-mono" data-mono>{log.keystrokes}</span>
                      </span>
                    )}
                    {log.mouseClicks > 0 && (
                      <span className="text-purple-400 flex items-center gap-0.5 flex-shrink-0" title="Clicks">
                        <Mouse size={9} /> <span className="font-mono" data-mono>{log.mouseClicks}</span>
                      </span>
                    )}
                    <span className="text-gray-300 font-mono flex-shrink-0" data-mono>{log.idleSeconds}s idle</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Screenshots Gallery with pagination */}
          <ScreenshotsGallery screenshots={screenshots} loading={loadingScreenshots} onScreenshotClick={onScreenshotClick} />
        </>
      ))}
    </div>
  );
}

// ---------- Live Feed Panel ----------
function LiveFeedPanel({ employeeId, employeeUserId, screenshots, onScreenshotClick }: {
  employeeId: string; employeeUserId: string | undefined; screenshots: any[]; onScreenshotClick: (url: string) => void;
}) {
  const [liveData, setLiveData] = useState<any>(null);
  const [feedLog, setFeedLog] = useState<any[]>([]);
  const [interval, setInterval_] = useState(30);
  const [setLiveMode] = useSetAgentLiveModeMutation();
  const { data: liveModeRes } = useGetAgentLiveModeQuery(employeeId, { pollingInterval: 10000 });
  const isLive = liveModeRes?.data?.enabled || false;

  // Sync interval selector with the value stored in Redis (survives page reloads)
  useEffect(() => {
    if (liveModeRes?.data?.intervalSeconds) {
      setInterval_(liveModeRes.data.intervalSeconds);
    }
  }, [liveModeRes?.data?.intervalSeconds]);

  // Listen for real-time heartbeat events
  useEffect(() => {
    const handleHeartbeat = (data: any) => {
      if (data.employeeId === employeeId) {
        setLiveData(data);
        setFeedLog(prev => [data, ...prev].slice(0, 50)); // keep last 50
      }
    };
    onSocketEvent('agent:heartbeat', handleHeartbeat);
    return () => { offSocketEvent('agent:heartbeat', handleHeartbeat); };
  }, [employeeId]);

  const latestScreenshot = screenshots.length > 0 ? screenshots[screenshots.length - 1] : null;

  return (
    <div className="space-y-4">
      {/* Live Controls */}
      <div className="layer-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={cn('w-3 h-3 rounded-full', isLive ? 'bg-red-500 animate-pulse' : 'bg-gray-300')} />
            <h4 className="text-sm font-semibold text-gray-800">
              {isLive ? 'Live View Active' : 'Live View Off'}
            </h4>
          </div>
          <div className="flex items-center gap-2">
            {/* Interval selector */}
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
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span>Capturing every <strong>{interval}s</strong></span>
            <span>·</span>
            <span>Agent will capture the next screenshot automatically</span>
            {liveData && (
              <>
                <span>·</span>
                <span>Last data: {new Date(liveData.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' })}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Current Window + URL */}
      {liveData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="layer-card p-4">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
              <Monitor size={12} /> Current Application
            </h4>
            <p className="text-lg font-semibold text-gray-800">{liveData.activeApp || 'Unknown'}</p>
            <p className="text-xs text-gray-500 truncate mt-1">{liveData.activeWindow || 'No window title'}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium',
                liveData.category === 'PRODUCTIVE' ? 'bg-emerald-100 text-emerald-700' :
                liveData.category === 'UNPRODUCTIVE' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'
              )}>{liveData.category || 'NEUTRAL'}</span>
              {liveData.keystrokes > 0 && (
                <span className="text-[10px] text-blue-600 flex items-center gap-0.5">
                  <Keyboard size={10} /> {liveData.keystrokes.toLocaleString()}
                </span>
              )}
              {liveData.mouseClicks > 0 && (
                <span className="text-[10px] text-purple-600 flex items-center gap-0.5">
                  <Mouse size={10} /> {liveData.mouseClicks.toLocaleString()}
                </span>
              )}
              {liveData.idleSeconds > 60 && (
                <span className="text-[10px] text-amber-600">Idle: {Math.floor(liveData.idleSeconds / 60)}m</span>
              )}
            </div>
          </div>

          {liveData.activeUrl && (
            <div className="layer-card p-4">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                <Globe size={12} /> Browser URL
              </h4>
              <p className="text-sm text-brand-600 truncate">{liveData.activeUrl}</p>
            </div>
          )}
        </div>
      )}

      {/* Live Video Stream */}
      <LiveVideoStream employeeId={employeeId} employeeUserId={employeeUserId} />

      {/* Latest Screenshot (auto-refreshes every 10s via polling) */}
      <div className="layer-card p-4">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1">
          <Eye size={12} /> Latest Screen Capture
        </h4>
        {latestScreenshot ? (
          <div className="relative cursor-pointer rounded-lg overflow-hidden border border-gray-200 hover:border-brand-300 transition-colors"
            onClick={() => onScreenshotClick(`${API_BASE}${latestScreenshot.imageUrl}`)}>
            <img src={`${API_BASE}${latestScreenshot.imageUrl}`} alt="Latest screenshot"
              className="w-full h-auto max-h-[400px] object-contain bg-gray-900" />
            <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded">
              {new Date(latestScreenshot.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' })}
              {' · '}{latestScreenshot.activeApp || 'Desktop'}
            </div>
          </div>
        ) : (
          <div className="bg-gray-100 rounded-lg h-48 flex items-center justify-center">
            <p className="text-xs text-gray-400">No screenshots yet — agent captures every 10 minutes</p>
          </div>
        )}
      </div>

      {/* Real-time Activity Feed */}
      <div className="layer-card p-4">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1">
          <Activity size={12} /> Real-time Activity Feed
        </h4>
        {feedLog.length > 0 ? (
          <div className="max-h-60 overflow-y-auto space-y-1">
            {feedLog.map((entry, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-3 text-xs py-1.5 border-b border-gray-50 last:border-0">
                <span className="text-gray-400 font-mono w-16 flex-shrink-0" data-mono>
                  {new Date(entry.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' })}
                </span>
                <div className={cn('w-2 h-2 rounded-full flex-shrink-0',
                  entry.category === 'PRODUCTIVE' ? 'bg-emerald-500' :
                  entry.category === 'UNPRODUCTIVE' ? 'bg-red-400' : 'bg-gray-300'
                )} />
                <span className="text-gray-700 font-medium">{entry.activeApp}</span>
                <span className="text-gray-400 truncate flex-1">{entry.activeWindow}</span>
                {entry.keystrokes > 0 && (
                  <span className="text-blue-500 flex items-center gap-0.5 flex-shrink-0" title="Keystrokes">
                    <Keyboard size={9} /> <span className="font-mono" data-mono>{entry.keystrokes}</span>
                  </span>
                )}
                {entry.mouseClicks > 0 && (
                  <span className="text-purple-500 flex items-center gap-0.5 flex-shrink-0" title="Clicks">
                    <Mouse size={9} /> <span className="font-mono" data-mono>{entry.mouseClicks}</span>
                  </span>
                )}
              </motion.div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 text-center py-6">Waiting for live data from agent...</p>
        )}
      </div>
    </div>
  );
}

// ---------- Live Video Stream (WebRTC) ----------
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

  // Poll agent status so we know before attempting stream (15s interval when idle)
  const { data: agentStatusRes } = useGetEmployeeAgentStatusQuery(employeeId, {
    pollingInterval: 15000,
    skip: !employeeId,
  });
  const agentIsActive = agentStatusRes?.data?.isActive ?? false;
  const lastHeartbeat = agentStatusRes?.data?.lastHeartbeat;

  // Cleanup on unmount — ensures no leaked listeners, timers, or peer connections
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
    if (socket && employeeUserId) {
      socket.emit('stream:stop-request', { employeeUserId });
    }
    if (socket) {
      if (signalHandlerRef.current) { socket.off('stream:signal', signalHandlerRef.current); signalHandlerRef.current = null; }
      if (streamErrorHandlerRef.current) { socket.off('stream:error', streamErrorHandlerRef.current); streamErrorHandlerRef.current = null; }
    }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    setStreaming(false);
    setConnecting(false);
  }, [employeeUserId]);

  const startLiveStream = useCallback(() => {
    if (!employeeUserId) {
      setError('Employee user account not found');
      return;
    }

    setConnecting(true);
    setError(null);
    const socket = getSocket();
    if (!socket || !socket.connected) {
      setError('Real-time connection unavailable. Please refresh the page.');
      setConnecting(false);
      return;
    }

    // Clean up previous handlers
    if (signalHandlerRef.current) socket.off('stream:signal', signalHandlerRef.current);
    if (streamErrorHandlerRef.current) socket.off('stream:error', streamErrorHandlerRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    // Handle errors from server — either agent offline check (has employeeUserId)
    // or agent renderer error relay (has employeeUserId from socket.data.userId).
    // Also accept errors with no employeeUserId since this socket receives targeted emits.
    const handleStreamError = (data: any) => {
      const matchesEmployee = !data.employeeUserId || data.employeeUserId === employeeUserId;
      if (matchesEmployee) {
        setError(data.message || 'Agent is not connected');
        setConnecting(false);
      }
    };
    streamErrorHandlerRef.current = handleStreamError;
    socket.on('stream:error', handleStreamError);

    // Create RTCPeerConnection
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
    pcRef.current = pc;

    pc.ontrack = (event) => {
      if (videoRef.current && event.streams[0]) {
        videoRef.current.srcObject = event.streams[0];
        setStreaming(true);
        setConnecting(false);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('stream:signal', {
          type: 'ice-candidate',
          candidate: event.candidate,
          targetSocketId: agentSocketIdRef.current,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setStreaming(false);
        setError('Stream disconnected — agent may have gone offline');
      }
    };

    const handleSignal = (data: any) => {
      if (data.type === 'offer' && data.sdp) {
        agentSocketIdRef.current = data.fromSocketId;
        pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
          .then(() => pc.createAnswer())
          .then((answer) => pc.setLocalDescription(answer))
          .then(() => {
            socket.emit('stream:signal', {
              type: 'answer',
              sdp: pc.localDescription,
              targetSocketId: data.fromSocketId,
            });
          })
          .catch(() => { setError('WebRTC negotiation failed'); setConnecting(false); });
      } else if (data.type === 'ice-candidate' && data.candidate) {
        pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
      }
    };
    signalHandlerRef.current = handleSignal;
    socket.on('stream:signal', handleSignal);

    socket.emit('stream:request', { employeeUserId });

    // Timeout only fires if neither stream:error nor stream:start responds
    timeoutRef.current = setTimeout(() => {
      setConnecting(prev => {
        if (prev) {
          setError('Agent did not respond. Make sure the desktop agent is running.');
          return false;
        }
        return prev;
      });
    }, 15000);
  }, [employeeUserId]);

  const lastSeenText = lastHeartbeat
    ? `Last seen ${new Date(lastHeartbeat).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`
    : 'Never connected';

  return (
    <div className="layer-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
          <Radio size={12} className={streaming ? 'text-red-500 animate-pulse' : 'text-gray-400'} />
          Live Screen
          {streaming && <span className="text-[9px] bg-red-500 text-white px-1.5 py-0.5 rounded-full font-bold animate-pulse">LIVE</span>}
          {!streaming && (
            <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full font-medium ml-1',
              agentIsActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500')}>
              {agentIsActive ? 'Agent Online' : 'Agent Offline'}
            </span>
          )}
        </h4>
        {!streaming && !connecting ? (
          <button
            onClick={startLiveStream}
            disabled={!agentIsActive}
            title={!agentIsActive ? `Desktop agent is offline. ${lastSeenText}` : 'Start live stream'}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1 transition-colors',
              agentIsActive
                ? 'text-white bg-red-600 hover:bg-red-700'
                : 'text-gray-400 bg-gray-100 cursor-not-allowed'
            )}>
            <Radio size={12} /> Start Live Stream
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
          <span>Desktop agent is not running. {lastSeenText}. Ask the employee to start the Aniston desktop agent.</span>
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
                <p className="text-white text-sm">Connecting to employee's screen...</p>
                <p className="text-gray-400 text-xs mt-1">Waiting for agent to respond</p>
              </div>
            ) : error ? (
              <div className="text-center px-6">
                <WifiOff size={28} className="mx-auto text-red-400 mb-2" />
                <p className="text-red-400 text-sm mb-2">{error}</p>
                {agentIsActive && (
                  <button onClick={startLiveStream}
                    className="text-xs text-white/70 hover:text-white underline">Try again</button>
                )}
              </div>
            ) : (
              <div className="text-center">
                <Monitor size={40} className="mx-auto text-gray-600 mb-2" />
                <p className="text-gray-400 text-sm">Click "Start Live Stream" to view employee's screen</p>
                <p className="text-gray-500 text-xs mt-1">Requires desktop agent to be running</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- App Drilldown (clickable Top Applications) ----------
function AppDrilldown({ topApps, logs }: { topApps: any[]; logs: any[] }) {
  const [expandedApp, setExpandedApp] = useState<string | null>(null);

  const getAppLogs = (appName: string) => {
    return logs.filter((l: any) => l.activeApp === appName).sort((a: any, b: any) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  };

  const isBrowser = (app: string) => {
    const lower = app.toLowerCase();
    return lower.includes('chrome') || lower.includes('edge') || lower.includes('firefox') || lower.includes('brave');
  };

  return (
    <div className="layer-card p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <Activity size={14} className="text-brand-500" /> Top Applications
        <span className="text-[10px] text-gray-400 font-normal">(click to expand)</span>
      </h3>
      <div className="space-y-1">
        {topApps.slice(0, 8).map((app: any, i: number) => {
          const maxMin = topApps[0]?.minutes || 1;
          const pct = Math.max(5, (app.minutes / maxMin) * 100);
          const isExpanded = expandedApp === app.app;
          const appLogs = isExpanded ? getAppLogs(app.app) : [];

          return (
            <div key={i}>
              <button onClick={() => setExpandedApp(isExpanded ? null : app.app)}
                className="w-full flex items-center gap-3 py-1 hover:bg-gray-50 rounded-lg transition-colors">
                <span className="text-xs text-gray-500 w-24 truncate text-left">{app.app}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                    className={cn('h-full rounded-full flex items-center justify-end pr-2',
                      isBrowser(app.app) ? 'bg-blue-500' : 'bg-brand-500')}>
                    <span className="text-[9px] text-white font-mono" data-mono>{app.minutes}m</span>
                  </motion.div>
                </div>
                {isBrowser(app.app) && <Globe size={12} className="text-blue-400 flex-shrink-0" />}
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="ml-28 border-l-2 border-gray-200 pl-3 py-2 space-y-1.5 max-h-48 overflow-y-auto">
                      {appLogs.length === 0 ? (
                        <p className="text-[10px] text-gray-400">No detailed logs</p>
                      ) : appLogs.slice(0, 30).map((log: any, j: number) => (
                        <div key={j} className="flex items-start gap-2 text-[11px]">
                          <span className="text-gray-400 font-mono flex-shrink-0 w-14" data-mono>
                            {new Date(log.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-gray-700 truncate">{log.activeWindow || 'Unknown window'}</p>
                            {log.activeUrl && (
                              <p className="text-blue-500 truncate text-[10px]">{log.activeUrl}</p>
                            )}
                          </div>
                          {log.keystrokes > 0 && (
                            <span className="text-blue-400 flex items-center gap-0.5 flex-shrink-0">
                              <Keyboard size={8} /> {log.keystrokes}
                            </span>
                          )}
                          <span className="text-gray-300 flex-shrink-0">{log.durationSeconds}s</span>
                        </div>
                      ))}
                      {appLogs.length > 30 && (
                        <p className="text-[10px] text-gray-400">...and {appLogs.length - 30} more entries</p>
                      )}
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

// ---------- Productivity Score Card (circular progress ring) ----------
function ProductivityScoreCard({ score, productiveMinutes, unproductiveMinutes }: {
  score: number | null; productiveMinutes: number; unproductiveMinutes: number;
}) {
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const pct = score ?? 0;
  const offset = circumference - (pct / 100) * circumference;
  const color = pct >= 70 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444';

  return (
    <div className="layer-card p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-indigo-50 text-indigo-600">
          {pct >= 40 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
        </div>
      </div>
      {score === null ? (
        <>
          <p className="text-2xl font-bold font-mono text-gray-300" data-mono>—</p>
          <p className="text-xs text-gray-400">Productivity</p>
        </>
      ) : (
        <div className="flex items-center gap-3">
          <svg width="52" height="52" className="flex-shrink-0 -rotate-90">
            <circle cx="26" cy="26" r={radius} stroke="#e5e7eb" strokeWidth="5" fill="none" />
            <circle cx="26" cy="26" r={radius} stroke={color} strokeWidth="5" fill="none"
              strokeDasharray={circumference} strokeDashoffset={offset}
              strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
          </svg>
          <div>
            <p className="text-xl font-bold font-mono leading-tight" style={{ color }} data-mono>{pct}%</p>
            <p className="text-[10px] text-gray-400">Productivity</p>
            <p className="text-[9px] text-emerald-600 mt-0.5">{productiveMinutes}m prod.</p>
            {unproductiveMinutes > 0 && (
              <p className="text-[9px] text-red-400">{unproductiveMinutes}m unprod.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Screenshots Gallery with pagination ----------
const SCREENSHOTS_PER_PAGE = 48;

function ScreenshotsGallery({ screenshots, loading, onScreenshotClick }: {
  screenshots: any[]; loading: boolean; onScreenshotClick: (url: string) => void;
}) {
  const [visible, setVisible] = useState(SCREENSHOTS_PER_PAGE);

  // Reset pagination when screenshots change (date/employee switch)
  useEffect(() => { setVisible(SCREENSHOTS_PER_PAGE); }, [screenshots.length]);

  const shown = screenshots.slice(0, visible);
  const hasMore = screenshots.length > visible;

  return (
    <div className="layer-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">
          Screenshots ({loading ? '...' : screenshots.length})
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
                <img src={`${API_BASE}${s.imageUrl}`} alt={s.activeApp || 'Screenshot'}
                  className="w-full h-28 object-cover" loading="lazy" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <Maximize2 size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
                  <p className="text-[9px] text-white truncate">{s.activeApp || 'Desktop'}</p>
                  <p className="text-[8px] text-gray-300">
                    {new Date(s.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                  </p>
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
        <p className="text-xs text-gray-400 text-center py-6">No screenshots captured for this date</p>
      )}
    </div>
  );
}

// ---------- Stat Card ----------
function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    blue: 'bg-blue-50 text-blue-600',
    purple: 'bg-purple-50 text-purple-600',
  };
  return (
    <div className="layer-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', colors[color])}>
          <Icon size={16} />
        </div>
      </div>
      <p className="text-2xl font-bold font-mono text-gray-800" data-mono>{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}
