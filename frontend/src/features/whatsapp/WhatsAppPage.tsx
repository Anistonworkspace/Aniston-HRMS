import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Send, Phone, MessageCircle, Loader2, WifiOff, Plus, User,
  Check, CheckCheck, ArrowLeft, X, ExternalLink, FileText, Play,
  Image as ImageIcon, AlertCircle, RefreshCw, Paperclip, Download,
  Copy, ArrowDown, Clock, Trash2, UserPlus, Edit2, Mail, StickyNote, XCircle,
} from 'lucide-react';
import {
  useGetWhatsAppStatusQuery,
  useGetWhatsAppChatsQuery,
  useGetWhatsAppChatMessagesQuery,
  useGetWhatsAppContactsQuery,
  useSendWhatsAppMessageMutation,
  useSendWhatsAppToNumberMutation,
  useLazyResolveWhatsAppChatQuery,
  useMarkChatAsReadMutation,
  useDownloadWhatsAppMediaMutation,
  useSendWhatsAppMediaMutation,
  useLazySearchWhatsAppMessagesQuery,
  useGetWhatsAppDbContactsQuery,
  useCreateWhatsAppContactMutation,
  useUpdateWhatsAppContactMutation,
  useDeleteWhatsAppContactMutation,
} from './whatsappApi';
import type {
  WhatsAppChat, WhatsAppMessage, WhatsAppDbContact, WhatsAppContact,
} from './whatsappApi';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';
import { onSocketEvent, offSocketEvent } from '../../lib/socket';

// =====================================================================
// CONSTANTS
// =====================================================================

const POLLING = { STATUS: 15000, CHATS: 60000 } as const;

// =====================================================================
// MAIN PAGE
// =====================================================================

export default function WhatsAppPage() {
  const { data: statusRes, isLoading: statusLoading } = useGetWhatsAppStatusQuery(
    undefined,
    { pollingInterval: POLLING.STATUS }
  );
  const isConnected = statusRes?.data?.isConnected;
  const isInitializing = statusRes?.data?.isInitializing;
  const isSyncing = statusRes?.data?.isSyncing;
  const sessionPhone = statusRes?.data?.phoneNumber;
  const lastPing = statusRes?.data?.lastPing;

  const sessionStale = useMemo(() => {
    if (!lastPing || !isConnected) return false;
    return Date.now() - new Date(lastPing).getTime() > 6 * 60 * 60 * 1000;
  }, [lastPing, isConnected]);

  // G5: real-time disconnect detection — show a banner if WhatsApp disconnects mid-session
  const [disconnectedMid, setDisconnectedMid] = useState(false);
  useEffect(() => {
    const handler = () => setDisconnectedMid(true);
    onSocketEvent('whatsapp:disconnected', handler);
    return () => offSocketEvent('whatsapp:disconnected', handler);
  }, []);
  // L1: auto-dismiss disconnect banner when status poll confirms reconnection
  useEffect(() => {
    if (isConnected) setDisconnectedMid(false);
  }, [isConnected]);

  if (statusLoading) {
    return (
      <div className="page-container">
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 size={32} className="text-indigo-400 animate-spin mb-4" />
          <p className="text-sm text-gray-500">Checking WhatsApp status...</p>
        </div>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="page-container">
        <div className="flex flex-col items-center justify-center py-20">
          {isInitializing ? (
            <>
              <Loader2 size={48} className="text-indigo-400 animate-spin mb-4" />
              <h2 className="text-lg font-semibold text-gray-700 mb-2">Connecting WhatsApp...</h2>
              <p className="text-sm text-gray-500 mb-4">Establishing connection. This may take a few seconds.</p>
            </>
          ) : (
            <>
              <WifiOff size={48} className="text-gray-300 mb-4" />
              <h2 className="text-lg font-semibold text-gray-700 mb-2">WhatsApp Not Connected</h2>
              <p className="text-sm text-gray-500 mb-4">Go to Settings → WhatsApp to connect your WhatsApp account.</p>
              <Link to="/settings" className="btn-primary text-sm">Open Settings</Link>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {disconnectedMid && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border-b border-red-200 text-red-800 text-xs">
          <WifiOff size={12} className="flex-shrink-0" />
          <span>WhatsApp disconnected. Messages cannot be sent until reconnected.</span>
          <Link to="/settings" className="underline font-medium ml-1">Reconnect in Settings</Link>
          <button onClick={() => setDisconnectedMid(false)} className="ml-auto p-0.5 hover:bg-red-100 rounded" aria-label="Dismiss">
            <X size={12} />
          </button>
        </div>
      )}
      {sessionStale && !disconnectedMid && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs">
          <Clock size={12} className="flex-shrink-0" />
          <span>WhatsApp session may be unstable — last activity was over 6 hours ago.</span>
          <Link to="/settings" className="underline font-medium ml-1">Check Settings</Link>
        </div>
      )}
      {isSyncing && (
        <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border-b border-green-200 text-green-800 text-xs">
          <Loader2 size={12} className="animate-spin flex-shrink-0" />
          <span>Syncing WhatsApp chats... Conversations will appear once sync completes.</span>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <WhatsAppChatApp sessionPhone={sessionPhone} isSyncing={!!isSyncing} />
      </div>
    </div>
  );
}

// =====================================================================
// SKELETON LOADERS
// =====================================================================

function ChatListSkeleton() {
  return (
    <div className="animate-pulse space-y-0">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50">
          <div className="w-10 h-10 rounded-full bg-gray-200 flex-shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="h-3.5 bg-gray-200 rounded w-2/3" />
            <div className="h-3 bg-gray-100 rounded w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function MessagesSkeleton() {
  return (
    <div className="animate-pulse space-y-3 px-4 py-4">
      {[false, true, false, true, false].map((fromMe, i) => (
        <div key={i} className={cn('flex', fromMe ? 'justify-end' : 'justify-start')}>
          <div className={cn('rounded-xl px-3 py-2 space-y-2', fromMe ? 'bg-green-100 w-[55%]' : 'bg-gray-200 w-[60%]')}>
            <div className="h-3 rounded w-full bg-white/50" />
            <div className="h-3 rounded w-3/4 bg-white/50" />
          </div>
        </div>
      ))}
    </div>
  );
}

// =====================================================================
// HELPERS
// =====================================================================

function formatChatTime(timestamp: string) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (diffDays === 0) return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return date.toLocaleDateString('en-IN', { weekday: 'short' });
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function normalizePhone(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}

function phoneMatchesChatId(phone: string, chatId: string): boolean {
  if (!phone || !chatId) return false;
  const phoneDigits = normalizePhone(phone);
  if (chatId.includes('@c.us')) {
    const chatDigits = chatId.replace('@c.us', '');
    return chatDigits === phoneDigits ||
      chatDigits.endsWith(phoneDigits.slice(-10)) ||
      phoneDigits.endsWith(chatDigits.slice(-10));
  }
  return false;
}

function findChatForPhone(chats: WhatsAppChat[], phone: string): WhatsAppChat | null {
  if (!phone || !chats.length) return null;
  return chats.find(c => phoneMatchesChatId(phone, c.id)) || null;
}

/** Detect base64 binary blobs that whatsapp-web.js puts in msg.body for media messages */
function isBase64Blob(s: string): boolean {
  if (!s || s.length < 100) return false;
  return /^[A-Za-z0-9+/=\r\n]{100,}$/.test(s.trim());
}

function formatPhoneDisplay(digits: string): string {
  if (!digits) return '';
  const d = digits.replace(/\D/g, '');
  if (d.startsWith('91') && d.length === 12) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  if (d.startsWith('1') && d.length === 11) return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return `+${d}`;
}

const SOURCE_LABELS: Record<string, string> = {
  MANUAL: 'Added',
  WHATSAPP_IMPORT: 'WhatsApp',
  EMPLOYEE: 'Employee',
  ONBOARDING: 'Onboarding',
  APPLICATION: 'Applied',
};

const SOURCE_COLORS: Record<string, string> = {
  MANUAL: 'bg-gray-100 text-gray-600',
  WHATSAPP_IMPORT: 'bg-green-50 text-green-700',
  EMPLOYEE: 'bg-blue-50 text-blue-700',
  ONBOARDING: '__primary__',
  APPLICATION: 'bg-amber-50 text-amber-700',
};

// =====================================================================
// ADD CONTACT MODAL
// =====================================================================

function AddContactModal({
  onClose,
  onSaved,
}: { onClose: () => void; onSaved: (contact: WhatsAppDbContact) => void }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [createContact, { isLoading }] = useCreateWhatsAppContactMutation();

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!form.phone.trim()) {
      e.phone = 'Phone is required';
    } else {
      const digits = form.phone.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) e.phone = 'Enter a valid phone number with country code';
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email';
    return e;
  };

  const handleSave = async () => {
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    try {
      const result = await createContact({
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        notes: form.notes.trim() || undefined,
      }).unwrap();
      toast.success('Contact saved');
      onSaved(result.data);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to save contact');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-md"
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserPlus size={18} style={{ color: 'var(--primary-color)' }} />
            <h2 className="text-base font-semibold text-gray-800">Add Contact</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100" aria-label="Close">
            <X size={18} className="text-gray-500" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
            <input
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="John Doe"
              className={cn('input-glass w-full text-sm', errors.name && 'border-red-300')}
            />
            {errors.name && <p className="text-xs text-red-500 mt-0.5">{errors.name}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Phone * (with country code)</label>
            <div className="relative">
              <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={form.phone}
                onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                placeholder="+919876543210 or +14155551234"
                className={cn('input-glass w-full text-sm pl-9', errors.phone && 'border-red-300')}
              />
            </div>
            {errors.phone ? (
              <p className="text-xs text-red-500 mt-0.5">{errors.phone}</p>
            ) : (
              <p className="text-xs text-gray-400 mt-0.5">International format — include country code</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email (optional)</label>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                placeholder="john@example.com"
                type="email"
                className={cn('input-glass w-full text-sm pl-9', errors.email && 'border-red-300')}
              />
            </div>
            {errors.email && <p className="text-xs text-red-500 mt-0.5">{errors.email}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes (optional)</label>
            <div className="relative">
              <StickyNote size={14} className="absolute left-3 top-3 text-gray-400" />
              <textarea
                value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                placeholder="Any notes about this contact..."
                rows={2}
                className="input-glass w-full text-sm pl-9 resize-none"
                maxLength={500}
              />
            </div>
          </div>
          <p className="text-xs text-gray-400 bg-gray-50 rounded-lg p-3">
            <strong>Note:</strong> This contact is stored in HRMS only. Due to WhatsApp provider limitations
            (whatsapp-web.js browser automation), contacts cannot be added directly to your WhatsApp device address book.
          </p>
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button
            onClick={handleSave}
            disabled={isLoading}
            className="btn-primary text-sm flex items-center gap-2"
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
            Save Contact
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// =====================================================================
// EDIT CONTACT MODAL
// =====================================================================

function EditContactModal({
  contact,
  onClose,
  onSaved,
}: { contact: WhatsAppDbContact; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: contact.name,
    email: contact.email || '',
    notes: contact.notes || '',
  });
  const [updateContact, { isLoading }] = useUpdateWhatsAppContactMutation();

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    try {
      await updateContact({
        contactId: contact.id,
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        notes: form.notes.trim() || undefined,
      }).unwrap();
      toast.success('Contact updated');
      onSaved();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to update');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-md"
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Edit2 size={18} style={{ color: 'var(--primary-color)' }} />
            <h2 className="text-base font-semibold text-gray-800">Edit Contact</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100" aria-label="Close">
            <X size={18} className="text-gray-500" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
            <input
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              className="input-glass w-full text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
            <input
              value={contact.phone}
              disabled
              className="input-glass w-full text-sm opacity-60 cursor-not-allowed"
            />
            <p className="text-xs text-gray-400 mt-0.5">Phone cannot be changed after creation</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                type="email"
                className="input-glass w-full text-sm pl-9"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              rows={2}
              className="input-glass w-full text-sm resize-none"
              maxLength={500}
            />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button
            onClick={handleSave}
            disabled={isLoading}
            className="btn-primary text-sm flex items-center gap-2"
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Save Changes
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// =====================================================================
// MAIN CHAT APP
// =====================================================================

function WhatsAppChatApp({ sessionPhone, isSyncing }: { sessionPhone?: string | null; isSyncing?: boolean }) {
  const hasPrefill = typeof window !== 'undefined' && !!sessionStorage.getItem('whatsapp_prefill_message');
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewChat, setShowNewChat] = useState(hasPrefill);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [leftTab, setLeftTab] = useState<'chats' | 'contacts' | 'groups'>('chats');
  const [resolvingPhone, setResolvingPhone] = useState<string | null>(null);
  const [showAddContact, setShowAddContact] = useState(false);
  const [editingContact, setEditingContact] = useState<WhatsAppDbContact | null>(null);

  const {
    data: chatsRes,
    isLoading: loadingChats,
    isFetching: fetchingChats,
    refetch: refetchChats,
  } = useGetWhatsAppChatsQuery(undefined, { pollingInterval: POLLING.CHATS });

  // DB contacts (WhatsAppContact model) — application-layer contacts with full CRUD
  const {
    data: dbContactsRes,
    isLoading: loadingDbContacts,
    isFetching: fetchingDbContacts,
    refetch: refetchDbContacts,
  } = useGetWhatsAppDbContactsQuery(
    { page: 1, limit: 200, search: searchQuery || undefined },
    { skip: leftTab !== 'contacts' }
  );

  // Live WhatsApp session contacts (from phone address book)
  const {
    data: liveContactsRes,
    isLoading: loadingLiveContacts,
  } = useGetWhatsAppContactsQuery(undefined, { skip: leftTab !== 'contacts' });

  const [triggerResolve] = useLazyResolveWhatsAppChatQuery();
  const [markAsRead] = useMarkChatAsReadMutation();
  const [deleteContact] = useDeleteWhatsAppContactMutation();

  const chats: WhatsAppChat[] = chatsRes?.data || [];
  const dbContacts: WhatsAppDbContact[] = dbContactsRes?.data || [];
  const liveContacts: WhatsAppContact[] = liveContactsRes?.data || [];
  const groupChats: WhatsAppChat[] = chats.filter(c => c.isGroup);

  // Refetch chats when sync completes so list populates immediately after first connect
  useEffect(() => {
    const handleSyncComplete = () => refetchChats();
    onSocketEvent('whatsapp:sync:complete', handleSyncComplete);
    return () => offSocketEvent('whatsapp:sync:complete', handleSyncComplete);
  }, [refetchChats]);

  // Expose active chatId so API layer can suppress toast for active conversation
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('wa:active-chat', { detail: selectedChat }));
  }, [selectedChat]);

  const selectedChatData = chats.find((c: WhatsAppChat) => c.id === selectedChat);

  useEffect(() => { setShowContactInfo(false); }, [selectedChat]);

  // Mark chat as read when selected
  useEffect(() => {
    if (selectedChat) {
      markAsRead(selectedChat).catch(() => {});
    }
  }, [selectedChat, markAsRead]);

  // Open chat by chatId from DB contact's providerChatId or phone resolution
  const handleContactClick = useCallback(async (contact: WhatsAppDbContact) => {
    // 1. If we already have providerChatId, use directly
    if (contact.providerChatId) {
      setSelectedChat(contact.providerChatId);
      setShowNewChat(false);
      return;
    }

    // 2. Try live @c.us match on current chats
    const liveChat = findChatForPhone(chats, contact.normalizedPhone)
      || findChatForPhone(chats, contact.phone);
    if (liveChat) {
      setSelectedChat(liveChat.id);
      setShowNewChat(false);
      return;
    }

    // 3. Resolve via backend (handles LID multi-device IDs) — 8s timeout prevents infinite spinner
    setResolvingPhone(contact.normalizedPhone);
    const resolveTimeout = setTimeout(() => {
      setResolvingPhone(null);
      toast.error('Phone resolution timed out. Opening composer instead.', { duration: 3000 });
    }, 8000);
    try {
      const res = await triggerResolve(contact.normalizedPhone).unwrap();
      if (res.data?.chatId) {
        setSelectedChat(res.data.chatId);
        setShowNewChat(false);
        refetchDbContacts();
        return;
      }
    } catch { /* ignore */ } finally {
      clearTimeout(resolveTimeout);
      setResolvingPhone(null);
    }

    // 4. Fallback: open NewChatView pre-filled so HR can compose a first message
    sessionStorage.setItem('whatsapp_prefill_phone', contact.normalizedPhone || contact.phone.replace(/\D/g, ''));
    setShowNewChat(true);
    setSelectedChat(null);
    toast(`Opening composer for ${contact.name} (+${contact.normalizedPhone || contact.phone})`, {
      duration: 4000,
      icon: '💬',
    });
  }, [chats, triggerResolve, refetchDbContacts]);

  const handleDeleteContact = useCallback(async (contact: WhatsAppDbContact, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete contact "${contact.name}"?\n\nChat history will not be deleted.`)) return;
    try {
      await deleteContact(contact.id).unwrap();
      toast.success('Contact deleted');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to delete');
    }
  }, [deleteContact]);

  const handleEditContact = useCallback((contact: WhatsAppDbContact, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingContact(contact);
  }, []);

  const filteredChats = useMemo(() => {
    const individualChats = chats.filter(c => !c.isGroup);
    if (!searchQuery) return individualChats;
    return individualChats.filter((c: WhatsAppChat) =>
      c.name?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [chats, searchQuery]);

  const filteredGroups = useMemo(() => {
    if (!searchQuery) return groupChats;
    return groupChats.filter((c: WhatsAppChat) =>
      c.name?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [groupChats, searchQuery]);

  // Live contacts filtered by search, excluding those already in DB contacts
  const filteredLiveContacts = useMemo(() => {
    // Build a set of last-10 digits from DB contacts to handle 91-prefix vs no-prefix mismatch
    const dbLast10 = new Set(dbContacts.map(c => c.normalizedPhone.slice(-10)));
    const filtered = liveContacts.filter(c => {
      const digits = c.number?.replace(/\D/g, '') || '';
      if (dbLast10.has(digits.slice(-10))) return false; // already in DB, skip duplicate
      if (searchQuery) {
        return c.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.number?.includes(searchQuery);
      }
      return true;
    });
    return filtered;
  }, [liveContacts, dbContacts, searchQuery]);

  // DB contacts are already filtered server-side via the search param
  const filteredDbContacts = dbContacts;

  const totalUnread = useMemo(() =>
    chats.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
    [chats]
  );

  const hasActiveView = selectedChat || showNewChat;

  return (
    <div className="h-[calc(100vh-80px)] flex rounded-2xl overflow-hidden border border-gray-200 bg-white shadow-sm relative">
      {/* ===== Left: Chat List ===== */}
      <div className={cn(
        'w-full lg:w-80 border-r border-gray-200 flex flex-col flex-shrink-0',
        hasActiveView && 'hidden lg:flex'
      )}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex bg-gray-100 rounded-lg p-0.5 flex-1">
              {(['chats', 'contacts', 'groups'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => { setLeftTab(tab); setSearchQuery(''); }}
                  className={cn(
                    'flex-1 text-[11px] font-medium py-1.5 rounded-md transition-all',
                    leftTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  )}
                  aria-label={`${tab} tab`}
                >
                  {tab === 'chats'
                    ? `Chats${chats.filter(c => !c.isGroup).length > 0 ? ` (${chats.filter(c => !c.isGroup).length})` : ''}`
                    : tab === 'contacts'
                    ? `Contacts`
                    : `Groups${groupChats.length > 0 ? ` (${groupChats.length})` : ''}`}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {totalUnread > 0 && leftTab === 'chats' && (
                <span className="w-5 h-5 rounded-full bg-green-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {totalUnread > 99 ? '99+' : totalUnread}
                </span>
              )}
              {leftTab === 'contacts' ? (
                <button
                  onClick={() => setShowAddContact(true)}
                  className="w-8 h-8 rounded-lg transition-colors flex items-center justify-center" style={{ background: 'var(--primary-color)' }}
                  aria-label="Add contact" title="Add Contact"
                >
                  <UserPlus size={15} className="text-white" />
                </button>
              ) : leftTab === 'groups' ? null : (
                <button
                  onClick={() => { setShowNewChat(true); setSelectedChat(null); }}
                  className="w-8 h-8 rounded-lg transition-colors flex items-center justify-center" style={{ background: 'var(--primary-color)' }}
                  aria-label="New chat" title="New Chat"
                >
                  <Plus size={16} className="text-white" />
                </button>
              )}
            </div>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={leftTab === 'chats' ? 'Search chats...' : leftTab === 'contacts' ? 'Search contacts...' : 'Search groups...'}
              className="w-full text-xs bg-white border border-gray-200 rounded-lg pl-8 pr-3 py-2 focus:outline-none"
              aria-label="Search"
            />
          </div>
        </div>

        {/* Chat / Contact / Group list */}
        <div className="flex-1 overflow-y-auto" role="list" aria-label={`${leftTab} list`}>
          {leftTab === 'chats' ? (
            /* ── Chats tab: individual 1-to-1 conversations ── */
            loadingChats ? <ChatListSkeleton /> :
            filteredChats.length === 0 ? (
              <EmptyState
                icon={isSyncing
                  ? <Loader2 size={32} className="text-green-400 animate-spin" />
                  : <MessageCircle size={32} className="text-gray-200" />}
                text={searchQuery ? 'No matching chats' : isSyncing ? 'Syncing chats...' : 'No chats yet'}
                subtext={!searchQuery
                  ? isSyncing
                    ? 'WhatsApp is loading your conversations. This can take 10–30 seconds on first connect.'
                    : 'All WhatsApp 1-to-1 conversations appear here. Groups are in the Groups tab.'
                  : undefined}
                action={!searchQuery && !isSyncing ? (
                  <button onClick={() => refetchChats()} className="text-xs font-medium mt-2 flex items-center gap-1 mx-auto" style={{ color: 'var(--primary-color)' }}>
                    <RefreshCw size={12} /> Refresh
                  </button>
                ) : undefined}
              />
            ) : (
              <>
                {fetchingChats && !loadingChats && <LoadingBanner text="Refreshing chats..." />}
                {filteredChats.map((chat: WhatsAppChat) => (
                  <ChatListItem
                    key={chat.id}
                    chat={chat}
                    isSelected={selectedChat === chat.id}
                    onClick={() => { setSelectedChat(chat.id); setShowNewChat(false); }}
                  />
                ))}
              </>
            )
          ) : leftTab === 'groups' ? (
            /* ── Groups tab: WhatsApp group conversations ── */
            loadingChats ? <ChatListSkeleton /> :
            filteredGroups.length === 0 ? (
              <EmptyState
                icon={<MessageCircle size={32} className="text-gray-200" />}
                text={searchQuery ? 'No matching groups' : 'No groups yet'}
                subtext={!searchQuery ? 'WhatsApp group chats will appear here automatically' : undefined}
              />
            ) : (
              <>
                {filteredGroups.map((chat: WhatsAppChat) => (
                  <ChatListItem
                    key={chat.id}
                    chat={chat}
                    isSelected={selectedChat === chat.id}
                    onClick={() => { setSelectedChat(chat.id); setShowNewChat(false); }}
                  />
                ))}
              </>
            )
          ) : (
            /* ── Contacts tab: DB contacts + live WhatsApp session contacts ── */
            (loadingDbContacts || loadingLiveContacts) ? <ChatListSkeleton /> : (
              <>
                {/* DB Contacts (manually managed) */}
                {filteredDbContacts.length > 0 && (
                  <>
                    <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-100">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Saved Contacts ({filteredDbContacts.length})</p>
                    </div>
                    {fetchingDbContacts && !loadingDbContacts && <LoadingBanner text="Refreshing contacts..." />}
                    {filteredDbContacts.map((contact: WhatsAppDbContact) => (
                      <DbContactListItem
                        key={contact.id}
                        contact={contact}
                        isSelected={selectedChat === contact.providerChatId}
                        isResolving={resolvingPhone === contact.normalizedPhone}
                        onClick={() => handleContactClick(contact)}
                        onDelete={e => handleDeleteContact(contact, e)}
                        onEdit={e => handleEditContact(contact, e)}
                      />
                    ))}
                  </>
                )}

                {/* Live WhatsApp session contacts (from phone address book) */}
                {filteredLiveContacts.length > 0 && (
                  <>
                    <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-100">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">WhatsApp Contacts ({filteredLiveContacts.length})</p>
                    </div>
                    {filteredLiveContacts.map((contact: WhatsAppContact) => (
                      <LiveContactListItem
                        key={contact.id}
                        contact={contact}
                        isSelected={false}
                        onClick={() => {
                          const phone = contact.number?.replace(/\D/g, '') || contact.id.replace('@c.us', '');
                          const liveChat = findChatForPhone(chats, phone);
                          if (liveChat) {
                            setSelectedChat(liveChat.id);
                            setShowNewChat(false);
                          } else {
                            sessionStorage.setItem('whatsapp_prefill_phone', phone);
                            setShowNewChat(true);
                            setSelectedChat(null);
                          }
                        }}
                      />
                    ))}
                  </>
                )}

                {/* Empty state: no contacts at all */}
                {filteredDbContacts.length === 0 && filteredLiveContacts.length === 0 && (
                  <EmptyState
                    icon={<User size={32} className="text-gray-200" />}
                    text={searchQuery ? 'No matching contacts' : 'No contacts yet'}
                    subtext={!searchQuery ? 'Add contacts manually or they will appear here from your WhatsApp session' : undefined}
                    action={!searchQuery ? (
                      <button
                        onClick={() => setShowAddContact(true)}
                        className="text-xs font-medium mt-2 flex items-center gap-1 mx-auto" style={{ color: 'var(--primary-color)' }}
                      >
                        <UserPlus size={12} /> Add Contact
                      </button>
                    ) : undefined}
                  />
                )}
              </>
            )
          )}
        </div>
      </div>

      {/* ===== Center: Chat View ===== */}
      <div className={cn('flex-1 flex flex-col min-w-0', !hasActiveView && 'hidden lg:flex')}>
        {showNewChat ? (
          <NewChatView
            onSent={(chatId) => {
              setSelectedChat(chatId);
              setShowNewChat(false);
              refetchChats();
            }}
            onBack={() => setShowNewChat(false)}
          />
        ) : selectedChat ? (
          <ChatView
            chatId={selectedChat}
            chatName={selectedChatData?.name || (selectedChat.includes('@g.us') ? 'Group Chat' : selectedChat.replace('@c.us', '').replace('@lid', ''))}
            onBack={() => setSelectedChat(null)}
            onToggleContactInfo={() => setShowContactInfo(prev => !prev)}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-50/30">
            <div className="text-center">
              <MessageCircle size={48} className="mx-auto text-gray-200 mb-4" />
              <h3 className="text-lg font-medium text-gray-500">Select a chat</h3>
              <p className="text-sm text-gray-400">Choose a conversation from the left or start a new one</p>
            </div>
          </div>
        )}
      </div>

      {/* ===== Right: Contact Info Panel ===== */}
      <AnimatePresence>
        {showContactInfo && selectedChat && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="lg:hidden fixed inset-0 bg-black/30 z-40"
              onClick={() => setShowContactInfo(false)}
            />
            <motion.div
              initial={{ x: 300, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 300, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className={cn(
                'w-[300px] border-l border-gray-200 flex flex-col bg-white flex-shrink-0',
                'lg:relative',
                'max-lg:fixed max-lg:right-0 max-lg:top-0 max-lg:h-full max-lg:z-50 max-lg:shadow-xl'
              )}
            >
              <ContactInfoPanel
                chatId={selectedChat}
                chatName={selectedChatData?.name || 'Contact'}
                dbContacts={dbContacts}
                onClose={() => setShowContactInfo(false)}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Add Contact Modal */}
      <AnimatePresence>
        {showAddContact && (
          <AddContactModal
            onClose={() => setShowAddContact(false)}
            onSaved={() => {
              setShowAddContact(false);
              refetchDbContacts();
            }}
          />
        )}
      </AnimatePresence>

      {/* Edit Contact Modal */}
      <AnimatePresence>
        {editingContact && (
          <EditContactModal
            contact={editingContact}
            onClose={() => setEditingContact(null)}
            onSaved={() => {
              setEditingContact(null);
              refetchDbContacts();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// =====================================================================
// LIST ITEM COMPONENTS (memoized)
// =====================================================================

const ChatListItem = memo(function ChatListItem({
  chat, isSelected, onClick,
}: { chat: WhatsAppChat; isSelected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      role="listitem"
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-50'
      )}
      style={isSelected ? { background: 'var(--primary-highlighted-color)' } : {}}
    >
      <div className={cn('w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0', chat.isGroup ? 'bg-indigo-100' : 'bg-green-100')}>
        {chat.profilePicUrl ? (
          <img src={chat.profilePicUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
        ) : chat.isGroup ? (
          <MessageCircle size={18} className="text-indigo-700" />
        ) : (
          <User size={18} className="text-green-700" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <p className={cn('text-sm truncate', chat.unreadCount > 0 ? 'font-semibold text-gray-900' : 'font-medium text-gray-800')}>
            {chat.name}
          </p>
          {chat.timestamp && (
            <span className={cn('text-[10px] flex-shrink-0', chat.unreadCount > 0 ? 'text-green-600 font-medium' : 'text-gray-400')}>
              {formatChatTime(chat.timestamp)}
            </span>
          )}
        </div>
        <p className={cn('text-xs truncate', chat.unreadCount > 0 ? 'text-gray-700 font-medium' : 'text-gray-500')}>
          {chat.lastMessage || 'No messages'}
        </p>
      </div>
      {chat.unreadCount > 0 && (
        <span className="w-5 h-5 rounded-full bg-green-500 text-white text-[10px] flex items-center justify-center flex-shrink-0 font-bold">
          {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
        </span>
      )}
    </button>
  );
});

/** DB Contact list item — shows source badge, has-chat indicator, edit/delete actions */
const DbContactListItem = memo(function DbContactListItem({
  contact, isSelected, isResolving, onClick, onDelete, onEdit,
}: {
  contact: WhatsAppDbContact;
  isSelected: boolean;
  isResolving: boolean;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onEdit: (e: React.MouseEvent) => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const initials = contact.name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
  const sourceLabel = SOURCE_LABELS[contact.source] || contact.source;
  const sourceColorRaw = SOURCE_COLORS[contact.source] || 'bg-gray-100 text-gray-600';
  const sourceColor = sourceColorRaw === '__primary__' ? '' : sourceColorRaw;
  const sourceColorStyle = sourceColorRaw === '__primary__' ? { background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' } : {};

  return (
    <div
      role="listitem"
      className={cn(
        'group relative flex items-center gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer',
        isResolving && 'opacity-60'
      )}
      style={isSelected ? { background: 'var(--primary-highlighted-color)' } : {}}
      onClick={onClick}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className={cn(
        'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 relative',
        contact.hasChat ? 'bg-green-100' : 'bg-blue-100'
      )}>
        {isResolving ? (
          <Loader2 size={14} className="animate-spin" style={{ color: 'var(--primary-color)' }} />
        ) : (
          <span className={cn('text-sm font-bold', contact.hasChat ? 'text-green-700' : 'text-blue-700')}>
            {initials}
          </span>
        )}
        {contact.hasChat && !isResolving && (
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-white" title="Has active chat" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 justify-between">
          <p className="text-sm font-medium text-gray-800 truncate">{contact.name}</p>
          {contact.lastMessageAt && (
            <span className="text-[10px] text-gray-400 flex-shrink-0">
              {formatChatTime(contact.lastMessageAt)}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400">{contact.phone}</p>
        {contact.email && (
          <p className="text-xs text-gray-300 truncate">{contact.email}</p>
        )}
      </div>

      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        {showActions ? (
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <button
              onClick={onEdit}
              className="p-1.5 rounded-lg transition-colors"
              aria-label="Edit contact"
              title="Edit"
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--primary-highlighted-color)')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <Edit2 size={13} style={{ color: 'var(--primary-color)' }} />
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
              aria-label="Delete contact"
              title="Delete"
            >
              <Trash2 size={13} className="text-red-400" />
            </button>
          </div>
        ) : (
          <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full', sourceColor)} style={sourceColorStyle}>
            {sourceLabel}
          </span>
        )}
        {contact.unreadCount > 0 && (
          <span className="w-4 h-4 rounded-full bg-green-500 text-white text-[9px] flex items-center justify-center font-bold">
            {contact.unreadCount}
          </span>
        )}
      </div>
    </div>
  );
});

/** Live WhatsApp session contact (from phone address book — read-only, no CRUD) */
const LiveContactListItem = memo(function LiveContactListItem({
  contact, isSelected, onClick,
}: {
  contact: WhatsAppContact;
  isSelected: boolean;
  onClick: () => void;
}) {
  const displayName = contact.name || contact.pushname || contact.number || contact.id.replace('@c.us', '');
  const initials = displayName.split(' ').map((w: string) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';

  return (
    <button
      role="listitem"
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-50'
      )}
      style={isSelected ? { background: 'var(--primary-highlighted-color)' } : {}}
      onClick={onClick}
    >
      <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
        <span className="text-sm font-bold text-green-700">{initials}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{displayName}</p>
        {contact.pushname && contact.name && contact.pushname !== contact.name && (
          <p className="text-xs text-gray-400 truncate">{contact.pushname}</p>
        )}
        <p className="text-xs text-gray-400">{contact.number ? `+${contact.number}` : ''}</p>
      </div>
      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 flex-shrink-0">WA</span>
    </button>
  );
});

// =====================================================================
// SMALL UI COMPONENTS
// =====================================================================

function EmptyState({
  icon, text, subtext, action,
}: { icon: React.ReactNode; text: string; subtext?: string; action?: React.ReactNode }) {
  return (
    <div className="text-center py-12 px-4">
      <div className="mx-auto mb-2">{icon}</div>
      <p className="text-gray-400 text-sm">{text}</p>
      {subtext && <p className="text-gray-300 text-xs mt-1">{subtext}</p>}
      {action}
    </div>
  );
}

function LoadingBanner({ text }: { text: string }) {
  return (
    <div className="px-4 py-1.5 text-[10px] font-medium flex items-center gap-1.5" style={{ background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' }}>
      <Loader2 size={10} className="animate-spin" /> {text}
    </div>
  );
}

// =====================================================================
// CONTACT INFO PANEL
// =====================================================================

function ContactInfoPanel({
  chatId, chatName, dbContacts, onClose,
}: {
  chatId: string;
  chatName: string;
  dbContacts: WhatsAppDbContact[];
  onClose: () => void;
}) {
  const isGroup = chatId.includes('@g.us');
  const phoneNumber = isGroup ? '' : chatId.replace('@c.us', '').replace('@lid', '').replace(/@\S+/, '');
  const initials = chatName.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';

  // Find matching DB contact if available
  const matchedContact = dbContacts.find(c =>
    c.normalizedPhone === phoneNumber ||
    c.normalizedPhone.endsWith(phoneNumber.slice(-10)) ||
    phoneNumber.endsWith(c.normalizedPhone.slice(-10))
  );

  const handleCopyPhone = () => {
    navigator.clipboard.writeText(formatPhoneDisplay(phoneNumber)).then(() => toast.success('Phone copied'));
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50/50">
        <h3 className="text-sm font-semibold text-gray-800">Contact Info</h3>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-200 transition-colors" aria-label="Close">
          <X size={18} className="text-gray-500" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center py-8 border-b border-gray-100">
          <div className={cn('w-24 h-24 rounded-full flex items-center justify-center mb-4', isGroup ? 'bg-indigo-100' : 'bg-green-100')}>
            {isGroup
              ? <MessageCircle size={36} className="text-indigo-700" />
              : <span className="text-2xl font-bold text-green-700">{initials}</span>}
          </div>
          <h4 className="text-base font-semibold text-gray-800">{chatName}</h4>
          {isGroup && (
            <span className="text-[10px] px-2 py-0.5 rounded-full mt-1 bg-indigo-50 text-indigo-700">Group</span>
          )}
          {!isGroup && matchedContact && (
            <span
              className={cn('text-[10px] px-2 py-0.5 rounded-full mt-1', (SOURCE_COLORS[matchedContact.source] || 'bg-gray-100 text-gray-600') === '__primary__' ? '' : (SOURCE_COLORS[matchedContact.source] || 'bg-gray-100 text-gray-600'))}
              style={SOURCE_COLORS[matchedContact.source] === '__primary__' ? { background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' } : {}}
            >
              {SOURCE_LABELS[matchedContact.source] || matchedContact.source}
            </span>
          )}
        </div>
        {phoneNumber && (
          <div className="px-4 py-4 border-b border-gray-100">
            <p className="text-xs text-gray-400 mb-1">Phone number</p>
            <div className="flex items-center gap-2">
              <Phone size={14} className="text-gray-400" />
              <span className="text-sm text-gray-700 font-mono flex-1">{formatPhoneDisplay(phoneNumber)}</span>
              <button
                onClick={handleCopyPhone}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                aria-label="Copy phone"
                title="Copy"
              >
                <Copy size={14} className="text-gray-400" />
              </button>
            </div>
          </div>
        )}
        {matchedContact?.email && (
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-xs text-gray-400 mb-1">Email</p>
            <div className="flex items-center gap-2">
              <Mail size={14} className="text-gray-400" />
              <span className="text-sm text-gray-700 flex-1">{matchedContact.email}</span>
            </div>
          </div>
        )}
        {matchedContact?.notes && (
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-xs text-gray-400 mb-1">Notes</p>
            <p className="text-sm text-gray-600">{matchedContact.notes}</p>
          </div>
        )}
        <div className="px-4 py-4">
          <a
            href={`/employees?search=${encodeURIComponent(phoneNumber)}`}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg transition-colors text-sm font-medium w-full justify-center" style={{ background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--primary-highlighted-color)')} onMouseLeave={e => (e.currentTarget.style.background = 'var(--primary-highlighted-color)')}
          >
            <ExternalLink size={14} /> View Employee Profile
          </a>
          <p className="text-[10px] text-gray-400 mt-2 text-center">
            Searches employees matching this phone number
          </p>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// CHAT VIEW
// =====================================================================

function ChatView({
  chatId, chatName, onBack, onToggleContactInfo,
}: { chatId: string; chatName: string; onBack?: () => void; onToggleContactInfo?: () => void }) {
  const isGroup = chatId.includes('@g.us');
  const { data: messagesRes, isLoading, isFetching, isError, error, refetch } =
    useGetWhatsAppChatMessagesQuery({ chatId, limit: 50 }, { pollingInterval: 15000 });
  const [sendMessage] = useSendWhatsAppMessageMutation();
  const [downloadMedia] = useDownloadWhatsAppMediaMutation();
  const [sendMedia] = useSendWhatsAppMediaMutation();
  const [triggerSearch, searchResult] = useLazySearchWhatsAppMessagesQuery();

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [chatSearch, setChatSearch] = useState('');
  const [showScrollDown, setShowScrollDown] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevMessageCount = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fetchTimedOut, setFetchTimedOut] = useState(false);

  const messages: WhatsAppMessage[] = messagesRes?.data || [];

  // D4: show timeout banner if the fetch is still in-flight after 50s
  useEffect(() => {
    if (!isFetching) { setFetchTimedOut(false); return; }
    const t = setTimeout(() => setFetchTimedOut(true), 50000);
    return () => clearTimeout(t);
  }, [isFetching]);

  // Auto-retry up to 2 times when messages return empty — handles WhatsApp session warm-up delay
  useEffect(() => {
    if (!isLoading && !isFetching && !isError && messages.length === 0 && retryCountRef.current < 2) {
      retryTimerRef.current = setTimeout(() => {
        retryCountRef.current += 1;
        refetch();
      }, 3000);
    }
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [messages.length, isLoading, isFetching, isError, refetch]);

  useEffect(() => {
    if (messages.length > prevMessageCount.current && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({
        behavior: prevMessageCount.current === 0 ? ('instant' as ScrollBehavior) : 'smooth',
      });
    }
    prevMessageCount.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    prevMessageCount.current = 0;
    retryCountRef.current = 0;
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    setInput('');
    setShowSearch(false);
    setChatSearch('');
    setShowScrollDown(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [chatId]);

  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    setShowScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 200);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      const phone = chatId.split('@')[0];
      await sendMessage({ to: phone, message: input.trim() }).unwrap();
      toast.success('Message sent');
      setInput('');
      inputRef.current?.focus();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to send message');
    }
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File too large (max 10MB)');
      return;
    }
    const formData = new FormData();
    formData.append('file', file);
    formData.append('chatId', chatId);
    try {
      await sendMedia(formData).unwrap();
      toast.success('Media sent');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to send media');
    }
    e.target.value = '';
  };

  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());

  const handleMediaDownload = async (msg: WhatsAppMessage) => {
    setDownloadingIds(prev => new Set(prev).add(msg.id));
    try {
      const result = await downloadMedia({ messageId: msg.id, chatId }).unwrap();
      if (result?.data?.mediaUrl) {
        // Trigger browser save-to-device
        const a = document.createElement('a');
        a.href = result.data.mediaUrl;
        a.download = result.data.mediaFilename || 'whatsapp-media';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        refetch();
        toast.success('Media downloaded');
      }
    } catch (err: any) {
      const reason = err?.data?.error?.message || err?.message || 'Failed to download media';
      toast.error(reason);
    } finally {
      setDownloadingIds(prev => { const s = new Set(prev); s.delete(msg.id); return s; });
    }
  };

  const handleSearch = useCallback(() => {
    if (chatSearch.trim().length >= 2) {
      triggerSearch({ chatId, query: chatSearch.trim() });
    }
  }, [chatId, chatSearch, triggerSearch]);

  const renderTick = (ack?: number, errorReason?: string | null) => {
    if (ack === undefined || ack === null) return null;
    if (ack === -1) return <XCircle size={14} className="text-red-400" aria-label={errorReason ? `Failed: ${errorReason}` : 'Message failed to send'} />;
    if (ack >= 3) return <CheckCheck size={14} className="text-blue-500" />;
    if (ack >= 2) return <CheckCheck size={14} className="text-gray-400" />;
    if (ack >= 1) return <Check size={14} className="text-gray-400" />;
    return null;
  };

  return (
    <>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3 bg-gray-50/50">
        {onBack && (
          <button
            onClick={onBack}
            className="lg:hidden p-1 rounded-lg hover:bg-gray-200 transition-colors"
            aria-label="Back"
          >
            <ArrowLeft size={18} className="text-gray-600" />
          </button>
        )}
        <button
          onClick={onToggleContactInfo}
          className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80 transition-opacity cursor-pointer"
        >
          <div className={cn('w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0', isGroup ? 'bg-indigo-100' : 'bg-green-100')}>
            {isGroup
              ? <MessageCircle size={16} className="text-indigo-700" />
              : <User size={16} className="text-green-700" />}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sm font-semibold text-gray-800 truncate">{chatName}</p>
            <p className="text-xs text-gray-400 truncate">
              {isGroup ? 'Group · WhatsApp' : `+${chatId.split('@')[0]}`}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setShowSearch(s => !s)}
            className={cn('p-2 rounded-lg hover:bg-gray-200 transition-colors')}
            style={showSearch ? { background: 'var(--primary-highlighted-color)' } : {}}
            aria-label="Search messages"
            title="Search messages"
          >
            <Search size={16} className={showSearch ? '' : 'text-gray-500'} style={showSearch ? { color: 'var(--primary-color)' } : {}} />
          </button>
          <button
            onClick={() => refetch()}
            className="p-2 rounded-lg hover:bg-gray-200 transition-colors"
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw size={16} className={cn('text-gray-500', isFetching && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Search bar */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-gray-200 bg-gray-50"
          >
            <div className="px-4 py-2 flex items-center gap-2">
              <Search size={14} className="text-gray-400 flex-shrink-0" />
              <input
                value={chatSearch}
                onChange={e => setChatSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Search in conversation..."
                className="flex-1 text-xs bg-transparent focus:outline-none"
                autoFocus
              />
              <button
                onClick={handleSearch}
                disabled={chatSearch.trim().length < 2}
                className="text-xs font-medium disabled:opacity-40"
                style={{ color: 'var(--primary-color)' }}
              >
                Search
              </button>
              <button
                onClick={() => { setShowSearch(false); setChatSearch(''); }}
                className="p-1 rounded hover:bg-gray-200"
              >
                <X size={14} className="text-gray-400" />
              </button>
            </div>
            {searchResult.data?.data && searchResult.data.data.length > 0 && (
              <div className="px-4 pb-2 max-h-32 overflow-y-auto">
                <p className="text-[10px] text-gray-400 mb-1">{searchResult.data.data.length} results</p>
                {searchResult.data.data.slice(0, 10).map((r: WhatsAppMessage) => (
                  <div key={r.id} className="text-xs text-gray-600 py-1 border-t border-gray-100 truncate">
                    <span className="text-[10px] text-gray-400 mr-2">
                      {r.timestamp ? new Date(r.timestamp).toLocaleDateString('en-IN') : ''}
                    </span>
                    {r.body}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-2 bg-[#efeae2] relative"
      >
        {fetchTimedOut && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg mx-2 mt-2 text-amber-800 text-xs">
            <AlertCircle size={12} className="flex-shrink-0" />
            <span>Message fetch is taking longer than usual.</span>
            <button onClick={() => { setFetchTimedOut(false); refetch(); }} className="ml-auto font-medium underline">Refresh</button>
          </div>
        )}
        {isLoading ? (
          <MessagesSkeleton />
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle size={32} className="text-red-300 mb-3" />
            <p className="text-sm text-red-500 font-medium mb-1">Failed to load messages</p>
            <p className="text-xs text-gray-400 mb-3 max-w-xs">
              {(() => {
                const msg: string = (error as any)?.data?.error?.message || '';
                // Don't expose raw internal stack traces
                if (!msg || msg.includes('Cannot read properties') || msg.includes('waitForChat')) {
                  return 'Chat is temporarily unavailable. The WhatsApp session may still be loading.';
                }
                return msg || 'WhatsApp may be disconnected or the chat is unavailable';
              })()}
            </p>
            <button
              onClick={() => refetch()}
              className="text-xs font-medium flex items-center gap-1"
              style={{ color: 'var(--primary-color)' }}
            >
              <RefreshCw size={12} /> Try again
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            {isFetching ? (
              <>
                <Loader2 size={28} className="text-green-400 animate-spin mb-3" />
                <p className="text-sm text-gray-400">Loading messages...</p>
              </>
            ) : (
              <>
                <MessageCircle size={32} className="text-gray-200 mb-3" />
                <p className="text-sm text-gray-400 font-medium">No messages loaded</p>
                <p className="text-xs text-gray-300 mt-1 max-w-xs">
                  This chat may have messages on your phone that haven't synced to this session yet.
                  Try refreshing or send a message to start.
                </p>
                <button
                  onClick={() => refetch()}
                  className="mt-3 text-xs font-medium flex items-center gap-1" style={{ color: 'var(--primary-color)' }}
                >
                  <RefreshCw size={12} /> Try loading again
                </button>
              </>
            )}
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              renderTick={renderTick}
              onDownloadMedia={handleMediaDownload}
              isDownloading={downloadingIds.has(msg.id)}
            />
          ))
        )}
        <div ref={messagesEndRef} />

        <AnimatePresence>
          {showScrollDown && (
            <motion.button
              initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
              onClick={scrollToBottom}
              className="sticky bottom-4 left-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-white shadow-lg flex items-center justify-center hover:bg-gray-50 z-10 border border-gray-200"
              aria-label="Scroll to bottom"
            >
              <ArrowDown size={18} className="text-gray-600" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Message input */}
      <div className="px-4 py-3 border-t border-gray-200 flex items-center gap-2 bg-gray-50/50">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          className="hidden"
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-2 rounded-full hover:bg-gray-200 transition-colors flex-shrink-0"
          aria-label="Attach file"
          title="Attach file"
        >
          <Paperclip size={18} className="text-gray-500" />
        </button>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          className="flex-1 text-sm bg-white border border-gray-200 rounded-full px-4 py-2.5 focus:outline-none focus:ring-1 focus:ring-green-300"
          aria-label="Message input"
          maxLength={4096}
        />
        <button
          onClick={handleSend}
          disabled={sending || !input.trim()}
          className="w-10 h-10 rounded-full bg-green-500 text-white flex items-center justify-center hover:bg-green-600 transition-colors disabled:opacity-50 flex-shrink-0"
          aria-label="Send message"
        >
          {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </div>
    </>
  );
}

// =====================================================================
// MESSAGE BUBBLE (memoized)
// =====================================================================

const MessageBubble = memo(function MessageBubble({
  msg, renderTick, onDownloadMedia, isDownloading,
}: {
  msg: WhatsAppMessage;
  renderTick: (ack?: number, error?: string | null) => React.ReactNode;
  onDownloadMedia: (msg: WhatsAppMessage) => void;
  isDownloading?: boolean;
}) {
  // Guard: if message data is corrupted, render a minimal fallback rather than crashing the chat view
  if (!msg || typeof msg.fromMe !== 'boolean') {
    return (
      <div className="flex justify-start mb-1 px-2">
        <div className="text-[10px] text-gray-400 italic px-2 py-1 bg-gray-50 rounded">[Message unavailable]</div>
      </div>
    );
  }

  const renderMedia = () => {
    if (!msg.hasMedia) return null;

    // Shared: pending-download button shown while server fetches from WhatsApp
    const fetchBtn = (icon: React.ReactNode, label: string) => (
      <button
        onClick={() => onDownloadMedia(msg)}
        disabled={isDownloading}
        className="mb-1 flex items-center gap-2 text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-2 hover:bg-gray-200 transition-colors w-full disabled:opacity-60"
      >
        {icon}
        <span>{label}</span>
        {isDownloading
          ? <Loader2 size={12} className="ml-auto animate-spin" style={{ color: 'var(--primary-color)' }} />
          : <Download size={12} className="ml-auto" style={{ color: 'var(--primary-color)' }} />}
      </button>
    );

    // Shared: save-to-device anchor (triggers browser download)
    const saveBtn = (url: string, filename?: string | null) => (
      <a
        href={url}
        download={filename || 'whatsapp-media'}
        className="flex items-center gap-1 text-[10px] mt-1 w-fit" style={{ color: 'var(--primary-color)' }}
        onClick={e => e.stopPropagation()}
      >
        <Download size={10} />Save
      </a>
    );

    if (msg.type === 'image' || msg.type === 'sticker') {
      if (msg.mediaUrl) {
        return (
          <div className="mb-1">
            <div className="rounded-lg overflow-hidden">
              <img src={msg.mediaUrl} alt="Image" className="max-w-full max-h-64 rounded-lg object-cover" loading="lazy" />
            </div>
            {saveBtn(msg.mediaUrl, msg.mediaFilename)}
          </div>
        );
      }
      return fetchBtn(<ImageIcon size={14} />, 'Image');
    }

    if (msg.type === 'document') {
      if (msg.mediaUrl) {
        return (
          <a
            href={msg.mediaUrl}
            download={msg.mediaFilename || 'document'}
            className="mb-1 flex items-center gap-2 text-xs bg-gray-100 rounded-lg px-3 py-2 hover:bg-gray-200 transition-colors"
            onClick={e => e.stopPropagation()}
          >
            <FileText size={14} className="flex-shrink-0" style={{ color: 'var(--primary-color)' }} />
            <span className="truncate text-gray-700">{msg.mediaFilename || 'Document'}</span>
            <Download size={12} className="ml-auto flex-shrink-0" style={{ color: 'var(--primary-color)' }} />
          </a>
        );
      }
      return fetchBtn(<FileText size={14} />, msg.mediaFilename || 'Document');
    }

    if (msg.type === 'audio' || msg.type === 'ptt') {
      if (msg.mediaUrl) {
        return (
          <div className="mb-1">
            <audio controls preload="none" className="max-w-full h-10">
              <source src={msg.mediaUrl} />
            </audio>
            {saveBtn(msg.mediaUrl, msg.mediaFilename)}
          </div>
        );
      }
      return fetchBtn(<Play size={14} />, 'Voice message');
    }

    if (msg.type === 'video') {
      if (msg.mediaUrl) {
        return (
          <div className="mb-1">
            <video controls className="max-w-full max-h-48 rounded-lg" preload="metadata">
              <source src={msg.mediaUrl} />
            </video>
            {saveBtn(msg.mediaUrl, msg.mediaFilename)}
          </div>
        );
      }
      return fetchBtn(<Play size={14} />, 'Video');
    }

    return null;
  };

  return (
    <div className={cn('flex', msg.fromMe ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-[85%] sm:max-w-[75%] md:max-w-[65%] px-3 py-2 rounded-xl text-sm shadow-sm overflow-hidden',
        msg.fromMe ? 'bg-[#dcf8c6] text-gray-800 rounded-tr-none' : 'bg-white text-gray-800 rounded-tl-none'
      )}>
        {msg.quotedMsg && (
          <div className="mb-1.5 px-2 py-1.5 bg-black/5 rounded-lg border-l-2 border-green-500">
            <p className="text-[10px] font-medium text-green-700">{msg.quotedMsg.fromMe ? 'You' : 'Them'}</p>
            <p className="text-xs text-gray-600 truncate">{msg.quotedMsg.body}</p>
          </div>
        )}
        {renderMedia()}
        {msg.body && !isBase64Blob(msg.body) && (
          <p className="whitespace-pre-wrap break-words" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
            {msg.body}
          </p>
        )}
        <div className="flex items-center justify-end gap-1 mt-1">
          <span className="text-[10px] text-gray-400 whitespace-nowrap">
            {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
          </span>
          {msg.fromMe && renderTick(msg.ack, (msg as any).error)}
        </div>
      </div>
    </div>
  );
});

// =====================================================================
// NEW CHAT VIEW
// =====================================================================

function NewChatView({ onSent, onBack }: { onSent: (chatId: string) => void; onBack: () => void }) {
  const prefillMsg = typeof window !== 'undefined' ? sessionStorage.getItem('whatsapp_prefill_message') || '' : '';
  const prefillPhone = typeof window !== 'undefined' ? sessionStorage.getItem('whatsapp_prefill_phone') || '' : '';
  const [phone, setPhone] = useState(prefillPhone);
  const [message, setMessage] = useState(prefillMsg);
  const [phoneError, setPhoneError] = useState('');

  useEffect(() => {
    sessionStorage.removeItem('whatsapp_prefill_message');
    sessionStorage.removeItem('whatsapp_prefill_phone');
  }, []);

  const [sendToNumber, { isLoading }] = useSendWhatsAppToNumberMutation();

  const validatePhone = (value: string) => {
    const cleaned = value.replace(/[\s\-()]/g, '');
    if (!cleaned) { setPhoneError(''); return false; }
    const digits = cleaned.replace(/^\+/, '');
    if (!/^[0-9]{7,15}$/.test(digits)) {
      setPhoneError('Enter a valid phone number with country code (e.g. 919876543210 or +14155551234)');
      return false;
    }
    setPhoneError('');
    return true;
  };

  const handleSend = async () => {
    if (!validatePhone(phone) || !message.trim()) return;
    try {
      const cleaned = phone.trim().replace(/^\+/, '');
      const res = await sendToNumber({ phone: cleaned, message: message.trim() }).unwrap();
      toast.success('Message sent!');
      if (res.data?.chatId) onSent(res.data.chatId);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to send');
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50/50 flex items-center gap-3">
        <button onClick={onBack} className="lg:hidden p-1 rounded-lg hover:bg-gray-200 transition-colors" aria-label="Back">
          <ArrowLeft size={18} className="text-gray-600" />
        </button>
        <h3 className="text-sm font-semibold text-gray-800">New Chat</h3>
      </div>
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
            <div className="relative">
              <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={phone}
                onChange={e => { setPhone(e.target.value); validatePhone(e.target.value); }}
                placeholder="919876543210 or +14155551234"
                className={cn('input-glass w-full pl-10 text-sm', phoneError && 'border-red-300 focus:ring-red-300')}
                aria-label="Phone number"
              />
            </div>
            {phoneError ? (
              <p className="text-xs text-red-500 mt-1">{phoneError}</p>
            ) : (
              <p className="text-xs text-gray-400 mt-1">Include country code (e.g. 91 for India, 1 for US)</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Type your message..."
              rows={4}
              className="input-glass w-full text-sm resize-none"
              aria-label="Message"
              maxLength={4096}
            />
            <p className="text-xs text-gray-400 mt-1 text-right">{message.length}/4096</p>
          </div>
          <button
            onClick={handleSend}
            disabled={isLoading || !phone || !message || !!phoneError}
            className="btn-primary w-full flex items-center justify-center gap-2 text-sm"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            Send Message
          </button>
        </div>
      </div>
    </div>
  );
}
