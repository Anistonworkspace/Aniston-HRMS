import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  HelpCircle, Plus, X, MessageCircle, CheckCircle, AlertTriangle,
  Loader2, Search, ChevronLeft, ChevronRight, Send, User, Users, ShieldCheck,
} from 'lucide-react';
import {
  useGetMyTicketsQuery, useGetAllTicketsQuery, useCreateTicketMutation,
  useGetTicketDetailQuery, useUpdateTicketMutation, useAddCommentMutation,
} from './helpdeskApi';
import { cn, formatDate, getInitials } from '../../lib/utils';
import { useAppSelector } from '../../app/store';
import { onSocketEvent, offSocketEvent } from '../../lib/socket';
import toast from 'react-hot-toast';
import { useEmpPerms } from '../../hooks/useEmpPerms';
import PermDenied from '../../components/PermDenied';

const MANAGEMENT_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];

const STATUS_CONFIG: Record<string, { class: string; label: string }> = {
  OPEN: { class: 'badge-warning', label: 'Open' },
  IN_PROGRESS: { class: 'badge-info', label: 'In Progress' },
  WAITING_ON_USER: { class: 'bg-orange-50 text-orange-600', label: 'Waiting' },
  RESOLVED: { class: 'badge-success', label: 'Resolved' },
  CLOSED: { class: 'badge-neutral', label: 'Closed' },
};

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'text-gray-400', MEDIUM: 'text-blue-500', HIGH: 'text-amber-500', URGENT: 'text-red-500',
};

const DEPT_CONFIG: Record<string, { class: string; label: string; icon: any }> = {
  HR: { class: 'bg-violet-50 text-violet-700 border border-violet-200', label: 'HR Team', icon: Users },
  ADMIN: { class: 'bg-blue-50 text-blue-700 border border-blue-200', label: 'Admin Team', icon: ShieldCheck },
};

export default function HelpdeskPage() {
  const user = useAppSelector(s => s.auth.user);
  const isManagement = user?.role ? MANAGEMENT_ROLES.includes(user.role) : false;
  return isManagement ? <HelpdeskManagementView /> : <HelpdeskPersonalView />;
}

/* ===== MANAGEMENT VIEW ===== */
function HelpdeskManagementView() {
  const user = useAppSelector(s => s.auth.user);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const [statusFilter, setStatusFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState<'HR' | 'ADMIN' | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data: res, isLoading, refetch } = useGetAllTicketsQuery({
    page, limit: 20,
    status: statusFilter || undefined,
    ...(isSuperAdmin && deptFilter !== 'ALL' ? { targetDept: deptFilter } : {}),
  } as any);
  const tickets = res?.data?.data || res?.data || [];
  const meta = res?.data?.meta || res?.meta || {};

  // Live updates via Socket.io
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    const handler = () => refetchRef.current();
    onSocketEvent('helpdesk:ticket-created', handler);
    onSocketEvent('helpdesk:ticket-updated', handler);
    onSocketEvent('helpdesk:comment-added', handler);
    return () => {
      offSocketEvent('helpdesk:ticket-created', handler);
      offSocketEvent('helpdesk:ticket-updated', handler);
      offSocketEvent('helpdesk:comment-added', handler);
    };
  }, []);

  const filteredTickets = searchQuery
    ? tickets.filter((t: any) => {
        const q = searchQuery.toLowerCase();
        return t.ticketCode?.toLowerCase().includes(q) ||
               t.subject?.toLowerCase().includes(q) ||
               `${t.employee?.firstName || ''} ${t.employee?.lastName || ''}`.toLowerCase().includes(q);
      })
    : tickets;

  const stats = {
    OPEN: tickets.filter((t: any) => t.status === 'OPEN').length,
    IN_PROGRESS: tickets.filter((t: any) => t.status === 'IN_PROGRESS').length,
    RESOLVED: tickets.filter((t: any) => t.status === 'RESOLVED').length,
    CLOSED: tickets.filter((t: any) => t.status === 'CLOSED').length,
  };

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-display font-bold text-gray-900">Helpdesk Management</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {user?.role === 'HR' ? 'HR support tickets' : user?.role === 'ADMIN' ? 'Admin support tickets' : 'All support tickets'}
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
          <Plus size={18} /> Raise Ticket
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {Object.entries(stats).map(([status, count]) => (
          <button key={status} onClick={() => { setStatusFilter(statusFilter === status ? '' : status); setPage(1); }}
            className={cn('stat-card text-center transition-all', statusFilter === status && 'ring-2 ring-brand-500')}>
            <p className="text-lg font-bold font-mono text-gray-900" data-mono>{count}</p>
            <p className="text-xs text-gray-500">{status.replace('_', ' ')}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="layer-card p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by ticket code, subject, or employee..."
              className="input-glass w-full pl-9 text-sm" />
          </div>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            className="input-glass text-sm">
            <option value="">All Status</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          {isSuperAdmin && (
            <select value={deptFilter} onChange={e => { setDeptFilter(e.target.value as any); setPage(1); }}
              className="input-glass text-sm">
              <option value="ALL">All Depts</option>
              <option value="HR">HR Team</option>
              <option value="ADMIN">Admin Team</option>
            </select>
          )}
        </div>
      </div>

      {/* Tickets Table */}
      <div className="layer-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Ticket</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Employee</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Category</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Priority</th>
                {isSuperAdmin && <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Dept</th>}
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={isSuperAdmin ? 7 : 6} className="text-center py-12">
                  <Loader2 size={24} className="animate-spin mx-auto text-brand-500" />
                </td></tr>
              ) : filteredTickets.length === 0 ? (
                <tr><td colSpan={isSuperAdmin ? 7 : 6} className="text-center py-12">
                  <HelpCircle size={40} className="mx-auto text-gray-200 mb-3" />
                  <p className="text-sm text-gray-400">No tickets found</p>
                </td></tr>
              ) : filteredTickets.map((ticket: any) => (
                <tr key={ticket.id} onClick={() => setSelectedTicketId(ticket.id)}
                  className="border-b border-gray-50 hover:bg-surface-2 transition-colors cursor-pointer">
                  <td className="px-5 py-3.5">
                    <p className="text-xs font-mono text-gray-400" data-mono>{ticket.ticketCode}</p>
                    <p className="text-sm font-medium text-gray-800 line-clamp-1">{ticket.subject}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center text-brand-700 font-semibold text-[10px]">
                        {getInitials(ticket.employee?.firstName, ticket.employee?.lastName)}
                      </div>
                      <div>
                        <p className="text-sm text-gray-700">{ticket.employee?.firstName} {ticket.employee?.lastName}</p>
                        <p className="text-[10px] text-gray-400">{ticket.employee?.employeeCode}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5"><span className="text-xs text-gray-500">{ticket.category}</span></td>
                  <td className="px-5 py-3.5">
                    <span className={cn('text-xs font-medium', PRIORITY_COLORS[ticket.priority])}>{ticket.priority}</span>
                  </td>
                  {isSuperAdmin && (
                    <td className="px-5 py-3.5">
                      {ticket.targetDept && (
                        <span className={cn('badge text-[10px] px-1.5 py-0.5', DEPT_CONFIG[ticket.targetDept]?.class)}>
                          {DEPT_CONFIG[ticket.targetDept]?.label}
                        </span>
                      )}
                    </td>
                  )}
                  <td className="px-5 py-3.5">
                    <span className={cn('badge text-xs', STATUS_CONFIG[ticket.status]?.class || 'badge-neutral')}>
                      {STATUS_CONFIG[ticket.status]?.label || ticket.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-xs text-gray-400">{formatDate(ticket.createdAt)}</p>
                    <p className="text-[10px] text-gray-300 flex items-center gap-1"><MessageCircle size={10} /> {ticket._count?.comments || 0}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-400">Page {meta.page} of {meta.totalPages}</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                className="p-1.5 rounded-lg hover:bg-surface-2 disabled:opacity-40"><ChevronLeft size={16} /></button>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= (meta.totalPages || 1)}
                className="p-1.5 rounded-lg hover:bg-surface-2 disabled:opacity-40"><ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedTicketId && (
          <TicketDetailModal ticketId={selectedTicketId} onClose={() => setSelectedTicketId(null)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCreate && <CreateTicketModal onClose={() => setShowCreate(false)} />}
      </AnimatePresence>
    </div>
  );
}

/* ===== TICKET DETAIL MODAL ===== */
function TicketDetailModal({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const { data: res, isLoading, refetch } = useGetTicketDetailQuery(ticketId);
  const [updateTicket, { isLoading: updating }] = useUpdateTicketMutation();
  const [addComment, { isLoading: commenting }] = useAddCommentMutation();
  const ticket = res?.data;
  const user = useAppSelector(s => s.auth.user);
  const isManagement = user?.role ? MANAGEMENT_ROLES.includes(user.role) : false;

  const [status, setStatus] = useState('');
  const [resolution, setResolution] = useState('');
  const [commentText, setCommentText] = useState('');

  // Live updates for this specific ticket
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    const handler = (data: any) => {
      if (!data?.ticketId || data.ticketId === ticketId) refetchRef.current();
    };
    onSocketEvent('helpdesk:ticket-updated', handler);
    onSocketEvent('helpdesk:comment-added', handler);
    return () => {
      offSocketEvent('helpdesk:ticket-updated', handler);
      offSocketEvent('helpdesk:comment-added', handler);
    };
  }, [ticketId]);

  if (ticket && !status) {
    setStatus(ticket.status);
    setResolution(ticket.resolution || '');
  }

  const handleUpdate = async () => {
    try {
      await updateTicket({ id: ticketId, data: { status, resolution: resolution || undefined } }).unwrap();
      toast.success('Ticket updated');
    } catch { toast.error('Failed'); }
  };

  const handleComment = async () => {
    if (!commentText.trim()) return;
    try {
      await addComment({ id: ticketId, content: commentText }).unwrap();
      setCommentText('');
      toast.success('Comment added');
    } catch { toast.error('Failed'); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 pt-12 overflow-y-auto"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
        role="dialog" aria-modal="true" aria-label="Ticket details"
        className="bg-white rounded-2xl shadow-glass-lg w-full max-w-2xl">
        {isLoading || !ticket ? (
          <div className="p-12 text-center"><Loader2 size={24} className="animate-spin mx-auto text-brand-500" /></div>
        ) : (
          <>
            <div className="flex items-start justify-between p-4 md:p-6 border-b border-gray-100">
              <div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-mono text-gray-400" data-mono>{ticket.ticketCode}</span>
                  <span className={cn('badge text-xs', STATUS_CONFIG[ticket.status]?.class)}>{STATUS_CONFIG[ticket.status]?.label}</span>
                  <span className={cn('text-xs font-medium', PRIORITY_COLORS[ticket.priority])}>{ticket.priority}</span>
                  {ticket.targetDept && (
                    <span className={cn('badge text-[10px] px-1.5 py-0.5', DEPT_CONFIG[ticket.targetDept]?.class)}>
                      {DEPT_CONFIG[ticket.targetDept]?.label}
                    </span>
                  )}
                </div>
                <h2 className="text-lg font-display font-semibold text-gray-900">{ticket.subject}</h2>
                {ticket.employee && (
                  <p className="text-xs text-gray-400 mt-1">
                    By {ticket.employee.firstName} {ticket.employee.lastName} ({ticket.employee.employeeCode}) · {formatDate(ticket.createdAt, 'long')}
                  </p>
                )}
              </div>
              <button onClick={onClose} aria-label="Close" className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-400" /></button>
            </div>

            <div className="p-4 md:p-6 space-y-4 md:space-y-5">
              <div>
                <p className="text-xs text-gray-400 mb-1">Description</p>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{ticket.description}</p>
              </div>

              {isManagement && (
                <div className="bg-surface-2 rounded-xl p-4 space-y-3">
                  <h4 className="text-xs font-semibold text-gray-600">Actions</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Status</label>
                      <select value={status} onChange={e => setStatus(e.target.value)} className="input-glass w-full text-sm">
                        {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Category</label>
                      <p className="text-sm text-gray-700 py-2">{ticket.category}</p>
                    </div>
                  </div>
                  {(status === 'RESOLVED' || status === 'CLOSED') && (
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Resolution</label>
                      <textarea value={resolution} onChange={e => setResolution(e.target.value)}
                        className="input-glass w-full text-sm h-16 resize-none" placeholder="Describe how the issue was resolved..." />
                    </div>
                  )}
                  <button onClick={handleUpdate} disabled={updating} className="btn-primary text-sm flex items-center gap-1.5">
                    {updating ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                    Update Ticket
                  </button>
                </div>
              )}

              {ticket.resolution && (
                <div className="bg-emerald-50 rounded-xl p-4">
                  <p className="text-xs font-semibold text-emerald-700 mb-1">Resolution</p>
                  <p className="text-sm text-emerald-800">{ticket.resolution}</p>
                </div>
              )}

              <div>
                <h4 className="text-xs font-semibold text-gray-600 mb-3">
                  Comments ({ticket.comments?.length || 0})
                </h4>
                <div className="space-y-3 max-h-60 overflow-y-auto">
                  {(ticket.comments || []).map((c: any) => (
                    <div key={c.id} className="flex gap-2.5">
                      <div className="w-7 h-7 rounded-md bg-gray-100 flex items-center justify-center flex-shrink-0">
                        <User size={12} className="text-gray-500" />
                      </div>
                      <div className="flex-1">
                        <div className="bg-surface-2 rounded-lg px-3 py-2">
                          <p className="text-xs text-gray-600">{c.content}</p>
                        </div>
                        <p className="text-[10px] text-gray-300 mt-0.5 ml-1">{formatDate(c.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 mt-3">
                  <input value={commentText} onChange={e => setCommentText(e.target.value)}
                    placeholder="Add a comment..." className="input-glass flex-1 text-sm"
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleComment(); } }} />
                  <button onClick={handleComment} disabled={commenting || !commentText.trim()}
                    aria-label="Send comment"
                    className="btn-primary text-sm px-3 disabled:opacity-50">
                    {commenting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

/* ===== PERSONAL VIEW (Employee) ===== */
function HelpdeskPersonalView() {
  const { perms } = useEmpPerms();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const { data: res, refetch } = useGetMyTicketsQuery();
  const tickets = res?.data || [];

  // Live updates
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    const handler = () => refetchRef.current();
    onSocketEvent('helpdesk:ticket-updated', handler);
    onSocketEvent('helpdesk:comment-added', handler);
    return () => {
      offSocketEvent('helpdesk:ticket-updated', handler);
      offSocketEvent('helpdesk:comment-added', handler);
    };
  }, []);

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-display font-bold text-gray-900">Helpdesk</h1>
          <p className="text-gray-500 text-xs md:text-sm mt-0.5">Raise and track support tickets</p>
        </div>
        {perms.canRaiseHelpdeskTickets ? (
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 bg-brand-600 text-white text-xs md:text-sm font-medium px-3 py-2 md:px-4 md:py-2.5 rounded-lg md:rounded-xl hover:bg-brand-700 transition-colors">
            <Plus size={14} /> Raise Ticket
          </button>
        ) : (
          <PermDenied action="raise helpdesk tickets" inline />
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].map(status => (
          <div key={status} className="stat-card text-center">
            <p className="text-lg font-bold font-mono text-gray-900" data-mono>
              {tickets.filter((t: any) => t.status === status).length}
            </p>
            <p className="text-xs text-gray-500">{status.replace('_', ' ')}</p>
          </div>
        ))}
      </div>

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
              transition={{ delay: i * 0.04 }}
              role="button" tabIndex={0}
              onClick={() => setSelectedTicketId(ticket.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedTicketId(ticket.id); } }}
              className="layer-card p-5 cursor-pointer hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs font-mono text-gray-400" data-mono>{ticket.ticketCode}</span>
                    <span className={cn('badge text-xs', STATUS_CONFIG[ticket.status]?.class || 'badge-neutral')}>
                      {STATUS_CONFIG[ticket.status]?.label || ticket.status}
                    </span>
                    <span className={cn('text-xs font-medium', PRIORITY_COLORS[ticket.priority])}>{ticket.priority}</span>
                    {ticket.targetDept && (
                      <span className={cn('badge text-[10px] px-1.5 py-0.5', DEPT_CONFIG[ticket.targetDept]?.class)}>
                        {DEPT_CONFIG[ticket.targetDept]?.label}
                      </span>
                    )}
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
        {showCreate && <CreateTicketModal onClose={() => setShowCreate(false)} />}
        {selectedTicketId && <TicketDetailModal ticketId={selectedTicketId} onClose={() => setSelectedTicketId(null)} />}
      </AnimatePresence>
    </div>
  );
}

/* ===== CREATE TICKET MODAL ===== */

// Default targetDept suggestion based on category
const CATEGORY_DEPT_MAP: Record<string, 'HR' | 'ADMIN'> = {
  IT: 'HR', HR: 'HR', LEAVE: 'HR', PAYROLL: 'HR',
  FINANCE: 'ADMIN', ADMIN: 'ADMIN', OTHER: 'HR',
};

function CreateTicketModal({ onClose }: { onClose: () => void }) {
  const [createTicket, { isLoading }] = useCreateTicketMutation();
  const [form, setForm] = useState({
    category: 'IT', subject: '', description: '', priority: 'MEDIUM', targetDept: 'HR',
  });

  const handleCategoryChange = (category: string) => {
    setForm(f => ({ ...f, category, targetDept: CATEGORY_DEPT_MAP[category] || 'HR' }));
  };

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
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }} role="dialog" aria-modal="true" aria-label="Create ticket"
        className="bg-white rounded-2xl shadow-glass-lg w-full max-w-md p-4 md:p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-display font-semibold text-gray-800">Raise a Ticket</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Category</label>
              <select value={form.category} onChange={e => handleCategoryChange(e.target.value)} className="input-glass w-full">
                <option value="IT">IT Support</option>
                <option value="HR">HR</option>
                <option value="FINANCE">Finance</option>
                <option value="ADMIN">Admin</option>
                <option value="PAYROLL">Payroll</option>
                <option value="LEAVE">Leave</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Priority</label>
              <select value={form.priority} onChange={e => setForm({...form, priority: e.target.value})} className="input-glass w-full">
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>
          </div>

          {/* Who handles this */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">Who should handle this?</label>
            <div className="grid grid-cols-2 gap-2">
              {(['HR', 'ADMIN'] as const).map(dept => {
                const cfg = DEPT_CONFIG[dept];
                const Icon = cfg.icon;
                return (
                  <button type="button" key={dept}
                    onClick={() => setForm(f => ({ ...f, targetDept: dept }))}
                    className={cn(
                      'flex items-center gap-2 p-2.5 rounded-xl border-2 text-sm font-medium transition-all',
                      form.targetDept === dept
                        ? dept === 'HR'
                          ? 'border-violet-500 bg-violet-50 text-violet-700'
                          : 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    )}>
                    <Icon size={15} />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">
              {form.targetDept === 'HR' ? 'HR team handles: leave, payroll, attendance, people matters' : 'Admin team handles: IT, facilities, admin requests'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Subject</label>
            <input value={form.subject} onChange={e => setForm({...form, subject: e.target.value})}
              className="input-glass w-full" placeholder="Brief description of the issue" required minLength={3} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Description</label>
            <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})}
              className="input-glass w-full h-24 resize-none" placeholder="Detailed explanation..." required minLength={10} />
          </div>

          {/* Alert banner showing where ticket is going */}
          <div className={cn('rounded-xl p-3 text-xs flex items-center gap-2',
            form.targetDept === 'HR' ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700')}>
            <AlertTriangle size={14} />
            This ticket will be sent to the <strong>{DEPT_CONFIG[form.targetDept]?.label}</strong> only.
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={isLoading} className="btn-primary flex-1 flex items-center justify-center gap-2">
              {isLoading && <Loader2 size={16} className="animate-spin" />} Submit Ticket
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
