import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Search, CalendarOff, MessageSquare, Check, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetPendingApprovalsAllQuery } from './dashboardApi';
import { useHandleLeaveActionMutation } from '../leaves/leaveApi';
import { formatDate, getInitials } from '../../lib/utils';
import toast from 'react-hot-toast';

type Tab = 'leaves' | 'tickets';

interface PendingLeave {
  id: string;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
  reason?: string;
  employee?: { firstName: string; lastName: string; employeeCode: string; department?: { name: string } };
  leaveType?: { id: string; name: string; code: string };
}

interface OpenTicket {
  id: string;
  subject: string;
  priority: string;
  status: string;
  ticketCode?: string;
  createdAt: string;
  employee?: { firstName: string; lastName: string; employeeCode: string };
}

export default function PendingApprovalsPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('leaves');
  const [search, setSearch] = useState('');
  const [searchDebounce, setSearchDebounce] = useState('');
  const { data: response, isLoading } = useGetPendingApprovalsAllQuery({ search: searchDebounce });
  const [handleLeaveAction] = useHandleLeaveActionMutation();

  const pendingLeaves = response?.data?.pendingLeaves?.data || [];
  const openTickets = response?.data?.openTickets?.data || [];
  const leavesCount = response?.data?.pendingLeaves?.total || 0;
  const ticketsCount = response?.data?.openTickets?.total || 0;

  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const handleSearch = (value: string) => {
    setSearch(value);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setSearchDebounce(value), 300);
  };

  const onLeaveAction = async (id: string, action: string) => {
    try {
      await handleLeaveAction({ id, action }).unwrap();
      toast.success(`Leave ${action.toLowerCase()}`);
    } catch { toast.error('Action failed'); }
  };

  const tabs: { key: Tab; label: string; count: number; icon: LucideIcon }[] = [
    { key: 'leaves', label: 'Leave Requests', count: leavesCount, icon: CalendarOff },
    { key: 'tickets', label: 'Helpdesk Tickets', count: ticketsCount, icon: MessageSquare },
  ];

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/dashboard')} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
          <ArrowLeft size={18} className="text-gray-500" />
        </button>
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Pending Approvals</h1>
          <p className="text-gray-500 text-sm mt-0.5">Review and manage all pending items</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search by employee name..."
          className="input-glass w-full pl-9 text-sm"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-surface-2 rounded-xl w-fit mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <tab.icon size={15} />
            {tab.label}
            <span className="badge badge-warning font-mono text-xs" data-mono>{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : activeTab === 'leaves' ? (
        <div className="space-y-3">
          {pendingLeaves.length === 0 ? (
            <div className="layer-card p-12 text-center">
              <CalendarOff size={32} className="text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No pending leave requests</p>
            </div>
          ) : (
            pendingLeaves.map((leave: PendingLeave) => (
              <motion.div
                key={leave.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="layer-card p-4"
              >
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 font-semibold text-sm">
                      {getInitials(leave.employee?.firstName, leave.employee?.lastName)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {leave.employee?.firstName} {leave.employee?.lastName}
                        <span className="text-xs text-gray-400 font-mono ml-2" data-mono>{leave.employee?.employeeCode}</span>
                      </p>
                      <p className="text-xs text-gray-400">
                        {leave.employee?.department?.name || '—'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-700">{leave.leaveType?.name}</p>
                    <p className="text-xs text-gray-400">
                      {formatDate(leave.startDate)} — {formatDate(leave.endDate)} · <span className="font-mono" data-mono>{leave.days}d</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onLeaveAction(leave.id, 'APPROVED')}
                      className="flex items-center gap-1 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-medium hover:bg-emerald-100 transition-colors"
                    >
                      <Check size={14} /> Approve
                    </button>
                    <button
                      onClick={() => onLeaveAction(leave.id, 'REJECTED')}
                      className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors"
                    >
                      <X size={14} /> Reject
                    </button>
                  </div>
                </div>
                {leave.reason && (
                  <p className="text-xs text-gray-500 mt-2 pl-[52px]">Reason: {leave.reason}</p>
                )}
              </motion.div>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {openTickets.length === 0 ? (
            <div className="layer-card p-12 text-center">
              <MessageSquare size={32} className="text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No open helpdesk tickets</p>
            </div>
          ) : (
            openTickets.map((ticket: OpenTicket) => (
              <motion.div
                key={ticket.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="layer-card p-4 cursor-pointer hover:ring-1 hover:ring-brand-200 transition-all"
                onClick={() => navigate(`/helpdesk`)}
              >
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center text-amber-700 font-semibold text-sm">
                      {getInitials(ticket.employee?.firstName, ticket.employee?.lastName)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {ticket.employee?.firstName} {ticket.employee?.lastName}
                        <span className="text-xs text-gray-400 font-mono ml-2" data-mono>{ticket.employee?.employeeCode}</span>
                      </p>
                      <p className="text-xs text-gray-500">{ticket.subject}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-gray-400" data-mono>{ticket.ticketCode}</span>
                    <span className={`badge text-xs ${ticket.priority === 'URGENT' ? 'badge-danger' : ticket.priority === 'HIGH' ? 'badge-warning' : 'badge-info'}`}>
                      {ticket.priority}
                    </span>
                    <span className={`badge text-xs ${ticket.status === 'OPEN' ? 'badge-warning' : 'badge-info'}`}>
                      {ticket.status?.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
