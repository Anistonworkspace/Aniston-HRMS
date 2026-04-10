import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Send, Phone, MessageCircle, Loader2, WifiOff, Plus, User,
  Check, CheckCheck, ArrowLeft, X, ExternalLink, FileText, Play,
  Image as ImageIcon, AlertCircle, RefreshCw, Paperclip, Download,
  Copy, ArrowDown, Bell, Clock,
} from 'lucide-react';
import {
  useGetWhatsAppStatusQuery,
  useGetWhatsAppChatsQuery,
  useGetWhatsAppChatMessagesQuery,
  useSendWhatsAppMessageMutation,
  useSendWhatsAppToNumberMutation,
  useGetWhatsAppConversationsQuery,
  useLazyResolveWhatsAppChatQuery,
  useGetWhatsAppContactsQuery,
  useMarkChatAsReadMutation,
  useDownloadWhatsAppMediaMutation,
  useSendWhatsAppMediaMutation,
  useLazySearchWhatsAppMessagesQuery,
} from './whatsappApi';
import type { WhatsAppChat, WhatsAppMessage, WhatsAppContact, WhatsAppConversation } from './whatsappApi';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

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
  const sessionPhone = statusRes?.data?.phoneNumber;
  const lastPing = statusRes?.data?.lastPing;

  // Session staleness warning — show if last ping > 6 hours ago
  const sessionStale = useMemo(() => {
    if (!lastPing || !isConnected) return false;
    return Date.now() - new Date(lastPing).getTime() > 6 * 60 * 60 * 1000;
  }, [lastPing, isConnected]);

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
      {sessionStale && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs">
          <Clock size={12} className="flex-shrink-0" />
          <span>WhatsApp session may be unstable — last activity was over 6 hours ago.</span>
          <Link to="/settings" className="underline font-medium ml-1">Check Settings</Link>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <WhatsAppChatApp sessionPhone={sessionPhone} />
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

// Normalize a phone or chat ID to pure digits for comparison
function normalizePhone(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}

// Match a phone number against a WhatsApp chat ID (handles @c.us and @lid)
function phoneMatchesChatId(phone: string, chatId: string): boolean {
  if (!phone || !chatId) return false;
  const phoneDigits = normalizePhone(phone);
  // For @c.us IDs, extract digits and compare suffix (last 10+ digits)
  if (chatId.includes('@c.us')) {
    const chatDigits = chatId.replace('@c.us', '');
    return chatDigits === phoneDigits ||
      chatDigits.endsWith(phoneDigits.slice(-10)) ||
      phoneDigits.endsWith(chatDigits.slice(-10));
  }
  // For @lid or group IDs, can't match by phone — return false
  return false;
}

function findChatForPhone(chats: WhatsAppChat[], phone: string): WhatsAppChat | null {
  if (!phone || !chats.length) return null;
  return chats.find(c => phoneMatchesChatId(phone, c.id)) || null;
}

// =====================================================================
// MAIN CHAT APP
// =====================================================================

function WhatsAppChatApp({ sessionPhone }: { sessionPhone?: string | null }) {
  const hasPrefill = typeof window !== 'undefined' && !!sessionStorage.getItem('whatsapp_prefill_message');
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewChat, setShowNewChat] = useState(hasPrefill);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [leftTab, setLeftTab] = useState<'chats' | 'contacts' | 'hrms'>('chats');
  // resolvingPhone: phone currently being resolved to a live chatId
  const [resolvingPhone, setResolvingPhone] = useState<string | null>(null);

  const {
    data: chatsRes,
    isLoading: loadingChats,
    isFetching: fetchingChats,
    refetch: refetchChats,
  } = useGetWhatsAppChatsQuery(undefined, { pollingInterval: POLLING.CHATS });

  const { data: contactsRes, isLoading: loadingContacts, isFetching: fetchingContacts } =
    useGetWhatsAppContactsQuery();

  // HRMS tab: use DB conversations (correct, keyed by contactPhone)
  const {
    data: conversationsRes,
    isLoading: loadingConversations,
    refetch: refetchConversations,
  } = useGetWhatsAppConversationsQuery(
    { page: 1, limit: 100 },
    { skip: leftTab !== 'hrms' }
  );

  // LID-safe chat resolution — used when clicking HRMS contact
  const [triggerResolve] = useLazyResolveWhatsAppChatQuery();

  const [markAsRead] = useMarkChatAsReadMutation();

  const phoneContacts = contactsRes?.data || [];
  const chats: WhatsAppChat[] = chatsRes?.data || [];
  const conversations: WhatsAppConversation[] = conversationsRes?.data || [];

  // Expose active chatId so API layer can suppress toast for active conversation
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('wa:active-chat', { detail: selectedChat }));
  }, [selectedChat]);

  const selectedChatData = chats.find((c: WhatsAppChat) => c.id === selectedChat);

  // Close contact info when chat changes
  useEffect(() => { setShowContactInfo(false); }, [selectedChat]);

  // Mark chat as read when selected — fires immediately, socket updates all clients
  useEffect(() => {
    if (selectedChat) {
      markAsRead(selectedChat).catch(() => {});
    }
  }, [selectedChat, markAsRead]);

  // ===== HRMS Contact click handler (LID-safe) =====
  const handleHrmsContactClick = useCallback(async (conv: WhatsAppConversation) => {
    // 1. If we already have providerChatId stored in DB, use it directly
    if (conv.providerChatId) {
      setSelectedChat(conv.providerChatId);
      setShowNewChat(false);
      return;
    }

    // 2. Check if any live chat matches this phone number (fast @c.us match)
    const liveChat = findChatForPhone(chats, conv.contactPhone);
    if (liveChat) {
      setSelectedChat(liveChat.id);
      setShowNewChat(false);
      return;
    }

    // 3. Resolve via backend (handles LID, stores result in DB for future)
    setResolvingPhone(conv.contactPhone);
    try {
      const res = await triggerResolve(conv.contactPhone).unwrap();
      if (res.data?.chatId) {
        setSelectedChat(res.data.chatId);
        setShowNewChat(false);
        refetchConversations();
        return;
      }
    } catch {
      // ignore resolve failure
    } finally {
      setResolvingPhone(null);
    }

    // 4. Fallback: open NewChatView pre-filled with this number so HR can still reply
    sessionStorage.setItem('whatsapp_prefill_phone', conv.contactPhone);
    setShowNewChat(true);
    setSelectedChat(null);
    toast(`Opening composer for +${conv.contactPhone} — number not found in active chats`, {
      duration: 4000,
      icon: '💬',
    });
  }, [chats, triggerResolve, refetchConversations]);

  // ===== Contacts tab click handler =====
  const handleContactClick = useCallback((contact: WhatsAppContact) => {
    const phone = contact.number || contact.id?.replace('@c.us', '');
    if (!phone) return;
    // If contact already has @c.us ID, use directly
    if (contact.id?.includes('@c.us')) {
      setSelectedChat(contact.id);
      setShowNewChat(false);
      return;
    }
    // Try to find in live chats
    const liveChat = findChatForPhone(chats, phone);
    if (liveChat) {
      setSelectedChat(liveChat.id);
      setShowNewChat(false);
      return;
    }
    // Fallback to new chat
    sessionStorage.setItem('whatsapp_prefill_phone', phone);
    setShowNewChat(true);
    setSelectedChat(null);
  }, [chats]);

  const filteredChats = useMemo(() =>
    chats.filter((c: WhatsAppChat) => c.name?.toLowerCase().includes(searchQuery.toLowerCase())),
    [chats, searchQuery]
  );

  const filteredContacts = useMemo(() =>
    phoneContacts.filter((c: WhatsAppContact) =>
      !searchQuery || c.name?.toLowerCase().includes(searchQuery.toLowerCase()) || c.number?.includes(searchQuery)
    ),
    [phoneContacts, searchQuery]
  );

  const filteredConversations = useMemo(() =>
    conversations.filter(c =>
      !searchQuery ||
      c.contactPhone.includes(searchQuery) ||
      (c.contactName || '').toLowerCase().includes(searchQuery.toLowerCase())
    ),
    [conversations, searchQuery]
  );

  // Total unread count for header/badge
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
              {(['chats', 'contacts', 'hrms'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setLeftTab(tab)}
                  className={cn(
                    'flex-1 text-xs font-medium py-1.5 rounded-md transition-all',
                    leftTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  )}
                  aria-label={`${tab} tab`}
                >
                  {tab === 'chats'
                    ? `Chats${chats.length > 0 ? ` (${chats.length})` : ''}`
                    : tab === 'contacts'
                    ? `Contacts${phoneContacts.length > 0 ? ` (${phoneContacts.length})` : ''}`
                    : `HRMS${conversations.length > 0 ? ` (${conversations.length})` : ''}`}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {totalUnread > 0 && (
                <span className="w-5 h-5 rounded-full bg-green-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {totalUnread > 99 ? '99+' : totalUnread}
                </span>
              )}
              <button
                onClick={() => { setShowNewChat(true); setSelectedChat(null); }}
                className="w-8 h-8 rounded-lg bg-brand-600 hover:bg-brand-700 transition-colors flex items-center justify-center"
                aria-label="New chat" title="New Chat"
              >
                <Plus size={16} className="text-white" />
              </button>
            </div>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={
                leftTab === 'chats' ? 'Search chats...' :
                leftTab === 'contacts' ? 'Search contacts...' : 'Search HRMS conversations...'
              }
              className="w-full text-xs bg-white border border-gray-200 rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-300"
              aria-label="Search"
            />
          </div>
        </div>

        {/* Chat/Contact/HRMS list */}
        <div className="flex-1 overflow-y-auto" role="list" aria-label={`${leftTab} list`}>
          {leftTab === 'chats' ? (
            loadingChats ? <ChatListSkeleton /> :
            filteredChats.length === 0 ? (
              <EmptyState
                icon={<MessageCircle size={32} className="text-gray-200" />}
                text={searchQuery ? 'No matching chats' : 'No chats yet'}
                action={!searchQuery ? (
                  <button onClick={() => refetchChats()} className="text-xs text-brand-600 hover:text-brand-700 font-medium mt-2 flex items-center gap-1 mx-auto">
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
          ) : leftTab === 'contacts' ? (
            loadingContacts ? <ChatListSkeleton /> :
            filteredContacts.length === 0 ? (
              <EmptyState icon={<User size={32} className="text-gray-200" />} text={searchQuery ? 'No matching contacts' : 'No contacts found'} />
            ) : (
              <>
                {fetchingContacts && !loadingContacts && <LoadingBanner text="Refreshing contacts..." />}
                {filteredContacts.map((contact: WhatsAppContact) => (
                  <ContactListItem
                    key={contact.id}
                    contact={contact}
                    isSelected={selectedChat === contact.id}
                    onClick={() => handleContactClick(contact)}
                  />
                ))}
              </>
            )
          ) : (
            // HRMS tab — DB conversations (properly grouped by contactPhone)
            loadingConversations ? <ChatListSkeleton /> :
            filteredConversations.length === 0 ? (
              <EmptyState
                icon={<MessageCircle size={32} className="text-gray-200" />}
                text="No HRMS conversations yet"
                subtext="Messages sent to candidates will appear here"
                action={
                  <button onClick={() => refetchConversations()} className="text-xs text-brand-600 hover:text-brand-700 font-medium mt-2 flex items-center gap-1 mx-auto">
                    <RefreshCw size={12} /> Refresh
                  </button>
                }
              />
            ) : (
              filteredConversations.map(conv => (
                <HrmsConversationItem
                  key={conv.id}
                  conv={conv}
                  isSelected={selectedChat === conv.providerChatId}
                  isResolving={resolvingPhone === conv.contactPhone}
                  onClick={() => handleHrmsContactClick(conv)}
                />
              ))
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
              refetchConversations();
            }}
            onBack={() => setShowNewChat(false)}
          />
        ) : selectedChat ? (
          <ChatView
            chatId={selectedChat}
            chatName={selectedChatData?.name || selectedChat.replace('@c.us', '').replace('@g.us', '')}
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
                onClose={() => setShowContactInfo(false)}
              />
            </motion.div>
          </>
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
        'w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-50',
        isSelected && 'bg-brand-50 hover:bg-brand-50'
      )}
    >
      <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
        {chat.profilePicUrl ? (
          <img src={chat.profilePicUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
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

const ContactListItem = memo(function ContactListItem({
  contact, isSelected, onClick,
}: { contact: WhatsAppContact; isSelected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      role="listitem"
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-50',
        isSelected && 'bg-brand-50 hover:bg-brand-50'
      )}
    >
      <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-blue-700">
          {(contact.name || '?').charAt(0).toUpperCase()}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{contact.name}</p>
        <p className="text-xs text-gray-400">{contact.number ? `+${contact.number}` : ''}</p>
      </div>
      {contact.isMyContact && (
        <span className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">Saved</span>
      )}
    </button>
  );
});

// HRMS conversation item — uses proper WhatsAppConversation data (no phantom grouping)
const HrmsConversationItem = memo(function HrmsConversationItem({
  conv, isSelected, isResolving, onClick,
}: {
  conv: WhatsAppConversation;
  isSelected: boolean;
  isResolving: boolean;
  onClick: () => void;
}) {
  const hasUnread = conv.unreadCount > 0;
  const displayName = conv.contactName || `+${conv.contactPhone}`;
  const lastDate = conv.lastMessageAt
    ? formatChatTime(conv.lastMessageAt)
    : '';

  return (
    <button
      onClick={onClick}
      disabled={isResolving}
      role="listitem"
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-50',
        isSelected && 'bg-brand-50 hover:bg-brand-50',
        isResolving && 'opacity-60'
      )}
    >
      <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
        {isResolving ? (
          <Loader2 size={14} className="text-brand-600 animate-spin" />
        ) : (
          <MessageCircle size={16} className="text-brand-600" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <p className={cn('text-sm truncate', hasUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-800')}>
            {displayName}
          </p>
          {lastDate && (
            <span className={cn('text-[10px] flex-shrink-0', hasUnread ? 'text-green-600 font-medium' : 'text-gray-400')}>
              {lastDate}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {conv.lastMessageDirection === 'OUTBOUND' && (
            <CheckCheck size={10} className="text-gray-400 flex-shrink-0" />
          )}
          <p className={cn('text-xs truncate', hasUnread ? 'text-gray-700 font-medium' : 'text-gray-500')}>
            {conv.lastMessagePreview || 'No messages yet'}
          </p>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        {hasUnread ? (
          <span className="w-5 h-5 rounded-full bg-green-500 text-white text-[10px] flex items-center justify-center font-bold">
            {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
          </span>
        ) : conv.templateSource ? (
          <span className="text-[9px] bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded-full whitespace-nowrap">
            {conv.templateSource.replace(/_/g, ' ')}
          </span>
        ) : null}
      </div>
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
    <div className="px-4 py-1.5 bg-brand-50 text-brand-600 text-[10px] font-medium flex items-center gap-1.5">
      <Loader2 size={10} className="animate-spin" /> {text}
    </div>
  );
}

// =====================================================================
// CONTACT INFO PANEL
// =====================================================================

function ContactInfoPanel({
  chatId, chatName, onClose,
}: { chatId: string; chatName: string; onClose: () => void }) {
  const phoneNumber = chatId.replace('@c.us', '').replace('@g.us', '').replace(/@\S+/, '');
  const initials = chatName.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';

  const handleCopyPhone = () => {
    navigator.clipboard.writeText(`+${phoneNumber}`).then(() => toast.success('Phone copied'));
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
          <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center mb-4">
            <span className="text-2xl font-bold text-green-700">{initials}</span>
          </div>
          <h4 className="text-base font-semibold text-gray-800">{chatName}</h4>
        </div>
        {phoneNumber && (
          <div className="px-4 py-4 border-b border-gray-100">
            <p className="text-xs text-gray-400 mb-1">Phone number</p>
            <div className="flex items-center gap-2">
              <Phone size={14} className="text-gray-400" />
              <span className="text-sm text-gray-700 font-mono flex-1">+{phoneNumber}</span>
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
        <div className="px-4 py-4">
          <a
            href={`/employees?search=${encodeURIComponent(phoneNumber)}`}
            className="flex items-center gap-2 px-4 py-2.5 bg-brand-50 text-brand-700 rounded-lg hover:bg-brand-100 transition-colors text-sm font-medium w-full justify-center"
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
  const { data: messagesRes, isLoading, isFetching, isError, error, refetch } =
    useGetWhatsAppChatMessagesQuery({ chatId, limit: 50 });
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

  const messages: WhatsAppMessage[] = messagesRes?.data || [];

  // Smart scroll — scroll on new messages
  useEffect(() => {
    if (messages.length > prevMessageCount.current && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({
        behavior: prevMessageCount.current === 0 ? ('instant' as ScrollBehavior) : 'smooth',
      });
    }
    prevMessageCount.current = messages.length;
  }, [messages.length]);

  // Reset state when chat changes
  useEffect(() => {
    prevMessageCount.current = 0;
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
      // Extract phone from chatId — strip suffix (@c.us, @lid etc.)
      const phone = chatId.split('@')[0];
      await sendMessage({ to: phone, message: input.trim() }).unwrap();
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

  const handleMediaDownload = async (msg: WhatsAppMessage) => {
    try {
      const result = await downloadMedia({ messageId: msg.id, chatId }).unwrap();
      if (result?.data?.mediaUrl) {
        refetch();
        toast.success('Media downloaded');
      }
    } catch {
      toast.error('Failed to download media');
    }
  };

  const handleSearch = useCallback(() => {
    if (chatSearch.trim().length >= 2) {
      triggerSearch({ chatId, query: chatSearch.trim() });
    }
  }, [chatId, chatSearch, triggerSearch]);

  const renderTick = (ack?: number) => {
    if (ack === undefined || ack === null) return null;
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
          <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
            <User size={16} className="text-green-700" />
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sm font-semibold text-gray-800 truncate">{chatName}</p>
            <p className="text-xs text-gray-400 truncate">
              +{chatId.split('@')[0]}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setShowSearch(s => !s)}
            className={cn('p-2 rounded-lg hover:bg-gray-200 transition-colors', showSearch && 'bg-brand-100')}
            aria-label="Search messages"
            title="Search messages"
          >
            <Search size={16} className={showSearch ? 'text-brand-600' : 'text-gray-500'} />
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
                className="text-xs text-brand-600 font-medium disabled:opacity-40"
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
        {isLoading ? (
          <MessagesSkeleton />
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle size={32} className="text-red-300 mb-3" />
            <p className="text-sm text-red-500 font-medium mb-1">Failed to load messages</p>
            <p className="text-xs text-gray-400 mb-3 max-w-xs">
              {(error as any)?.data?.error?.message || 'WhatsApp may be disconnected or the chat is unavailable'}
            </p>
            <button
              onClick={() => refetch()}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1"
            >
              <RefreshCw size={12} /> Try again
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            No messages yet — send a message below
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              renderTick={renderTick}
              onDownloadMedia={handleMediaDownload}
            />
          ))
        )}
        <div ref={messagesEndRef} />

        {/* Scroll to bottom button */}
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
  msg, renderTick, onDownloadMedia,
}: {
  msg: WhatsAppMessage;
  renderTick: (ack?: number) => React.ReactNode;
  onDownloadMedia: (msg: WhatsAppMessage) => void;
}) {
  const renderMedia = () => {
    if (!msg.hasMedia) return null;
    if (msg.type === 'image' || msg.type === 'sticker') {
      if (msg.mediaUrl) {
        return (
          <div className="mb-1 rounded-lg overflow-hidden">
            <img src={msg.mediaUrl} alt="Image" className="max-w-full max-h-64 rounded-lg object-cover" loading="lazy" />
          </div>
        );
      }
      return (
        <button onClick={() => onDownloadMedia(msg)} className="mb-1 flex items-center gap-2 text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-2 hover:bg-gray-200 transition-colors w-full">
          <ImageIcon size={14} /><span>Image</span><Download size={12} className="ml-auto text-brand-600" />
        </button>
      );
    }
    if (msg.type === 'document') {
      if (msg.mediaUrl) {
        return (
          <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer" className="mb-1 flex items-center gap-2 text-xs bg-gray-100 rounded-lg px-3 py-2 hover:bg-gray-200 transition-colors">
            <FileText size={14} className="text-brand-600 flex-shrink-0" />
            <span className="truncate text-gray-700">{msg.mediaFilename || 'Document'}</span>
            <Download size={12} className="ml-auto text-brand-600 flex-shrink-0" />
          </a>
        );
      }
      return (
        <button onClick={() => onDownloadMedia(msg)} className="mb-1 flex items-center gap-2 text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-2 hover:bg-gray-200 transition-colors w-full">
          <FileText size={14} /><span>{msg.mediaFilename || 'Document'}</span><Download size={12} className="ml-auto text-brand-600" />
        </button>
      );
    }
    if (msg.type === 'audio' || msg.type === 'ptt') {
      if (msg.mediaUrl) {
        return <div className="mb-1"><audio controls preload="none" className="max-w-full h-10"><source src={msg.mediaUrl} /></audio></div>;
      }
      return (
        <button onClick={() => onDownloadMedia(msg)} className="mb-1 flex items-center gap-2 text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-2 hover:bg-gray-200 transition-colors w-full">
          <Play size={14} /><span>Voice message</span><Download size={12} className="ml-auto text-brand-600" />
        </button>
      );
    }
    if (msg.type === 'video') {
      return (
        <button onClick={() => onDownloadMedia(msg)} className="mb-1 flex items-center gap-2 text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-2 hover:bg-gray-200 transition-colors w-full">
          <Play size={14} /><span>Video</span><Download size={12} className="ml-auto text-brand-600" />
        </button>
      );
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
        {msg.body && (
          <p className="whitespace-pre-wrap break-words" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
            {msg.body}
          </p>
        )}
        <div className="flex items-center justify-end gap-1 mt-1">
          <span className="text-[10px] text-gray-400 whitespace-nowrap">
            {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
          </span>
          {msg.fromMe && renderTick(msg.ack)}
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
    // Allow 10-15 digits with optional leading +
    const digits = cleaned.replace(/^\+/, '');
    if (!/^[0-9]{10,15}$/.test(digits)) {
      setPhoneError('Enter 10–15 digits with country code (e.g. 919876543210)');
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
                placeholder="919876543210"
                className={cn('input-glass w-full pl-10 text-sm', phoneError && 'border-red-300 focus:ring-red-300')}
                aria-label="Phone number"
              />
            </div>
            {phoneError ? (
              <p className="text-xs text-red-500 mt-1">{phoneError}</p>
            ) : (
              <p className="text-xs text-gray-400 mt-1">Include country code (e.g. 91 for India)</p>
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
