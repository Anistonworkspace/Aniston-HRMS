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

  // Only check agent status for HYBRID employees
  const { data: statusRes } = useGetAgentStatusQuery(undefined, { skip: shiftType !== 'HYBRID' || isManagement });
  const agentActive = statusRes?.data?.isActive;

  // Don't show if: not hybrid, already active, dismissed, or management
  if (isManagement || shiftType !== 'HYBRID' || agentActive || dismissed) {
    // Show small connected badge if agent is active
    if (shiftType === 'HYBRID' && agentActive && !isManagement) {
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

  // Default download URL — in production this comes from org settings
  const downloadUrl = '/uploads/agent/AnistonActivityAgent-Setup.exe';

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

            <div className="flex items-center gap-3 mb-3">
              <a href={downloadUrl} download
                className="inline-flex items-center gap-2 bg-white text-brand-700 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-white/90 transition-colors shadow-sm">
                <Download size={16} /> Download Agent
              </a>
              <button onClick={() => setShowSteps(!showSteps)}
                className="inline-flex items-center gap-1 text-sm text-white/70 hover:text-white transition-colors">
                How to install {showSteps ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>

            <AnimatePresence>
              {showSteps && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="bg-white/10 rounded-xl p-4 text-sm text-white/90 space-y-2">
                    <div className="flex gap-2">
                      <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold flex-shrink-0">1</span>
                      <p>Click "Download Agent" above to get the installer (.exe)</p>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold flex-shrink-0">2</span>
                      <p>Run the downloaded file and follow the installation wizard</p>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold flex-shrink-0">3</span>
                      <p>The agent will appear in your system tray (bottom-right). Log in with your HRMS email and password</p>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold flex-shrink-0">4</span>
                      <p>Done! The agent will auto-start on boot and track your activity during work hours</p>
                    </div>
                    <p className="text-xs text-white/50 mt-2">The agent tracks: active apps, idle time, and periodic screenshots. No keylogging.</p>
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
