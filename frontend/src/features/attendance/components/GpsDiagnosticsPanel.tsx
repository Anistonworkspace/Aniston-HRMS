import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Activity, ChevronDown, ChevronUp, RefreshCw, Copy, CheckCircle2 } from 'lucide-react';
import { getNativeGpsDiagnostics } from '../../../lib/capacitorGPS';

const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export default function GpsDiagnosticsPanel() {
  if (!isAndroid) return null;

  return <GpsDiagnosticsPanelInner />;
}

function GpsDiagnosticsPanelInner() {
  const [open, setOpen]         = useState(false);
  const [diag, setDiag]         = useState<Record<string, string>>({});
  const [loading, setLoading]   = useState(false);
  const [copied, setCopied]     = useState(false);

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
    if (!open) {
      await fetchDiag();
    }
    setOpen((v) => !v);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(diag, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  }

  async function handleRefresh() {
    await fetchDiag();
  }

  const entries = Object.entries(diag);

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
              onClick={handleRefresh}
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

          {/* Table */}
          <div className="overflow-x-auto">
            {entries.length === 0 ? (
              <p className="px-4 py-3 text-xs text-gray-600 font-mono">
                {loading ? 'Loading…' : 'No diagnostics data available.'}
              </p>
            ) : (
              <table className="w-full text-xs font-mono">
                <tbody>
                  {entries.map(([key, value]) => (
                    <tr key={key} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                      <td className="px-4 py-2 text-indigo-400 whitespace-nowrap align-top w-1/2 select-all">
                        {key}
                      </td>
                      <td className="px-4 py-2 text-gray-300 break-all align-top select-all">
                        {value === '' ? <span className="text-gray-600 italic">—</span> : value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
