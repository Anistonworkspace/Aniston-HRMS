import { useState, useEffect, useRef } from 'react';
import {
  CheckCircle, XCircle, Clock, FileText, MessageSquare,
  LogIn, LogOut, RefreshCw, Search, Calendar, ChevronDown,
  UserCheck, UserX, Hourglass,
} from 'lucide-react';
import { useGetRegularizationsQuery, useHandleRegularizationMutation } from '../attendanceApi';
import { onSocketEvent, offSocketEvent } from '../../../lib/socket';
import { cn, formatDate, getInitials } from '../../../lib/utils';
import toast from 'react-hot-toast';

type StatusTab = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';

function getRegType(r: any): { label: string; class: string; icon: any } {
  if (r.requestedCheckIn && r.requestedCheckOut) {
    return { label: 'Full Correction', class: 'bg-purple-50 text-purple-700', icon: RefreshCw };
  }
  if (r.requestedCheckIn && !r.requestedCheckOut) {
    return { label: 'Missed Check-In', class: 'bg-amber-50 text-amber-700', icon: LogIn };
  }
  if (!r.requestedCheckIn && r.requestedCheckOut) {
    return { label: 'Missed Check-Out', class: 'bg-orange-50 text-orange-700', icon: LogOut };
  }
  return { label: 'Time Correction', class: 'bg-blue-50 text-blue-700', icon: Clock };
}

const STATUS_BADGE: Record<string, { class: string; label: string }> = {
  PENDING:           { class: 'bg-amber-100 text-amber-700',     label: 'Pending' },
  MANAGER_REVIEWED:  { class: 'bg-blue-100 text-blue-700',       label: 'Mgr Reviewed' },
  APPROVED:          { class: 'bg-emerald-100 text-emerald-700', label: 'Approved' },
  REJECTED:          { class: 'bg-red-100 text-red-700',         label: 'Rejected' },
};

const TAB_CONFIG: { key: StatusTab; label: string; icon: any; activeClass: string }[] = [
  { key: 'PENDING',  label: 'Pending',  icon: Hourglass, activeClass: 'bg-amber-500 text-white' },
  { key: 'APPROVED', label: 'Approved', icon: UserCheck, activeClass: 'bg-emerald-500 text-white' },
  { key: 'REJECTED', label: 'Rejected', icon: UserX,     activeClass: 'bg-red-500 text-white' },
  { key: 'ALL',      label: 'All',      icon: FileText,  activeClass: 'bg-gray-700 text-white' },
];

export default function RegularizationTab() {
  const [statusTab, setStatusTab] = useState<StatusTab>('PENDING');
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [remarkId, setRemarkId] = useState<string | null>(null);
  const [remarks, setRemarks] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [approvalPickerId, setApprovalPickerId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const queryParams = {
    status: statusTab,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(dateFilter ? { date: dateFilter } : {}),
  };

  const { data: res, isLoading, refetch } = useGetRegularizationsQuery(queryParams);
  const [handleReg] = useHandleRegularizationMutation();

  const regularizations: any[] = res?.data || [];
  const total: number = res?.meta?.total ?? regularizations.length;

  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    const handler = () => refetchRef.current();
    onSocketEvent('attendance:checkin', handler);
    onSocketEvent('attendance:regularization-submitted', handler);
    return () => {
      offSocketEvent('attendance:checkin', handler);
      offSocketEvent('attendance:regularization-submitted', handler);
    };
  }, []);

  const handleAction = async (id: string, action: string, approvalType?: string) => {
    setProcessingId(id);
    try {
      await handleReg({
        id,
        action,
        ...(remarkId === id && remarks ? { remarks } : {}),
        ...(approvalType ? { approvalType } : {}),
      }).unwrap();
      const label = action === 'APPROVED'
        ? (approvalType === 'HALF_DAY' ? 'approved as half day' : 'approved as full day')
        : action.toLowerCase();
      toast.success(`Regularization ${label}`);
      setRemarkId(null);
      setRemarks('');
      setApprovalPickerId(null);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to process regularization');
    } finally {
      setProcessingId(null);
    }
  };

  const formatTime = (d: string | null) => {
    if (!d) return '--';
    return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  };

  const canAct = (r: any) => ['PENDING', 'MANAGER_REVIEWED'].includes(r.status);

  return (
    <div className="space-y-3">
      {/* Sub-tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {TAB_CONFIG.map(tab => {
          const Icon = tab.icon;
          const isActive = statusTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setStatusTab(tab.key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                isActive ? tab.activeClass : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              )}
            >
              <Icon size={12} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[160px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name or code…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input-glass w-full text-xs pl-7 py-1.5"
          />
        </div>
        <div className="relative">
          <Calendar size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="date"
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            className="input-glass text-xs pl-7 py-1.5"
          />
          {dateFilter && (
            <button
              onClick={() => setDateFilter('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <XCircle size={13} />
            </button>
          )}
        </div>
      </div>

      <p className="text-[10px] text-gray-400">{total} request{total !== 1 ? 's' : ''}</p>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="layer-card p-3 space-y-2">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-100 animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="w-32 h-3 bg-gray-100 rounded animate-pulse" />
                  <div className="w-48 h-2.5 bg-gray-50 rounded animate-pulse" />
                </div>
                <div className="w-16 h-5 bg-amber-100 rounded-full animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : regularizations.length === 0 ? (
        <div className="layer-card p-8 text-center">
          <CheckCircle size={32} className="mx-auto text-emerald-300 mb-2" />
          <p className="text-sm text-gray-400">
            {statusTab === 'PENDING' ? 'No pending regularization requests' : `No ${statusTab.toLowerCase()} regularizations found`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {regularizations.map((r: any) => {
            const att = r.attendance || {};
            const emp = att.employee || { firstName: 'Unknown', lastName: '', employeeCode: '—' };
            const regType = getRegType(r);
            const TypeIcon = regType.icon;
            const statusBadge = STATUS_BADGE[r.status] || STATUS_BADGE.PENDING;
            const actionable = canAct(r);
            const isApprovalPicker = approvalPickerId === r.id;

            return (
              <div key={r.id} className="layer-card p-3 space-y-2">
                {/* Header */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0" style={{ background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' }}>
                    {getInitials(emp.firstName, emp.lastName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs font-medium text-gray-800">{emp.firstName} {emp.lastName}</p>
                      <span className="text-[10px] text-gray-400 font-mono" data-mono>{emp.employeeCode}</span>
                      <span className={cn('flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full', regType.class)}>
                        <TypeIcon size={9} />
                        {regType.label}
                      </span>
                      <span className={cn('text-[9px] font-semibold px-1.5 py-0.5 rounded-full ml-auto', statusBadge.class)}>
                        {statusBadge.label}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      Date: {formatDate(att.date)} · Original: {formatTime(att.checkIn)} → {formatTime(att.checkOut)}
                    </p>
                  </div>
                </div>

                {/* Details */}
                <div className="bg-gray-50 rounded-lg p-2.5 space-y-1">
                  {(r.requestedCheckIn || r.requestedCheckOut) && (
                    <div className="flex flex-wrap items-center gap-4 text-[11px] mb-1">
                      {r.requestedCheckIn && (
                        <>
                          <span className="text-gray-500">Req. Check-In:</span>
                          <span className="font-mono text-gray-700 font-medium" data-mono>{formatTime(r.requestedCheckIn)}</span>
                        </>
                      )}
                      {r.requestedCheckOut && (
                        <>
                          <span className="text-gray-500">Req. Check-Out:</span>
                          <span className="font-mono text-gray-700 font-medium" data-mono>{formatTime(r.requestedCheckOut)}</span>
                        </>
                      )}
                    </div>
                  )}
                  <div className="flex items-start gap-1">
                    <FileText size={11} className="text-gray-400 mt-0.5 flex-shrink-0" />
                    <p className="text-[11px] text-gray-600">{r.reason}</p>
                  </div>
                  {r.status === 'MANAGER_REVIEWED' && r.managerRemarks && (
                    <div className="mt-1 pt-1 border-t border-gray-200">
                      <p className="text-[10px] text-blue-600 font-medium">Manager: {r.managerRemarks}</p>
                    </div>
                  )}
                  {r.status === 'APPROVED' && r.hrRemarks && (
                    <p className="text-[10px] text-emerald-600 font-medium mt-1 pt-1 border-t border-gray-200">HR Note: {r.hrRemarks}</p>
                  )}
                  {r.status === 'REJECTED' && (r.hrRemarks || r.approverRemarks) && (
                    <p className="text-[10px] text-red-600 font-medium mt-1 pt-1 border-t border-gray-200">Rejected: {r.hrRemarks || r.approverRemarks}</p>
                  )}
                </div>

                {/* Remarks input */}
                {actionable && remarkId === r.id && (
                  <input
                    type="text"
                    placeholder="Add remarks (optional)..."
                    value={remarks}
                    onChange={e => setRemarks(e.target.value)}
                    className="input-glass text-xs py-1.5 w-full"
                  />
                )}

                {/* Full Day / Half Day picker */}
                {actionable && isApprovalPicker && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 space-y-2">
                    <p className="text-[11px] font-semibold text-emerald-800">Approve attendance as:</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAction(r.id, 'APPROVED', 'FULL_DAY')}
                        disabled={processingId === r.id}
                        className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
                      >
                        {processingId === r.id ? 'Processing…' : '✓ Full Day Present'}
                      </button>
                      <button
                        onClick={() => handleAction(r.id, 'APPROVED', 'HALF_DAY')}
                        disabled={processingId === r.id}
                        className="flex-1 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
                      >
                        {processingId === r.id ? 'Processing…' : '½ Half Day'}
                      </button>
                    </div>
                    <button onClick={() => setApprovalPickerId(null)} className="text-[10px] text-gray-400 hover:text-gray-600 w-full text-center">
                      Cancel
                    </button>
                  </div>
                )}

                {/* Action buttons */}
                {actionable && !isApprovalPicker && (
                  <div className="flex items-center gap-2 pt-1 flex-wrap">
                    <button
                      onClick={() => { setApprovalPickerId(r.id); setRemarkId(null); }}
                      disabled={processingId === r.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                    >
                      <CheckCircle size={13} /> Approve <ChevronDown size={11} />
                    </button>
                    <button
                      onClick={() => handleAction(r.id, 'REJECTED')}
                      disabled={processingId === r.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
                    >
                      <XCircle size={13} /> {processingId === r.id ? 'Processing…' : 'Reject'}
                    </button>
                    {r.status === 'PENDING' && (
                      <button
                        onClick={() => handleAction(r.id, 'MANAGER_REVIEWED')}
                        disabled={processingId === r.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 disabled:opacity-50 transition-colors"
                      >
                        <Clock size={13} /> Mark Reviewed
                      </button>
                    )}
                    <button
                      onClick={() => { setRemarkId(remarkId === r.id ? null : r.id); setRemarks(''); }}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-500 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <MessageSquare size={12} /> Remarks
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
