import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HelpCircle, Plus, X, MessageCircle, Clock, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '../../app/api';
import { cn, formatDate } from '../../lib/utils';
import toast from 'react-hot-toast';

const helpdeskApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getMyTickets: builder.query<any, void>({ query: () => '/helpdesk/my' }),
    createTicket: builder.mutation<any, any>({
      query: (body) => ({ url: '/helpdesk', method: 'POST', body }),
    }),
    getTicketDetail: builder.query<any, string>({ query: (id) => `/helpdesk/${id}` }),
    addComment: builder.mutation<any, { id: string; content: string }>({
      query: ({ id, content }) => ({ url: `/helpdesk/${id}/comment`, method: 'POST', body: { content } }),
    }),
  }),
});

const { useGetMyTicketsQuery, useCreateTicketMutation, useGetTicketDetailQuery, useAddCommentMutation } = helpdeskApi;

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; class: string }> = {
  OPEN: { icon: <Clock size={14} />, class: 'badge-warning' },
  IN_PROGRESS: { icon: <AlertTriangle size={14} />, class: 'badge-info' },
  RESOLVED: { icon: <CheckCircle size={14} />, class: 'badge-success' },
  CLOSED: { icon: <CheckCircle size={14} />, class: 'badge-neutral' },
};

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'text-gray-400', MEDIUM: 'text-blue-500', HIGH: 'text-amber-500', URGENT: 'text-red-500',
};

export default function HelpdeskPage() {
  const [showCreate, setShowCreate] = useState(false);
  const { data: res, refetch } = useGetMyTicketsQuery();
  const tickets = res?.data || [];

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Helpdesk</h1>
          <p className="text-gray-500 text-sm mt-0.5">Raise and track support tickets</p>
        </div>
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
          <Plus size={18} /> Raise Ticket
        </motion.button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].map((status) => {
          const count = tickets.filter((t: any) => t.status === status).length;
          return (
            <div key={status} className="stat-card text-center">
              <p className="text-lg font-bold font-mono text-gray-900" data-mono>{count}</p>
              <p className="text-xs text-gray-500">{status.replace('_', ' ')}</p>
            </div>
          );
        })}
      </div>

      {/* Tickets list */}
      {tickets.length === 0 ? (
        <div className="layer-card p-16 text-center">
          <HelpCircle size={48} className="mx-auto text-gray-200 mb-4" />
          <h3 className="text-lg font-display font-semibold text-gray-600">No tickets</h3>
          <p className="text-sm text-gray-400 mt-1">Need help? Raise a ticket and our team will assist you.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket: any, i: number) => (
            <motion.div key={ticket.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }} className="layer-card p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-gray-400" data-mono>{ticket.ticketCode}</span>
                    <span className={cn('badge text-xs', STATUS_CONFIG[ticket.status]?.class || 'badge-neutral')}>
                      {ticket.status.replace('_', ' ')}
                    </span>
                    <span className={cn('text-xs font-medium', PRIORITY_COLORS[ticket.priority])}>
                      {ticket.priority}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-gray-800">{ticket.subject}</h3>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-1">{ticket.description}</p>
                </div>
                <div className="text-right flex-shrink-0 ml-4">
                  <p className="text-xs text-gray-400">{formatDate(ticket.createdAt)}</p>
                  <p className="text-xs text-gray-400 flex items-center gap-1 justify-end mt-1">
                    <MessageCircle size={12} /> {ticket._count?.comments || 0}
                  </p>
                </div>
              </div>
              {ticket.resolution && (
                <div className="mt-3 pt-3 border-t border-gray-50">
                  <p className="text-xs text-emerald-600">Resolution: {ticket.resolution}</p>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showCreate && <CreateTicketModal onClose={() => { setShowCreate(false); refetch(); }} />}
      </AnimatePresence>
    </div>
  );
}

function CreateTicketModal({ onClose }: { onClose: () => void }) {
  const [createTicket, { isLoading }] = useCreateTicketMutation();
  const [form, setForm] = useState({ category: 'IT', subject: '', description: '', priority: 'MEDIUM' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await createTicket(form).unwrap();
      toast.success(result.message || 'Ticket created!');
      onClose();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-glass-lg w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-display font-semibold text-gray-800">Raise a Ticket</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Category</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input-glass w-full">
                <option value="IT">IT Support</option><option value="HR">HR</option>
                <option value="FINANCE">Finance</option><option value="ADMIN">Admin</option>
                <option value="PAYROLL">Payroll</option><option value="LEAVE">Leave</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Priority</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="input-glass w-full">
                <option value="LOW">Low</option><option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option><option value="URGENT">Urgent</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Subject</label>
            <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}
              className="input-glass w-full" placeholder="Brief description of the issue" required minLength={3} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input-glass w-full h-24 resize-none" placeholder="Detailed explanation..." required minLength={10} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
              type="submit" disabled={isLoading} className="btn-primary flex-1 flex items-center justify-center gap-2">
              {isLoading && <Loader2 size={16} className="animate-spin" />} Submit Ticket
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
