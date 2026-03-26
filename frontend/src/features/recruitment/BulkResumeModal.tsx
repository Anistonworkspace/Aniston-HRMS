import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  X, Upload, FileText, Loader2, CheckCircle2, AlertCircle, UserPlus, ChevronRight,
} from 'lucide-react';
import { useUploadBulkResumesMutation, useGetBulkUploadQuery, useCreateApplicationFromItemMutation } from './bulkResumeApi';
import { useGetJobOpeningsQuery } from './recruitmentApi';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

interface Props {
  onClose: () => void;
}

type Step = 'select-job' | 'upload' | 'processing' | 'results';

export default function BulkResumeModal({ onClose }: Props) {
  const [step, setStep] = useState<Step>('select-job');
  const [selectedJobId, setSelectedJobId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploadId, setUploadId] = useState<string | null>(null);

  const { data: jobsRes } = useGetJobOpeningsQuery({ page: 1, limit: 50 });
  const [uploadResumes, { isLoading: uploading }] = useUploadBulkResumesMutation();
  const { data: uploadRes, refetch } = useGetBulkUploadQuery(uploadId!, { skip: !uploadId, pollingInterval: step === 'processing' ? 3000 : 0 });
  const [createApp] = useCreateApplicationFromItemMutation();

  const jobs = jobsRes?.data || [];
  const upload = uploadRes?.data;
  const items = upload?.items || [];
  const isComplete = upload?.status === 'COMPLETED';

  useEffect(() => {
    if (isComplete && step === 'processing') setStep('results');
  }, [isComplete, step]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files).filter(f =>
      ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(f.type)
    );
    setFiles(prev => [...prev, ...droppedFiles].slice(0, 50));
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(prev => [...prev, ...Array.from(e.target.files!)].slice(0, 50));
    }
  };

  const handleUpload = async () => {
    if (!selectedJobId || files.length === 0) return;
    const formData = new FormData();
    formData.append('jobOpeningId', selectedJobId);
    files.forEach(f => formData.append('resumes', f));

    try {
      const result = await uploadResumes(formData).unwrap();
      setUploadId(result.data.upload.id);
      setStep('processing');
      toast.success(`${files.length} resumes uploaded!`);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Upload failed');
    }
  };

  const handleCreateApp = async (itemId: string) => {
    try {
      await createApp({ itemId, jobOpeningId: selectedJobId }).unwrap();
      toast.success('Application created!');
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed');
    }
  };

  const scoreColor = (score: number) => {
    if (score >= 80) return 'bg-emerald-50 text-emerald-700';
    if (score >= 60) return 'bg-amber-50 text-amber-700';
    return 'bg-red-50 text-red-700';
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-glass-lg p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-display font-semibold text-gray-800">Bulk Resume Upload</h2>
            <p className="text-xs text-gray-400">Upload multiple resumes for AI-powered scoring</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6">
          {['Select Job', 'Upload Files', 'Processing', 'Results'].map((label, i) => {
            const stepIdx = ['select-job', 'upload', 'processing', 'results'].indexOf(step);
            return (
              <div key={label} className="flex items-center gap-2">
                {i > 0 && <ChevronRight size={14} className="text-gray-300" />}
                <span className={cn('text-xs font-medium px-2 py-1 rounded-full',
                  i === stepIdx ? 'bg-brand-50 text-brand-700' : i < stepIdx ? 'bg-emerald-50 text-emerald-700' : 'text-gray-400')}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Step 1: Select Job */}
        {step === 'select-job' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2">Select Job Opening</label>
              <select value={selectedJobId} onChange={e => setSelectedJobId(e.target.value)} className="input-glass w-full">
                <option value="">Choose a job...</option>
                {jobs.map((job: any) => (
                  <option key={job.id} value={job.id}>{job.title} — {job.department} [{job.status}]</option>
                ))}
              </select>
            </div>
            <button disabled={!selectedJobId} onClick={() => setStep('upload')}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50">
              Continue <ChevronRight size={16} />
            </button>
          </div>
        )}

        {/* Step 2: Upload Files */}
        {step === 'upload' && (
          <div className="space-y-4">
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              className="border-2 border-dashed border-gray-200 rounded-2xl p-8 text-center hover:border-brand-400 transition-colors cursor-pointer"
              onClick={() => document.getElementById('file-input')?.click()}>
              <Upload size={40} className="mx-auto text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-600">Drop resume files here</p>
              <p className="text-xs text-gray-400 mt-1">PDF, DOC, DOCX — Max 50 files, 10MB each</p>
              <input id="file-input" type="file" multiple accept=".pdf,.doc,.docx" onChange={handleFileSelect} className="hidden" />
            </div>

            {files.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <FileText size={16} className="text-brand-500" />
                      <span className="text-sm text-gray-700 truncate max-w-[300px]">{f.name}</span>
                      <span className="text-[10px] text-gray-400">{(f.size / 1024).toFixed(0)} KB</span>
                    </div>
                    <button onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      className="text-gray-300 hover:text-red-500"><X size={14} /></button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setStep('select-job')} className="btn-secondary flex-1">Back</button>
              <button disabled={files.length === 0 || uploading} onClick={handleUpload}
                className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50">
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                Upload {files.length} Resume{files.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Processing */}
        {step === 'processing' && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <Loader2 size={32} className="animate-spin text-brand-600 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-700">Processing resumes with AI...</p>
              <p className="text-xs text-gray-400 mt-1">
                {upload?.processedFiles || 0} / {upload?.totalFiles || files.length} completed
              </p>
            </div>
            <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-brand-600 rounded-full transition-all duration-500"
                style={{ width: `${((upload?.processedFiles || 0) / (upload?.totalFiles || 1)) * 100}%` }} />
            </div>
            {items.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {items.map((item: any) => (
                  <div key={item.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                    {item.status === 'SCORED' ? <CheckCircle2 size={14} className="text-emerald-500" />
                      : item.status === 'FAILED' ? <AlertCircle size={14} className="text-red-500" />
                      : <Loader2 size={14} className="animate-spin text-gray-400" />}
                    <span className="text-gray-600 truncate">{item.fileName}</span>
                    {item.aiScore && <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-bold ${scoreColor(Number(item.aiScore))}`}>{Number(item.aiScore).toFixed(0)}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 4: Results */}
        {step === 'results' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 size={20} className="text-emerald-500" />
              <p className="text-sm font-medium text-gray-700">
                {items.filter((i: any) => i.status === 'SCORED').length} resumes scored successfully
              </p>
            </div>

            <div className="border border-gray-100 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left py-2 px-3 font-medium text-gray-500">#</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-500">Candidate</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-500">Contact</th>
                    <th className="text-center py-2 px-3 font-medium text-gray-500">Score</th>
                    <th className="text-center py-2 px-3 font-medium text-gray-500">Status</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-500">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any, i: number) => (
                    <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-2 px-3 text-gray-400 font-mono" data-mono>{i + 1}</td>
                      <td className="py-2 px-3">
                        <p className="text-gray-800 font-medium">{item.candidateName || item.fileName}</p>
                        <p className="text-[10px] text-gray-400 truncate max-w-[150px]">{item.fileName}</p>
                      </td>
                      <td className="py-2 px-3">
                        {item.email && <p className="text-gray-600">{item.email}</p>}
                        {item.phone && <p className="text-gray-400">{item.phone}</p>}
                        {!item.email && !item.phone && <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2 px-3 text-center">
                        {item.aiScore ? (
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${scoreColor(Number(item.aiScore))}`}>
                            {Number(item.aiScore).toFixed(0)}/100
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2 px-3 text-center">
                        {item.status === 'SCORED' && <span className="text-emerald-600">Scored</span>}
                        {item.status === 'FAILED' && <span className="text-red-500">Failed</span>}
                        {item.status === 'PENDING' && <span className="text-gray-400">Pending</span>}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {item.applicationId ? (
                          <span className="text-emerald-600 text-[10px] font-medium">Applied</span>
                        ) : item.status === 'SCORED' ? (
                          <button onClick={() => handleCreateApp(item.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-brand-50 text-brand-700 rounded-lg hover:bg-brand-100">
                            <UserPlus size={10} /> Create App
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button onClick={onClose} className="btn-primary w-full">Done</button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
