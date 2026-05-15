import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, MessageCircle, Loader2, CheckCircle2, AlertCircle, Send, Phone,
  QrCode, Wifi, WifiOff, Briefcase, RefreshCw,
} from 'lucide-react';
import {
  useInitializeWhatsAppMutation, useGetWhatsAppStatusQuery, useGetWhatsAppQrQuery,
  useSendWhatsAppMessageMutation, useSendWhatsAppJobLinkMutation,
  useGetWhatsAppMessagesQuery, useLogoutWhatsAppMutation,
} from './whatsappApi';
import { useGetJobOpeningsQuery } from '../recruitment/recruitmentApi';
import toast from 'react-hot-toast';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'send' | 'job-link' | 'history';

export default function WhatsAppPanel({ isOpen, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('send');
  const { data: statusRes, refetch: refetchStatus } = useGetWhatsAppStatusQuery(undefined, { pollingInterval: 10000 });
  const { data: qrRes, refetch: refetchQr } = useGetWhatsAppQrQuery(undefined, { pollingInterval: 5000 });
  const [initialize, { isLoading: initializing }] = useInitializeWhatsAppMutation();
  const [logout] = useLogoutWhatsAppMutation();

  const status = statusRes?.data;
  const isConnected = status?.isConnected || false;
  const qrCode = qrRes?.data?.qrCode;

  const handleInit = async () => {
    try {
      await initialize().unwrap();
      toast.success('WhatsApp initializing... Scan QR code');
      refetchQr();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const handleLogout = async () => {
    try {
      await logout().unwrap();
      toast.success('WhatsApp disconnected');
      refetchStatus();
    } catch (err: any) { toast.error('Failed to disconnect'); }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex" onClick={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div initial={{ x: -400 }} animate={{ x: 0 }} exit={{ x: -400 }}
            transition={{ type: 'spring', damping: 25 }}
            className="w-[400px] h-full bg-white shadow-2xl border-r border-gray-200 flex flex-col overflow-hidden">

            {/* Header */}
            <div className="p-4 border-b border-gray-100 bg-emerald-600 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageCircle size={20} />
                  <span className="font-display font-semibold">WhatsApp Business</span>
                </div>
                <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-lg">
                  <X size={18} />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-2 text-sm text-emerald-100">
                {isConnected ? (
                  <><Wifi size={14} /> Connected: +{status?.phoneNumber || '...'}</>
                ) : (
                  <><WifiOff size={14} /> Not connected</>
                )}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {!isConnected ? (
                // Not connected — show QR or init button
                <div className="text-center py-6">
                  {qrCode ? (
                    <div className="space-y-4">
                      <QrCode size={40} className="mx-auto text-gray-400" />
                      <p className="text-sm font-medium text-gray-700">Scan QR Code</p>
                      <p className="text-xs text-gray-400">Open WhatsApp on your phone → Settings → Linked Devices → Link a Device</p>
                      <img src={qrCode} alt="QR Code" className="mx-auto w-56 h-56 rounded-xl border border-gray-200" />
                      <button onClick={() => { refetchQr(); toast.success('QR code refreshed'); }} className="text-xs hover:underline flex items-center gap-1 mx-auto" style={{ color: 'var(--primary-color)' }}>
                        <RefreshCw size={12} /> Refresh QR
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <MessageCircle size={48} className="mx-auto text-gray-300" />
                      <p className="text-sm text-gray-500">Connect WhatsApp to send messages</p>
                      <button onClick={handleInit} disabled={initializing}
                        className="btn-primary flex items-center gap-2 mx-auto">
                        {initializing ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />}
                        {initializing ? 'Starting...' : 'Connect WhatsApp'}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                // Connected — show tabs
                <div>
                  <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-4">
                    {[
                      { key: 'send' as Tab, label: 'Message' },
                      { key: 'job-link' as Tab, label: 'Job Link' },
                      { key: 'history' as Tab, label: 'History' },
                    ].map(t => (
                      <button key={t.key} onClick={() => setTab(t.key)}
                        className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                          tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                        {t.label}
                      </button>
                    ))}
                  </div>

                  {tab === 'send' && <SendMessageForm />}
                  {tab === 'job-link' && <SendJobLinkForm />}
                  {tab === 'history' && <MessageHistory />}
                </div>
              )}
            </div>

            {/* Footer */}
            {isConnected && (
              <div className="p-3 border-t border-gray-100">
                <button onClick={handleLogout} className="text-xs text-red-500 hover:text-red-700 w-full text-center">
                  Disconnect WhatsApp
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SendMessageForm() {
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [sendMsg, { isLoading }] = useSendWhatsAppMessageMutation();

  const handleSend = async () => {
    if (!phone || !message) return;
    try {
      await sendMsg({ to: phone, message }).unwrap();
      toast.success('Message sent!');
      setPhone('');
      setMessage('');
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Phone Number</label>
        <div className="relative">
          <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={phone} onChange={e => setPhone(e.target.value)}
            placeholder="+91 98765 43210" className="input-glass w-full pl-9 text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Message</label>
        <textarea value={message} onChange={e => setMessage(e.target.value)}
          placeholder="Type your message..." className="input-glass w-full h-24 resize-none text-sm" />
      </div>
      <button onClick={handleSend} disabled={isLoading || !phone || !message}
        className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
        {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
      </button>
    </div>
  );
}

function SendJobLinkForm() {
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [candidateName, setCandidateName] = useState('');
  const [selectedJobId, setSelectedJobId] = useState('');
  const { data: jobsRes } = useGetJobOpeningsQuery({ page: 1, limit: 50 });
  const [sendJobLink, { isLoading }] = useSendWhatsAppJobLinkMutation();

  const jobs = jobsRes?.data || [];
  const selectedJob = jobs.find((j: any) => j.id === selectedJobId);

  const validatePhone = (value: string) => {
    const digits = value.replace(/[\s\-()]/g, '').replace(/^\+/, '');
    if (!digits) { setPhoneError('Phone number is required'); return false; }
    if (!/^[0-9]{7,15}$/.test(digits)) {
      setPhoneError('Enter a valid phone number with country code (e.g. 919876543210)');
      return false;
    }
    setPhoneError('');
    return true;
  };

  const handleSend = async () => {
    if (!validatePhone(phone) || !selectedJob) return;
    try {
      const jobUrl = `${window.location.origin}/jobs?apply=${selectedJob.id}`;
      await sendJobLink({ phone: phone.replace(/[\s\-()]/g, ''), candidateName: candidateName || undefined, jobTitle: selectedJob.title, jobUrl }).unwrap();
      toast.success('Job link sent!');
      setPhone('');
      setCandidateName('');
      setSelectedJobId('');
      setPhoneError('');
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to send job link'); }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Select Job</label>
        <select value={selectedJobId} onChange={e => setSelectedJobId(e.target.value)} className="input-glass w-full text-sm">
          <option value="">Choose job...</option>
          {jobs.map((j: any) => <option key={j.id} value={j.id}>{j.title} — {j.department} [{j.status}]</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Phone Number</label>
        <input value={phone} onChange={e => { setPhone(e.target.value); if (phoneError) validatePhone(e.target.value); }}
          placeholder="+91 98765 43210" className={`input-glass w-full text-sm ${phoneError ? 'border-red-300' : ''}`} />
        {phoneError && <p className="text-xs text-red-500 mt-0.5">{phoneError}</p>}
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Candidate Name (optional)</label>
        <input value={candidateName} onChange={e => setCandidateName(e.target.value)}
          placeholder="John Doe" className="input-glass w-full text-sm" />
      </div>

      {selectedJob && (
        <div className="bg-emerald-50 rounded-xl p-3 text-xs text-emerald-800 space-y-1">
          <p className="font-medium">Preview:</p>
          <p>Hi {candidateName || 'Candidate'}! We'd like you to apply for <strong>{selectedJob.title}</strong> at Aniston Technologies.</p>
          <p className="text-emerald-600">Please click the link to apply...</p>
        </div>
      )}

      <button onClick={handleSend} disabled={isLoading || !phone || !selectedJobId || !!phoneError}
        className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
        {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Briefcase size={14} />} Send Job Link
      </button>
    </div>
  );
}

function MessageHistory() {
  const { data: res, isLoading } = useGetWhatsAppMessagesQuery({ page: 1, limit: 30 });
  const messages = res?.data || [];

  if (isLoading) return <div className="py-8 text-center"><Loader2 size={20} className="animate-spin text-gray-300 mx-auto" /></div>;
  if (messages.length === 0) return <p className="text-sm text-gray-400 text-center py-8">No messages sent yet</p>;

  return (
    <div className="space-y-2">
      {messages.map((msg: any) => (
        <div key={msg.id} className="p-3 bg-gray-50 rounded-xl">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-mono text-gray-500" data-mono>{msg.to}</span>
            {msg.status === 'SENT' ? (
              <CheckCircle2 size={12} className="text-emerald-500" />
            ) : msg.status === 'FAILED' ? (
              <AlertCircle size={12} className="text-red-500" />
            ) : (
              <Loader2 size={12} className="animate-spin text-gray-400" />
            )}
          </div>
          <p className="text-xs text-gray-600 line-clamp-2">{msg.message}</p>
          <div className="flex items-center gap-2 mt-1">
            {msg.templateType && (
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' }}>{msg.templateType}</span>
            )}
            <span className="text-[10px] text-gray-400">
              {new Date(msg.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
