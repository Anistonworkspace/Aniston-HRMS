import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Check, Plus, X, Eye, Shield, BookOpen, Users, Laptop, Heart, Loader2 } from 'lucide-react';
import { useGetPoliciesQuery, useGetPolicyQuery, useAcknowledgePolicyMutation, useCreatePolicyMutation } from './policyApi';
import { useAppSelector } from '../../app/store';
import { cn, formatDate } from '../../lib/utils';
import toast from 'react-hot-toast';

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  HR_GENERAL: <Users size={18} className="text-brand-500" />,
  LEAVE: <BookOpen size={18} className="text-purple-500" />,
  HYBRID: <Shield size={18} className="text-teal-500" />,
  WORK_MANAGEMENT: <FileText size={18} className="text-blue-500" />,
  ESCALATION: <FileText size={18} className="text-red-500" />,
  IT: <Laptop size={18} className="text-gray-500" />,
  CODE_OF_CONDUCT: <Shield size={18} className="text-amber-500" />,
  HEALTH_SAFETY: <Heart size={18} className="text-rose-500" />,
};

const CATEGORY_LABELS: Record<string, string> = {
  HR_GENERAL: 'HR General',
  LEAVE: 'Leave Policy',
  HYBRID: 'Hybrid Work',
  WORK_MANAGEMENT: 'Work Management',
  ESCALATION: 'Escalation',
  IT: 'IT Policy',
  CODE_OF_CONDUCT: 'Code of Conduct',
  HEALTH_SAFETY: 'Health & Safety',
};

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];

export default function PoliciesPage() {
  const [selectedCategory, setSelectedCategory] = useState('');
  const [viewingPolicy, setViewingPolicy] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { data: policiesRes } = useGetPoliciesQuery({ category: selectedCategory || undefined });
  const [acknowledgePolicy] = useAcknowledgePolicyMutation();
  const user = useAppSelector((s) => s.auth.user);

  const policies = policiesRes?.data || [];
  const categories = Object.keys(CATEGORY_LABELS);
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
            <Plus size={18} /> Create Policy
          </motion.button>
        )}
      </div>

      {/* Category filter chips */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setSelectedCategory('')}
          className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
            !selectedCategory ? 'bg-brand-600 text-white' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
          )}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5',
              selectedCategory === cat ? 'bg-brand-600 text-white' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
            )}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Policy cards */}
      {policies.length === 0 ? (
        <div className="layer-card p-16 text-center">
          <FileText size={48} className="mx-auto text-gray-200 mb-4" />
          <h3 className="text-lg font-display font-semibold text-gray-600">No policies found</h3>
          <p className="text-sm text-gray-400 mt-1">Policies will appear here once HR publishes them.</p>
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
                  {CATEGORY_ICONS[policy.category] || <FileText size={18} className="text-gray-400" />}
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-gray-800">{policy.title}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {CATEGORY_LABELS[policy.category] || policy.category} · v{policy.version}
                  </p>
                </div>
              </div>

              <p className="text-xs text-gray-500 line-clamp-2 mb-4 flex-1">
                {policy.content.substring(0, 120)}...
              </p>

              <div className="flex items-center justify-between pt-3 border-t border-gray-50">
                <span className="text-xs text-gray-400">
                  {policy._count?.acknowledgments || 0} acknowledged
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setViewingPolicy(policy.id)}
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

      {/* Policy Detail Modal */}
      <AnimatePresence>
        {viewingPolicy && <PolicyDetailModal policyId={viewingPolicy} onClose={() => setViewingPolicy(null)} />}
      </AnimatePresence>
    </div>
  );
}

function CreatePolicyModal({ onClose }: { onClose: () => void }) {
  const [createPolicy, { isLoading }] = useCreatePolicyMutation();
  const [form, setForm] = useState({ title: '', category: 'HR_GENERAL', content: '', version: '1.0' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createPolicy({
        title: form.title,
        category: form.category,
        content: form.content,
        version: form.version,
      }).unwrap();
      toast.success('Policy created!');
      onClose();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to create policy');
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
          <h2 className="text-lg font-display font-semibold text-gray-800">Create Policy</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X size={18} className="text-gray-400" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Title *</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="input-glass w-full"
              placeholder="e.g. Remote Work Policy"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Category *</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="input-glass w-full"
              >
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Version</label>
              <input
                value={form.version}
                onChange={(e) => setForm({ ...form, version: e.target.value })}
                className="input-glass w-full"
                placeholder="1.0"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Content *</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              className="input-glass w-full min-h-48 resize-y"
              placeholder="Write the full policy content here..."
              required
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <motion.button
              type="submit"
              disabled={isLoading}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              {isLoading && <Loader2 size={16} className="animate-spin" />} Create
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

function PolicyDetailModal({ policyId, onClose }: { policyId: string; onClose: () => void }) {
  const { data: policyRes, isLoading } = useGetPolicyQuery(policyId);
  const policy = policyRes?.data;

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
        className="bg-white rounded-2xl shadow-glass-lg w-full max-w-2xl p-6 max-h-[80vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-display font-semibold text-gray-800">
            {isLoading ? 'Loading...' : policy?.title || 'Policy'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-brand-500" />
          </div>
        ) : policy ? (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <span className={cn(
                'px-2.5 py-1 rounded-lg text-xs font-medium bg-brand-50 text-brand-700'
              )}>
                {CATEGORY_LABELS[policy.category] || policy.category}
              </span>
              <span className="text-xs text-gray-400 font-mono" data-mono>v{policy.version}</span>
              <span className="text-xs text-gray-400">
                {policy._count?.acknowledgments || 0} acknowledged
              </span>
            </div>
            <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap leading-relaxed">
              {policy.content}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-8">Policy not found</p>
        )}

        <div className="flex justify-end pt-4 mt-4 border-t border-gray-100">
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
