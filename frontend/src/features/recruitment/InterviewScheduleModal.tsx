import { useState } from 'react';
import { X, Calendar, User, Clock, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAddInterviewScoreMutation } from './recruitmentApi';
import toast from 'react-hot-toast';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  applicationId: string;
  nextRound: number;
}

export default function InterviewScheduleModal({ isOpen, onClose, applicationId, nextRound }: Props) {
  const [form, setForm] = useState({
    round: nextRound,
    interviewerName: '',
    date: '',
    time: '',
    type: 'TECHNICAL' as string,
    notes: '',
  });

  const [addScore, { isLoading }] = useAddInterviewScoreMutation();

  const handleSubmit = async () => {
    try {
      await addScore({
        applicationId,
        round: form.round,
        notes: `Interview scheduled: ${form.type} round with ${form.interviewerName} on ${form.date} at ${form.time}. ${form.notes}`,
      }).unwrap();
      toast.success('Interview scheduled');
      onClose();
    } catch {
      toast.error('Failed to schedule interview');
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-display font-bold text-gray-900">Schedule Interview</h3>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Round</label>
                  <input type="number" min={1} value={form.round}
                    onChange={e => setForm({ ...form, round: parseInt(e.target.value) })}
                    className="input-glass w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="input-glass w-full">
                    <option value="TECHNICAL">Technical</option>
                    <option value="HR">HR</option>
                    <option value="CULTURAL_FIT">Cultural Fit</option>
                    <option value="FINAL">Final</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Interviewer</label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={form.interviewerName}
                    onChange={e => setForm({ ...form, interviewerName: e.target.value })}
                    className="input-glass w-full pl-10" placeholder="Interviewer name" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input type="date" value={form.date}
                    onChange={e => setForm({ ...form, date: e.target.value })}
                    className="input-glass w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Time</label>
                  <input type="time" value={form.time}
                    onChange={e => setForm({ ...form, time: e.target.value })}
                    className="input-glass w-full" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  className="input-glass w-full h-20 resize-none" placeholder="Additional notes..." />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="btn-secondary">Cancel</button>
                <button onClick={handleSubmit} disabled={isLoading || !form.date || !form.time}
                  className="btn-primary flex items-center gap-2">
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
                  Schedule
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
