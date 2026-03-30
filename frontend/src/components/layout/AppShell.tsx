import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import MobileBottomNav from './MobileBottomNav';
import ActivityCheckInPrompt from '../ActivityCheckInPrompt';
import AgentDownloadBanner from '../AgentDownloadBanner';
import useActivityTracker from '../../hooks/useActivityTracker';
import { useAppSelector } from '../../app/store';
import AiAssistantFab from '../../features/ai-assistant/AiAssistantPanel';
import { connectSocket, disconnectSocket } from '../../lib/socket';

export default function AppShell() {
  // Activity tracking — runs globally for all logged-in users
  useActivityTracker();
  const user = useAppSelector(s => s.auth.user);

  // Connect Socket.io when user is logged in
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      connectSocket(token);
    }
    return () => { disconnectSocket(); };
  }, [user?.id]);
  const location = useLocation();
  const isAdminOrHR = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role || '');
  const aiContext = location.pathname.startsWith('/recruitment') ? 'hr-recruitment' as const
    : location.pathname.startsWith('/settings') ? 'admin' as const
    : 'hr-general' as const;
  const aiLabel = aiContext === 'hr-recruitment' ? 'HR Recruitment Assistant'
    : aiContext === 'admin' ? 'Admin Assistant' : 'HR Assistant';

  return (
    <div className="flex min-h-screen bg-surface-1">
      {/* Sidebar — desktop only */}
      <Sidebar />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-h-screen">
        <Topbar />
        <main className="flex-1 pb-20 md:pb-0">
          <AgentDownloadBanner />
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
