import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Monitor, Download, ChevronDown, ChevronUp, X, CheckCircle2, Loader2, Wifi, WifiOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppSelector } from '../app/store';
import { useGetAgentStatusQuery, useGetAgentDownloadStatusQuery, useGenerateAgentPairCodeMutation } from '../features/attendance/attendanceApi';
import { useGetEmployeeShiftQuery } from '../features/workforce/workforceApi';
import { onSocketEvent, offSocketEvent, getSocket } from '../lib/socket';

const MANAGEMENT_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];
const DISMISS_KEY = 'agent-banner-dismissed';

function isDismissedToday(): boolean {
  const dismissed = localStorage.getItem(DISMISS_KEY);
  if (!dismissed) return false;
  return dismissed === new Date().toISOString().split('T')[0];
}

export default function AgentDownloadBanner() {
  const user = useAppSelector(s => s.auth.user);
  const isManagement = user?.role ? MANAGEMENT_ROLES.includes(user.role) : false;
  const [dismissed, setDismissed] = useState(isDismissedToday());
  const [showSteps, setShowSteps] = useState(false);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [generatePairCode, { isLoading: generating }] = useGenerateAgentPairCodeMutation();
  const [phase, setPhase] = useState<'checking' | 'connected' | 'not-connected' | 'hidden'>('checking');

  // Skip for management users
  const { data: shiftRes, isLoading: loadingShift } = useGetEmployeeShiftQuery(user?.employeeId || '', { skip: !user?.employeeId || isManagement });
  const shiftType = shiftRes?.data?.shift?.shiftType;

  // Check employee.workMode as fallback
  const workMode = (user as any)?.workMode;
  const needsAgent = shiftType === 'HYBRID' || shiftType === 'OFFICE' || workMode === 'HYBRID' || workMode === 'OFFICE';

  // Poll agent status every 30 seconds
  const { data: statusRes, isLoading: loadingStatus } = useGetAgentStatusQuery(undefined, {
    skip: !needsAgent || isManagement,
    pollingInterval: 15_000,
  });
  const agentActive = statusRes?.data?.isActive;

  // Listen for real-time agent connection via Socket.io
  // Re-registers when socket reconnects (onSocketEvent now queues if socket not ready)
  useEffect(() => {
    const handleConnected = () => setPhase('connected');
    onSocketEvent('agent:connected', handleConnected);

    // Also listen for socket reconnect to re-register
    const sock = getSocket();
    const onReconnect = () => onSocketEvent('agent:connected', handleConnected);
    sock?.on('connect', onReconnect);

    return () => {
      offSocketEvent('agent:connected', handleConnected);
      sock?.off('connect', onReconnect);
    };
  }, []);

  // Determine phase
  useEffect(() => {
    if (isManagement || !needsAgent) {
      setPhase('hidden');
    } else if (loadingShift || loadingStatus) {
      setPhase('checking');
    } else if (agentActive) {
      setPhase('connected');
    } else {
      setPhase('not-connected');
    }
  }, [isManagement, needsAgent, loadingShift, loadingStatus, agentActive]);

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, new Date().toISOString().split('T')[0]);
    setDismissed(true);
  };

  // Check whether the installer exe is actually available on the server
  const { data: downloadStatusRes } = useGetAgentDownloadStatusQuery(undefined, {
    skip: phase === 'hidden' || phase === 'connected',
  });
  const downloadAvailable = downloadStatusRes?.data?.available ?? false;
  const downloadUrl = downloadStatusRes?.data?.downloadUrl || '/downloads/aniston-support-setup.exe';

  // Hidden for management or non-agent employees
  if (phase === 'hidden') return null;

  // Top banner: connected status (small green badge)
  if (phase === 'connected') {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-600 text-xs font-medium rounded-lg mx-6 mt-2 w-fit">
        <CheckCircle2 size={12} /> Desktop Agent Connected
      </div>
    );
  }

  // Checking phase — small bottom-right toast
  if (phase === 'checking') {
    return (
      <div className="fixed bottom-20 right-4 z-40">
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="bg-white rounded-xl shadow-lg border border-gray-200 px-4 py-3 flex items-center gap-3 max-w-xs"
        >
          <Loader2 size={18} className="animate-spin flex-shrink-0" style={{ color: 'var(--primary-color)' }} />
          <div>
            <p className="text-sm font-medium text-gray-700">Checking agent status...</p>
            <p className="text-[11px] text-gray-400">Connecting to activity tracker</p>
          </div>
        </motion.div>
      </div>
    );
  }

  // Not connected + dismissed → small bottom-right reminder (doesn't block)
  if (dismissed) {
    return (
      <div className="fixed bottom-20 right-4 z-40">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-center gap-2 shadow-sm cursor-pointer max-w-xs"
          onClick={() => setDismissed(false)}
        >
          <WifiOff size={14} className="text-amber-500 flex-shrink-0" />
          <p className="text-xs text-amber-700">Agent not connected <span className="underline">Setup</span></p>
        </motion.div>
      </div>
    );
  }

  // Not connected — full download banner (non-blocking, bottom-right floating widget)
  return (
    <div className="fixed bottom-20 right-4 z-40 w-[380px]">
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden"
      >
        {/* Header */}
        <div className="to-purple-600 text-white px-4 py-3 flex items-center justify-between" style={{ background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' }}>
          <div className="flex items-center gap-2">
            <Monitor size={18} />
            <span className="text-sm font-semibold">Activity Agent Required</span>
          </div>
          <button onClick={handleDismiss} className="text-white/50 hover:text-white/90 transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3">
          <p className="text-xs text-gray-500 mb-3">
            Your hybrid shift requires the desktop agent for activity tracking. Download and install to get started.
          </p>

          <div className="flex items-center gap-2 mb-2">
            {downloadAvailable ? (
              <a href={downloadUrl} download="aniston-support-setup.exe"
                className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors" style={{ background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' }}>
                <Download size={14} /> Download
              </a>
            ) : (
              <div className="flex-1 inline-flex items-center justify-center gap-2 bg-gray-100 text-gray-400 px-3 py-2 rounded-lg text-sm font-medium cursor-not-allowed"
                title="Installer not yet built. Push to main to trigger the build.">
                <Download size={14} /> Not yet built
              </div>
            )}
            <button onClick={async () => {
              try {
                const res = await generatePairCode().unwrap();
                setPairCode(res.data?.code);
              } catch (err: any) {
                toast.error(err?.data?.error?.message || 'Failed to generate pairing code. Please try again.');
              }
            }} disabled={generating}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50">
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
              {pairCode ? 'New Code' : 'Link Agent'}
            </button>
          </div>

          {/* Pairing code display */}
          {pairCode && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-2 text-center">
              <p className="text-[10px] text-gray-400 mb-1">Enter this code in the agent app:</p>
              <div className="flex items-center justify-center gap-2">
                <span className="text-2xl font-mono font-bold tracking-widest" data-mono style={{ color: 'var(--primary-color)' }}>{pairCode}</span>
                <button onClick={() => { navigator.clipboard.writeText(pairCode).catch(() => {}); }}
                  className="text-xs underline" style={{ color: 'var(--primary-color)' }}>Copy</button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">Expires in 5 minutes</p>
            </div>
          )}

          <button onClick={() => setShowSteps(!showSteps)}
            className="w-full text-xs text-gray-400 hover:text-gray-600 transition-colors flex items-center justify-center gap-1 mb-1">
            Installation steps {showSteps ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>

          <AnimatePresence>
            {showSteps && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="bg-gray-50 rounded-lg p-3 text-[11px] text-gray-600 space-y-1.5 mt-1">
                  <p><strong>1.</strong> Click "Download Agent" — browser may warn "isn't commonly downloaded"</p>
                  <p><strong>2.</strong> Click <strong>↑ arrow → "Keep" → "Keep anyway"</strong></p>
                  <p><strong>3.</strong> If SmartScreen pops up → <strong>"More info" → "Run anyway"</strong></p>
                  <p><strong>4.</strong> Install → login with HRMS credentials in system tray</p>
                  <p className="text-gray-400 pt-1 border-t border-gray-200">Safe software by Aniston IT. Tracks: active apps, idle time, screenshots. No keylogging.</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Status indicator */}
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100">
            <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
            <span className="text-[10px] text-gray-400">Agent not detected — waiting for connection...</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
