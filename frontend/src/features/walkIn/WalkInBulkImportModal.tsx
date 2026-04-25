import { useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Upload, FileText, Loader2, CheckCircle2, AlertCircle, Download, Users } from 'lucide-react';
import { useBulkImportWalkInsMutation, useSendWalkInWhatsAppInviteMutation } from './walkInApi';
import toast from 'react-hot-toast';

interface Props {
  onClose: () => void;
}

const CSV_TEMPLATE = `fullName,phone,email,position,experienceYears
Rahul Gupta,9876543210,rahul@example.com,HR Executive,3
Priya Sharma,9811112222,priya@example.com,Software Engineer,5`;

export default function WalkInBulkImportModal({ onClose }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number; candidates: any[] } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sendingWa, setSendingWa] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [bulkImport, { isLoading: importing }] = useBulkImportWalkInsMutation();
  const [sendInvite] = useSendWalkInWhatsAppInviteMutation();

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && (dropped.name.endsWith('.csv') || dropped.type.includes('csv') || dropped.type === 'text/plain')) {
      setFile(dropped);
    } else {
      toast.error('Please drop a CSV file');
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setFile(e.target.files[0]);
  };

  const handleImport = async () => {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await bulkImport(formData).unwrap();
      setResult(res.data);
      toast.success(res.message);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Import failed');
    }
  };

  const handleSendWa = async (candidate: any) => {
    setSendingWa(prev => ({ ...prev, [candidate.id]: true }));
    try {
      await sendInvite({
        phone: candidate.phone,
        candidateName: candidate.fullName,
        position: candidate.appliedPosition || 'Open Position',
        interviewDate: 'To be confirmed',
        interviewTime: 'To be confirmed',
      }).unwrap();
      toast.success(`WhatsApp invite sent to ${candidate.fullName}`);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to send WhatsApp invite');
    } finally {
      setSendingWa(prev => ({ ...prev, [candidate.id]: false }));
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'walkin_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, y: 16 }} animate={{ scale: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-glass-lg w-full max-w-2xl overflow-hidden"
        style={{ maxHeight: 'min(90dvh, calc(100dvh - 2rem))' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center">
              <Users size={18} className="text-brand-600" />
            </div>
            <div>
              <h2 className="text-base font-display font-semibold text-gray-800">Bulk Import Candidates</h2>
              <p className="text-xs text-gray-400">Import from Naukri, Indeed, or any CSV export</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X size={16} className="text-gray-400" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto" style={{ maxHeight: 'calc(90dvh - 100px)' }}>
          {!result ? (
            <>
              {/* Template download */}
              <div className="flex items-center justify-between bg-brand-50 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-brand-800">Required columns: fullName, phone</p>
                  <p className="text-xs text-brand-600 mt-0.5">Optional: email, position, experienceYears</p>
                </div>
                <button onClick={downloadTemplate} className="flex items-center gap-1.5 text-xs text-brand-700 font-medium px-3 py-1.5 bg-white rounded-lg border border-brand-200 hover:bg-brand-100 transition-colors">
                  <Download size={13} /> Download Template
                </button>
              </div>

              {/* Drop zone */}
              <div
                onDrop={handleDrop}
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors ${
                  isDragging ? 'border-brand-400 bg-brand-50' : 'border-gray-200 hover:border-brand-300'
                }`}
              >
                <Upload size={36} className="mx-auto text-gray-300 mb-3" />
                {file ? (
                  <div className="flex items-center justify-center gap-2">
                    <FileText size={18} className="text-brand-500" />
                    <span className="text-sm font-medium text-gray-700">{file.name}</span>
                    <span className="text-xs text-gray-400">({(file.size / 1024).toFixed(0)} KB)</span>
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-medium text-gray-600">Drop your CSV file here or click to browse</p>
                    <p className="text-xs text-gray-400 mt-1">Max 200 candidates per import, 5 MB</p>
                  </>
                )}
                <input ref={fileInputRef} type="file" accept=".csv,text/csv,text/plain" onChange={handleFileSelect} className="hidden" />
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button onClick={onClose} className="btn-secondary flex-1 text-sm">Cancel</button>
                <button
                  disabled={!file || importing}
                  onClick={handleImport}
                  className="btn-primary flex-1 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {importing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                  {importing ? 'Importing...' : 'Import Candidates'}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Import result summary */}
              <div className="flex items-center gap-4 bg-gray-50 rounded-xl p-4">
                <div className="flex items-center gap-2 text-emerald-700">
                  <CheckCircle2 size={18} />
                  <span className="text-sm font-semibold">{result.created} imported</span>
                </div>
                {result.skipped > 0 && (
                  <div className="flex items-center gap-2 text-amber-600">
                    <AlertCircle size={16} />
                    <span className="text-sm">{result.skipped} skipped (duplicates)</span>
                  </div>
                )}
              </div>

              {/* Imported candidates table */}
              {result.candidates.length > 0 && (
                <div className="border border-gray-100 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="text-left py-2 px-3 font-medium text-gray-500">Token</th>
                        <th className="text-left py-2 px-3 font-medium text-gray-500">Name</th>
                        <th className="text-left py-2 px-3 font-medium text-gray-500">Phone</th>
                        <th className="text-left py-2 px-3 font-medium text-gray-500">Position</th>
                        <th className="text-right py-2 px-3 font-medium text-gray-500">Invite</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.candidates.map((c: any) => (
                        <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="py-2 px-3 font-mono text-gray-500 text-[10px]">{c.tokenNumber}</td>
                          <td className="py-2 px-3 text-gray-800 font-medium">{c.fullName}</td>
                          <td className="py-2 px-3 text-gray-600">{c.phone}</td>
                          <td className="py-2 px-3 text-gray-500">{c.appliedPosition || '—'}</td>
                          <td className="py-2 px-3 text-right">
                            <button
                              disabled={sendingWa[c.id]}
                              onClick={() => handleSendWa(c)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors disabled:opacity-50"
                            >
                              {sendingWa[c.id] ? <Loader2 size={10} className="animate-spin" /> : '💬'}
                              WhatsApp
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <button onClick={onClose} className="btn-primary w-full text-sm">Done</button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
