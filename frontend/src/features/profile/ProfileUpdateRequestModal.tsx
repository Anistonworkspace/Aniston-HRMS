import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, MapPin, Phone, CreditCard, X, Loader2, CheckCircle2, Send } from 'lucide-react';
import { useCreateProfileEditRequestMutation } from './profileEditRequestApi';
import toast from 'react-hot-toast';

type Category = 'PERSONAL_DETAILS' | 'ADDRESS' | 'EMERGENCY_CONTACT' | 'BANK_DETAILS';

const CATEGORIES: { id: Category; icon: any; title: string; description: string }[] = [
  {
    id: 'PERSONAL_DETAILS',
    icon: User,
    title: 'Personal Details',
    description: 'Name, date of birth, gender, blood group, marital status, personal email, phone',
  },
  {
    id: 'ADDRESS',
    icon: MapPin,
    title: 'Address',
    description: 'Current residential address — street, city, state, pincode',
  },
  {
    id: 'EMERGENCY_CONTACT',
    icon: Phone,
    title: 'Emergency Contact',
    description: 'Name, phone, relationship and email of your emergency contact person',
  },
  {
    id: 'BANK_DETAILS',
    icon: CreditCard,
    title: 'Bank Details',
    description: 'Bank account number, IFSC code, bank name, account holder name, account type',
  },
];

interface Props {
  onClose: () => void;
}

export default function ProfileUpdateRequestModal({ onClose }: Props) {
  const [selected, setSelected] = useState<Category | null>(null);
  const [createRequest, { isLoading }] = useCreateProfileEditRequestMutation();

  const handleSubmit = async () => {
    if (!selected) return;
    try {
      await createRequest({ category: selected, requestedData: {} }).unwrap();
      toast.success('Request submitted to HR for approval');
      onClose();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to submit request');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white rounded-2xl shadow-glass-lg w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-display font-semibold text-gray-900">Request Profile Update</h2>
            <p className="text-xs text-gray-500 mt-0.5">Select the section you want to update. HR will review your request.</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-2">
          {CATEGORIES.map(cat => {
            const Icon = cat.icon;
            const active = selected === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelected(cat.id)}
                className={`w-full text-left p-4 rounded-xl border-2 transition-all flex items-start gap-3 ${
                  active ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-brand-300 hover:bg-brand-50/30'
                }`}
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${active ? 'bg-brand-600' : 'bg-gray-100'}`}>
                  <Icon size={16} className={active ? 'text-white' : 'text-gray-500'} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{cat.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{cat.description}</p>
                </div>
                <div className={`w-4 h-4 rounded-full border-2 mt-1 shrink-0 flex items-center justify-center ${
                  active ? 'border-brand-500 bg-brand-500' : 'border-gray-300'
                }`}>
                  {active && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
              </button>
            );
          })}
        </div>

        <div className="px-5 pb-5">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 mb-4">
            HR will review and approve your request. Once approved, you'll have 48 hours to apply the changes.
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 text-sm">Cancel</button>
            <button
              type="button"
              disabled={!selected || isLoading}
              onClick={handleSubmit}
              className="btn-primary flex-1 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Submit Request
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
