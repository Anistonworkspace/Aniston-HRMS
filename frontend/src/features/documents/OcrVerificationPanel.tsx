import { useState, useEffect } from 'react';
import { Shield, Save, Loader2, RotateCcw, AlertTriangle, CheckCircle2, XCircle, ScanLine, Eye, Pencil, Check } from 'lucide-react';
import { useGetDocumentOcrQuery, useTriggerDocumentOcrMutation, useUpdateDocumentOcrMutation } from './documentOcrApi';
import { useVerifyDocumentMutation } from './documentApi';
import { useVerifyKycMutation } from '../kyc/kycApi';
import toast from 'react-hot-toast';
import { cn, getUploadUrl } from '../../lib/utils';

interface Props {
  documentId: string;
  documentName: string;
  documentType: string;
  documentStatus?: string;
  employeeId?: string;
  fileUrl?: string;
  onClose: () => void;
}

const OCR_FIELDS = [
  { key: 'extractedName', label: 'Name' },
  { key: 'extractedDob', label: 'Date of Birth' },
  { key: 'extractedFatherName', label: "Father's Name" },
  { key: 'extractedMotherName', label: "Mother's Name" },
  { key: 'extractedDocNumber', label: 'Document Number' },
  { key: 'extractedGender', label: 'Gender' },
  { key: 'extractedAddress', label: 'Address' },
] as const;

type FieldKey = typeof OCR_FIELDS[number]['key'];

export default function OcrVerificationPanel({ documentId, documentName, documentType, documentStatus, employeeId, fileUrl, onClose }: Props) {
  const { data: ocrRes, isLoading, isError, refetch } = useGetDocumentOcrQuery(documentId);
  const [triggerOcr, { isLoading: triggering }] = useTriggerDocumentOcrMutation();
  const [updateOcr, { isLoading: saving }] = useUpdateDocumentOcrMutation();
  const [verifyDoc, { isLoading: verifyingDoc }] = useVerifyDocumentMutation();
  const [verifyKyc, { isLoading: verifyingKyc }] = useVerifyKycMutation();
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [hrNotes, setHrNotes] = useState('');
  const [ocrStatus, setOcrStatus] = useState('PENDING');

  const ocr = ocrRes?.data;

  useEffect(() => {
    if (ocr) {
      const f: Record<string, string> = {};
      OCR_FIELDS.forEach(({ key }) => { f[key] = ocr[key] || ''; });
      setFields(f);
      setHrNotes(ocr.hrNotes || '');
      setOcrStatus(ocr.ocrStatus || 'PENDING');
    }
  }, [ocr]);

  const handleTriggerOcr = async () => {
    try {
      await triggerOcr(documentId).unwrap();
      toast.success('OCR processing triggered');
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'OCR failed');
    }
  };

  const handleSave = async () => {
    try {
      await updateOcr({
        documentId,
        body: { ...fields, hrNotes, ocrStatus },
      }).unwrap();
      toast.success('OCR data saved');
      setEditing(false);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to save');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="ml-auto relative w-full max-w-2xl bg-white shadow-2xl overflow-y-auto animate-in slide-in-from-right">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ScanLine size={20} className="text-brand-600" />
            <div>
              <h2 className="text-lg font-display font-bold text-gray-900">OCR Verification</h2>
              <p className="text-xs text-gray-400">{documentName} - {documentType?.replace(/_/g, ' ')}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        <div className="p-6 space-y-6">
          {/* Document Preview */}
          {fileUrl && (
            <div className="layer-card p-4">
              <p className="text-xs font-medium text-gray-500 mb-2">Document Preview</p>
              <a href={getUploadUrl(fileUrl)} target="_blank" rel="noopener noreferrer"
                className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1.5">
                <Eye size={14} /> View Original Document
              </a>
            </div>
          )}

          {/* No OCR data yet */}
          {isError && (
            <div className="layer-card p-6 text-center">
              <ScanLine size={32} className="text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-500 mb-4">No OCR data available for this document</p>
              <button onClick={handleTriggerOcr} disabled={triggering}
                className="btn-primary text-sm flex items-center gap-2 mx-auto">
                {triggering ? <Loader2 size={14} className="animate-spin" /> : <ScanLine size={14} />}
                {triggering ? 'Processing...' : 'Run OCR Scan'}
              </button>
            </div>
          )}

          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="animate-spin text-gray-400 mr-2" />
              <span className="text-sm text-gray-400">Loading OCR data...</span>
            </div>
          )}

          {ocr && (
            <>
              {/* Quality Indicators */}
              <div className="layer-card p-4">
                <p className="text-xs font-semibold text-gray-600 mb-3">Image Quality Analysis</p>
                <div className="flex flex-wrap gap-2">
                  <span className={cn(
                    'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium',
                    ocr.isScreenshot ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
                  )}>
                    {ocr.isScreenshot ? <XCircle size={12} /> : <CheckCircle2 size={12} />}
                    {ocr.isScreenshot ? 'Screenshot Detected' : 'Not a Screenshot'}
                  </span>
                  <span className={cn(
                    'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium',
                    ocr.isOriginalScan ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                  )}>
                    {ocr.isOriginalScan ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                    {ocr.isOriginalScan ? 'Original Scan' : 'May Not Be Original'}
                  </span>
                  <span className={cn(
                    'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium',
                    ocr.resolutionQuality === 'HIGH' ? 'bg-emerald-50 text-emerald-700'
                      : ocr.resolutionQuality === 'MEDIUM' ? 'bg-amber-50 text-amber-700'
                      : 'bg-red-50 text-red-700'
                  )}>
                    Resolution: {ocr.resolutionQuality || 'Unknown'}
                  </span>
                  <span className={cn(
                    'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium',
                    ocr.confidence >= 0.7 ? 'bg-emerald-50 text-emerald-700'
                      : ocr.confidence >= 0.4 ? 'bg-amber-50 text-amber-700'
                      : 'bg-red-50 text-red-700'
                  )}>
                    Confidence: {Math.round(ocr.confidence * 100)}%
                  </span>
                </div>

                {/* Tampering warnings */}
                {ocr.tamperingIndicators && (ocr.tamperingIndicators as string[]).length > 0 && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-xs font-medium text-red-700 flex items-center gap-1.5 mb-1">
                      <AlertTriangle size={12} /> Tampering Indicators
                    </p>
                    {(ocr.tamperingIndicators as string[]).map((t: string, i: number) => (
                      <p key={i} className="text-xs text-red-600 ml-5">- {t}</p>
                    ))}
                  </div>
                )}
              </div>

              {/* Detected Type */}
              <div className="layer-card p-4">
                <p className="text-xs font-semibold text-gray-600 mb-1">Detected Document Type</p>
                <p className="text-sm font-medium text-gray-800">{ocr.detectedType?.replace(/_/g, ' ') || 'Unknown'}</p>
              </div>

              {/* AI Extraction Results (from DeepSeek/configured AI) */}
              {ocr.llmExtractedData && (
                <div className="layer-card p-4 border border-blue-100 bg-blue-50/30">
                  <p className="text-xs font-semibold text-blue-700 mb-2 flex items-center gap-1.5">
                    <Shield size={12} /> AI-Assisted Verification
                    {ocr.llmConfidence != null && (
                      <span className={cn(
                        'ml-2 px-2 py-0.5 rounded-full text-[10px] font-medium',
                        ocr.llmConfidence >= 0.7 ? 'bg-emerald-100 text-emerald-700' : ocr.llmConfidence >= 0.4 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                      )}>
                        AI Confidence: {Math.round(ocr.llmConfidence * 100)}%
                      </span>
                    )}
                  </p>

                  {/* Issues found by AI */}
                  {(ocr.llmExtractedData as any).issues?.length > 0 && (
                    <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-xs font-medium text-red-700 mb-1">Issues Detected:</p>
                      {((ocr.llmExtractedData as any).issues as string[]).map((issue: string, i: number) => (
                        <p key={i} className="text-xs text-red-600 ml-3">• {issue}</p>
                      ))}
                    </div>
                  )}

                  {/* OCR corrections applied */}
                  {(ocr.llmExtractedData as any).corrections?.length > 0 && (
                    <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-xs font-medium text-amber-700 mb-1">OCR Corrections Applied:</p>
                      {((ocr.llmExtractedData as any).corrections as string[]).map((c: string, i: number) => (
                        <p key={i} className="text-xs text-amber-600 ml-3">• {c}</p>
                      ))}
                    </div>
                  )}

                  {/* No issues = all clear */}
                  {!(ocr.llmExtractedData as any).issues?.length && !(ocr.llmExtractedData as any).corrections?.length && ocr.llmConfidence != null && ocr.llmConfidence >= 0.6 && (
                    <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
                      <p className="text-xs text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 size={12} /> AI verification passed — no issues found
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Extracted Fields */}
              <div className="layer-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-gray-600">Extracted Fields</p>
                  <div className="flex gap-2">
                    <button onClick={handleTriggerOcr} disabled={triggering}
                      className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
                      {triggering ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                      Re-scan
                    </button>
                    <button onClick={() => setEditing(!editing)}
                      className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1">
                      <Pencil size={12} /> {editing ? 'Cancel Edit' : 'Edit'}
                    </button>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {OCR_FIELDS.map(({ key, label }) => (
                    <div key={key} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                      <label className="text-xs text-gray-500 w-32 flex-shrink-0">{label}</label>
                      {editing ? (
                        <input
                          value={fields[key] || ''}
                          onChange={e => setFields(prev => ({ ...prev, [key]: e.target.value }))}
                          className="input-glass text-sm flex-1 ml-3"
                          placeholder={`Enter ${label.toLowerCase()}`}
                        />
                      ) : (
                        <span className={cn('text-sm font-medium', fields[key] ? 'text-gray-800' : 'text-gray-300')}>
                          {fields[key] || '—'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Cross-Validation Status */}
              {ocr.crossValidationStatus && (
                <div className="layer-card p-4">
                  <p className="text-xs font-semibold text-gray-600 mb-2">Cross-Document Validation</p>
                  <span className={cn(
                    'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium',
                    ocr.crossValidationStatus === 'PASS' ? 'bg-emerald-50 text-emerald-700'
                      : ocr.crossValidationStatus === 'FAIL' ? 'bg-red-50 text-red-700'
                      : 'bg-amber-50 text-amber-700'
                  )}>
                    {ocr.crossValidationStatus === 'PASS' ? <CheckCircle2 size={12} /> : ocr.crossValidationStatus === 'FAIL' ? <XCircle size={12} /> : <AlertTriangle size={12} />}
                    {ocr.crossValidationStatus}
                  </span>
                  {ocr.crossValidationDetails && (
                    <div className="mt-2 space-y-1">
                      {(ocr.crossValidationDetails as any[]).map((d: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          {d.match ? <CheckCircle2 size={12} className="text-emerald-500" /> : <XCircle size={12} className="text-red-500" />}
                          <span className="text-gray-600 font-medium">{d.field}:</span>
                          {d.values?.map((v: any, j: number) => (
                            <span key={j} className="text-gray-500">{v.docType}: <strong>{v.value || '—'}</strong>{j < d.values.length - 1 ? ', ' : ''}</span>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* HR Notes & Status */}
              <div className="layer-card p-4">
                <p className="text-xs font-semibold text-gray-600 mb-3">Review Status & Notes</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Status</label>
                    <select value={ocrStatus} onChange={e => setOcrStatus(e.target.value)} className="input-glass text-sm w-full">
                      <option value="PENDING">Pending Review</option>
                      <option value="REVIEWED">Reviewed - OK</option>
                      <option value="FLAGGED">Flagged - Issue Found</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">HR Notes</label>
                    <textarea value={hrNotes} onChange={e => setHrNotes(e.target.value)}
                      className="input-glass text-sm w-full h-20 resize-none"
                      placeholder="Add notes about this document..." />
                  </div>
                </div>
              </div>

              {/* Save Button */}
              <button onClick={handleSave} disabled={saving}
                className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? 'Saving...' : 'Save Review'}
              </button>

              {/* Verify This Document */}
              {documentStatus === 'PENDING' && (
                <button onClick={async () => {
                  try {
                    await verifyDoc({ id: documentId, status: 'VERIFIED' }).unwrap();
                    toast.success('Document verified!');
                  } catch { toast.error('Failed to verify document'); }
                }} disabled={verifyingDoc}
                  className="w-full flex items-center justify-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors">
                  {verifyingDoc ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Verify This Document
                </button>
              )}

              {/* Verify All & Approve KYC */}
              {employeeId && (
                <button onClick={async () => {
                  try {
                    // First verify this document if pending
                    if (documentStatus === 'PENDING') {
                      await verifyDoc({ id: documentId, status: 'VERIFIED' }).unwrap();
                    }
                    // Then approve KYC
                    await verifyKyc(employeeId).unwrap();
                    toast.success('KYC approved! Employee can now access the portal.');
                    onClose();
                  } catch (err: any) {
                    toast.error(err?.data?.error?.message || 'Failed to approve KYC');
                  }
                }} disabled={verifyingKyc}
                  className="w-full flex items-center justify-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white transition-colors">
                  {verifyingKyc ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Approve KYC & Grant Portal Access
                </button>
              )}

              {/* HR reviewed info */}
              {ocr.hrReviewedBy && (
                <p className="text-xs text-gray-400 text-center">
                  Last reviewed on {new Date(ocr.hrReviewedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
