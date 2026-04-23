import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bell, X, Calendar, Clock, Headphones, User, Zap,
  FileText, Megaphone, UserPlus, CheckCheck, BellOff,
} from 'lucide-react';
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
  isLive: boolean;
}

// ─── Type → icon + color mapping ─────────────────────────────
const TYPE_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  LEAVE:                    { icon: Calendar,   color: 'text-indigo-600',  bg: 'bg-indigo-50' },
  LEAVE_SUBMITTED:          { icon: Calendar,   color: 'text-indigo-600',  bg: 'bg-indigo-50' },
  LEAVE_REVIEWED:           { icon: Calendar,   color: 'text-indigo-600',  bg: 'bg-indigo-50' },
  REGULARIZATION_SUBMITTED: { icon: Clock,      color: 'text-amber-600',   bg: 'bg-amber-50' },
  REGULARIZATION_REVIEWED:  { icon: Clock,      color: 'text-amber-600',   bg: 'bg-amber-50' },
  HELPDESK_TICKET_CREATED:  { icon: Headphones, color: 'text-blue-600',    bg: 'bg-blue-50' },
  HELPDESK_TICKET_UPDATED:  { icon: Headphones, color: 'text-blue-600',    bg: 'bg-blue-50' },
  HELPDESK_COMMENT:         { icon: Headphones, color: 'text-blue-600',    bg: 'bg-blue-50' },
  PROFILE_EDIT_REQUEST:     { icon: User,       color: 'text-violet-600',  bg: 'bg-violet-50' },
  PROFILE_EDIT_REVIEWED:    { icon: User,       color: 'text-violet-600',  bg: 'bg-violet-50' },
  OVERTIME_SUBMITTED:       { icon: Zap,        color: 'text-orange-600',  bg: 'bg-orange-50' },
  OVERTIME_REVIEWED:        { icon: Zap,        color: 'text-orange-600',  bg: 'bg-orange-50' },
  document:                 { icon: FileText,   color: 'text-emerald-600', bg: 'bg-emerald-50' },
  announcement:             { icon: Megaphone,  color: 'text-pink-600',    bg: 'bg-pink-50' },
  walk_in:                  { icon: UserPlus,   color: 'text-teal-600',    bg: 'bg-teal-50' },
};

const DEFAULT_TYPE = { icon: Bell, color: 'text-gray-500', bg: 'bg-gray-100' };

function getTypeConfig(type: string) {
  return TYPE_CONFIG[type] || TYPE_CONFIG[type?.toLowerCase()] || DEFAULT_TYPE;
}

// ─── Relative timestamp ───────────────────────────────────────
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ─── Sound ───────────────────────────────────────────────────
const playNotificationSound = () => {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    osc.type = 'sine';
    gain.gain.value = 0.25;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.stop(ctx.currentTime + 0.4);
  } catch {}
};

function dbNotifToLive(n: DbNotification): LiveNotification {
  const data = n.data as Record<string, unknown> | null | undefined;
  return {
    id: n.id,
    title: n.title,
    message: n.message,
    type: n.type,
    link: (data?.link as string) ?? undefined,
    timestamp: n.createdAt,
    isRead: n.isRead,
    isLive: false,
  };
}

// ─── Notification Item ────────────────────────────────────────
function NotifItem({ notif, onRead }: { notif: LiveNotification; onRead: (n: LiveNotification) => void }) {
  const cfg = getTypeConfig(notif.type);
  const Icon = cfg.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18 }}
      onClick={() => onRead(notif)}
      className={`relative flex items-start gap-3 px-4 py-3.5 cursor-pointer transition-colors hover:bg-gray-50/80
        ${!notif.isRead ? 'bg-blue-50/40' : 'bg-white'}`}
    >
      {/* Unread left border */}
      {!notif.isRead && (
        <div className="absolute left-0 top-3 bottom-3 w-0.5 bg-blue-500 rounded-full" />
      )}

      {/* Icon */}
      <div className={`shrink-0 w-8 h-8 rounded-full ${cfg.bg} flex items-center justify-center mt-0.5`}>
        <Icon size={14} className={cfg.color} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pr-2">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm font-medium leading-tight ${!notif.isRead ? 'text-gray-900' : 'text-gray-700'} line-clamp-1`}>
            {notif.title}
          </p>
          {!notif.isRead && (
            <div className="shrink-0 w-2 h-2 rounded-full bg-blue-500 mt-1" />
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2 leading-relaxed">{notif.message}</p>
        <p className="text-[10px] text-gray-400 mt-1.5 font-medium">{relativeTime(notif.timestamp)}</p>
      </div>
    </motion.div>
  );
}

// ─── Main Component ───────────────────────────────────────────
export default function NotificationBell() {
  const navigate = useNavigate();
  const [liveNotifs, setLiveNotifs] = useState<LiveNotification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  // Merge: live socket notifs + DB notifs (deduplicated)
  const dbIds = new Set((notifData?.data ?? []).map((n) => n.id));
  const pendingLive = liveNotifs.filter((n) => !dbIds.has(n.id));
  const dbMapped = (notifData?.data ?? []).map(dbNotifToLive);
  const notifications: LiveNotification[] = [...pendingLive, ...dbMapped];
  const unreadCount = (unreadData?.count ?? 0) + pendingLive.filter((n) => !n.isRead).length;

  // Generic notification:new listener
  useEffect(() => {
    const handler = (data: any) => {
      playNotificationSound();
      setLiveNotifs((prev) =>
        [
          {
            id: data.id ?? `live-${Date.now()}`,
            title: data.title,
            message: data.message,
            type: data.type ?? 'notification',
            link: data.link,
            timestamp: data.timestamp ?? new Date().toISOString(),
            isRead: false,
            isLive: true,
          },
          ...prev,
        ].slice(0, 50),
      );
      setTimeout(() => { void refetchNotifs(); void refetchUnread(); }, 600);
    };
    onSocketEvent('notification:new', handler);
    return () => offSocketEvent('notification:new', handler);
  }, [refetchNotifs, refetchUnread]);

  // Walk-in listener
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
    return () => offSocketEvent('walk_in:new', handler);
  }, []);

  // Close on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    setLiveNotifs((prev) => prev.map((n) => ({ ...n, isRead: true })));
    await markAllRead();
    void refetchUnread();
  }, [markAllRead, refetchUnread]);

  const handleNotifClick = useCallback(async (notif: LiveNotification) => {
    if (!notif.isLive) {
      void markRead(notif.id);
    } else {
      setLiveNotifs((prev) => prev.map((n) => (n.id === notif.id ? { ...n, isRead: true } : n)));
    }
    setIsOpen(false);
    if (notif.link) navigate(notif.link);
  }, [markRead, navigate]);

  const badgeCount = unreadCount > 99 ? '99+' : unreadCount > 0 ? String(unreadCount) : null;

  return (
    <div ref={ref} className="relative">
      {/* Bell button */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        className={`relative p-2 rounded-lg transition-colors ${isOpen ? 'bg-gray-100 text-gray-700' : 'text-gray-500 hover:bg-gray-100'}`}
        aria-label="Notifications"
      >
        <Bell size={20} />
        <AnimatePresence>
          {badgeCount && (
            <motion.span
              key="badge"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none"
            >
              {badgeCount}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      {/* Panel */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Mobile backdrop */}
            <motion.div
              key="notif-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="sm:hidden fixed inset-0 bg-black/30 z-[49]"
              onClick={() => setIsOpen(false)}
            />
          <motion.div
            key="notif-panel"
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="fixed inset-x-3 top-16 sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-96 bg-white rounded-2xl border border-gray-200 shadow-2xl z-50 overflow-hidden flex flex-col max-h-[calc(100dvh-4.5rem)] sm:max-h-[520px]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2">
                <Bell size={16} className="text-gray-700" />
                <h3 className="text-sm font-display font-bold text-gray-900">Notifications</h3>
                {unreadCount > 0 && (
                  <span className="text-[10px] font-bold text-white bg-red-500 rounded-full px-1.5 py-0.5 leading-none">
                    {unreadCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium transition-colors"
                  >
                    <CheckCheck size={12} />
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                  aria-label="Close notifications"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Notification list */}
            <div className="overflow-y-auto flex-1 custom-scrollbar divide-y divide-gray-50">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                    <BellOff size={24} className="text-gray-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-700 mb-1">You're all caught up!</p>
                  <p className="text-xs text-gray-400">No notifications yet. We'll let you know when something needs your attention.</p>
                </div>
              ) : (
                notifications.map((notif) => (
                  <NotifItem key={notif.id} notif={notif} onRead={handleNotifClick} />
                ))
              )}
            </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <div className="shrink-0 px-5 py-3 border-t border-gray-100 bg-gray-50/50">
                <p className="text-xs text-gray-400 text-center">
                  {notifications.length} notification{notifications.length !== 1 ? 's' : ''}
                  {unreadCount > 0 ? ` · ${unreadCount} unread` : ' · all read'}
                </p>
              </div>
            )}
          </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
