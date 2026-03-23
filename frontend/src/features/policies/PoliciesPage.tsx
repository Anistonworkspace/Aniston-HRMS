import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Check, Plus, X, Eye, Shield, BookOpen, Users, Laptop, Heart } from 'lucide-react';
import { useGetPoliciesQuery, useAcknowledgePolicyMutation } from './policyApi';
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

export default function PoliciesPage() {
  const [selectedCategory, setSelectedCategory] = useState('');
  const [viewingPolicy, setViewingPolicy] = useState<string | null>(null);
  const { data: policiesRes } = useGetPoliciesQuery({ category: selectedCategory || undefined });
  const [acknowledgePolicy] = useAcknowledgePolicyMutation();

  const policies = policiesRes?.data || [];
  const categories = Object.keys(CATEGORY_LABELS);

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
    </div>
  );
}
