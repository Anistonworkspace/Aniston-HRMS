import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X, Send, Loader2, Trash2 } from 'lucide-react';
import { useAiChatMutation, useAiClearHistoryMutation } from './aiAssistantApi';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface AiAssistantPanelProps {
  context: 'admin' | 'hr-recruitment' | 'hr-general';
  label?: string;
}

export default function AiAssistantFab({ context, label }: AiAssistantPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* FAB button */}
      <button onClick={() => setOpen(!open)}
        className="fixed bottom-24 right-6 z-40 w-14 h-14 rounded-full shadow-lg transition-all flex items-center justify-center group"
        style={{ background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' }}
        title="AI Assistant">
        <Sparkles size={22} className="group-hover:scale-110 transition-transform" />
      </button>

      {/* Panel */}
      <AnimatePresence>
        {open && (
          <AiAssistantPanel context={context} label={label || 'AI Assistant'} onClose={() => setOpen(false)} />
        )}
      </AnimatePresence>
    </>
  );
}

function AiAssistantPanel({ context, label, onClose }: AiAssistantPanelProps & { onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [chat, { isLoading }] = useAiChatMutation();
  const [clearHistory] = useAiClearHistoryMutation();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async (msg?: string) => {
    const text = msg || input.trim();
    if (!text) return;
    setInput('');

    const userMsg: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);

    try {
      const res = await chat({ message: text, context }).unwrap();
      const aiMsg: Message = { role: 'assistant', content: res.data.reply };
      setMessages(prev => [...prev, aiMsg]);
      setSuggestions(res.data.suggestions || []);
    } catch (err: any) {
      const errMsg: Message = { role: 'assistant', content: 'Sorry, I encountered an error. Please check your AI configuration in Settings.' };
      setMessages(prev => [...prev, errMsg]);
    }
  };

  const handleClear = async () => {
    try {
      await clearHistory({ context }).unwrap();
      setMessages([]);
      setSuggestions([]);
      toast.success('Conversation cleared');
    } catch {
      toast.error('Failed to clear');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className="fixed bottom-44 right-6 z-[45] w-[420px] max-h-[600px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={18} style={{ color: 'var(--primary-color)' }} />
          <span className="text-sm font-semibold text-gray-800">{label}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleClear} className="p-1.5 rounded-lg hover:bg-white/60 transition-colors" title="Clear conversation">
            <Trash2 size={14} className="text-gray-500" />
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/60 transition-colors">
            <X size={16} className="text-gray-500" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[300px] max-h-[420px]">
        {messages.length === 0 ? (
          <div className="text-center py-8">
            <Sparkles size={32} className="mx-auto mb-3" style={{ color: 'var(--primary-color)', opacity: 0.5 }} />
            <p className="text-sm text-gray-500 mb-4">Ask me anything about your HRMS</p>
            <div className="space-y-2">
              {(context === 'admin' ? [
                'How many employees joined this month?',
                'Which departments have pending leaves?',
                'Show me system status overview',
              ] : context === 'hr-recruitment' ? [
                'How many candidates are in interview stage?',
                'Summary of today\'s interviews',
                'Average AI score for applications',
              ] : [
                'Today\'s attendance summary',
                'Employees with low leave balance',
                'Upcoming holidays',
              ]).map((q, i) => (
                <button key={i} onClick={() => handleSend(q)}
                  className="w-full text-left text-xs px-3 py-2 bg-gray-50 rounded-lg text-gray-600 transition-colors">
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[85%] px-3 py-2 rounded-xl text-sm',
                msg.role === 'user'
                  ? 'rounded-tr-none'
                  : 'bg-gray-100 text-gray-800 rounded-tl-none'
              )}
              style={msg.role === 'user' ? { background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' } : undefined}>
                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
              </div>
            </div>
          ))
        )}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-xl px-4 py-2 rounded-tl-none">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {/* Suggestion chips */}
        {suggestions.length > 0 && !isLoading && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {suggestions.map((s, i) => (
              <button key={i} onClick={() => handleSend(s)}
                className="text-xs px-2.5 py-1 rounded-full transition-colors"
                style={{ background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' }}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="Ask something..."
          disabled={isLoading}
          className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded-full px-4 py-2 focus:outline-none"
        />
        <button onClick={() => handleSend()} disabled={isLoading || !input.trim()}
          className="w-9 h-9 rounded-full flex items-center justify-center transition-colors disabled:opacity-50"
          style={{ background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' }}>
          {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </motion.div>
  );
}
