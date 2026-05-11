import { useState } from 'react';
import { MapPin, CheckCircle, XCircle, Loader2, RefreshCw, Home, Navigation } from 'lucide-react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { useGetHomeLocationRequestsQuery, useReviewHomeLocationRequestMutation } from '../workforce/workforceApi';
import { cn, formatDate } from '../../lib/utils';

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
};

export default function HomeLocationRequestsTab() {
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | ''>('PENDING');
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [radiusValues, setRadiusValues] = useState<Record<string, string>>({});
  const { data: res, isLoading, refetch } = useGetHomeLocationRequestsQuery(statusFilter ? { status: statusFilter } : undefined);
  const [reviewRequest, { isLoading: reviewing }] = useReviewHomeLocationRequestMutation();

  const requests: any[] = res?.data || [];

  const handleReview = async (id: string, action: 'APPROVED' | 'REJECTED') => {
    try {
      const radius = radiusValues[id] ? parseInt(radiusValues[id], 10) : undefined;
      if (action === 'APPROVED' && radius !== undefined && (isNaN(radius) || radius < 50 || radius > 1000)) {
        toast.error('Geofence radius must be between 50m and 1000m');
        return;
      }
      await reviewRequest({
        id,
        action,
        reviewNotes: reviewNotes[id]?.trim() || undefined,
        radiusMeters: action === 'APPROVED' ? radius : undefined,
      }).unwrap();
      toast.success(
        action === 'APPROVED'
          ? `Home location approved with ${radius ?? 100}m geofence`
          : 'Home location request rejected'
      );
      setReviewNotes(prev => { const n = { ...prev }; delete n[id]; return n; });
      setRadiusValues(prev => { const n = { ...prev }; delete n[id]; return n; });
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to update request');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-display font-semibold text-gray-900">Home Location Requests</h2>
          <p className="text-sm text-gray-400 mt-0.5">Approve employee WFH home locations — creates a geofence for clock-in/out</p>
        </div>
        <button onClick={() => refetch()} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
          <RefreshCw size={16} className="text-gray-400" />
        </button>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(['PENDING', 'APPROVED', 'REJECTED', ''] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
              statusFilter === s ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            )}
          >
            {s === '' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-brand-400" />
        </div>
      ) : requests.length === 0 ? (
        <div className="layer-card p-10 text-center">
          <Home size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm text-gray-400">No {statusFilter.toLowerCase() || ''} home location requests</p>
          <p className="text-xs text-gray-300 mt-1">Employees submit their home GPS from the Attendance page</p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req: any, i: number) => (
            <motion.div
              key={req.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="layer-card p-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700 shrink-0">
                    {(req.employee?.firstName?.[0] || '') + (req.employee?.lastName?.[0] || '')}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      {req.employee?.firstName} {req.employee?.lastName}
                      <span className="text-gray-400 text-xs font-normal ml-2">{req.employee?.employeeCode}</span>
                      {req.employee?.department?.name && (
                        <span className="text-gray-400 text-xs font-normal ml-1">· {req.employee.department.name}</span>
                      )}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-500">
                      <Navigation size={11} className="text-indigo-400" />
                      <span className="font-mono text-[11px]" data-mono>
                        {req.latitude.toFixed(6)}, {req.longitude.toFixed(6)}
                      </span>
                      {req.accuracy && (
                        <span className="text-gray-400">· ±{Math.round(req.accuracy)}m</span>
                      )}
                    </div>
                    {req.address && (
                      <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                        <MapPin size={10} /> {req.address}
                      </p>
                    )}
                    {req.status === 'APPROVED' && req.approvedGeofence && (
                      <p className="text-[11px] text-emerald-600 mt-0.5 flex items-center gap-1">
                        <CheckCircle size={10} /> Geofence: {req.approvedGeofence.radiusMeters}m radius approved
                      </p>
                    )}
                    <p className="text-[11px] text-gray-300 mt-1">{formatDate(req.createdAt)}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span className={cn('badge text-xs px-2 py-0.5 rounded-full', STATUS_STYLE[req.status])}>
                    {req.status}
                  </span>
                  {req.status === 'PENDING' && (
                    <div className="flex flex-col gap-1.5 w-full sm:w-56">
                      {/* Radius picker */}
                      <div>
                        <label className="text-[10px] text-gray-400 block mb-0.5">Geofence radius (m, default 100)</label>
                        <input
                          type="number"
                          min={50}
                          max={1000}
                          placeholder="100"
                          value={radiusValues[req.id] || ''}
                          onChange={(e) => setRadiusValues(prev => ({ ...prev, [req.id]: e.target.value }))}
                          className="input-glass text-xs py-1.5 px-2 w-full"
                        />
                      </div>
                      <input
                        type="text"
                        placeholder="Notes (optional)"
                        value={reviewNotes[req.id] || ''}
                        onChange={(e) => setReviewNotes(prev => ({ ...prev, [req.id]: e.target.value }))}
                        className="input-glass text-xs py-1.5 px-2 w-full"
                      />
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => handleReview(req.id, 'APPROVED')}
                          disabled={reviewing}
                          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-medium hover:bg-emerald-600 transition-colors disabled:opacity-60"
                        >
                          {reviewing ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                          Approve
                        </button>
                        <button
                          onClick={() => handleReview(req.id, 'REJECTED')}
                          disabled={reviewing}
                          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600 transition-colors disabled:opacity-60"
                        >
                          <XCircle size={11} />
                          Reject
                        </button>
                      </div>
                    </div>
                  )}
                  {req.status !== 'PENDING' && req.reviewNotes && (
                    <p className="text-[11px] text-gray-400 italic text-right max-w-[200px]">"{req.reviewNotes}"</p>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
