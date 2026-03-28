import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Send, Phone, Video, MessageCircle, Loader2, WifiOff, Plus, User, Check, CheckCheck, ArrowLeft, X, ExternalLink, FileText, Play, Image as ImageIcon, PhoneOff, Mic, MicOff, Volume2 } from 'lucide-react';
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

function WhatsAppChat() {
  // Auto-open New Chat if there's a prefill message from Share Job
  const hasPrefill = !!sessionStorage.getItem('whatsapp_prefill_message');
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewChat, setShowNewChat] = useState(hasPrefill);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [leftTab, setLeftTab] = useState<'chats' | 'contacts' | 'hrms'>('chats');
  const [hrmsPhone, setHrmsPhone] = useState<string | null>(null);

  const { data: chatsRes, isLoading: loadingChats, refetch: refetchChats } = useGetWhatsAppChatsQuery(undefined, { pollingInterval: 15000 });
  const { data: contactsRes, isLoading: loadingContacts } = useGetWhatsAppContactsQuery();
  const { data: hrmsMessagesRes, isLoading: loadingHrms } = useGetWhatsAppMessagesQuery({ page: 1, limit: 100 });
  const phoneContacts = contactsRes?.data || [];
  const chats = chatsRes?.data || [];

  // Build HRMS contacts from DB messages (grouped by phone)
  const hrmsContacts = useMemo(() => {
    const msgs = hrmsMessagesRes?.data || hrmsMessagesRes?.data?.data || [];
    if (!Array.isArray(msgs)) return [];
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

  const selectedChatData = chats.find((c: any) => c.id === selectedChat);

  // Close contact info when chat changes
  useEffect(() => {
    setShowContactInfo(false);
  }, [selectedChat]);

  return (
    <div className="h-[calc(100vh-80px)] flex rounded-2xl overflow-hidden border border-gray-200 bg-white shadow-sm relative">
      {/* Left: Chat List */}
      <div className={cn(
        'w-full lg:w-80 border-r border-gray-200 flex flex-col flex-shrink-0',
        (selectedChat || showNewChat) && 'hidden lg:flex'
      )}>
        {/* Header with tabs */}
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex bg-gray-100 rounded-lg p-0.5 flex-1">
              <button onClick={() => setLeftTab('chats')}
                className={cn('flex-1 text-xs font-medium py-1.5 rounded-md transition-all',
                  leftTab === 'chats' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                Chats
              </button>
              <button onClick={() => setLeftTab('contacts')}
                className={cn('flex-1 text-xs font-medium py-1.5 rounded-md transition-all',
                  leftTab === 'contacts' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                Contacts
              </button>
              <button onClick={() => setLeftTab('hrms')}
                className={cn('flex-1 text-xs font-medium py-1.5 rounded-md transition-all',
                  leftTab === 'hrms' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                HRMS{hrmsContacts.length > 0 && ` (${hrmsContacts.length})`}
              </button>
            </div>
            <button onClick={() => { setShowNewChat(true); setSelectedChat(null); }}
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
            /* Phone Chats */
            loadingChats ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-brand-600" size={24} />
              </div>
            ) : filteredChats.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                {searchQuery ? 'No matching chats' : 'No chats yet'}
              </div>
            ) : (
              filteredChats.map((chat: any) => (
                <button key={chat.id} onClick={() => { setSelectedChat(chat.id); setShowNewChat(false); setLeftTab('chats'); }}
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
                          {new Date(chat.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
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
              ))
            )
          ) : leftTab === 'contacts' ? (
            /* Phone Contacts */
            loadingContacts ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-brand-600" size={24} />
              </div>
            ) : phoneContacts.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">No contacts found</div>
            ) : (
              phoneContacts
                .filter((c: any) => !searchQuery || c.name?.toLowerCase().includes(searchQuery.toLowerCase()) || c.number?.includes(searchQuery))
                .map((contact: any) => (
                  <button key={contact.id}
                    onClick={() => {
                      const phone = contact.number || contact.id?.replace('@c.us', '');
                      if (phone) {
                        sessionStorage.setItem('whatsapp_prefill_phone', phone);
                        setShowNewChat(true);
                        setSelectedChat(null);
                      }
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-50">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <User size={18} className="text-blue-700" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{contact.name}</p>
                      <p className="text-xs text-gray-400">{contact.number ? `+${contact.number}` : ''}</p>
                    </div>
                    {contact.isMyContact && (
                      <span className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">Saved</span>
                    )}
                  </button>
                ))
            )
          ) : (
            /* HRMS Contacts (from DB messages) */
            loadingHrms ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-brand-600" size={24} />
              </div>
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
                      setHrmsPhone(contact.phone);
                      setSelectedChat(null);
                      setShowNewChat(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-50">
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
          <NewChatView onSent={(chatId) => { setSelectedChat(chatId); setShowNewChat(false); refetchChats(); }} />
        ) : hrmsPhone ? (
          <HrmsMessageView phone={hrmsPhone} messages={hrmsMessagesRes} onBack={() => setHrmsPhone(null)} />
        ) : selectedChat ? (
          <ChatView
            chatId={selectedChat}
            chatName={selectedChatData?.name || 'Chat'}
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
            {/* Mobile overlay backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="lg:hidden fixed inset-0 bg-black/30 z-40"
              onClick={() => setShowContactInfo(false)}
            />
            {/* Panel */}
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

function ContactInfoPanel({ chatId, chatName, onClose }: { chatId: string; chatName: string; onClose: () => void }) {
  const phoneNumber = chatId.replace('@c.us', '').replace('@g.us', '');
  const initials = chatName
    .split(' ')
    .map(w => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50/50">
        <h3 className="text-sm font-semibold text-gray-800">Contact Info</h3>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-200 transition-colors">
          <X size={18} className="text-gray-500" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Avatar */}
        <div className="flex flex-col items-center py-8 border-b border-gray-100">
          <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center mb-4">
            <span className="text-2xl font-bold text-green-700">{initials}</span>
          </div>
          <h4 className="text-base font-semibold text-gray-800">{chatName}</h4>
        </div>

        {/* Phone */}
        <div className="px-4 py-4 border-b border-gray-100">
          <p className="text-xs text-gray-400 mb-1">Phone number</p>
          <div className="flex items-center gap-2">
            <Phone size={14} className="text-gray-400" />
            <span className="text-sm text-gray-700 font-mono">+{phoneNumber}</span>
          </div>
        </div>

        {/* View Employee Profile link */}
        <div className="px-4 py-4">
          <a
            href={`/employees?search=${encodeURIComponent(phoneNumber)}`}
            className="flex items-center gap-2 px-4 py-2.5 bg-brand-50 text-brand-700 rounded-lg hover:bg-brand-100 transition-colors text-sm font-medium w-full justify-center"
          >
            <ExternalLink size={14} />
            View Employee Profile
          </a>
          <p className="text-[10px] text-gray-400 mt-2 text-center">
            Searches employees matching this phone number
          </p>
        </div>
      </div>
    </div>
  );
}

function ChatView({ chatId, chatName, onBack, onToggleContactInfo }: { chatId: string; chatName: string; onBack?: () => void; onToggleContactInfo?: () => void }) {
  const { data: messagesRes, isLoading, refetch } = useGetWhatsAppChatMessagesQuery(
    { chatId, limit: 50 },
    { pollingInterval: 5000 }
  );
  const [sendMessage] = useSendWhatsAppMessageMutation();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [callState, setCallState] = useState<null | { type: 'voice' | 'video'; status: 'ringing' | 'active' | 'ended' }>(null);
  const [muted, setMuted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = messagesRes?.data || [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async () => {
    if (!input.trim()) return;
    setSending(true);
    try {
      // Extract phone number from chatId (format: "919876543210@c.us")
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
        return (
          <div className="mb-1 rounded-lg overflow-hidden">
            <img src={msg.mediaUrl} alt="Image" className="max-w-full max-h-64 rounded-lg object-cover" loading="lazy" />
          </div>
        );
      }
      return (
        <div className="mb-1 flex items-center gap-2 text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-2">
          <ImageIcon size={14} />
          <span>Image</span>
        </div>
      );
    }

    if (msg.type === 'document') {
      return (
        <div className="mb-1">
          {msg.mediaUrl ? (
            <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs bg-gray-100 rounded-lg px-3 py-2 hover:bg-gray-200 transition-colors">
              <FileText size={14} className="text-brand-600 flex-shrink-0" />
              <span className="truncate text-gray-700">{msg.mediaFilename || 'Document'}</span>
            </a>
          ) : (
            <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-2">
              <FileText size={14} />
              <span>{msg.mediaFilename || 'Document'}</span>
            </div>
          )}
        </div>
      );
    }

    if (msg.type === 'audio' || msg.type === 'ptt') {
      if (msg.mediaUrl) {
        return (
          <div className="mb-1">
            <audio controls preload="none" className="max-w-full h-10">
              <source src={msg.mediaUrl} />
              Your browser does not support audio.
            </audio>
          </div>
        );
      }
      return (
        <div className="mb-1 flex items-center gap-2 text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-2">
          <Play size={14} />
          <span>Voice message</span>
        </div>
      );
    }

    if (msg.type === 'video') {
      return (
        <div className="mb-1 flex items-center gap-2 text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-2">
          <Play size={14} />
          <span>Video</span>
        </div>
      );
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
        <button
          onClick={onToggleContactInfo}
          className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80 transition-opacity cursor-pointer"
        >
          <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
            <User size={16} className="text-green-700" />
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sm font-semibold text-gray-800 truncate">{chatName}</p>
            <p className="text-xs text-gray-400 truncate">{chatId.replace('@c.us', '').replace('@g.us', '')}</p>
          </div>
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => setCallState({ type: 'video', status: 'ringing' })}
            className="p-2 rounded-lg hover:bg-gray-200 transition-colors" title="Video call">
            <Video size={18} className="text-gray-500" />
          </button>
          <button onClick={() => setCallState({ type: 'voice', status: 'ringing' })}
            className="p-2 rounded-lg hover:bg-gray-200 transition-colors" title="Voice call">
            <Phone size={18} className="text-gray-500" />
          </button>
        </div>
      </div>

      {/* Call Overlay */}
      <AnimatePresence>
        {callState && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-gradient-to-b from-gray-900 to-gray-800 flex flex-col items-center justify-center text-white"
          >
            <div className="w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center mb-6">
              <User size={40} className="text-green-400" />
            </div>
            <h3 className="text-xl font-semibold mb-1">{chatName}</h3>
            <p className="text-sm text-gray-400 mb-2">{chatId.replace('@c.us', '').replace('@g.us', '')}</p>
            <p className="text-sm text-gray-300 mb-8">
              {callState.status === 'ringing' ? (callState.type === 'voice' ? 'Voice calling...' : 'Video calling...') : 'Call in progress'}
            </p>
            <p className="text-xs text-amber-400 bg-amber-400/10 rounded-lg px-4 py-2 mb-8">
              Calls require WhatsApp on phone — use your phone to accept/make calls
            </p>
            <div className="flex items-center gap-8">
              <button onClick={() => setMuted(!muted)}
                className={cn('w-14 h-14 rounded-full flex items-center justify-center transition-colors', muted ? 'bg-red-500' : 'bg-gray-600 hover:bg-gray-500')}>
                {muted ? <MicOff size={22} /> : <Mic size={22} />}
              </button>
              <button onClick={() => setCallState(null)}
                className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors">
                <PhoneOff size={24} />
              </button>
              <button className="w-14 h-14 rounded-full bg-gray-600 hover:bg-gray-500 flex items-center justify-center transition-colors">
                <Volume2 size={22} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-2 bg-[#efeae2]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'200\' height=\'200\' viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M100 0l100 200H0z\' fill=\'%23d4cfc4\' fill-opacity=\'0.05\'/%3E%3C/svg%3E")' }}>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-gray-400" size={24} />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">No messages yet</div>
        ) : (
          messages.map((msg: any) => (
            <div key={msg.id} className={cn('flex', msg.fromMe ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[85%] sm:max-w-[75%] md:max-w-[65%] px-3 py-2 rounded-xl text-sm shadow-sm overflow-hidden',
                msg.fromMe
                  ? 'bg-[#dcf8c6] text-gray-800 rounded-tr-none'
                  : 'bg-white text-gray-800 rounded-tl-none'
              )}>
                {renderMediaContent(msg)}
                {msg.body && (
                  <p className="whitespace-pre-wrap break-words overflow-wrap-anywhere" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{msg.body}</p>
                )}
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

function NewChatView({ onSent }: { onSent: (chatId: string) => void }) {
  // Check for pre-filled message from Share Job flow
  const prefillMsg = sessionStorage.getItem('whatsapp_prefill_message') || '';
  const prefillPhone = sessionStorage.getItem('whatsapp_prefill_phone') || '';
  const [phone, setPhone] = useState(prefillPhone);
  const [message, setMessage] = useState(prefillMsg);

  // Clear prefill after reading
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
      if (res.data?.chatId) {
        onSent(res.data.chatId);
      }
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to send');
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50/50">
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

// ---------- HRMS Message View ----------
function HrmsMessageView({ phone, messages, onBack }: { phone: string; messages: any; onBack: () => void }) {
  const allMsgs = messages?.data || [];
  const filtered = (Array.isArray(allMsgs) ? allMsgs : [])
    .filter((m: any) => m.to?.includes(phone.replace(/\D/g, '')))
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
          <div className="text-center py-12 text-gray-400 text-sm">No messages found</div>
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
