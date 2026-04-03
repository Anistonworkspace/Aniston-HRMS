import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import MobileBottomNav from './MobileBottomNav';
import ActivityCheckInPrompt from '../ActivityCheckInPrompt';
// AgentDownloadBanner removed — agent setup is now admin-only via Settings > Agent Setup
import useActivityTracker from '../../hooks/useActivityTracker';
import { useAppSelector, useAppDispatch } from '../../app/store';
import { api } from '../../app/api';
import AiAssistantFab from '../../features/ai-assistant/AiAssistantPanel';
import { connectSocket, disconnectSocket, onSocketEvent, offSocketEvent } from '../../lib/socket';

export default function AppShell() {
  // Activity tracking — runs globally for all logged-in users
  useActivityTracker();
  const user = useAppSelector(s => s.auth.user);

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
  const location = useLocation();
  const isAdminOrHR = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role || '');
  const aiContext = location.pathname.startsWith('/recruitment') ? 'hr-recruitment' as const
    : location.pathname.startsWith('/settings') ? 'admin' as const
    : 'hr-general' as const;
  const aiLabel = aiContext === 'hr-recruitment' ? 'HR Recruitment Assistant'
    : aiContext === 'admin' ? 'Admin Assistant' : 'HR Assistant';

  const exitAccess = user?.exitAccess;

  return (
    <div className="flex min-h-screen bg-surface-1">
      {/* Sidebar — desktop only */}
      <Sidebar />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-h-screen">
        <Topbar />
        <main className="flex-1 pb-20 md:pb-0">
          {/* Limited access banner for exiting employees */}
          {exitAccess && (
            <div className="mx-4 mt-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600 flex-shrink-0"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
              <p className="text-xs text-amber-700">You are in <strong>limited access mode</strong>. Only specific features are available. Contact HR for details.</p>
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
    </div>
  );
}
