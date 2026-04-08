import { useState, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Check, Plus, X, Eye, Upload, Loader2, Download, Trash2, BookOpen, Mail, Palette } from 'lucide-react';
import { useGetPoliciesQuery, useAcknowledgePolicyMutation, useCreatePolicyMutation, useDeletePolicyMutation } from './policyApi';
import { useAppSelector } from '../../app/store';
import { formatDate } from '../../lib/utils';
import toast from 'react-hot-toast';
import SecureDocumentViewer from './SecureDocumentViewer';

const LettersTab = lazy(() => import('./LettersTab'));
const BrandingTab = lazy(() => import('./BrandingTab'));

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];

type Tab = 'policies' | 'letters' | 'branding';

export default function PoliciesPage() {
  const user = useAppSelector((s) => s.auth.user);
  const isAdmin = user && ADMIN_ROLES.includes(user.role);
  const [activeTab, setActiveTab] = useState<Tab>('policies');

  const tabs: { id: Tab; label: string; icon: any; adminOnly?: boolean }[] = [
    { id: 'policies', label: 'Policies', icon: BookOpen },
    { id: 'letters', label: 'Letters', icon: Mail, adminOnly: true },
    { id: 'branding', label: 'Branding', icon: Palette, adminOnly: true },
  ];

  const visibleTabs = tabs.filter((t) => !t.adminOnly || isAdmin);

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Policies & Letters</h1>
          <p className="text-gray-500 text-sm mt-0.5">Company policies, letters, and branding management</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 bg-gray-100/60 rounded-xl p-1 w-fit">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <Suspense fallback={<div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-indigo-600" /></div>}>
        {activeTab === 'policies' && <PoliciesTab isAdmin={!!isAdmin} canDelete={!!user && ['SUPER_ADMIN', 'ADMIN'].includes(user.role)} />}
        {activeTab === 'letters' && isAdmin && <LettersTab />}
        {activeTab === 'branding' && isAdmin && <BrandingTab />}
      </Suspense>
    </div>
  );
}

/* ================================================================== */
/*  Policies Tab (refactored from original page)                       */
/* ================================================================== */
function PoliciesTab({ isAdmin, canDelete }: { isAdmin: boolean; canDelete: boolean }) {
  const [viewingPolicy, setViewingPolicy] = useState<any | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { data: policiesRes, isLoading } = useGetPoliciesQuery();
  const [acknowledgePolicy] = useAcknowledgePolicyMutation();
  const [deletePolicy] = useDeletePolicyMutation();

  const policies = policiesRes?.data || [];

  const handleAcknowledge = async (id: string) => {
    try {
      await acknowledgePolicy(id).unwrap();
      toast.success('Policy acknowledged');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Already acknowledged');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this policy? This action cannot be undone.')) return;
    setDeletingId(id);
    try {
      await deletePolicy(id).unwrap();
      toast.success('Policy deleted');
    } catch {
      toast.error('Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={18} /> Upload Policy
          </motion.button>
        </div>
      )}

      {policies.length === 0 ? (
        <div className="layer-card p-16 text-center">
          <FileText size={48} className="mx-auto text-gray-200 mb-4" />
          <h3 className="text-lg font-display font-semibold text-gray-600">No policies found</h3>
          <p className="text-sm text-gray-400 mt-1">Policies will appear here once HR uploads them.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {policies.map((policy: any, index: number) => (
            <motion.div
              key={policy.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="layer-card p-5 flex flex-col"
            >
              <div className="flex items-start gap-3 mb-3">
                <div className="p-2 rounded-lg bg-surface-2">
                  <FileText size={18} className="text-brand-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-gray-800 truncate">{policy.title}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    v{policy.version} &middot; {formatDate(policy.updatedAt)}
                  </p>
                  {policy.fileName && (
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{policy.fileName}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    {policy.downloadAllowed ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 font-medium">Download allowed</span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-medium">View only</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-gray-50 mt-auto">
                <span className="text-xs text-gray-400">
                  {policy._count?.acknowledgments || 0} acknowledged
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setViewingPolicy(policy)}
                    className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1"
                  >
                    <Eye size={14} /> Read
                  </button>
                  {policy.acknowledgments?.length > 0 ? (
                    <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                      <Check size={14} /> Acknowledged
                    </span>
                  ) : (
                    <button
                      onClick={() => handleAcknowledge(policy.id)}
                      className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1"
                    >
                      <Check size={14} /> Acknowledge
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => handleDelete(policy.id)}
                      disabled={deletingId === policy.id}
                      className="text-xs text-red-500 hover:text-red-700 font-medium flex items-center gap-1 disabled:opacity-50"
                    >
                      {deletingId === policy.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Create Policy Modal */}
      <AnimatePresence>
        {showCreateModal && <CreatePolicyModal onClose={() => setShowCreateModal(false)} />}
      </AnimatePresence>

      {/* Secure Policy Viewer */}
      {viewingPolicy && (
        <SecureDocumentViewer
          streamUrl={`/policies/${viewingPolicy.id}/stream`}
          title={viewingPolicy.title}
          downloadAllowed={viewingPolicy.downloadAllowed}
          downloadUrl={`/policies/${viewingPolicy.id}/download`}
          onClose={() => setViewingPolicy(null)}
        />
      )}
    </div>
  );
}

/* ================================================================== */
/*  Create Policy Modal                                                 */
/* ================================================================== */
function CreatePolicyModal({ onClose }: { onClose: () => void }) {
  const [createPolicy, { isLoading }] = useCreatePolicyMutation();
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [downloadAllowed, setDownloadAllowed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      toast.error('Please select a PDF or document file');
      return;
    }
    try {
      const formData = new FormData();
      formData.append('title', title);
      formData.append('file', file);
      formData.append('downloadAllowed', String(downloadAllowed));
      await createPolicy(formData).unwrap();
      toast.success('Policy uploaded!');
      onClose();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to upload policy');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-glass-lg w-full max-w-lg p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-display font-semibold text-gray-800">Upload Policy</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X size={18} className="text-gray-400" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Title *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input-glass w-full"
              placeholder="e.g. Leave & Attendance Policy"
              required
            />
          </div>

          {/* File upload area */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Document *</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-200 rounded-xl p-6 text-center hover:border-brand-400 hover:bg-brand-50/30 transition-colors group"
            >
              {file ? (
                <div className="flex items-center justify-center gap-3">
                  <FileText size={24} className="text-brand-500" />
                  <div className="text-left">
                    <p className="text-sm font-medium text-gray-800 truncate max-w-[280px]">{file.name}</p>
                    <p className="text-xs text-gray-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    className="p-1 hover:bg-gray-100 rounded"
                  >
                    <X size={14} className="text-gray-400" />
                  </button>
                </div>
              ) : (
                <div>
                  <Upload size={28} className="mx-auto text-gray-300 group-hover:text-brand-400 mb-2" />
                  <p className="text-sm text-gray-500">Click to upload PDF or DOC file</p>
                  <p className="text-xs text-gray-400 mt-1">Max 10MB</p>
                </div>
              )}
            </button>
          </div>

          {/* Download permission */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={downloadAllowed} onChange={(e) => setDownloadAllowed(e.target.checked)}
              className="accent-indigo-600 w-4 h-4" />
            <span className="text-sm text-gray-700">Allow employees to download this policy</span>
          </label>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <motion.button
              type="submit"
              disabled={isLoading || !file}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isLoading && <Loader2 size={16} className="animate-spin" />} Upload
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
