import { useState } from 'react';
import { motion } from 'framer-motion';
import { User, MapPin, Phone, CreditCard, Shield, X, Loader2, Send } from 'lucide-react';
import { useCreateProfileEditRequestMutation } from './profileEditRequestApi';
import toast from 'react-hot-toast';

type Category = 'PERSONAL_DETAILS' | 'ADDRESS' | 'EMERGENCY_CONTACT' | 'BANK_DETAILS' | 'EPF_DETAILS';

const CATEGORIES: { id: Category; icon: any; title: string; description: string }[] = [
  { id: 'PERSONAL_DETAILS', icon: User, title: 'Personal Details', description: 'Name, DOB, gender, phone, personal email, blood group, marital status' },
  { id: 'ADDRESS', icon: MapPin, title: 'Address', description: 'Current residential address — street, city, state, pincode' },
  { id: 'EMERGENCY_CONTACT', icon: Phone, title: 'Emergency Contact', description: 'Name, phone, relationship and email of your emergency contact' },
  { id: 'BANK_DETAILS', icon: CreditCard, title: 'Bank Details', description: 'Bank account number, IFSC code, bank name, account holder name, account type' },
  { id: 'EPF_DETAILS', icon: Shield, title: 'EPF Details', description: 'EPF Member ID (UAN from previous employer) to opt into EPF deduction' },
];

type FieldDef = { key: string; label: string; type: 'text' | 'tel' | 'email' | 'date' | 'select'; options?: { v: string; l: string }[] };

const FORM_FIELDS: Record<Category, FieldDef[]> = {
  PERSONAL_DETAILS: [
    { key: 'firstName', label: 'First Name', type: 'text' },
    { key: 'lastName', label: 'Last Name', type: 'text' },
    { key: 'phone', label: 'Phone', type: 'tel' },
    { key: 'personalEmail', label: 'Personal Email', type: 'email' },
    { key: 'dateOfBirth', label: 'Date of Birth', type: 'date' },
    { key: 'gender', label: 'Gender', type: 'select', options: [
      { v: 'MALE', l: 'Male' }, { v: 'FEMALE', l: 'Female' },
      { v: 'OTHER', l: 'Other' }, { v: 'PREFER_NOT_TO_SAY', l: 'Prefer not to say' },
    ]},
    { key: 'bloodGroup', label: 'Blood Group', type: 'select', options: ['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(v => ({ v, l: v })) },
    { key: 'maritalStatus', label: 'Marital Status', type: 'select', options: [
      { v: 'Single', l: 'Single' }, { v: 'Married', l: 'Married' },
      { v: 'Divorced', l: 'Divorced' }, { v: 'Widowed', l: 'Widowed' },
    ]},
  ],
  ADDRESS: [
    { key: 'line1', label: 'Street Address', type: 'text' },
    { key: 'city', label: 'City', type: 'text' },
    { key: 'state', label: 'State', type: 'text' },
    { key: 'pincode', label: 'Pincode', type: 'text' },
  ],
  EMERGENCY_CONTACT: [
    { key: 'name', label: 'Contact Name', type: 'text' },
    { key: 'relationship', label: 'Relationship', type: 'select', options: [
      { v: 'SPOUSE', l: 'Spouse' }, { v: 'PARENT', l: 'Parent' },
      { v: 'SIBLING', l: 'Sibling' }, { v: 'FRIEND', l: 'Friend' }, { v: 'OTHER', l: 'Other' },
    ]},
    { key: 'phone', label: 'Phone', type: 'tel' },
    { key: 'email', label: 'Email (optional)', type: 'email' },
  ],
  BANK_DETAILS: [
    { key: 'accountHolderName', label: 'Account Holder Name', type: 'text' },
    { key: 'bankName', label: 'Bank Name', type: 'text' },
    { key: 'bankBranchName', label: 'Branch Name', type: 'text' },
    { key: 'bankAccountNumber', label: 'Account Number', type: 'text' },
    { key: 'ifscCode', label: 'IFSC Code', type: 'text' },
    { key: 'accountType', label: 'Account Type', type: 'select', options: [
      { v: 'SAVINGS', l: 'Savings' }, { v: 'CURRENT', l: 'Current' },
    ]},
  ],
  EPF_DETAILS: [
    { key: 'epfMemberId', label: 'EPF Member ID (Previous UAN)', type: 'text' },
  ],
};

interface Props {
  onClose: () => void;
  defaultCategory?: Category | undefined;
}

export default function ProfileUpdateRequestModal({ onClose, defaultCategory }: Props) {
  const [selected, setSelected] = useState<Category | null>(defaultCategory ?? null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [createRequest, { isLoading }] = useCreateProfileEditRequestMutation();

  const handleCategoryChange = (cat: Category) => {
    setSelected(cat);
    setFormData({});
  };

  const handleSubmit = async () => {
    if (!selected) return;
    const fields = FORM_FIELDS[selected];
    const hasData = fields.some(f => formData[f.key]?.trim());
    if (!hasData) {
      toast.error('Please fill in at least one field with the new value you want');
      return;
    }
    const requestedData: Record<string, string> = {};
    for (const f of fields) {
      if (formData[f.key]?.trim()) requestedData[f.key] = formData[f.key].trim();
    }
    try {
      await createRequest({ category: selected, requestedData }).unwrap();
      toast.success('Request submitted to HR for approval');
      onClose();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to submit request');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white rounded-2xl shadow-glass-lg w-full max-w-md flex flex-col"
        style={{ maxHeight: 'min(90dvh, 680px)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-display font-semibold text-gray-900">Request Profile Update</h2>
            <p className="text-xs text-gray-500 mt-0.5">Select section, fill new values. HR will review before changes apply.</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Category selector */}
          <div className="space-y-2">
            {CATEGORIES.map(cat => {
              const Icon = cat.icon;
              const active = selected === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => handleCategoryChange(cat.id)}
                  className={`w-full text-left p-3 rounded-xl border-2 transition-all flex items-center gap-3 ${
                    active ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-brand-300 hover:bg-brand-50/30'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${active ? 'bg-brand-600' : 'bg-gray-100'}`}>
                    <Icon size={15} className={active ? 'text-white' : 'text-gray-500'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{cat.title}</p>
                    <p className="text-xs text-gray-500 truncate">{cat.description}</p>
                  </div>
                  <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                    active ? 'border-brand-500 bg-brand-500' : 'border-gray-300'
                  }`}>
                    {active && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Form fields for selected category */}
          {selected && (
            <div className="border-t border-gray-100 pt-4 space-y-3">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Enter your new {CATEGORIES.find(c => c.id === selected)?.title} details
              </p>
              {FORM_FIELDS[selected].map(field => (
                <div key={field.key}>
                  <label className="block text-xs text-gray-500 mb-1">{field.label}</label>
                  {field.type === 'select' ? (
                    <select
                      value={formData[field.key] || ''}
                      onChange={e => setFormData(d => ({ ...d, [field.key]: e.target.value }))}
                      className="input-glass w-full text-sm"
                    >
                      <option value="">Select…</option>
                      {field.options?.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                    </select>
                  ) : (
                    <input
                      type={field.type}
                      value={formData[field.key] || ''}
                      onChange={e => setFormData(d => ({ ...d, [field.key]: e.target.value }))}
                      className={`input-glass w-full text-sm ${field.key === 'bankAccountNumber' || field.key === 'ifscCode' ? 'font-mono' : ''}`}
                      placeholder={`New ${field.label.toLowerCase()}`}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 shrink-0">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 mb-3">
            HR will review your request. Once approved, changes will be applied automatically within 48 hours.
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
