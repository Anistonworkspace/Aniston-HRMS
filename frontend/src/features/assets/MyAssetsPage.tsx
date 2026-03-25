import { motion } from 'framer-motion';
import {
  Laptop, Smartphone, CreditCard, Monitor, Package, Calendar, AlertCircle,
  Loader2, MessageSquare, Shield,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetMyAssetsQuery } from './assetApi';

const CATEGORIES: Record<string, { label: string; icon: any; color: string }> = {
  LAPTOP: { label: 'Laptop', icon: Laptop, color: 'bg-blue-50 text-blue-600' },
  MOBILE: { label: 'Mobile', icon: Smartphone, color: 'bg-purple-50 text-purple-600' },
  SIM_CARD: { label: 'SIM Card', icon: CreditCard, color: 'bg-emerald-50 text-emerald-600' },
  ACCESS_CARD: { label: 'Access Card', icon: CreditCard, color: 'bg-amber-50 text-amber-600' },
  VISITING_CARD: { label: 'Visiting Card', icon: CreditCard, color: 'bg-pink-50 text-pink-600' },
  MONITOR: { label: 'Monitor', icon: Monitor, color: 'bg-indigo-50 text-indigo-600' },
  OTHER: { label: 'Other', icon: Package, color: 'bg-gray-50 text-gray-600' },
};

const CONDITIONS: Record<string, { label: string; color: string }> = {
  EXCELLENT: { label: 'Excellent', color: 'bg-emerald-50 text-emerald-700' },
  GOOD: { label: 'Good', color: 'bg-blue-50 text-blue-700' },
  FAIR: { label: 'Fair', color: 'bg-amber-50 text-amber-700' },
  DAMAGED: { label: 'Damaged', color: 'bg-red-50 text-red-700' },
  LOST: { label: 'Lost', color: 'bg-gray-100 text-gray-500' },
};

export default function MyAssetsPage() {
  const { data: res, isLoading } = useGetMyAssetsQuery();
  const navigate = useNavigate();
  const assignments = res?.data || [];

  const handleRaiseTicket = (assignment: any) => {
    const asset = assignment.asset;
    const subject = `Issue with ${asset.name} (${asset.assetCode})`;
    // Navigate to helpdesk with pre-filled query params
    navigate(`/helpdesk?newTicket=true&category=IT Asset&subject=${encodeURIComponent(subject)}&assetId=${asset.id}`);
  };

  return (
    <div className="page-container">
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-gray-900 flex items-center gap-2">
          <Laptop className="text-brand-600" size={28} /> My Assets
        </h1>
        <p className="text-gray-500 text-sm mt-0.5">Assets currently assigned to you</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
        </div>
      ) : assignments.length === 0 ? (
        <div className="text-center py-16 layer-card">
          <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No assets assigned to you</p>
          <p className="text-gray-400 text-sm mt-1">When IT assigns equipment to you, it will appear here</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assignments.map((assignment: any, i: number) => {
            const asset = assignment.asset;
            const cat = CATEGORIES[asset?.category] || CATEGORIES.OTHER;
            const CatIcon = cat.icon;

            return (
              <motion.div
                key={assignment.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="layer-card p-5"
              >
                {/* Header */}
                <div className="flex items-start gap-3 mb-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${cat.color}`}>
                    <CatIcon size={24} />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900">{asset?.name}</h3>
                    {(asset?.brand || asset?.modelNumber) && (
                      <p className="text-xs text-gray-500">{[asset.brand, asset.modelNumber].filter(Boolean).join(' · ')}</p>
                    )}
                    <p className="text-xs font-mono text-gray-400" data-mono>{asset?.assetCode}</p>
                  </div>
                  <span className="text-xs bg-brand-50 text-brand-600 px-2 py-0.5 rounded-full font-medium">
                    {cat.label}
                  </span>
                </div>

                {/* Details */}
                <div className="space-y-2 mb-4">
                  {asset?.serialNumber && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Serial #</span>
                      <span className="font-mono text-gray-600" data-mono>{asset.serialNumber}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400 flex items-center gap-1"><Calendar size={12} /> Assigned</span>
                    <span className="text-gray-600">
                      {new Date(assignment.assignedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                  {asset?.condition && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Condition</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${CONDITIONS[asset.condition]?.color || ''}`}>
                        {CONDITIONS[asset.condition]?.label || asset.condition}
                      </span>
                    </div>
                  )}
                  {asset?.warrantyExpiry && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400 flex items-center gap-1"><Shield size={12} /> Warranty</span>
                      <span className="text-gray-600">{new Date(asset.warrantyExpiry).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                    </div>
                  )}
                </div>

                {/* Raise Ticket */}
                <button
                  onClick={() => handleRaiseTicket(assignment)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-xl text-sm font-medium hover:bg-amber-100 transition-colors"
                >
                  <MessageSquare size={14} /> Raise Ticket
                </button>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
