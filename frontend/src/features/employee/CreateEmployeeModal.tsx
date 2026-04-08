import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Send, Mail, CheckCircle2, DollarSign } from 'lucide-react';
import { useInviteEmployeeMutation } from './employeeApi';
import { useGetSalaryTemplatesQuery } from '../payroll/salaryTemplateApi';
import { useApplyTemplateMutation } from '../payroll/salaryTemplateApi';
import { formatCurrency } from '../../lib/utils';
import toast from 'react-hot-toast';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CreateEmployeeModal({ open, onClose }: Props) {
  const [inviteEmployee, { isLoading }] = useInviteEmployeeMutation();
  const { data: templatesRes } = useGetSalaryTemplatesQuery();
  const [applyTemplate] = useApplyTemplateMutation();
  const templates = templatesRes?.data || [];
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [success, setSuccess] = useState<{ email: string; code: string; url: string; employeeId?: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error('Email is required');
      return;
    }
    try {
      const result = await inviteEmployee({
        email: email.trim(),
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
      }).unwrap();
      const employeeId = result?.data?.employeeId;
      setSuccess({
        email: email.trim(),
        code: result?.data?.employeeCode || 'N/A',
        url: result?.data?.onboardingUrl || '',
        employeeId,
      });
      toast.success(result.message || 'Invitation sent!');

      // Auto-apply salary template if selected
      if (selectedTemplateId && employeeId) {
        try {
          await applyTemplate({
            templateId: selectedTemplateId,
            employeeIds: [employeeId],
            effectiveFrom: new Date().toISOString().split('T')[0],
            reason: 'Applied during employee creation',
            confirmOverwrite: true,
          }).unwrap();
          toast.success('Salary template applied');
        } catch {
          // Non-blocking — template apply failure shouldn't block invitation
          toast('Salary template will need to be applied manually', { icon: '⚠️' });
        }
      }
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to send invitation');
    }
  };

  const handleClose = () => {
    setEmail('');
    setFirstName('');
    setLastName('');
    setSelectedTemplateId('');
    setSuccess(null);
    onClose();
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={(e) => e.target === e.currentTarget && handleClose()}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-white rounded-2xl shadow-glass-lg w-full max-w-md p-6"
        >
          {success ? (
            /* Success State */
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              </div>
              <h2 className="text-lg font-display font-bold text-gray-900 mb-2">Invitation Sent!</h2>
              <p className="text-sm text-gray-500 mb-4">
                An onboarding invitation has been sent to <span className="font-medium text-gray-700">{success.email}</span>
              </p>
              <div className="bg-gray-50 rounded-xl p-4 mb-4 text-left space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Employee Code</span>
                  <span className="font-mono font-medium text-gray-700" data-mono>{success.code}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Status</span>
                  <span className="text-amber-600 font-medium">Pending Onboarding</span>
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-5">
                The employee will receive an email with a link to complete their profile, upload documents, and set their password.
              </p>
              <button onClick={handleClose} className="btn-primary w-full">Done</button>
            </div>
          ) : (
            /* Form State */
            <>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-lg font-display font-semibold text-gray-800">Add Employee</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Send onboarding invitation via email</p>
                </div>
                <button onClick={handleClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                  <X size={18} className="text-gray-400" />
                </button>
              </div>

              <div className="bg-blue-50 rounded-xl p-3 mb-5 flex items-start gap-2.5">
                <Mail className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <p className="text-xs text-blue-700 leading-relaxed">
                  Enter the employee's Microsoft email. They will receive an onboarding link to fill in their personal details, upload documents, and set their password.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">
                    Email Address <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input-glass w-full"
                    placeholder="employee@aniston.in"
                    required
                    autoFocus
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">First Name</label>
                    <input
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="input-glass w-full"
                      placeholder="Optional"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Last Name</label>
                    <input
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="input-glass w-full"
                      placeholder="Optional"
                    />
                  </div>
                </div>

                {/* Salary Template (optional) */}
                {templates.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1 flex items-center gap-1">
                      <DollarSign size={13} /> Salary Template <span className="text-xs text-gray-400 font-normal">(optional)</span>
                    </label>
                    <select
                      value={selectedTemplateId}
                      onChange={(e) => setSelectedTemplateId(e.target.value)}
                      className="input-glass w-full text-sm"
                    >
                      <option value="">No template — set salary later</option>
                      {templates.map((t: any) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.type.replace(/_/g, ' ')}) — {formatCurrency(Number(t.ctc))}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-gray-400 mt-1">Salary structure will be auto-applied when employee is created</p>
                  </div>
                )}

                <div className="flex gap-3 pt-3">
                  <button type="button" onClick={handleClose} className="btn-secondary flex-1">Cancel</button>
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    type="submit"
                    disabled={isLoading}
                    className="btn-primary flex-1 flex items-center justify-center gap-2"
                  >
                    {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    Send Invitation
                  </motion.button>
                </div>
              </form>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
