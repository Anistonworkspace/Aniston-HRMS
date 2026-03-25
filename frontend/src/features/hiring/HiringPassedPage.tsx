import { useState } from 'react';
import { motion } from 'framer-motion';
import { Award, Search, Eye, Mail, UserPlus, Star, Loader2, X, CheckCircle2, MoreHorizontal, XCircle, PauseCircle, RotateCcw, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetSelectedCandidatesQuery, useHireWalkInMutation, useUpdateWalkInStatusMutation, useDeleteWalkInMutation } from '../walkIn/walkInApi';
import { formatDate, getInitials } from '../../lib/utils';
import toast from 'react-hot-toast';

export default function HiringPassedPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [hireModal, setHireModal] = useState<any>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const { data: res, isLoading } = useGetSelectedCandidatesQuery({ page, limit: 20, search: search || undefined });
  const [updateStatus] = useUpdateWalkInStatusMutation();
  const [deleteWalkIn] = useDeleteWalkInMutation();
  const navigate = useNavigate();

  const handleAction = async (id: string, action: string) => {
    setOpenMenu(null);
    if (action === 'REJECTED' || action === 'ON_HOLD' || action === 'WAITING') {
      const labels: Record<string, string> = { REJECTED: 'reject', ON_HOLD: 'put on hold', WAITING: 'move back to walk-in' };
      if (!confirm(`Are you sure you want to ${labels[action]} this candidate?`)) return;
      try {
        await updateStatus({ id, status: action }).unwrap();
        toast.success(`Candidate ${labels[action]}!`);
      } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
    } else if (action === 'DELETE') {
      if (!confirm('Permanently delete this candidate record?')) return;
      try {
        await deleteWalkIn(id).unwrap();
        toast.success('Candidate deleted');
      } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
    }
  };

  const candidates = res?.data || [];
  const meta = res?.meta;

  return (
    <div className="page-container">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900 flex items-center gap-2">
            <Award className="text-emerald-500" size={28} /> Hiring Passed
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">Candidates who passed all interview rounds — ready for onboarding</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm mb-6">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or token..."
          className="input-glass w-full pl-9 text-sm"
        />
      </div>

      {/* Candidates Table */}
      {isLoading ? (
        <div className="layer-card p-16 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600 mx-auto" />
        </div>
      ) : candidates.length === 0 ? (
        <div className="layer-card p-16 text-center">
          <Award size={48} className="mx-auto text-gray-200 mb-4" />
          <h3 className="text-lg font-display font-semibold text-gray-600 mb-1">No candidates ready</h3>
          <p className="text-sm text-gray-400">Candidates who pass all interview rounds will appear here</p>
        </div>
      ) : (
        <div className="layer-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Candidate</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 hidden md:table-cell">Token</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 hidden lg:table-cell">Position</th>
                <th className="text-center py-3 px-4 text-xs font-medium text-gray-500">AI Score</th>
                <th className="text-center py-3 px-4 text-xs font-medium text-gray-500 hidden md:table-cell">Interviews</th>
                <th className="text-right py-3 px-4 text-xs font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c: any) => {
                const avgScore = c.interviewRounds?.length > 0
                  ? Math.round(c.interviewRounds.reduce((sum: number, r: any) => sum + (r.overallScore || 0), 0) / c.interviewRounds.filter((r: any) => r.overallScore).length)
                  : null;

                return (
                  <motion.tr key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-sm font-bold">
                          {getInitials(c.fullName)}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-800">{c.fullName}</p>
                          <p className="text-xs text-gray-400">{c.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 hidden md:table-cell">
                      <span className="text-xs font-mono text-gray-500" data-mono>{c.tokenNumber}</span>
                    </td>
                    <td className="py-3 px-4 hidden lg:table-cell">
                      <span className="text-sm text-gray-600">{c.jobOpening?.title || '—'}</span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {c.aiScore ? (
                        <div className="inline-flex items-center gap-1 text-sm font-semibold">
                          <Star size={14} className={Number(c.aiScore) >= 70 ? 'text-amber-400 fill-amber-400' : 'text-gray-300'} />
                          <span className={Number(c.aiScore) >= 70 ? 'text-emerald-600' : Number(c.aiScore) >= 50 ? 'text-amber-600' : 'text-red-500'}>
                            {Number(c.aiScore).toFixed(0)}
                          </span>
                        </div>
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </td>
                    <td className="py-3 px-4 text-center hidden md:table-cell">
                      <span className="text-sm font-mono text-gray-600" data-mono>
                        {avgScore ? `${avgScore}/10` : '—'}
                      </span>
                      <span className="text-xs text-gray-400 ml-1">({c.interviewRounds?.length || 0} rounds)</span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => navigate(`/walk-in-management/${c.id}`)}
                          className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                          <Eye size={14} /> View
                        </button>
                        <button onClick={() => setHireModal(c)}
                          className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-1">
                          <UserPlus size={12} /> Hire
                        </button>
                        <div className="relative">
                          <button onClick={() => setOpenMenu(openMenu === c.id ? null : c.id)}
                            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
                            <MoreHorizontal size={16} />
                          </button>
                          {openMenu === c.id && (
                            <div className="absolute right-0 top-8 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-20 w-44"
                              onMouseLeave={() => setOpenMenu(null)}>
                              <button onClick={() => handleAction(c.id, 'ON_HOLD')}
                                className="w-full text-left px-3 py-2 text-xs text-orange-600 hover:bg-orange-50 flex items-center gap-2">
                                <PauseCircle size={14} /> Put on Hold
                              </button>
                              <button onClick={() => handleAction(c.id, 'REJECTED')}
                                className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2">
                                <XCircle size={14} /> Reject
                              </button>
                              <button onClick={() => handleAction(c.id, 'WAITING')}
                                className="w-full text-left px-3 py-2 text-xs text-blue-600 hover:bg-blue-50 flex items-center gap-2">
                                <RotateCcw size={14} /> Back to Walk-In
                              </button>
                              <div className="border-t border-gray-100 my-1" />
                              <button onClick={() => handleAction(c.id, 'DELETE')}
                                className="w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-red-50 flex items-center gap-2">
                                <Trash2 size={14} /> Delete Record
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-400">
                Page {meta.page} of {meta.totalPages} ({meta.total} total)
              </p>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1 text-xs border rounded-lg disabled:opacity-30">Prev</button>
                <button disabled={page >= meta.totalPages} onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1 text-xs border rounded-lg disabled:opacity-30">Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Hire Modal */}
      {hireModal && <HireModal candidate={hireModal} onClose={() => setHireModal(null)} />}
    </div>
  );
}

function HireModal({ candidate, onClose }: { candidate: any; onClose: () => void }) {
  const [teamsEmail, setTeamsEmail] = useState('');
  const [hireWalkIn, { isLoading }] = useHireWalkInMutation();
  const [result, setResult] = useState<any>(null);

  const handleHire = async () => {
    if (!teamsEmail) return toast.error('Please enter a Teams email');
    try {
      const res = await hireWalkIn({ id: candidate.id, teamsEmail }).unwrap();
      setResult(res.data);
      toast.success(`Employee ${res.data.employeeCode} created!`);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Hire failed');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-display font-semibold text-gray-800">
            {result ? 'Employee Created' : 'Create Employee'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {result ? (
          <div className="text-center py-4">
            <div className="w-14 h-14 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 size={28} className="text-emerald-500" />
            </div>
            <p className="text-lg font-semibold text-gray-800 mb-1">{candidate.fullName}</p>
            <p className="text-2xl font-display font-bold text-brand-600 mb-2" data-mono>{result.employeeCode}</p>
            <p className="text-sm text-gray-500 mb-1">Teams Email: {teamsEmail}</p>
            <p className="text-xs text-gray-400">Onboarding invitation has been sent</p>
            <button onClick={onClose} className="btn-primary mt-5 w-full">Done</button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-sm font-medium text-gray-800">{candidate.fullName}</p>
              <p className="text-xs text-gray-500">{candidate.email} • {candidate.phone}</p>
              {candidate.jobOpening && (
                <p className="text-xs text-brand-600 mt-1">{candidate.jobOpening.title} — {candidate.jobOpening.department}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Teams / Work Email *</label>
              <input
                type="email" value={teamsEmail} onChange={e => setTeamsEmail(e.target.value)}
                placeholder="firstname.lastname@aniston.in"
                className="input-glass w-full" required
              />
              <p className="text-xs text-gray-400 mt-1">This will be used as the employee's login email</p>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleHire} disabled={isLoading || !teamsEmail}
                className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50">
                {isLoading && <Loader2 size={16} className="animate-spin" />}
                <Mail size={16} /> Create & Send Invite
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
