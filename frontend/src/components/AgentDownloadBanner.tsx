import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Monitor, Download, ChevronDown, ChevronUp, X, CheckCircle2 } from 'lucide-react';
import { useAppSelector } from '../app/store';
import { useGetAgentStatusQuery } from '../features/attendance/attendanceApi';
import { useGetEmployeeShiftQuery } from '../features/workforce/workforceApi';

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

  // Skip for management users
  const { data: shiftRes } = useGetEmployeeShiftQuery(user?.employeeId || '', { skip: !user?.employeeId || isManagement });
  const shiftType = shiftRes?.data?.shift?.shiftType;

  // Check agent status for OFFICE and HYBRID employees
  // Also check employee.workMode as fallback when no shift is assigned yet
  const workMode = (user as any)?.workMode;
  const needsAgent = shiftType === 'HYBRID' || shiftType === 'OFFICE' || workMode === 'HYBRID' || workMode === 'OFFICE';
  const { data: statusRes } = useGetAgentStatusQuery(undefined, { skip: !needsAgent || isManagement });
  const agentActive = statusRes?.data?.isActive;

  // Don't show if: doesn't need agent, already active, dismissed, or management
  if (isManagement || !needsAgent || agentActive || dismissed) {
    if (needsAgent && agentActive && !isManagement) {
      return (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-600 text-xs font-medium rounded-lg mx-6 mt-2 w-fit">
          <CheckCircle2 size={12} /> Desktop Agent Connected
        </div>
      );
    }
    return null;
  }

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, new Date().toISOString().split('T')[0]);
    setDismissed(true);
  };

  const apiBase = (import.meta.env.VITE_API_URL || 'http://localhost:4000/api').replace('/api', '');
  const downloadUrl = import.meta.env.VITE_AGENT_DOWNLOAD_URL || `${apiBase}/uploads/agent/aniston-agent.exe`;

  return (
    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mx-6 mt-3 mb-1">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-brand-600 to-purple-600 text-white p-5 shadow-lg">
        {/* Dismiss button */}
        <button onClick={handleDismiss} className="absolute top-3 right-3 text-white/50 hover:text-white/80 transition-colors">
          <X size={16} />
        </button>

        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
            <Monitor size={24} />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold mb-1">Desktop Activity Agent Required</h3>
            <p className="text-sm text-white/80 mb-3">
              Your hybrid shift requires desktop monitoring to track activity on work-from-home days.
              Download and install the agent to get started.
            </p>

            <div className="flex items-center gap-3 mb-2">
              <a href={downloadUrl} download="aniston-agent.exe"
                className="inline-flex items-center gap-2 bg-white text-brand-700 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-white/90 transition-colors shadow-sm">
                <Download size={16} /> Download Agent
              </a>
              <button onClick={() => setShowSteps(!showSteps)}
                className="inline-flex items-center gap-1 text-sm text-white/70 hover:text-white transition-colors">
                How to install {showSteps ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
            <p className="text-[11px] text-white/50 mb-3">Windows may show a security warning — this is normal for new software. Follow the steps below to proceed safely.</p>

            <AnimatePresence>
              {showSteps && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="bg-white/10 rounded-xl p-4 text-sm text-white/90 space-y-2.5">
                    <div className="flex gap-2">
                      <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold flex-shrink-0">1</span>
                      <p>Click <strong>"Download Agent"</strong> — your browser may show <em>"isn't commonly downloaded"</em></p>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-5 h-5 rounded-full bg-amber-400/30 flex items-center justify-center text-xs font-bold flex-shrink-0">2</span>
                      <p>Click the <strong>↑ arrow</strong> next to the warning → Click <strong>"Keep"</strong> → then <strong>"Keep anyway"</strong></p>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-5 h-5 rounded-full bg-amber-400/30 flex items-center justify-center text-xs font-bold flex-shrink-0">3</span>
                      <p>If Windows SmartScreen pops up → Click <strong>"More info"</strong> → Click <strong>"Run anyway"</strong></p>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold flex-shrink-0">4</span>
                      <p>Follow the installer → Agent appears in system tray (bottom-right). Log in with your HRMS credentials</p>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-5 h-5 rounded-full bg-emerald-400/30 flex items-center justify-center text-xs font-bold flex-shrink-0">5</span>
                      <p>Done! Agent auto-starts on boot and tracks activity during your shift hours</p>
                    </div>
                    <p className="text-xs text-white/40 mt-2 border-t border-white/10 pt-2">The warning appears because the agent is new and doesn't yet have a code signing certificate. It is safe — built by Aniston Technologies IT team. Tracks: active apps, idle time, periodic screenshots. No keylogging.</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
