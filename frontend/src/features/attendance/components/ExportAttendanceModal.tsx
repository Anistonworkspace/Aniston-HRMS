import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, FileSpreadsheet, ChevronDown, Loader2 } from 'lucide-react';
import { useAuthDownload } from '../../../hooks/useAuthDownload';

interface Props {
  onClose: () => void;
  defaultDate?: string; // pre-fill from current filter date
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function ExportAttendanceModal({ onClose, defaultDate }: Props) {
  const now = defaultDate ? new Date(defaultDate) : new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear]   = useState(now.getFullYear());

  const { download, downloading } = useAuthDownload();
  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  const handleExport = async () => {
    const monthName = MONTHS[month - 1];
    await download(
      `/attendance/export?month=${month}&year=${year}`,
      `attendance-${monthName}-${year}.xlsx`,
    );
    onClose();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.16 }}
          className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden z-10"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                <FileSpreadsheet size={16} className="text-emerald-600" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Export Attendance</h2>
                <p className="text-xs text-gray-400">Download monthly Excel report</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
              <X size={16} />
            </button>
          </div>

          <div className="p-5 space-y-4">
            {/* Month + Year selectors */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Month</label>
                <div className="relative">
                  <select
                    value={month}
                    onChange={e => setMonth(Number(e.target.value))}
                    className="w-full appearance-none pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  >
                    {MONTHS.map((m, i) => (
                      <option key={i + 1} value={i + 1}>{m}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Year</label>
                <div className="relative">
                  <select
                    value={year}
                    onChange={e => setYear(Number(e.target.value))}
                    className="w-full appearance-none pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  >
                    {years.map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* Preview label */}
            <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-center gap-2">
              <Download size={14} className="text-gray-400" />
              <span className="text-xs text-gray-500">
                Will download: <span className="font-semibold text-gray-700">attendance-{MONTHS[month - 1]}-{year}.xlsx</span>
              </span>
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={!!downloading}
              className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {downloading
                ? <><Loader2 size={14} className="animate-spin" /> Downloading…</>
                : <><Download size={14} /> Download</>
              }
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
