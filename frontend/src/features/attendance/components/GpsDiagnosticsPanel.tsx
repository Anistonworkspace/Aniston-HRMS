import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Activity, ChevronDown, ChevronUp, RefreshCw, Copy, CheckCircle2, AlertTriangle } from 'lucide-react';
import { getNativeGpsDiagnostics } from '../../../lib/capacitorGPS';

const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export default function GpsDiagnosticsPanel() {
  if (!isAndroid) return null;
  return <GpsDiagnosticsPanelInner />;
}

// Fields that indicate a problem when they have specific values — shown in red
const ALERT_RULES: Record<string, (v: string) => boolean> = {
  credentialsPresent:          (v) => v === 'false',
  trackingEnabled:             (v) => v === 'false',
  baseUrlValid:                (v) => v === 'false',
  serviceRunning:              (v) => v === 'false',
  lastWatchdogResult:          (v) => v.startsWith('no_credentials') || v.startsWith('failed'),
  lastRestartResult:           (v) => v.startsWith('failed') || v.startsWith('missing_credentials') || v === 'deferred_to_user_unlocked',
  suspectedForceStop:          (v) => v === 'true',
  batteryOptimizationIgnored:  (v) => v === 'false',
  locationPermissionFine:      (v) => v === 'false',
  locationPermissionBackground:(v) => v === 'false',
  tokenPresent:                (v) => v === 'false',
  attendanceIdPresent:         (v) => v === 'false',
  lastAlarmScheduleResult:     (v) => v.startsWith('failed'),
  exactAlarmGranted:           (v) => v === 'false',
  consecutive403Count:         (v) => parseInt(v, 10) >= 2,
  gpsConsentRequired:          (v) => v === 'true',
};

// Fields that indicate success when they have specific values — shown in green
const OK_RULES: Record<string, (v: string) => boolean> = {
  credentialsPresent:          (v) => v === 'true',
  trackingEnabled:             (v) => v === 'true',
  baseUrlValid:                (v) => v === 'true',
  serviceRunning:              (v) => v === 'true',
  batteryOptimizationIgnored:  (v) => v === 'true',
  locationPermissionFine:      (v) => v === 'true',
  locationPermissionBackground:(v) => v === 'true',
  tokenPresent:                (v) => v === 'true',
  attendanceIdPresent:         (v) => v === 'true',
  lastWatchdogResult:          (v) => v === 'service_already_running' || v === 'restarted_service',
  lastRestartResult:           (v) => v === 'started' || v === 'skipped_already_running',
  exactAlarmGranted:           (v) => v === 'true',
  lastAlarmScheduleResult:     (v) => v === 'ok' || v === 'ok_inexact_fallback',
  lastAlarmType:               (v) => v === 'exact',
  consecutive403Count:         (v) => v === '0',
  gpsConsentRequired:          (v) => v === 'false',
  directBootLocked:            (v) => v === 'false',
};

// Human-friendly group labels and field order for readability
const GROUPS: Array<{ label: string; keys: string[] }> = [
  {
    label: 'Session & Service',
    keys: ['sessionState', 'serviceRunning', 'trackingEnabled', 'credentialsPresent',
           'missingCredentialFields', 'tokenPresent', 'foregroundNotificationVisible',
           'nativeSessionStoredAt', 'nativeSessionClearedAt',
           'gpsStopReason', 'gpsConsentRequired'],
  },
  {
    label: 'URL & API',
    keys: ['apiBaseUrl', 'heartbeatUrl', 'baseUrlValid', 'baseUrlSource'],
  },
  {
    label: 'GPS & Heartbeat',
    keys: ['lastLocationRequestAt', 'lastLocationReceivedAt', 'lastGpsPointAt',
           'lastHeartbeatAt', 'nextLocationDueAt', 'nextGpsCaptureAt',
           'lastPointSkipReason', 'lastPointSkipAt'],
  },
  {
    label: 'GPS Interval',
    keys: ['gpsIntervalMs', 'gpsIntervalLabel', 'gpsIntervalSource', 'lastIntervalUpdatedAt'],
  },
  {
    label: 'Service Lifecycle',
    keys: ['lastServiceStartAt', 'lastServiceStopAt', 'lastServiceStopReason',
           'lastOnTaskRemovedAt', 'lastRestartAlarmScheduledAt'],
  },
  {
    label: 'Restart Chain',
    keys: ['lastRestartReceiverFiredAt', 'lastRestartReceiverAction',
           'lastRestartAttemptAt', 'restartCredentialsPresent',
           'restartServiceIntentCreatedAt', 'restartStartForegroundServiceCalledAt',
           'lastRestartResult', 'lastRestartException',
           'directBootLocked', 'userUnlockedReceiverRegistered', 'restartDeferredUntilUnlock'],
  },
  {
    label: 'Watchdog',
    keys: ['lastWatchdogRunAt', 'lastWatchdogResult', 'watchdogCredentialsPresent',
           'watchdogMissingFields', 'watchdogRestartAttemptAt', 'watchdogException'],
  },
  {
    label: 'Permissions',
    keys: ['locationPermissionFine', 'locationPermissionBackground',
           'batteryOptimizationIgnored', 'oemAutoStartNotFound'],
  },
  {
    label: 'HTTP',
    keys: ['lastHttpRequestAt', 'lastHttpRequestUrl', 'lastHttpResponseAt',
           'lastBackendStatusCode', 'lastErrorMessage',
           'consecutive403Count', 'last403At',
           'tokenRetrySource', 'tokenRetryAttemptedAt'],
  },
  {
    label: 'Force-Stop Detection',
    keys: ['suspectedForceStop', 'suspectedForceStopAt'],
  },
  {
    label: 'Alarm Diagnostics',
    keys: ['exactAlarmGranted', 'lastAlarmType', 'lastAlarmScheduleResult', 'lastAlarmScheduleError'],
  },
  {
    label: 'Credential Snapshot',
    keys: [
      'attendanceIdPresent', 'attendanceIdFirst8',
      'pluginCredSnapshotAt', 'serviceCredSnapshotAt',
      'receiverCredSnapshotAt', 'watchdogCredSnapshotAt',
    ],
  },
  {
    label: 'Device',
    keys: ['manufacturer', 'brand', 'model', 'sdkInt'],
  },
];

function rowColor(key: string, value: string): string {
  if (ALERT_RULES[key]?.(value)) return 'text-red-400';
  if (OK_RULES[key]?.(value))    return 'text-green-400';
  return 'text-gray-300';
}

function GpsDiagnosticsPanelInner() {
  const [open, setOpen]       = useState(false);
  const [diag, setDiag]       = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [copied, setCopied]   = useState(false);

  async function fetchDiag() {
    setLoading(true);
    try {
      const result = await getNativeGpsDiagnostics();
      setDiag(result);
    } catch {
      setDiag({ _error: 'Failed to fetch diagnostics' });
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle() {
    if (!open) await fetchDiag();
    setOpen((v) => !v);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(diag, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  // Show a summary alert badge when critical fields indicate a problem
  const hasCriticalAlert = Object.entries(diag).some(
    ([k, v]) => ALERT_RULES[k]?.(v)
  );

  return (
    <div className="mt-4 bg-gray-900 rounded-xl border border-white/10 overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <Activity className="w-4 h-4 text-indigo-400" />
          <span className="font-mono">GPS Diagnostics</span>
          {hasCriticalAlert && !open && (
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
          )}
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4 text-gray-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-500" />
        )}
      </button>

      {/* Expanded panel */}
      {open && (
        <div className="border-t border-white/10">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10">
            <button
              onClick={fetchDiag}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors ml-auto"
            >
              {copied ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                  <span className="text-green-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy JSON
                </>
              )}
            </button>
          </div>

          {Object.keys(diag).length === 0 ? (
            <p className="px-4 py-3 text-xs text-gray-600 font-mono">
              {loading ? 'Loading…' : 'No diagnostics data available.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              {GROUPS.map((group) => {
                // Collect known keys in order, then append any unlisted keys at end
                const groupEntries = group.keys
                  .filter((k) => k in diag)
                  .map((k) => [k, diag[k]] as [string, string]);
                if (groupEntries.length === 0) return null;
                return (
                  <div key={group.label}>
                    <div className="px-4 py-1.5 bg-white/5 text-gray-500 text-[10px] font-semibold uppercase tracking-widest">
                      {group.label}
                    </div>
                    <table className="w-full text-xs font-mono">
                      <tbody>
                        {groupEntries.map(([key, value]) => (
                          <tr key={key} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                            <td className="px-4 py-1.5 text-indigo-400 whitespace-nowrap align-top w-[45%] select-all">
                              {key}
                            </td>
                            <td className={`px-4 py-1.5 break-all align-top select-all ${rowColor(key, String(value))}`}>
                              {value === '' || value === undefined
                                ? <span className="text-gray-600 italic">—</span>
                                : String(value)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}

              {/* Ungrouped / extra fields appended at end */}
              {(() => {
                const grouped = new Set(GROUPS.flatMap((g) => g.keys));
                const extra = Object.entries(diag).filter(([k]) => !grouped.has(k));
                if (extra.length === 0) return null;
                return (
                  <div>
                    <div className="px-4 py-1.5 bg-white/5 text-gray-500 text-[10px] font-semibold uppercase tracking-widest">
                      Other
                    </div>
                    <table className="w-full text-xs font-mono">
                      <tbody>
                        {extra.map(([key, value]) => (
                          <tr key={key} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                            <td className="px-4 py-1.5 text-indigo-400 whitespace-nowrap align-top w-[45%] select-all">{key}</td>
                            <td className={`px-4 py-1.5 break-all align-top select-all ${rowColor(key, String(value))}`}>
                              {value === '' ? <span className="text-gray-600 italic">—</span> : String(value)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
