import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Send, Phone, Video, MessageCircle, Loader2, WifiOff, Plus, User, Check, CheckCheck, ArrowLeft, X, ExternalLink, FileText, Play, Image as ImageIcon, PhoneOff, Mic, MicOff, Volume2, AlertCircle, RefreshCw } from 'lucide-react';
import {
  useGetWhatsAppStatusQuery,
  useGetWhatsAppChatsQuery,
  useGetWhatsAppChatMessagesQuery,
  useSendWhatsAppMessageMutation,
  useSendWhatsAppToNumberMutation,
  useGetWhatsAppMessagesQuery,
  useGetWhatsAppContactsQuery,
} from './whatsappApi';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';
import { onSocketEvent, offSocketEvent } from '../../lib/socket';

export default function WhatsAppPage() {
  const { data: statusRes } = useGetWhatsAppStatusQuery(undefined, { pollingInterval: 5000 });
  const isConnected = statusRes?.data?.isConnected;
  const isInitializing = statusRes?.data?.isInitializing;

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
              <p className="text-sm text-gray-500 mb-4">Go to Settings &rarr; WhatsApp to connect your WhatsApp account.</p>
              <a href="/settings" className="btn-primary text-sm">Open Settings</a>
            </>
          )}
        </div>
      </div>
    );
  }

  return <WhatsAppChat />;
}

/* ------------------------------------------------------------------ */
/*  Syncing progress bar component                                    */
/* ------------------------------------------------------------------ */
function SyncProgress({ label, progress }: { label: string; progress: number }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6">
      <Loader2 className="animate-spin text-brand-500 mb-4" size={28} />
      <p className="text-sm font-medium text-gray-700 mb-3">{label}</p>
      <div className="w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-brand-500 rounded-full"
          initial={{ width: '5%' }}
          animate={{ width: `${Math.max(progress, 5)}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>
      <p className="text-xs text-gray-400 mt-2 font-mono" data-mono>{Math.round(progress)}%</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Chat Component                                               */
/* ------------------------------------------------------------------ */
function WhatsAppChat() {
  const hasPrefill = !!sessionStorage.getItem('whatsapp_prefill_message');
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewChat, setShowNewChat] = useState(hasPrefill);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [leftTab, setLeftTab] = useState<'chats' | 'contacts' | 'hrms'>('chats');
  const [hrmsPhone, setHrmsPhone] = useState<string | null>(null);

  // Simulated progress for loading states
  const [chatProgress, setChatProgress] = useState(0);
  const [contactProgress, setContactProgress] = useState(0);

  const { data: chatsRes, isLoading: loadingChats, isFetching: fetchingChats, refetch: refetchChats } = useGetWhatsAppChatsQuery(undefined, { pollingInterval: 30000 });
  const { data: contactsRes, isLoading: loadingContacts, isFetching: fetchingContacts } = useGetWhatsAppContactsQuery();
  const { data: hrmsMessagesRes, isLoading: loadingHrms } = useGetWhatsAppMessagesQuery({ page: 1, limit: 100 });
  const phoneContacts = contactsRes?.data || [];
  const chats = chatsRes?.data || [];

  // Simulate progress when loading chats
  useEffect(() => {
    if (!loadingChats && !fetchingChats) { setChatProgress(100); return; }
    setChatProgress(0);
    const steps = [10, 25, 40, 55, 70, 82, 90, 95];
    let i = 0;
    const interval = setInterval(() => {
      if (i < steps.length) { setChatProgress(steps[i]); i++; }
      else clearInterval(interval);
    }, 400);
    return () => clearInterval(interval);
  }, [loadingChats, fetchingChats]);

  // Simulate progress when loading contacts
  useEffect(() => {
    if (!loadingContacts && !fetchingContacts) { setContactProgress(100); return; }
    setContactProgress(0);
    const steps = [8, 20, 35, 50, 65, 78, 88, 94];
    let i = 0;
    const interval = setInterval(() => {
      if (i < steps.length) { setContactProgress(steps[i]); i++; }
      else clearInterval(interval);
    }, 500);
    return () => clearInterval(interval);
  }, [loadingContacts, fetchingContacts]);

  // Build HRMS contacts from DB messages (grouped by phone)
  const hrmsContacts = useMemo(() => {
    const raw = hrmsMessagesRes?.data;
    const msgs = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
    const grouped = new Map<string, { phone: string; lastMessage: string; lastDate: string; count: number; status: string }>();
    for (const m of msgs) {
      const phone = m.to || '';
      if (!phone) continue;
      const existing = grouped.get(phone);
      if (!existing) {
        grouped.set(phone, { phone, lastMessage: m.message?.slice(0, 80) || '', lastDate: m.sentAt || m.createdAt, count: 1, status: m.status });
      } else {
        existing.count++;
        if (new Date(m.sentAt || m.createdAt) > new Date(existing.lastDate)) {
          existing.lastMessage = m.message?.slice(0, 80) || '';
          existing.lastDate = m.sentAt || m.createdAt;
          existing.status = m.status;
        }
      }
    }
    return Array.from(grouped.values()).sort((a, b) => new Date(b.lastDate).getTime() - new Date(a.lastDate).getTime());
  }, [hrmsMessagesRes]);

  const filteredChats = chats.filter((c: any) =>
    c.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredContacts = phoneContacts.filter((c: any) =>
    !searchQuery || c.name?.toLowerCase().includes(searchQuery.toLowerCase()) || c.number?.includes(searchQuery)
  );

  const selectedChatData = chats.find((c: any) => c.id === selectedChat);

  useEffect(() => { setShowContactInfo(false); }, [selectedChat]);

  // Listen for real-time socket events to refresh chats
  useEffect(() => {
    const handleNewMessage = () => { refetchChats(); };
    onSocketEvent('whatsapp:message:new', handleNewMessage);
    return () => { offSocketEvent('whatsapp:message:new', handleNewMessage); };
  }, [refetchChats]);

  const findChatIdForPhone = useCallback((phone: string) => {
    const cleanPhone = phone.replace(/\D/g, '');
    const chat = chats.find((c: any) => {
      const chatPhone = c.id?.replace('@c.us', '').replace('@g.us', '') || '';
      return chatPhone === cleanPhone || chatPhone === `91${cleanPhone}` || `91${chatPhone}` === cleanPhone;
    });
    return chat?.id || null;
  }, [chats]);

  const handleContactClick = useCallback((contact: any) => {
    const phone = contact.number || contact.id?.replace('@c.us', '');
    if (!phone) return;
    const existingChatId = contact.id?.includes('@c.us') ? contact.id : findChatIdForPhone(phone);
    if (existingChatId) {
      setSelectedChat(existingChatId);
      setShowNewChat(false);
      setHrmsPhone(null);
    } else {
      sessionStorage.setItem('whatsapp_prefill_phone', phone);
      setShowNewChat(true);
      setSelectedChat(null);
      setHrmsPhone(null);
    }
  }, [findChatIdForPhone]);

  return (
    <div className="h-[calc(100vh-80px)] flex rounded-2xl overflow-hidden border border-gray-200 bg-white shadow-sm relative">
      {/* Left: Chat List */}
      <div className={cn(
        'w-full lg:w-80 border-r border-gray-200 flex flex-col flex-shrink-0',
        (selectedChat || showNewChat || hrmsPhone) && 'hidden lg:flex'
      )}>
        {/* Header with tabs */}
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex bg-gray-100 rounded-lg p-0.5 flex-1">
              <button onClick={() => setLeftTab('chats')}
                className={cn('flex-1 text-xs font-medium py-1.5 rounded-md transition-all',
                  leftTab === 'chats' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                Chats{chats.length > 0 && ` (${chats.length})`}
              </button>
              <button onClick={() => setLeftTab('contacts')}
                className={cn('flex-1 text-xs font-medium py-1.5 rounded-md transition-all',
                  leftTab === 'contacts' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                Contacts{phoneContacts.length > 0 && ` (${phoneContacts.length})`}
              </button>
              <button onClick={() => setLeftTab('hrms')}
                className={cn('flex-1 text-xs font-medium py-1.5 rounded-md transition-all',
                  leftTab === 'hrms' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                HRMS{hrmsContacts.length > 0 && ` (${hrmsContacts.length})`}
              </button>
            </div>
            <button onClick={() => { setShowNewChat(true); setSelectedChat(null); setHrmsPhone(null); }}
              className="w-8 h-8 rounded-lg bg-brand-600 hover:bg-brand-700 transition-colors flex items-center justify-center flex-shrink-0" title="New Chat">
              <Plus size={16} className="text-white" />
            </button>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder={leftTab === 'chats' ? 'Search chats...' : leftTab === 'contacts' ? 'Search contacts...' : 'Search HRMS messages...'}
              className="w-full text-xs bg-white border border-gray-200 rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-300" />
          </div>
        </div>

        {/* Chat/Contact list */}
        <div className="flex-1 overflow-y-auto">
          {leftTab === 'chats' ? (
            loadingChats ? (
              <SyncProgress label="Syncing chats from WhatsApp..." progress={chatProgress} />
            ) : filteredChats.length === 0 ? (
              <div className="text-center py-12 px-4">
                <MessageCircle size={32} className="mx-auto text-gray-200 mb-2" />
                <p className="text-gray-400 text-sm">{searchQuery ? 'No matching chats' : 'No chats yet'}</p>
                {!searchQuery && (
                  <button onClick={() => refetchChats()} className="text-xs text-brand-600 hover:text-brand-700 font-medium mt-2 flex items-center gap-1 mx-auto">
                    <RefreshCw size={12} /> Refresh
                  </button>
                )}
              </div>
            ) : (
              <>
                {fetchingChats && !loadingChats && (
                  <div className="px-4 py-1.5 bg-brand-50 text-brand-600 text-[10px] font-medium flex items-center gap-1.5">
                    <Loader2 size={10} className="animate-spin" /> Refreshing chats...
                  </div>
                )}
                {filteredChats.map((chat: any) => (
                  <button key={chat.id} onClick={() => { setSelectedChat(chat.id); setShowNewChat(false); setHrmsPhone(null); }}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-50',
                      selectedChat === chat.id && 'bg-brand-50 hover:bg-brand-50'
                    )}>
                    <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                      <User size={18} className="text-green-700" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-gray-800 truncate">{chat.name}</p>
                        {chat.timestamp && (
                          <span className="text-[10px] text-gray-400 flex-shrink-0">
                            {formatChatTime(chat.timestamp)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate">{chat.lastMessage || 'No messages'}</p>
                    </div>
                    {chat.unreadCount > 0 && (
                      <span className="w-5 h-5 rounded-full bg-green-500 text-white text-[10px] flex items-center justify-center flex-shrink-0">
                        {chat.unreadCount}
                      </span>
                    )}
                  </button>
                ))}
              </>
            )
          ) : leftTab === 'contacts' ? (
            loadingContacts ? (
              <SyncProgress label="Syncing contacts..." progress={contactProgress} />
            ) : filteredContacts.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                {searchQuery ? 'No matching contacts' : 'No contacts found'}
              </div>
            ) : (
              <>
                {fetchingContacts && !loadingContacts && (
                  <div className="px-4 py-1.5 bg-brand-50 text-brand-600 text-[10px] font-medium flex items-center gap-1.5">
                    <Loader2 size={10} className="animate-spin" /> Refreshing contacts...
                  </div>
                )}
                {filteredContacts.map((contact: any) => (
                  <button key={contact.id}
                    onClick={() => handleContactClick(contact)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-50',
                      selectedChat === contact.id && 'bg-brand-50 hover:bg-brand-50'
                    )}>
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
                ))}
              </>
            )
          ) : (
            /* HRMS Contacts (from DB messages) */
            loadingHrms ? (
              <SyncProgress label="Loading HRMS messages..." progress={50} />
            ) : hrmsContacts.length === 0 ? (
              <div className="text-center py-12 px-4">
                <MessageCircle size={32} className="mx-auto text-gray-200 mb-2" />
                <p className="text-gray-400 text-sm">No HRMS messages yet</p>
                <p className="text-gray-300 text-xs mt-1">Messages sent to candidates will appear here</p>
              </div>
            ) : (
              hrmsContacts
                .filter(c => !searchQuery || c.phone.includes(searchQuery))
                .map((contact) => (
                  <button key={contact.phone}
                    onClick={() => {
                      const chatId = findChatIdForPhone(contact.phone);
                      if (chatId) {
                        setSelectedChat(chatId);
                        setHrmsPhone(null);
                        setShowNewChat(false);
                      } else {
                        setHrmsPhone(contact.phone);
                        setSelectedChat(null);
                        setShowNewChat(false);
                      }
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-50',
                      hrmsPhone === contact.phone && 'bg-brand-50 hover:bg-brand-50'
                    )}>
                    <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                      <MessageCircle size={16} className="text-brand-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-gray-800">+{contact.phone}</p>
                        <span className="text-[10px] text-gray-400 flex-shrink-0">
                          {new Date(contact.lastDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 truncate">{contact.lastMessage}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-[10px] font-mono text-gray-400" data-mono>{contact.count} msg</span>
                      <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full font-medium',
                        contact.status === 'SENT' ? 'bg-emerald-50 text-emerald-600' :
                        contact.status === 'FAILED' ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-500'
                      )}>{contact.status}</span>
                    </div>
                  </button>
                ))
            )
          )}
        </div>
      </div>

      {/* Center: Chat View */}
      <div className={cn(
        'flex-1 flex flex-col min-w-0',
        !selectedChat && !showNewChat && !hrmsPhone && 'hidden lg:flex'
      )}>
        {showNewChat ? (
          <NewChatView onSent={(chatId) => { setSelectedChat(chatId); setShowNewChat(false); refetchChats(); }} onBack={() => setShowNewChat(false)} />
        ) : hrmsPhone ? (
          <HrmsMessageView phone={hrmsPhone} messages={hrmsMessagesRes} onBack={() => setHrmsPhone(null)} />
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

      {/* Right: Contact Info Panel */}
      <AnimatePresence>
        {showContactInfo && selectedChat && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="lg:hidden fixed inset-0 bg-black/30 z-40"
              onClick={() => setShowContactInfo(false)}
            />
            <motion.div
              initial={{ x: 300, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 300, opacity: 0 }}
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

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */
function formatChatTime(timestamp: string) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);

  if (diffDays === 0) {
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return date.toLocaleDateString('en-IN', { weekday: 'short' });
  }
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

/* ------------------------------------------------------------------ */
/*  Contact Info Panel                                                */
/* ------------------------------------------------------------------ */
function ContactInfoPanel({ chatId, chatName, onClose }: { chatId: string; chatName: string; onClose: () => void }) {
  const phoneNumber = chatId.replace('@c.us', '').replace('@g.us', '');
  const initials = chatName.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50/50">
        <h3 className="text-sm font-semibold text-gray-800">Contact Info</h3>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-200 transition-colors">
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
        <div className="px-4 py-4 border-b border-gray-100">
          <p className="text-xs text-gray-400 mb-1">Phone number</p>
          <div className="flex items-center gap-2">
            <Phone size={14} className="text-gray-400" />
            <span className="text-sm text-gray-700 font-mono">+{phoneNumber}</span>
          </div>
        </div>
        <div className="px-4 py-4">
          <a
            href={`/employees?search=${encodeURIComponent(phoneNumber)}`}
            className="flex items-center gap-2 px-4 py-2.5 bg-brand-50 text-brand-700 rounded-lg hover:bg-brand-100 transition-colors text-sm font-medium w-full justify-center"
          >
            <ExternalLink size={14} />
            View Employee Profile
          </a>
          <p className="text-[10px] text-gray-400 mt-2 text-center">Searches employees matching this phone number</p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Chat View                                                         */
/* ------------------------------------------------------------------ */
function ChatView({ chatId, chatName, onBack, onToggleContactInfo }: { chatId: string; chatName: string; onBack?: () => void; onToggleContactInfo?: () => void }) {
  const { data: messagesRes, isLoading, isFetching, isError, error, refetch } = useGetWhatsAppChatMessagesQuery(
    { chatId, limit: 50 },
    { pollingInterval: 10000 }
  );
  const [sendMessage] = useSendWhatsAppMessageMutation();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [msgProgress, setMsgProgress] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = messagesRes?.data || [];

  // Message loading progress
  useEffect(() => {
    if (!isLoading) { setMsgProgress(100); return; }
    setMsgProgress(0);
    const steps = [15, 35, 55, 72, 85, 93];
    let i = 0;
    const interval = setInterval(() => {
      if (i < steps.length) { setMsgProgress(steps[i]); i++; }
      else clearInterval(interval);
    }, 300);
    return () => clearInterval(interval);
  }, [isLoading]);

  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  useEffect(() => {
    const handleNewMessage = (data: any) => {
      if (data?.chatId === chatId || !data?.chatId) refetch();
    };
    onSocketEvent('whatsapp:message:new', handleNewMessage);
    onSocketEvent('whatsapp:message:status', handleNewMessage);
    return () => {
      offSocketEvent('whatsapp:message:new', handleNewMessage);
      offSocketEvent('whatsapp:message:status', handleNewMessage);
    };
  }, [chatId, refetch]);

  const handleSend = async () => {
    if (!input.trim()) return;
    setSending(true);
    try {
      const phone = chatId.replace('@c.us', '').replace('@g.us', '');
      await sendMessage({ to: phone, message: input.trim() }).unwrap();
      setInput('');
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to send');
    }
    setSending(false);
  };

  const renderTick = (ack: number) => {
    if (ack >= 3) return <CheckCheck size={14} className="text-blue-500" />;
    if (ack >= 2) return <CheckCheck size={14} className="text-gray-400" />;
    if (ack >= 1) return <Check size={14} className="text-gray-400" />;
    return null;
  };

  const renderMediaContent = (msg: any) => {
    if (!msg.hasMedia) return null;
    if (msg.type === 'image' || msg.type === 'sticker') {
      if (msg.mediaUrl) {
        return <div className="mb-1 rounded-lg overflow-hidden"><img src={msg.mediaUrl} alt="Image" className="max-w-full max-h-64 rounded-lg object-cover" loading="lazy" /></div>;
      }
      return <div className="mb-1 flex items-center gap-2 text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-2"><ImageIcon size={14} /><span>Image</span></div>;
    }
    if (msg.type === 'document') {
      return (
        <div className="mb-1">
          {msg.mediaUrl ? (
            <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs bg-gray-100 rounded-lg px-3 py-2 hover:bg-gray-200 transition-colors">
              <FileText size={14} className="text-brand-600 flex-shrink-0" />
              <span className="truncate text-gray-700">{msg.mediaFilename || 'Document'}</span>
            </a>
          ) : (
            <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-2"><FileText size={14} /><span>{msg.mediaFilename || 'Document'}</span></div>
          )}
        </div>
      );
    }
    if (msg.type === 'audio' || msg.type === 'ptt') {
      if (msg.mediaUrl) {
        return <div className="mb-1"><audio controls preload="none" className="max-w-full h-10"><source src={msg.mediaUrl} /></audio></div>;
      }
      return <div className="mb-1 flex items-center gap-2 text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-2"><Play size={14} /><span>Voice message</span></div>;
    }
    if (msg.type === 'video') {
      return <div className="mb-1 flex items-center gap-2 text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-2"><Play size={14} /><span>Video</span></div>;
    }
    return null;
  };

  return (
    <>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3 bg-gray-50/50">
        {onBack && (
          <button onClick={onBack} className="lg:hidden p-1 rounded-lg hover:bg-gray-200 transition-colors">
            <ArrowLeft size={18} className="text-gray-600" />
          </button>
        )}
        <button onClick={onToggleContactInfo} className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80 transition-opacity cursor-pointer">
          <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
            <User size={16} className="text-green-700" />
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sm font-semibold text-gray-800 truncate">{chatName}</p>
            <p className="text-xs text-gray-400 truncate">{chatId.replace('@c.us', '').replace('@g.us', '')}</p>
          </div>
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => refetch()} className="p-2 rounded-lg hover:bg-gray-200 transition-colors" title="Refresh messages">
            <RefreshCw size={16} className={cn('text-gray-500', isFetching && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-2 bg-[#efeae2]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'200\' height=\'200\' viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M100 0l100 200H0z\' fill=\'%23d4cfc4\' fill-opacity=\'0.05\'/%3E%3C/svg%3E")' }}>
        {isLoading ? (
          <SyncProgress label="Loading messages..." progress={msgProgress} />
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle size={32} className="text-red-300 mb-3" />
            <p className="text-sm text-red-500 font-medium mb-1">Failed to load messages</p>
            <p className="text-xs text-gray-400 mb-3 max-w-xs">
              {(error as any)?.data?.error?.message || 'WhatsApp may be disconnected or the chat is unavailable'}
            </p>
            <button onClick={() => refetch()} className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1">
              <RefreshCw size={12} /> Try again
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">No messages yet — send a message below</div>
        ) : (
          messages.map((msg: any) => (
            <div key={msg.id} className={cn('flex', msg.fromMe ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[85%] sm:max-w-[75%] md:max-w-[65%] px-3 py-2 rounded-xl text-sm shadow-sm overflow-hidden',
                msg.fromMe ? 'bg-[#dcf8c6] text-gray-800 rounded-tr-none' : 'bg-white text-gray-800 rounded-tl-none'
              )}>
                {renderMediaContent(msg)}
                {msg.body && <p className="whitespace-pre-wrap break-words" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{msg.body}</p>}
                <div className="flex items-center justify-end gap-1 mt-1">
                  <span className="text-[10px] text-gray-400 whitespace-nowrap">
                    {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                  {msg.fromMe && renderTick(msg.ack)}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-200 flex items-center gap-3 bg-gray-50/50">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="Type a message..."
          className="flex-1 text-sm bg-white border border-gray-200 rounded-full px-4 py-2.5 focus:outline-none focus:ring-1 focus:ring-green-300"
        />
        <button onClick={handleSend} disabled={sending || !input.trim()}
          className="w-10 h-10 rounded-full bg-green-500 text-white flex items-center justify-center hover:bg-green-600 transition-colors disabled:opacity-50">
          {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  New Chat View                                                     */
/* ------------------------------------------------------------------ */
function NewChatView({ onSent, onBack }: { onSent: (chatId: string) => void; onBack: () => void }) {
  const prefillMsg = sessionStorage.getItem('whatsapp_prefill_message') || '';
  const prefillPhone = sessionStorage.getItem('whatsapp_prefill_phone') || '';
  const [phone, setPhone] = useState(prefillPhone);
  const [message, setMessage] = useState(prefillMsg);

  useEffect(() => {
    sessionStorage.removeItem('whatsapp_prefill_message');
    sessionStorage.removeItem('whatsapp_prefill_phone');
  }, []);
  const [sendToNumber, { isLoading }] = useSendWhatsAppToNumberMutation();

  const handleSend = async () => {
    if (!phone.trim() || !message.trim()) return;
    try {
      const res = await sendToNumber({ phone: phone.trim(), message: message.trim() }).unwrap();
      toast.success('Message sent!');
      if (res.data?.chatId) onSent(res.data.chatId);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to send');
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50/50 flex items-center gap-3">
        <button onClick={onBack} className="lg:hidden p-1 rounded-lg hover:bg-gray-200 transition-colors">
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
              <input value={phone} onChange={e => setPhone(e.target.value)}
                placeholder="919876543210" className="input-glass w-full pl-10 text-sm" />
            </div>
            <p className="text-xs text-gray-400 mt-1">Include country code (91 for India)</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
            <textarea value={message} onChange={e => setMessage(e.target.value)}
              placeholder="Type your message..." rows={4}
              className="input-glass w-full text-sm resize-none" />
          </div>
          <button onClick={handleSend} disabled={isLoading || !phone || !message}
            className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            Send Message
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  HRMS Message View                                                 */
/* ------------------------------------------------------------------ */
function HrmsMessageView({ phone, messages, onBack }: { phone: string; messages: any; onBack: () => void }) {
  const raw = messages?.data;
  const allMsgs = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
  const cleanPhone = phone.replace(/\D/g, '');
  const filtered = allMsgs
    .filter((m: any) => {
      const msgPhone = (m.to || '').replace(/\D/g, '');
      return msgPhone.includes(cleanPhone) || cleanPhone.includes(msgPhone);
    })
    .sort((a: any, b: any) => new Date(a.sentAt || a.createdAt).getTime() - new Date(b.sentAt || b.createdAt).getTime());

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center gap-3">
        <button onClick={onBack} className="p-1 rounded hover:bg-gray-200">
          <ArrowLeft size={18} className="text-gray-600" />
        </button>
        <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center">
          <MessageCircle size={18} className="text-brand-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-800">+{phone}</p>
          <p className="text-xs text-gray-400">HRMS Messages · {filtered.length} messages</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-[#f0f2f5]">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">No messages found for this number</div>
        ) : (
          filtered.map((msg: any, i: number) => (
            <div key={msg.id || i} className="flex justify-end">
              <div className="max-w-[75%] bg-[#d9fdd3] rounded-xl rounded-tr-sm px-3 py-2 shadow-sm">
                <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{msg.message}</p>
                <div className="flex items-center justify-end gap-1.5 mt-1">
                  <span className="text-[10px] text-gray-500">
                    {new Date(msg.sentAt || msg.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {msg.status === 'SENT' ? <CheckCheck size={12} className="text-blue-500" /> : msg.status === 'FAILED' ? <X size={12} className="text-red-500" /> : <Check size={12} className="text-gray-400" />}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
