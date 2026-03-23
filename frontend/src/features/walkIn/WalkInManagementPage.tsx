import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Search, Clock, UserCheck, UserX, ArrowRight, MessageSquare,
  ChevronDown, Loader2, FileText, Phone, Mail, MapPin, Briefcase, X, Send,
} from 'lucide-react';
import {
  useGetTodayWalkInsQuery,
  useUpdateWalkInStatusMutation,
  useConvertWalkInMutation,
  useAddWalkInNotesMutation,
  useDeleteWalkInMutation,
  useHireWalkInMutation,
} from './walkInApi';
import toast from 'react-hot-toast';

const STATUS_CONFIG: Record<string, { label: string; color: string; badge: string }> = {
  WAITING: { label: 'Waiting', color: 'text-amber-600', badge: 'badge-warning' },
  IN_INTERVIEW: { label: 'In Interview', color: 'text-blue-600', badge: 'badge-info' },
  COMPLETED: { label: 'Completed', color: 'text-emerald-600', badge: 'badge-success' },
  NO_SHOW: { label: 'No Show', color: 'text-red-600', badge: 'badge-danger' },
};

export default function WalkInManagementPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notesInput, setNotesInput] = useState('');
  const [showNotesFor, setShowNotesFor] = useState<string | null>(null);

  const { data, isLoading, refetch } = useGetTodayWalkInsQuery({
    search: search || undefined,
    status: statusFilter || undefined,
    limit: 50,
  });
  const [showHireModal, setShowHireModal] = useState<string | null>(null);
  const [hireEmail, setHireEmail] = useState('');

  const [updateStatus, { isLoading: isUpdating }] = useUpdateWalkInStatusMutation();
  const [convertWalkIn, { isLoading: isConverting }] = useConvertWalkInMutation();
  const [addNotes] = useAddWalkInNotesMutation();
  const [deleteWalkIn] = useDeleteWalkInMutation();
  const [hireWalkIn, { isLoading: isHiring }] = useHireWalkInMutation();

  const candidates = data?.data || [];
  const meta = data?.meta;

  const handleStatusChange = async (id: string, status: string) => {
    try {
      await updateStatus({ id, status }).unwrap();
      toast.success(`Status updated to ${STATUS_CONFIG[status]?.label || status}`);
    } catch {
      toast.error('Failed to update status');
    }
  };

  const handleConvert = async (id: string) => {
    try {
      await convertWalkIn(id).unwrap();
      toast.success('Converted to recruitment application');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Conversion failed');
    }
  };

  const handleAddNotes = async (id: string) => {
    if (!notesInput.trim()) return;
    try {
      await addNotes({ id, notes: notesInput.trim() }).unwrap();
      toast.success('Notes saved');
      setNotesInput('');
      setShowNotesFor(null);
    } catch {
      toast.error('Failed to save notes');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this record?')) return;
    try {
      await deleteWalkIn(id).unwrap();
      toast.success('Record deleted');
      if (selectedId === id) setSelectedId(null);
    } catch {
      toast.error('Failed to delete');
    }
  };

  const handleHire = async (id: string) => {
    if (!hireEmail.trim()) {
      toast.error('Please enter a Teams email address');
      return;
    }
    try {
      const result = await hireWalkIn({ id, teamsEmail: hireEmail.trim() }).unwrap();
      const empCode = result?.data?.employeeCode || 'N/A';
      const onboardingLink = result?.data?.onboardingLink || '';
      toast.success(`Hired! Employee code: ${empCode}${onboardingLink ? ` — Onboarding link sent` : ''}`, { duration: 6000 });
      setShowHireModal(null);
      setHireEmail('');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to hire candidate');
    }
  };

  const selected = candidates.find((c: any) => c.id === selectedId);
  const hireCandidate = candidates.find((c: any) => c.id === showHireModal);

  // Stats
  const stats = {
    total: candidates.length,
    waiting: candidates.filter((c: any) => c.status === 'WAITING').length,
    inInterview: candidates.filter((c: any) => c.status === 'IN_INTERVIEW').length,
    completed: candidates.filter((c: any) => c.status === 'COMPLETED').length,
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Walk-In Candidates</h1>
          <p className="text-sm text-gray-400 mt-0.5">Today's walk-in interview registrations</p>
        </div>
        <button onClick={() => refetch()} className="btn-secondary text-sm">
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatMini icon={Users} label="Total Today" value={stats.total} color="text-gray-600" bg="bg-gray-50" />
        <StatMini icon={Clock} label="Waiting" value={stats.waiting} color="text-amber-600" bg="bg-amber-50" />
        <StatMini icon={UserCheck} label="In Interview" value={stats.inInterview} color="text-blue-600" bg="bg-blue-50" />
        <StatMini icon={UserCheck} label="Completed" value={stats.completed} color="text-emerald-600" bg="bg-emerald-50" />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email, phone, or token..."
            className="input-glass w-full pl-10"
          />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input-glass w-full sm:w-48">
          <option value="">All Statuses</option>
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
            <option key={key} value={key}>{cfg.label}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      <div className="flex gap-6">
        {/* Candidate List */}
        <div className="flex-1 space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
            </div>
          ) : candidates.length === 0 ? (
            <div className="text-center py-16 layer-card">
              <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No walk-in candidates{statusFilter ? ` with status "${STATUS_CONFIG[statusFilter]?.label}"` : ''} today</p>
            </div>
          ) : (
            candidates.map((candidate: any) => {
              const sc = STATUS_CONFIG[candidate.status] || STATUS_CONFIG.WAITING;
              return (
                <motion.div
                  key={candidate.id}
                  layout
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => setSelectedId(candidate.id)}
                  className={`layer-card p-4 cursor-pointer transition-all ${selectedId === candidate.id ? 'ring-2 ring-brand-500 shadow-layer-md' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-brand-50 flex items-center justify-center">
                        <span className="text-sm font-bold text-brand-600">
                          {candidate.fullName?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                        </span>
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900">{candidate.fullName}</h3>
                        <p className="text-xs text-gray-400">
                          {candidate.jobOpening?.title || 'No position selected'} • {candidate.tokenNumber}
                        </p>
                      </div>
                    </div>
                    <span className={`badge ${sc.badge}`}>{sc.label}</span>
                  </div>

                  {/* Quick Actions */}
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-50">
                    {candidate.status === 'WAITING' && (
                      <button
                        onClick={e => { e.stopPropagation(); handleStatusChange(candidate.id, 'IN_INTERVIEW'); }}
                        className="text-xs text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors"
                      >
                        Start Interview
                      </button>
                    )}
                    {candidate.status === 'IN_INTERVIEW' && (
                      <button
                        onClick={e => { e.stopPropagation(); handleStatusChange(candidate.id, 'COMPLETED'); }}
                        className="text-xs text-emerald-600 hover:bg-emerald-50 px-2 py-1 rounded-lg transition-colors"
                      >
                        Mark Completed
                      </button>
                    )}
                    {!candidate.convertedToApp && candidate.jobOpeningId && (
                      <button
                        onClick={e => { e.stopPropagation(); handleConvert(candidate.id); }}
                        disabled={isConverting}
                        className="text-xs text-brand-600 hover:bg-brand-50 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
                      >
                        <ArrowRight className="w-3 h-3" /> Convert to Application
                      </button>
                    )}
                    {candidate.convertedToApp && (
                      <span className="text-xs text-emerald-500 flex items-center gap-1">
                        <UserCheck className="w-3 h-3" /> Converted
                      </span>
                    )}
                    {(candidate.status === 'COMPLETED' || candidate.status === 'IN_INTERVIEW') && (
                      <button
                        onClick={e => { e.stopPropagation(); setShowHireModal(candidate.id); setHireEmail(''); }}
                        className="text-xs text-purple-600 hover:bg-purple-50 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
                      >
                        <Send className="w-3 h-3" /> Hire & Send Invite
                      </button>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); handleStatusChange(candidate.id, 'NO_SHOW'); }}
                      className="text-xs text-red-500 hover:bg-red-50 px-2 py-1 rounded-lg transition-colors ml-auto"
                    >
                      No Show
                    </button>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>

        {/* Detail Panel (Desktop) */}
        <AnimatePresence>
          {selected && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="hidden lg:block w-96 shrink-0"
            >
              <div className="layer-card p-5 sticky top-6 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-display font-bold text-gray-900">{selected.fullName}</h2>
                    <p className="text-sm text-gray-400 font-mono" data-mono>{selected.tokenNumber}</p>
                  </div>
                  <button onClick={() => setSelectedId(null)} className="text-gray-400 hover:text-gray-600">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <span className={`badge ${STATUS_CONFIG[selected.status]?.badge}`}>
                  {STATUS_CONFIG[selected.status]?.label}
                </span>

                <div className="space-y-2 text-sm">
                  <DetailRow icon={Briefcase} value={selected.jobOpening?.title || 'No position'} />
                  <DetailRow icon={Mail} value={selected.email} />
                  <DetailRow icon={Phone} value={`+91 ${selected.phone}`} />
                  {selected.city && <DetailRow icon={MapPin} value={selected.city} />}
                </div>

                {/* Professional */}
                <div className="pt-3 border-t border-gray-100 space-y-2 text-sm">
                  {selected.qualification && (
                    <div><span className="text-gray-400">Qualification:</span> <span className="text-gray-700">{selected.qualification}{selected.fieldOfStudy ? ` — ${selected.fieldOfStudy}` : ''}</span></div>
                  )}
                  <div>
                    <span className="text-gray-400">Experience:</span>{' '}
                    <span className="text-gray-700">
                      {selected.isFresher ? 'Fresher' : `${selected.experienceYears}y ${selected.experienceMonths}m`}
                    </span>
                  </div>
                  {selected.expectedCtc && (
                    <div><span className="text-gray-400">Expected CTC:</span> <span className="text-gray-700">₹{Number(selected.expectedCtc).toLocaleString('en-IN')} LPA</span></div>
                  )}
                  {selected.noticePeriod && (
                    <div><span className="text-gray-400">Notice:</span> <span className="text-gray-700">{selected.noticePeriod}</span></div>
                  )}
                </div>

                {/* Skills */}
                {selected.skills?.length > 0 && (
                  <div className="pt-3 border-t border-gray-100">
                    <p className="text-xs text-gray-400 mb-2">Skills</p>
                    <div className="flex flex-wrap gap-1">
                      {selected.skills.map((s: string) => <span key={s} className="badge badge-info">{s}</span>)}
                    </div>
                  </div>
                )}

                {/* Documents */}
                <div className="pt-3 border-t border-gray-100 space-y-1 text-xs">
                  <p className="text-gray-400 mb-1">Documents</p>
                  <DocStatus label="Aadhaar Front" has={!!selected.aadhaarFrontUrl} />
                  <DocStatus label="Aadhaar Back" has={!!selected.aadhaarBackUrl} />
                  <DocStatus label="PAN Card" has={!!selected.panCardUrl} />
                  <DocStatus label="Selfie" has={!!selected.selfieUrl} />
                  <DocStatus label="Resume" has={!!selected.resumeUrl} />
                </div>

                {/* HR Notes */}
                <div className="pt-3 border-t border-gray-100">
                  <p className="text-xs text-gray-400 mb-2">HR Notes</p>
                  {selected.hrNotes && (
                    <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 mb-2">{selected.hrNotes}</p>
                  )}
                  <div className="flex gap-2">
                    <input
                      value={showNotesFor === selected.id ? notesInput : ''}
                      onFocus={() => setShowNotesFor(selected.id)}
                      onChange={e => { setShowNotesFor(selected.id); setNotesInput(e.target.value); }}
                      placeholder="Add a note..."
                      className="input-glass flex-1 text-sm"
                    />
                    <button
                      onClick={() => handleAddNotes(selected.id)}
                      className="btn-primary px-3 py-1.5 text-sm"
                    >
                      <MessageSquare className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-3 border-t border-gray-100 flex flex-wrap gap-2">
                  {!selected.convertedToApp && selected.jobOpeningId && (
                    <button onClick={() => handleConvert(selected.id)} disabled={isConverting}
                      className="btn-primary text-sm flex items-center gap-1">
                      {isConverting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
                      Convert to Application
                    </button>
                  )}
                  {(selected.status === 'COMPLETED' || selected.status === 'IN_INTERVIEW') && (
                    <button onClick={() => { setShowHireModal(selected.id); setHireEmail(''); }}
                      className="text-sm bg-purple-600 text-white hover:bg-purple-700 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors">
                      <Send className="w-3 h-3" /> Hire & Send Invite
                    </button>
                  )}
                  <button onClick={() => handleDelete(selected.id)}
                    className="text-sm text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg">
                    Delete
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Hire & Send Invite Modal */}
      <AnimatePresence>
        {showHireModal && hireCandidate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => setShowHireModal(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-display font-bold text-gray-900">Hire & Send Invite</h3>
                <button onClick={() => setShowHireModal(null)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Candidate Name</label>
                  <div className="text-sm font-medium text-gray-900 bg-gray-50 rounded-lg px-3 py-2.5">
                    {hireCandidate.fullName}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Position</label>
                  <div className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2.5">
                    {hireCandidate.jobOpening?.title || 'Not specified'}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Teams Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={hireEmail}
                    onChange={e => setHireEmail(e.target.value)}
                    placeholder="employee@aniston.in"
                    className="input-glass w-full"
                    autoFocus
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    An onboarding invite will be sent to this email address.
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
                <button
                  onClick={() => setShowHireModal(null)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleHire(showHireModal)}
                  disabled={isHiring || !hireEmail.trim()}
                  className={`px-5 py-2 text-sm rounded-lg font-medium flex items-center gap-2 transition-colors
                    ${isHiring || !hireEmail.trim()
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-purple-600 text-white hover:bg-purple-700'}`}
                >
                  {isHiring ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send Onboarding Invite
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatMini({ icon: Icon, label, value, color, bg }: {
  icon: any; label: string; value: number; color: string; bg: string;
}) {
  return (
    <div className="stat-card flex items-center gap-3">
      <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center`}>
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <div>
        <p className="text-2xl font-display font-bold text-gray-900" data-mono>{value}</p>
        <p className="text-xs text-gray-400">{label}</p>
      </div>
    </div>
  );
}

function DetailRow({ icon: Icon, value }: { icon: any; value: string }) {
  return (
    <div className="flex items-center gap-2 text-gray-600">
      <Icon className="w-4 h-4 text-gray-400 shrink-0" />
      <span className="truncate">{value}</span>
    </div>
  );
}

function DocStatus({ label, has }: { label: string; has: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${has ? 'bg-emerald-400' : 'bg-gray-300'}`} />
      <span className={has ? 'text-gray-600' : 'text-gray-400'}>{label}</span>
    </div>
  );
}
