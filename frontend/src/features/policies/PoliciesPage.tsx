import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Check, Plus, X, Eye, Upload, Loader2, Download } from 'lucide-react';
import { useGetPoliciesQuery, useAcknowledgePolicyMutation, useCreatePolicyMutation } from './policyApi';
import { useAppSelector } from '../../app/store';
import { formatDate } from '../../lib/utils';
import toast from 'react-hot-toast';

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];

/** Build an absolute URL for a policy file stored on the backend */
function getFileUrl(filePath: string) {
  const base = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
  // Remove /api suffix — files are served from the server root
  const serverRoot = base.replace(/\/api\/?$/, '');
  return `${serverRoot}${filePath}`;
}

export default function PoliciesPage() {
  const [viewingPolicy, setViewingPolicy] = useState<any | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { data: policiesRes } = useGetPoliciesQuery();
  const [acknowledgePolicy] = useAcknowledgePolicyMutation();
  const user = useAppSelector((s) => s.auth.user);

  const policies = policiesRes?.data || [];
  const canCreate = user && ADMIN_ROLES.includes(user.role);

  const handleAcknowledge = async (id: string) => {
    try {
      await acknowledgePolicy(id).unwrap();
      toast.success('Policy acknowledged');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Already acknowledged');
    }
  };

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Policies</h1>
          <p className="text-gray-500 text-sm mt-0.5">Company policies and guidelines</p>
        </div>
        {canCreate && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={18} /> Upload Policy
          </motion.button>
        )}
      </div>

      {/* Policy cards */}
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
                  <button
                    onClick={() => handleAcknowledge(policy.id)}
                    className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1"
                  >
                    <Check size={14} /> Acknowledge
                  </button>
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

      {/* Policy Viewer Modal — inline PDF/doc reader */}
      <AnimatePresence>
        {viewingPolicy && (
          <PolicyViewerModal policy={viewingPolicy} onClose={() => setViewingPolicy(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Create Policy Modal — title + file upload only                    */
/* ------------------------------------------------------------------ */
function CreatePolicyModal({ onClose }: { onClose: () => void }) {
  const [createPolicy, { isLoading }] = useCreatePolicyMutation();
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
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

/* ------------------------------------------------------------------ */
/*  Policy Viewer Modal — inline PDF reader / download fallback       */
/* ------------------------------------------------------------------ */
function PolicyViewerModal({ policy, onClose }: { policy: any; onClose: () => void }) {
  const fileUrl = policy.filePath ? getFileUrl(policy.filePath) : null;
  const isPdf = policy.fileName?.toLowerCase().endsWith('.pdf');

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
        className="bg-white rounded-2xl shadow-glass-lg w-full max-w-4xl flex flex-col"
        style={{ height: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-display font-semibold text-gray-800 truncate">{policy.title}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              v{policy.version} &middot; {formatDate(policy.updatedAt)}
              {policy.fileName && <> &middot; {policy.fileName}</>}
            </p>
          </div>
          <div className="flex items-center gap-2 ml-4">
            {fileUrl && (
              <a
                href={fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-gray-700"
                title="Download"
              >
                <Download size={18} />
              </a>
            )}
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              <X size={18} className="text-gray-400" />
            </button>
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-hidden">
          {fileUrl && isPdf ? (
            <iframe
              src={fileUrl}
              className="w-full h-full border-0"
              title={policy.title}
            />
          ) : fileUrl ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <FileText size={64} className="text-gray-200" />
              <p className="text-gray-500 text-sm">This document cannot be previewed in the browser.</p>
              <a
                href={fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="btn-primary flex items-center gap-2"
              >
                <Download size={16} /> Download Document
              </a>
            </div>
          ) : policy.content ? (
            <div className="p-6 overflow-y-auto h-full prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap leading-relaxed">
              {policy.content}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-gray-400">No document attached</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end px-6 py-3 border-t border-gray-100 shrink-0">
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
