import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, Loader2, ChevronDown } from 'lucide-react';
import { useImportAttendanceMutation } from '../attendanceApi';
import toast from 'react-hot-toast';

interface Props {
  onClose: () => void;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function ImportAttendanceModal({ onClose }: Props) {
  const now = new Date();
  // Default to previous month
  const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

  const [month, setMonth] = useState(prevMonth);
  const [year, setYear] = useState(prevYear);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<{ processed: number; skipped: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [importAttendance, { isLoading }] = useImportAttendanceMutation();

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  const handleFile = (f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls'].includes(ext ?? '')) {
      toast.error('Please upload an Excel file (.xlsx or .xls)');
      return;
    }
    setFile(f);
    setResult(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFile(dropped);
  };

  const handleSubmit = async () => {
    if (!file) { toast.error('Please select an Excel file'); return; }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('month', String(month));
    fd.append('year', String(year));
    try {
      const res = await importAttendance(fd).unwrap();
      setResult(res.data);
      if (res.data.errors.length === 0) {
        toast.success(`Import complete — ${res.data.processed} employees processed`);
      } else {
        toast.success(`Import done with ${res.data.errors.length} warning(s)`);
      }
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Import failed');
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.18 }}
          className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden z-10"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                <FileSpreadsheet size={16} className="text-indigo-600" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Import Attendance</h2>
                <p className="text-xs text-gray-400">Upload legacy Excel attendance sheet</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
              <X size={16} />
            </button>
          </div>

          <div className="p-6 space-y-5">
            {/* Month + Year selectors */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Month</label>
                <div className="relative">
                  <select
                    value={month}
                    onChange={e => setMonth(Number(e.target.value))}
                    className="w-full appearance-none pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
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
                    className="w-full appearance-none pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  >
                    {years.map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* File upload zone */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Excel File</label>
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl p-6 cursor-pointer transition-colors ${
                  dragOver
                    ? 'border-indigo-400 bg-indigo-50'
                    : file
                    ? 'border-emerald-300 bg-emerald-50'
                    : 'border-gray-200 bg-gray-50 hover:border-indigo-300 hover:bg-indigo-50/40'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
                {file ? (
                  <>
                    <CheckCircle2 size={24} className="text-emerald-500" />
                    <p className="text-sm font-medium text-emerald-700">{file.name}</p>
                    <p className="text-xs text-emerald-500">{(file.size / 1024).toFixed(1)} KB — Click to change</p>
                  </>
                ) : (
                  <>
                    <Upload size={24} className="text-gray-400" />
                    <p className="text-sm text-gray-600 font-medium">Drop Excel file here or click to browse</p>
                    <p className="text-xs text-gray-400">Supports .xlsx and .xls — max 10 MB</p>
                  </>
                )}
              </div>
            </div>

            {/* Legend */}
            <div className="bg-gray-50 rounded-xl p-3.5 space-y-1.5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Excel Code Legend</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {[
                  { code: 'P', label: 'Present', color: 'bg-emerald-400' },
                  { code: 'A', label: 'Absent', color: 'bg-red-400' },
                  { code: 'A(SL)', label: 'Sick Leave (1 day)', color: 'bg-purple-400' },
                  { code: 'A(CL)', label: 'Casual Leave (1 day)', color: 'bg-purple-400' },
                  { code: 'HD(CL)', label: 'Half Day CL (0.5 day)', color: 'bg-amber-400' },
                  { code: '~/blank', label: 'Skip (no change)', color: 'bg-gray-300' },
                ].map(({ code, label, color }) => (
                  <div key={code} className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />
                    <span className="text-xs text-gray-500"><span className="font-mono font-semibold text-gray-700">{code}</span> — {label}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-2">Rows without an EMP-xxx employee number are automatically skipped.</p>
            </div>

            {/* Result panel */}
            {result && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={`rounded-xl p-4 space-y-2 ${result.errors.length === 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}`}
              >
                <div className="flex items-center gap-2">
                  {result.errors.length === 0
                    ? <CheckCircle2 size={16} className="text-emerald-600" />
                    : <AlertTriangle size={16} className="text-amber-600" />
                  }
                  <span className="text-sm font-semibold text-gray-800">Import Complete</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-white rounded-lg py-2">
                    <p className="text-lg font-bold text-emerald-600">{result.processed}</p>
                    <p className="text-xs text-gray-500">Processed</p>
                  </div>
                  <div className="bg-white rounded-lg py-2">
                    <p className="text-lg font-bold text-gray-400">{result.skipped}</p>
                    <p className="text-xs text-gray-500">Skipped</p>
                  </div>
                  <div className="bg-white rounded-lg py-2">
                    <p className="text-lg font-bold text-red-500">{result.errors.length}</p>
                    <p className="text-xs text-gray-500">Errors</p>
                  </div>
                </div>
                {result.errors.length > 0 && (
                  <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
                    {result.errors.map((e, i) => (
                      <p key={i} className="text-xs text-amber-700 bg-amber-100 rounded px-2 py-1 font-mono">{e}</p>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              {result ? 'Close' : 'Cancel'}
            </button>
            {!result && (
              <button
                onClick={handleSubmit}
                disabled={!file || isLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {isLoading ? (
                  <><Loader2 size={14} className="animate-spin" /> Importing…</>
                ) : (
                  <><Upload size={14} /> Import {MONTHS[month - 1]} {year}</>
                )}
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
