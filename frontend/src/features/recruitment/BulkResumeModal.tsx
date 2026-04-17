import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Upload, FileText, Loader2, CheckCircle2, AlertCircle, UserPlus, ChevronRight,
  ChevronDown, ChevronUp, Shield, Target, Star, Tag,
} from 'lucide-react';
import { useUploadBulkResumesMutation, useGetBulkUploadQuery, useCreateApplicationFromItemMutation } from './bulkResumeApi';
import { useGetJobOpeningsQuery } from './recruitmentApi';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

interface Props {
  onClose: () => void;
}

type Step = 'select-job' | 'upload' | 'processing' | 'results';

function scoreColor(score: number | null | undefined) {
  if (score == null) return 'bg-gray-50 text-gray-400';
  if (score >= 75) return 'bg-emerald-50 text-emerald-700';
  if (score >= 50) return 'bg-amber-50 text-amber-700';
  return 'bg-red-50 text-red-700';
}

/* Inline expandable row for ATS intelligence */
function ResumeIntelligenceRow({ item }: { item: any }) {
  const [open, setOpen] = useState(false);
  const details = item.aiScoreDetails as any;
  if (!details && !item.matchedKeywords?.length && !item.missingKeywords?.length) return null;

  const strengths: string[] = details?.strengths || [];
  const gaps: string[] = details?.gaps || [];
  const summary: string = details?.summary || '';
  const atsData = details?.atsScoreData;
  const matched: string[] = item.matchedKeywords || details?.matchedKeywords || [];
  const missing: string[] = item.missingKeywords || details?.missingKeywords || [];
  const parseMethod: string = details?.parseMethod || '';

  return (
    <>
      <tr>
        <td colSpan={7} className="px-3 pb-0">
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-1 text-[10px] text-brand-600 hover:text-brand-800 py-1"
          >
            {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {open ? 'Hide' : 'View'} Resume Intelligence
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="px-3 pb-3">
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 space-y-3 text-xs">
              {/* Parse method + summary */}
              {parseMethod && (
                <p className="text-gray-400">
                  Extracted via: <span className="font-medium text-gray-600">
                    {parseMethod === 'ai-ocr' ? 'AI OCR Service' : parseMethod === 'pdf-parse' ? 'PDF Text Extraction' : parseMethod}
                  </span>
                </p>
              )}
              {summary && (
                <p className="text-gray-600 bg-brand-50/60 rounded-lg p-2 italic border border-brand-100">{summary}</p>
              )}

              {/* ATS Breakdown */}
              {atsData?.breakdown && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-700 mb-2 flex items-center gap-1">
                    <Shield size={11} className="text-brand-500" /> ATS Breakdown
                  </p>
                  <div className="grid grid-cols-5 gap-2">
                    {[
                      { label: 'Sections', val: atsData.breakdown.sections, max: 25 },
                      { label: 'Keywords', val: atsData.breakdown.keywords, max: 35 },
                      { label: 'Contact', val: atsData.breakdown.contact, max: 15 },
                      { label: 'Quantified', val: atsData.breakdown.quantification, max: 15 },
                      { label: 'Parse', val: atsData.breakdown.parseQuality, max: 10 },
                    ].map(({ label, val, max }) => (
                      <div key={label} className="bg-white rounded-lg p-2 text-center border border-gray-100">
                        <div className="font-bold text-gray-800" data-mono>{val ?? '—'}<span className="font-normal text-gray-400">/{max}</span></div>
                        <div className="text-[9px] text-gray-500 mt-0.5">{label}</div>
                        <div className="w-full h-1 bg-gray-200 rounded-full mt-1 overflow-hidden">
                          <div className="h-full bg-brand-500 rounded-full" style={{ width: `${val != null ? (val / max) * 100 : 0}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Sections found/missing */}
                  {atsData.sectionsFound?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {atsData.sectionsFound.map((s: string) => (
                        <span key={s} className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-[9px]">✓ {s}</span>
                      ))}
                      {atsData.sectionsMissing?.map((s: string) => (
                        <span key={s} className="px-1.5 py-0.5 bg-red-50 text-red-600 rounded-full text-[9px]">✗ {s}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Strengths + Gaps */}
              {(strengths.length > 0 || gaps.length > 0) && (
                <div className="grid grid-cols-2 gap-3">
                  {strengths.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-emerald-700 mb-1.5 flex items-center gap-1">
                        <CheckCircle2 size={11} /> Strengths ({strengths.length})
                      </p>
                      <ul className="space-y-1">
                        {strengths.map((s, i) => (
                          <li key={i} className="flex items-start gap-1 bg-emerald-50/60 rounded px-2 py-1">
                            <span className="text-emerald-500 shrink-0">✓</span>
                            <span className="text-gray-700">{s}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {gaps.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-red-600 mb-1.5 flex items-center gap-1">
                        <AlertCircle size={11} /> Gaps / Missing ({gaps.length})
                      </p>
                      <ul className="space-y-1">
                        {gaps.map((g, i) => (
                          <li key={i} className="flex items-start gap-1 bg-red-50/60 rounded px-2 py-1">
                            <span className="text-red-400 shrink-0">✗</span>
                            <span className="text-gray-700">{g}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Keyword chips */}
              {(matched.length > 0 || missing.length > 0) && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-700 mb-1.5 flex items-center gap-1">
                    <Tag size={11} className="text-brand-500" /> JD Keyword Match
                  </p>
                  {matched.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {matched.map((kw) => (
                        <span key={kw} className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[9px] font-medium">
                          ✓ {kw}
                        </span>
                      ))}
                    </div>
                  )}
                  {missing.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {missing.map((kw) => (
                        <span key={kw} className="px-1.5 py-0.5 bg-red-50 text-red-600 border border-red-200 rounded-full text-[9px] font-medium">
                          ✗ {kw}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

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
  const items: any[] = upload?.items || [];
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
      toast.success(`${files.length} resumes uploaded for AI scoring!`);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Upload failed');
    }
  };

  const handleCreateApp = async (itemId: string) => {
    try {
      await createApp({ itemId, jobOpeningId: selectedJobId }).unwrap();
      toast.success('Application created in pipeline!');
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed');
    }
  };

  const scoredCount = items.filter(i => i.status === 'SCORED').length;
  const failedCount = items.filter(i => i.status === 'FAILED').length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-glass-lg w-full max-w-4xl overflow-y-auto" style={{ maxHeight: 'min(90dvh, calc(100dvh - 2rem))' }}>

        {/* Header */}
        <div className="flex items-center justify-between sticky top-0 bg-white z-10 px-6 pt-6 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-display font-semibold text-gray-800">Bulk Resume Upload</h2>
            <p className="text-xs text-gray-400">AI-powered OCR scoring — real analysis, no fake data</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        <div className="px-6 py-5">
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
                <p className="text-xs text-gray-400 mt-1">Resumes will be scored against this job's description and requirements</p>
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
                <p className="text-sm font-medium text-gray-600">Drop resume files here or click to browse</p>
                <p className="text-xs text-gray-400 mt-1">PDF, DOC, DOCX — Up to 50 files, 100 MB each</p>
                <p className="text-xs text-gray-300 mt-0.5">AI OCR automatically extracts text from scanned PDFs</p>
                <input id="file-input" type="file" multiple accept=".pdf,.doc,.docx" onChange={handleFileSelect} className="hidden" />
              </div>

              {files.length > 0 && (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <FileText size={16} className="text-brand-500" />
                        <span className="text-sm text-gray-700 truncate max-w-[300px]">{f.name}</span>
                        <span className="text-[10px] text-gray-400">
                          {f.size > 1024 * 1024 ? `${(f.size / (1024 * 1024)).toFixed(1)} MB` : `${(f.size / 1024).toFixed(0)} KB`}
                        </span>
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
                <p className="text-sm font-medium text-gray-700">Scoring resumes with AI OCR pipeline...</p>
                <p className="text-xs text-gray-400 mt-1">
                  {upload?.processedFiles || 0} / {upload?.totalFiles || files.length} processed
                </p>
              </div>
              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-brand-600 rounded-full transition-all duration-500"
                  style={{ width: `${((upload?.processedFiles || 0) / (upload?.totalFiles || 1)) * 100}%` }} />
              </div>
              {items.length > 0 && (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {items.map((item: any) => (
                    <div key={item.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                      {item.status === 'SCORED' ? <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                        : item.status === 'FAILED' ? <AlertCircle size={14} className="text-red-500 shrink-0" />
                        : <Loader2 size={14} className="animate-spin text-gray-400 shrink-0" />}
                      <span className="text-gray-600 truncate flex-1">{item.fileName}</span>
                      {item.aiScore != null && (
                        <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${scoreColor(Number(item.aiScore))}`}>
                          {Number(item.aiScore).toFixed(0)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 4: Results with full ATS intelligence */}
          {step === 'results' && (
            <div className="space-y-4">
              {/* Summary bar */}
              <div className="flex items-center gap-4 bg-gray-50 rounded-xl p-3 text-xs">
                <div className="flex items-center gap-1.5 text-emerald-700">
                  <CheckCircle2 size={14} /> <strong>{scoredCount}</strong> scored
                </div>
                {failedCount > 0 && (
                  <div className="flex items-center gap-1.5 text-red-600">
                    <AlertCircle size={14} /> <strong>{failedCount}</strong> failed
                  </div>
                )}
                <div className="ml-auto text-gray-400">
                  Click "View Resume Intelligence" on each row for detailed analysis
                </div>
              </div>

              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left py-2 px-3 font-medium text-gray-500">#</th>
                      <th className="text-left py-2 px-3 font-medium text-gray-500">Candidate</th>
                      <th className="text-left py-2 px-3 font-medium text-gray-500">Contact</th>
                      <th className="text-center py-2 px-3 font-medium text-gray-500 flex items-center justify-center gap-1">
                        <Star size={11} /> AI Score
                      </th>
                      <th className="text-center py-2 px-3 font-medium text-gray-500">
                        <span className="flex items-center justify-center gap-1"><Shield size={11} /> ATS</span>
                      </th>
                      <th className="text-center py-2 px-3 font-medium text-gray-500">Status</th>
                      <th className="text-right py-2 px-3 font-medium text-gray-500">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items
                      .slice()
                      .sort((a, b) => (Number(b.aiScore) || 0) - (Number(a.aiScore) || 0))
                      .map((item: any, i: number) => (
                      <React.Fragment key={item.id}>
                        <tr className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="py-2 px-3 text-gray-400 font-mono" data-mono>{i + 1}</td>
                          <td className="py-2 px-3">
                            <p className="text-gray-800 font-medium">{item.candidateName || item.fileName}</p>
                            <p className="text-[10px] text-gray-400 truncate max-w-[150px]">{item.fileName}</p>
                          </td>
                          <td className="py-2 px-3">
                            {item.email && <p className="text-gray-600 truncate max-w-[140px]">{item.email}</p>}
                            {item.phone && <p className="text-gray-400">{item.phone}</p>}
                            {!item.email && !item.phone && <span className="text-gray-300">—</span>}
                          </td>
                          <td className="py-2 px-3 text-center">
                            {item.aiScore != null ? (
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${scoreColor(Number(item.aiScore))}`}>
                                {Number(item.aiScore).toFixed(0)}/100
                              </span>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="py-2 px-3 text-center">
                            {item.atsScore != null ? (
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${scoreColor(Number(item.atsScore))}`}>
                                {Number(item.atsScore).toFixed(0)}/100
                              </span>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="py-2 px-3 text-center">
                            {item.status === 'SCORED' && <span className="text-emerald-600 font-medium">Scored</span>}
                            {item.status === 'FAILED' && (
                              <span className="text-red-500" title={item.errorMessage || ''}>Failed</span>
                            )}
                            {item.status === 'PENDING' && <span className="text-gray-400">Pending</span>}
                            {item.status === 'PROCESSING' && <span className="text-brand-500">Processing</span>}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {item.applicationId ? (
                              <span className="text-emerald-600 text-[10px] font-medium">Applied ✓</span>
                            ) : item.status === 'SCORED' ? (
                              <button onClick={() => handleCreateApp(item.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-brand-50 text-brand-700 rounded-lg hover:bg-brand-100 transition-colors">
                                <UserPlus size={10} /> Add to Pipeline
                              </button>
                            ) : null}
                          </td>
                        </tr>
                        {/* Expandable intelligence row */}
                        {item.status === 'SCORED' && <ResumeIntelligenceRow item={item} />}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              <button onClick={onClose} className="btn-primary w-full">Done</button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
