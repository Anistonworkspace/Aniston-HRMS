import { useEffect, useState, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { WifiOff } from 'lucide-react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import MobileBottomNav from './MobileBottomNav';
import ActivityCheckInPrompt from '../ActivityCheckInPrompt';
import useActivityTracker from '../../hooks/useActivityTracker';
import { useInactivityTimeout } from '../../hooks/useInactivityTimeout';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useOfflineSync } from '../../hooks/useOfflineSync';
import { useAppSelector, useAppDispatch } from '../../app/store';
import { api } from '../../app/api';
import AiAssistantFab from '../../features/ai-assistant/AiAssistantPanel';
import { connectSocket, disconnectSocket, onSocketEvent, offSocketEvent } from '../../lib/socket';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

export default function AppShell() {
  const { t } = useTranslation();

  // Activity tracking — runs globally for all logged-in users
  useActivityTracker();

  // Network status + offline action sync
  const { isOnline } = useNetworkStatus();
  useOfflineSync();
  const wasOffline = useRef(false);
  useEffect(() => {
    if (!isOnline) {
      wasOffline.current = true;
    } else if (wasOffline.current) {
      wasOffline.current = false;
      toast.success(t('appShell.backOnline'));
    }
  }, [isOnline, t]);
  const user = useAppSelector(s => s.auth.user);
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);
  const { resetTimer } = useInactivityTimeout(() => setShowTimeoutWarning(true));

  // Connect Socket.io when user is logged in
  const accessToken = useAppSelector(s => s.auth.accessToken);
  const dispatch = useAppDispatch();
  useEffect(() => {
    if (accessToken) {
      connectSocket(accessToken);
    }
    return () => { disconnectSocket(); };
  }, [accessToken]);

  // Real-time dashboard refresh — invalidate RTK Query cache on server events
  useEffect(() => {
    const handleDashboardRefresh = () => {
      dispatch(api.util.invalidateTags(['Dashboard']));
    };
    onSocketEvent('dashboard:refresh', handleDashboardRefresh);
    return () => { offSocketEvent('dashboard:refresh', handleDashboardRefresh); };
  }, [dispatch]);

  // Real-time document verification notification — auto-fill feedback
  useEffect(() => {
    const handleDocVerified = (data: { documentType?: string; autoFilledFields?: string[]; message?: string }) => {
      if (data.autoFilledFields && data.autoFilledFields.length > 0) {
        toast.success(data.message || `Document verified! Auto-filled: ${data.autoFilledFields.join(', ')}`, { duration: 6000 });
        // Refresh employee data
        dispatch(api.util.invalidateTags(['Employee', 'Document']));
      } else {
        toast.success(`Your ${(data.documentType || 'document').replace(/_/g, ' ')} was approved by HR`);
        dispatch(api.util.invalidateTags(['Document']));
      }
    };
    onSocketEvent('document:verified', handleDocVerified);
    return () => { offSocketEvent('document:verified', handleDocVerified); };
  }, [dispatch]);
  const location = useLocation();
  const isAdminOrHR = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role || '');
  const aiContext = location.pathname.startsWith('/recruitment') ? 'hr-recruitment' as const
    : location.pathname.startsWith('/settings') ? 'admin' as const
    : 'hr-general' as const;
  const aiLabel = aiContext === 'hr-recruitment' ? t('appShell.hrRecruitmentAssistant')
    : aiContext === 'admin' ? t('appShell.adminAssistant') : t('appShell.hrAssistant');

  const exitAccess = user?.exitAccess;

  return (
    <div className="flex h-[100dvh] bg-surface-1 overflow-hidden">
      {/* Sidebar — desktop only */}
      <Sidebar />

      {/* Main area — min-h-0 lets the flex column shrink below content height,
          enabling the <main> scroll container to work correctly */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        <Topbar />
        {/* pb-[calc(5rem+env(safe-area-inset-bottom,0px))]: accounts for 64px mobile nav + iOS safe area */}
        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:pb-0">
          {/* Offline banner */}
          <AnimatePresence>
            {!isOnline && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center gap-2">
                  <WifiOff size={14} className="text-red-500 flex-shrink-0" />
                  <p className="text-xs text-red-700 font-medium">{t('appShell.offline')}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {/* Limited access banner for exiting employees */}
          {exitAccess && (
            <div className="mx-4 mt-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600 flex-shrink-0"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
              <p className="text-xs text-amber-700">{t('appShell.limitedAccess')}</p>
            </div>
          )}
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            <Outlet />
          </motion.div>
        </main>
      </div>

      {/* Mobile bottom nav */}
      <MobileBottomNav />

      {/* Activity check-in prompts for hybrid employees */}
      <ActivityCheckInPrompt />

      {/* AI Assistant FAB — visible to Admin/HR */}
      {isAdminOrHR && <AiAssistantFab context={aiContext} label={aiLabel} />}

      {/* Inactivity timeout warning modal */}
      {showTimeoutWarning && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="timeout-title">
          <div className="layer-card mx-4 w-full max-w-sm rounded-2xl p-6 shadow-xl">
            <h2 id="timeout-title" className="font-sora text-lg font-semibold text-gray-900">{t('appShell.sessionExpiring')}</h2>
            <p className="mt-2 text-sm text-gray-600">
              {t('appShell.sessionExpiryMessage')}
            </p>
            <div className="mt-5 flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowTimeoutWarning(false);
                  resetTimer();
                }}
                className="btn-primary px-5 py-2 text-sm"
              >
                {t('appShell.stayLoggedIn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
