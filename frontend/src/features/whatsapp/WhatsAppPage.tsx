import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Search, Send, Phone, MessageCircle, Loader2, WifiOff, Plus, User, Check, CheckCheck } from 'lucide-react';
import {
  useGetWhatsAppStatusQuery,
  useGetWhatsAppChatsQuery,
  useGetWhatsAppChatMessagesQuery,
  useSendWhatsAppMessageMutation,
  useSendWhatsAppToNumberMutation,
} from './whatsappApi';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

export default function WhatsAppPage() {
  const { data: statusRes } = useGetWhatsAppStatusQuery(undefined, { pollingInterval: 10000 });
  const isConnected = statusRes?.data?.isConnected;

  if (!isConnected) {
    return (
      <div className="page-container">
        <div className="flex flex-col items-center justify-center py-20">
          <WifiOff size={48} className="text-gray-300 mb-4" />
          <h2 className="text-lg font-semibold text-gray-700 mb-2">WhatsApp Not Connected</h2>
          <p className="text-sm text-gray-500 mb-4">Go to Settings &rarr; WhatsApp to connect your WhatsApp account.</p>
          <a href="/settings" className="btn-primary text-sm">Open Settings</a>
        </div>
      </div>
    );
  }

  return <WhatsAppChat />;
}

function WhatsAppChat() {
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);

  const { data: chatsRes, isLoading: loadingChats, refetch: refetchChats } = useGetWhatsAppChatsQuery(undefined, { pollingInterval: 15000 });
  const chats = chatsRes?.data || [];

  const filteredChats = chats.filter((c: any) =>
    c.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="h-[calc(100vh-80px)] flex rounded-2xl overflow-hidden border border-gray-200 bg-white shadow-sm">
      {/* Left: Chat List */}
      <div className="w-80 border-r border-gray-200 flex flex-col flex-shrink-0">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-800">Chats</h2>
            <button onClick={() => setShowNewChat(true)}
              className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors" title="New Chat">
              <Plus size={18} className="text-gray-600" />
            </button>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search chats..." className="w-full text-xs bg-white border border-gray-200 rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-300" />
          </div>
        </div>

        {/* Chat list */}
        <div className="flex-1 overflow-y-auto">
          {loadingChats ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-brand-600" size={24} />
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              {searchQuery ? 'No matching chats' : 'No chats yet'}
            </div>
          ) : (
            filteredChats.map((chat: any) => (
              <button key={chat.id} onClick={() => { setSelectedChat(chat.id); setShowNewChat(false); }}
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
          )}
        </div>
      </div>

      {/* Right: Chat View */}
      <div className="flex-1 flex flex-col">
        {showNewChat ? (
          <NewChatView onSent={(chatId) => { setSelectedChat(chatId); setShowNewChat(false); refetchChats(); }} />
        ) : selectedChat ? (
          <ChatView chatId={selectedChat} chatName={chats.find((c: any) => c.id === selectedChat)?.name || 'Chat'} />
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
    </div>
  );
}

function ChatView({ chatId, chatName }: { chatId: string; chatName: string }) {
  const { data: messagesRes, isLoading, refetch } = useGetWhatsAppChatMessagesQuery(
    { chatId, limit: 50 },
    { pollingInterval: 5000 }
  );
  const [sendMessage] = useSendWhatsAppMessageMutation();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
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

  return (
    <>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3 bg-gray-50/50">
        <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center">
          <User size={16} className="text-green-700" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-800">{chatName}</p>
          <p className="text-xs text-gray-400">{chatId.replace('@c.us', '').replace('@g.us', '')}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2 bg-[#efeae2]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'200\' height=\'200\' viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M100 0l100 200H0z\' fill=\'%23d4cfc4\' fill-opacity=\'0.05\'/%3E%3C/svg%3E")' }}>
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
                'max-w-[65%] px-3 py-2 rounded-xl text-sm shadow-sm',
                msg.fromMe
                  ? 'bg-[#dcf8c6] text-gray-800 rounded-tr-none'
                  : 'bg-white text-gray-800 rounded-tl-none'
              )}>
                <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                <div className="flex items-center justify-end gap-1 mt-1">
                  <span className="text-[10px] text-gray-400">
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
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
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
