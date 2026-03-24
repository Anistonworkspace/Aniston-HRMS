import { Outlet } from 'react-router-dom';
import { motion } from 'framer-motion';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import MobileBottomNav from './MobileBottomNav';
import ActivityCheckInPrompt from '../ActivityCheckInPrompt';
import useActivityTracker from '../../hooks/useActivityTracker';

export default function AppShell() {
  // Activity tracking — runs globally for all logged-in users
  useActivityTracker();

  return (
    <div className="flex min-h-screen bg-surface-1">
      {/* Sidebar — desktop only */}
      <Sidebar />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-h-screen">
        <Topbar />
        <main className="flex-1 pb-20 md:pb-0">
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
    </div>
  );
}
