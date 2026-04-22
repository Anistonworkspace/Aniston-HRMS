import { useState, useEffect, useRef } from 'react';
import { Bell, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { onSocketEvent, offSocketEvent } from '../../lib/socket';
import toast from 'react-hot-toast';
import {
  useGetNotificationsQuery,
  useGetUnreadCountQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
  type DbNotification,
} from './notificationsApi';

interface LiveNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  link?: string;
  timestamp: string;
  isRead: boolean;
  isLive: boolean; // true = arrived via socket this session (not yet in DB poll)
}

const playNotificationSound = () => {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    gain.gain.value = 0.3;
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    oscillator.stop(ctx.currentTime + 0.5);
  } catch {}
};

function dbNotifToLive(n: DbNotification): LiveNotification {
  const data = n.data as Record<string, unknown> | null | undefined;
  return {
    id: n.id,
    title: n.title,
    message: n.message,
    type: n.type,
    link: data?.link as string | undefined,
    timestamp: n.createdAt,
    isRead: n.isRead,
    isLive: false,
  };
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const [liveNotifs, setLiveNotifs] = useState<LiveNotification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // DB-backed queries
  const { data: notifData, refetch: refetchNotifs } = useGetNotificationsQuery(
    { page: 1, limit: 50 },
    { refetchOnFocus: true },
  );
  const { data: unreadData, refetch: refetchUnread } = useGetUnreadCountQuery(undefined, {
    refetchOnFocus: true,
    pollingInterval: 60_000,
  });

  const [markRead] = useMarkNotificationReadMutation();
  const [markAllRead] = useMarkAllNotificationsReadMutation();

  // Merge DB notifications with live ones that haven't been persisted yet.
  // DB notifications are the source of truth; live ones fill the gap for
  // any socket events that arrived before this component polled again.
  const dbIds = new Set((notifData?.data ?? []).map((n) => n.id));
  const pendingLive = liveNotifs.filter((n) => !dbIds.has(n.id));
  const dbMapped = (notifData?.data ?? []).map(dbNotifToLive);
  const notifications: LiveNotification[] = [...pendingLive, ...dbMapped];

  const unreadCount =
    (unreadData?.count ?? 0) + pendingLive.filter((n) => !n.isRead).length;

  // Listen for real-time notifications
  useEffect(() => {
    const handler = (data: any) => {
      playNotificationSound();
      setLiveNotifs((prev) =>
        [
          {
            id: data.id ?? `live-${Date.now()}`,
            title: data.title,
            message: data.message,
            type: data.type,
            link: data.link,
            timestamp: data.timestamp ?? new Date().toISOString(),
            isRead: false,
            isLive: true,
          },
          ...prev,
        ].slice(0, 50),
      );
      // Refresh DB list so the persisted record shows up quickly
      setTimeout(() => {
        void refetchNotifs();
        void refetchUnread();
      }, 500);
    };
    onSocketEvent('notification:new', handler);
    return () => {
      offSocketEvent('notification:new', handler);
    };
  }, [refetchNotifs, refetchUnread]);

  // Walk-in specific notification listener
  useEffect(() => {
    const handler = (data: any) => {
      playNotificationSound();
      toast.success(`New walk-in: ${data.fullName} for ${data.jobTitle}`, { duration: 5000 });
      setLiveNotifs((prev) =>
        [
          {
            id: `walkin-${Date.now()}`,
            title: 'New Walk-In Candidate',
            message: `${data.fullName} registered for ${data.jobTitle}`,
            type: 'walk_in',
            link: '/walk-in-management',
            timestamp: data.timestamp ?? new Date().toISOString(),
            isRead: false,
            isLive: true,
          },
          ...prev,
        ].slice(0, 50),
      );
    };
    onSocketEvent('walk_in:new', handler);
    return () => {
      offSocketEvent('walk_in:new', handler);
    };
  }, []);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleMarkAllRead = async () => {
    // Optimistically clear live unread
    setLiveNotifs((prev) => prev.map((n) => ({ ...n, isRead: true })));
    await markAllRead();
  };

  const handleMarkRead = async (notif: LiveNotification) => {
    if (!notif.isLive) {
      await markRead(notif.id);
    } else {
      setLiveNotifs((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, isRead: true } : n)),
      );
    }
    if (notif.link) navigate(notif.link);
  };

  const clearAll = () => {
    setLiveNotifs([]);
    setIsOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 5, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 5, scale: 0.97 }}
            className="absolute right-0 top-12 w-80 bg-white rounded-xl border border-gray-200 shadow-lg z-50 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <h3 className="text-sm font-display font-bold text-gray-900">Notifications</h3>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="text-xs text-brand-600 hover:underline"
                  >
                    Mark all read
                  </button>
                )}
                {notifications.length > 0 && (
                  <button onClick={clearAll} className="text-xs text-gray-400 hover:text-gray-600">
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Notifications List */}
            <div className="max-h-80 overflow-y-auto custom-scrollbar">
              {notifications.length === 0 ? (
                <div className="py-8 text-center">
                  <Bell className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No notifications</p>
                </div>
              ) : (
                notifications.map((notif) => (
                  <div
                    key={notif.id}
                    className={`px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer
                      ${!notif.isRead ? 'bg-brand-50/30' : ''}`}
                    onClick={() => handleMarkRead(notif)}
                  >
                    <div className="flex items-start gap-2">
                      {!notif.isRead && (
                        <div className="w-2 h-2 rounded-full bg-brand-500 mt-1.5 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{notif.title}</p>
                        <p className="text-xs text-gray-500 line-clamp-2">{notif.message}</p>
                        <p className="text-[10px] text-gray-300 mt-1">
                          {new Date(notif.timestamp).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
