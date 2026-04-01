import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, Camera, Upload, CheckCircle2, Clock, XCircle, Loader2,
  AlertTriangle, ChevronDown, ChevronUp, Info, FileUp, GraduationCap,
  ShieldCheck, CreditCard, Home, Briefcase, Award, Image,
} from 'lucide-react';
import { useAppSelector } from '../../app/store';
import {
  useGetMyKycStatusQuery, useUploadKycDocumentMutation, useUploadKycPhotoMutation,
  useUploadCombinedPdfMutation, useUploadPhotoFileMutation, useSubmitKycMutation,
} from './kycApi';
import CameraCapture from './CameraCapture';
import { onSocketEvent, offSocketEvent } from '../../lib/socket';
import toast from 'react-hot-toast';

// ===== Document Categories =====
const DOCUMENT_CATEGORIES = [
  {
    id: 'education',
    title: 'Education Certificates',
    icon: GraduationCap,
    description: '10th, 12th, Degree, and Post-Graduation certificates',
    docs: [
      { type: 'TENTH_CERTIFICATE', label: '10th Marksheet / Certificate', required: true },
      { type: 'TWELFTH_CERTIFICATE', label: '12th Marksheet / Certificate', required: true },
      { type: 'DEGREE_CERTIFICATE', label: 'Diploma / Degree Certificate', required: true },
      { type: 'POST_GRADUATION_CERTIFICATE', label: 'Post-Graduation Certificate', required: false, hint: 'If applicable' },
    ],
  },
  {
    id: 'identity',
    title: 'Identity Proof (any one)',
    icon: ShieldCheck,
    description: 'Upload any ONE: Aadhaar, Passport, Driving License, or Voter ID',
    anyOne: true,
    docs: [
      { type: 'AADHAAR', label: 'Aadhaar Card', required: false },
      { type: 'PASSPORT', label: 'Passport', required: false },
      { type: 'DRIVING_LICENSE', label: 'Driving License', required: false },
      { type: 'VOTER_ID', label: 'Voter ID', required: false },
    ],
  },
  {
    id: 'pan',
    title: 'PAN Card (Mandatory)',
    icon: CreditCard,
    description: 'Clear scan of your PAN card',
    docs: [
      { type: 'PAN', label: 'PAN Card', required: true },
    ],
  },
  {
    id: 'residence',
    title: 'Residence Proof',
    icon: Home,
    description: 'Own house: utility bill (electricity/water/gas). Renting: rent agreement + owner\'s utility bill',
    docs: [
      { type: 'RESIDENCE_PROOF', label: 'Residence Proof', required: true, hint: 'Utility bill, rent agreement, or address proof' },
    ],
  },
  {
    id: 'photo',
    title: 'Passport Size Photograph',
    icon: Image,
    description: 'Upload a clear passport-size photo or capture with camera',
    isPhotoSection: true,
    docs: [
      { type: 'PHOTO', label: 'Passport Size Photo', required: true },
    ],
  },
  {
    id: 'employment',
    title: 'Previous Employment',
    icon: Briefcase,
    description: 'Offer letter, salary slips, relieving/experience letter',
    optional: true,
    skippable: true,
    docs: [
      { type: 'OFFER_LETTER_DOC', label: 'Offer / Appointment Letter', required: false },
      { type: 'SALARY_SLIP_DOC', label: 'Last 3 Salary Slips', required: false },
      { type: 'BANK_STATEMENT', label: 'Bank Statements (alt to salary slips)', required: false },
      { type: 'RELIEVING_LETTER', label: 'Relieving Letter', required: false },
      { type: 'EXPERIENCE_LETTER', label: 'Experience Letter', required: false },
    ],
  },
  {
    id: 'additional',
    title: 'Additional Documents',
    icon: Award,
    description: 'Professional certifications, PF/ESIC details',
    optional: true,
    docs: [
      { type: 'PROFESSIONAL_CERTIFICATION', label: 'Professional Certifications', required: false },
      { type: 'OTHER', label: 'PF / ESIC Details from Last Employer', required: false },
    ],
  },
];

const IDENTITY_TYPES = ['AADHAAR', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID'];
const MANDATORY_TYPES = ['PAN', 'TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'RESIDENCE_PROOF'];

const statusConfig: Record<string, { icon: any; color: string; bg: string; label: string }> = {
  PENDING: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', label: 'Pending — Upload your documents' },
  SUBMITTED: { icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', label: 'Submitted — Under HR Review' },
  VERIFIED: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', label: 'Verified — KYC Complete' },
  REJECTED: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50 border-red-200', label: 'Rejected — Please re-upload flagged documents' },
};

export default function KycGatePage() {
  const user = useAppSelector(s => s.auth.user);
  const { data: kycRes, isLoading, refetch } = useGetMyKycStatusQuery();
  const [uploadDoc] = useUploadKycDocumentMutation();
  const [uploadPhoto] = useUploadKycPhotoMutation();
  const [uploadCombinedPdf] = useUploadCombinedPdfMutation();
  const [uploadPhotoFile] = useUploadPhotoFileMutation();
  const [submitKyc, { isLoading: submitting }] = useSubmitKycMutation();

  // Real-time: auto-refetch when HR verifies/rejects
  useEffect(() => {
    const handler = () => { refetch(); };
    onSocketEvent('kyc:status-changed', handler);
    return () => { offSocketEvent('kyc:status-changed', handler); };
  }, [refetch]);

  const [showCamera, setShowCamera] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    education: true, identity: true, pan: true, residence: true, photo: true,
    employment: false, additional: false,
  });
  const [showGuidelines, setShowGuidelines] = useState(false);
  const [firstJob, setFirstJob] = useState(false);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const combinedPdfRef = useRef<HTMLInputElement | null>(null);
  const photoFileRef = useRef<HTMLInputElement | null>(null);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-1">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-brand-600" />
          <p className="text-sm text-gray-400">Loading KYC status...</p>
        </div>
      </div>
    );
  }

  const kyc = kycRes?.data;
  const kycStatus = kyc?.kycStatus || 'PENDING';
  const submittedDocs: string[] = (kyc?.submittedDocs || []) as string[];
  const photoUrl = kyc?.photoUrl || null;
  const combinedPdfUploaded = kyc?.combinedPdfUploaded || false;
  const rejectionReason = kyc?.rejectionReason || null;
  const status = statusConfig[kycStatus] || statusConfig.PENDING;
  const StatusIcon = status.icon;
  // Only lock when submitted (under review) or verified. Rejected = allow re-upload
  const isLocked = kycStatus === 'SUBMITTED' || kycStatus === 'VERIFIED';

  // Progress calculation
  const hasIdentityProof = IDENTITY_TYPES.some(t => submittedDocs.includes(t));
  const hasPan = submittedDocs.includes('PAN');
  const hasTenth = submittedDocs.includes('TENTH_CERTIFICATE');
  const hasTwelfth = submittedDocs.includes('TWELFTH_CERTIFICATE');
  const hasDegree = submittedDocs.includes('DEGREE_CERTIFICATE');
  const hasResidence = submittedDocs.includes('RESIDENCE_PROOF');
  const hasPhoto = !!photoUrl || submittedDocs.includes('PHOTO');

  const mandatoryChecks = [hasPan, hasIdentityProof, hasTenth, hasTwelfth, hasDegree, hasResidence, hasPhoto];
  const completedMandatory = mandatoryChecks.filter(Boolean).length;
  const totalMandatory = mandatoryChecks.length;
  const allMandatoryUploaded = mandatoryChecks.every(Boolean);
  const canSubmit = (allMandatoryUploaded || combinedPdfUploaded) && !isLocked;

  const toggleSection = (id: string) => setOpenSections(prev => ({ ...prev, [id]: !prev[id] }));

  // Handlers
  const handleFileUpload = async (docType: string, file: File) => {
    if (!user?.employeeId) {
      toast.error('Employee profile not linked. Please contact HR.');
      return;
    }
    setUploading(docType);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', docType);
      formData.append('name', docType.replace(/_/g, ' '));
      formData.append('employeeId', user.employeeId);
      await uploadDoc({ employeeId: user.employeeId, formData }).unwrap();
      toast.success(`${docType.replace(/_/g, ' ')} uploaded`);
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Upload failed');
    }
    setUploading(null);
  };

  const handleCombinedPdfUpload = async (file: File) => {
    if (!user?.employeeId) {
      toast.error('Employee profile not linked. Please contact HR.');
      return;
    }
    setUploading('COMBINED_PDF');
    try {
      const formData = new FormData();
      formData.append('file', file);
      await uploadCombinedPdf({ employeeId: user.employeeId, formData }).unwrap();
      toast.success('Combined PDF uploaded successfully');
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Upload failed');
    }
    setUploading(null);
  };

  const handlePhotoCapture = async (blob: Blob) => {
    if (!user?.employeeId) {
      toast.error('Employee profile not linked. Please contact HR.');
      return;
    }
    setShowCamera(false);
    setUploading('PHOTO');
    try {
      const formData = new FormData();
      formData.append('photo', blob, 'kyc-photo.jpg');
      await uploadPhoto({ employeeId: user.employeeId, formData }).unwrap();
      toast.success('Photo captured successfully');
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Photo upload failed');
    }
    setUploading(null);
  };

  const handlePhotoFileUpload = async (file: File) => {
    if (!user?.employeeId) {
      toast.error('Employee profile not linked. Please contact HR.');
      return;
    }
    setUploading('PHOTO');
    try {
      const formData = new FormData();
      formData.append('file', file);
      await uploadPhotoFile({ employeeId: user.employeeId, formData }).unwrap();
      toast.success('Photo uploaded successfully');
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Photo upload failed');
    }
    setUploading(null);
  };

  const handleSubmitKyc = async () => {
    try {
      await submitKyc(user?.employeeId || '').unwrap();
      toast.success('KYC submitted for HR review');
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Submission failed');
    }
  };

  const renderDocFlag = (docType: string) => {
    const docStatus = kyc?.documentStatuses?.[docType];
    const reason = kyc?.documentReasons?.[docType];
    if (docStatus === 'FLAGGED') {
      return (
        <div className="mt-2 flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-lg p-2.5 text-xs text-orange-700">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>
            <span className="font-medium">This document was flagged.</span>
            {reason && <p className="mt-0.5">{reason}</p>}
            <p className="mt-1">Please re-upload a valid, clearly scanned copy.</p>
          </div>
        </div>
      );
    }
    if (docStatus === 'REJECTED') {
      return (
        <div className="mt-2 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-700">
          <XCircle size={14} className="mt-0.5 shrink-0" />
          <div>
            <span className="font-medium">This document was rejected.</span>
            {reason && <p className="mt-0.5">{reason}</p>}
            <p className="mt-1">Please re-upload a correct version.</p>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-surface-1 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-50 mb-4">
            <FileText size={28} className="text-brand-600" />
          </div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Complete Your KYC</h1>
          <p className="text-gray-500 text-sm mt-2">
            Upload your pre-joining documents for verification. All documents will be reviewed by HR.
          </p>
        </div>

        {/* Status Banner */}
        <div className={`layer-card p-4 flex items-center gap-3 border mb-4 ${status.bg}`}>
          <StatusIcon size={20} className={status.color} />
          <div>
            <p className={`font-semibold text-sm ${status.color}`}>{status.label}</p>
            {rejectionReason && kycStatus === 'REJECTED' && (
              <p className="text-xs text-red-500 mt-1">Reason: {rejectionReason}</p>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        {!isLocked && (
          <div className="layer-card p-4 border border-gray-200 mb-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-700">
                {combinedPdfUploaded ? 'Combined PDF uploaded' : `${completedMandatory} of ${totalMandatory} mandatory documents uploaded`}
              </p>
              {combinedPdfUploaded && <CheckCircle2 size={16} className="text-emerald-500" />}
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-brand-600 h-2 rounded-full transition-all duration-500"
                style={{ width: `${combinedPdfUploaded ? 100 : (completedMandatory / totalMandatory) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Submission Guidelines */}
        <button
          onClick={() => setShowGuidelines(!showGuidelines)}
          className="layer-card w-full p-4 border border-blue-200 bg-blue-50/50 mb-4 flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <Info size={16} className="text-blue-600" />
            <span className="text-sm font-medium text-blue-700">Submission Guidelines</span>
          </div>
          {showGuidelines ? <ChevronUp size={16} className="text-blue-600" /> : <ChevronDown size={16} className="text-blue-600" />}
        </button>
        <AnimatePresence>
          {showGuidelines && (
            <motion.div
              initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden mb-4"
            >
              <div className="layer-card p-4 border border-blue-100 bg-blue-50/30 text-sm text-gray-600 space-y-2">
                <p>All documents should be <strong>clearly scanned</strong> (PDF format preferred; avoid mobile screenshots).</p>
                <p>Maximum file size: <strong>10MB per document</strong>. Accepted formats: PDF, JPG, PNG.</p>
                <p>You can upload documents <strong>individually</strong> OR upload all in <strong>one combined PDF</strong>.</p>
                <p>Arrange documents in order: ID Proof → PAN → Education → Employment → Photographs.</p>
                <p>File name format: <strong>YourName_PreJoiningDocs.pdf</strong></p>
                <p>Passport photos: <strong>upload a file</strong> or <strong>capture with camera</strong>.</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Combined PDF Upload */}
        {!isLocked && (
          <div className={`layer-card p-5 border mb-6 ${combinedPdfUploaded ? 'border-emerald-200 bg-emerald-50/30' : 'border-indigo-200 bg-indigo-50/30'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {combinedPdfUploaded ? (
                  <CheckCircle2 size={22} className="text-emerald-500" />
                ) : (
                  <FileUp size={22} className="text-indigo-600" />
                )}
                <div>
                  <p className="text-sm font-semibold text-gray-800">
                    {combinedPdfUploaded ? 'Combined PDF Uploaded' : 'Upload All Documents in One PDF'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {combinedPdfUploaded
                      ? 'Your combined document has been uploaded. You can still upload individual documents below.'
                      : 'Combine all documents into a single PDF named YourName_PreJoiningDocs.pdf'}
                  </p>
                </div>
              </div>
              <div>
                <input
                  ref={combinedPdfRef}
                  type="file"
                  accept=".pdf,.doc,.docx,image/*,application/pdf"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleCombinedPdfUpload(file);
                    e.target.value = '';
                  }}
                />
                <button
                  onClick={() => combinedPdfRef.current?.click()}
                  disabled={uploading === 'COMBINED_PDF'}
                  className={`text-xs px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-all ${
                    combinedPdfUploaded ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'btn-primary'
                  } disabled:opacity-50`}
                >
                  {uploading === 'COMBINED_PDF' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {combinedPdfUploaded ? 'Re-upload' : 'Upload PDF'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Document Category Sections */}
        <div className="space-y-3 mb-6">
          {DOCUMENT_CATEGORIES.map(category => {
            // Skip employment section if first job
            if (category.id === 'employment' && firstJob) return null;

            const isOpen = openSections[category.id];
            const CategoryIcon = category.icon;
            const categoryDocs = category.docs;

            // Check if any doc in category is uploaded
            const uploadedCount = categoryDocs.filter(d => submittedDocs.includes(d.type)).length;
            const isCategoryComplete = category.anyOne
              ? categoryDocs.some(d => submittedDocs.includes(d.type))
              : category.id === 'photo'
              ? hasPhoto
              : categoryDocs.filter(d => d.required).every(d => submittedDocs.includes(d.type));

            return (
              <div key={category.id} className="layer-card border border-gray-200 overflow-hidden">
                {/* Category Header */}
                <button
                  onClick={() => toggleSection(category.id)}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {isCategoryComplete ? (
                      <CheckCircle2 size={20} className="text-emerald-500" />
                    ) : (
                      <CategoryIcon size={20} className="text-gray-400" />
                    )}
                    <div>
                      <p className="text-sm font-semibold text-gray-800">
                        {category.title}
                        {category.optional && <span className="text-gray-400 font-normal ml-1">(Optional)</span>}
                      </p>
                      <p className="text-xs text-gray-400">{category.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {uploadedCount > 0 && (
                      <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                        {uploadedCount}/{categoryDocs.length}
                      </span>
                    )}
                    {isOpen ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                  </div>
                </button>

                {/* Category Content */}
                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 space-y-3">
                        {/* First job toggle for employment */}
                        {category.id === 'employment' && (
                          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer mb-2">
                            <input
                              type="checkbox"
                              checked={firstJob}
                              onChange={e => setFirstJob(e.target.checked)}
                              className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                            />
                            This is my first job (skip this section)
                          </label>
                        )}

                        {/* Photo section: dual mode */}
                        {category.isPhotoSection ? (
                          <div>
                            <div className={`p-4 rounded-xl border ${hasPhoto ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-100 bg-gray-50/30'}`}>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  {hasPhoto ? <CheckCircle2 size={18} className="text-emerald-500" /> : <Camera size={18} className="text-gray-400" />}
                                  <div>
                                    <p className="text-sm font-medium text-gray-700">Passport Size Photo <span className="text-red-400">*</span></p>
                                    <p className="text-xs text-gray-400">Upload a photo file or capture with camera</p>
                                  </div>
                                </div>
                                {photoUrl && !showCamera && (
                                  <img src={photoUrl} alt="KYC Photo" className="w-10 h-10 rounded-lg object-cover border border-gray-200" />
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-3">
                                <input
                                  ref={photoFileRef}
                                  type="file"
                                  accept="image/jpeg,image/png"
                                  className="hidden"
                                  onChange={e => {
                                    const file = e.target.files?.[0];
                                    if (file) handlePhotoFileUpload(file);
                                    e.target.value = '';
                                  }}
                                />
                                <button
                                  onClick={() => photoFileRef.current?.click()}
                                  disabled={uploading === 'PHOTO' || isLocked}
                                  className="text-xs px-3 py-2 rounded-lg font-medium flex items-center gap-1.5 btn-primary disabled:opacity-50"
                                >
                                  {uploading === 'PHOTO' ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                                  Upload Photo
                                </button>
                                <button
                                  onClick={() => setShowCamera(true)}
                                  disabled={uploading === 'PHOTO' || isLocked}
                                  className="text-xs px-3 py-2 rounded-lg font-medium flex items-center gap-1.5 bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                                >
                                  <Camera size={12} />
                                  Capture with Camera
                                </button>
                              </div>
                              {showCamera && (
                                <div className="mt-3">
                                  <CameraCapture onCapture={handlePhotoCapture} onCancel={() => setShowCamera(false)} />
                                </div>
                              )}
                            </div>
                            {renderDocFlag('PHOTO')}
                          </div>
                        ) : (
                          /* Regular document rows */
                          categoryDocs.map(doc => {
                            const isUploaded = submittedDocs.includes(doc.type);
                            const isUploading = uploading === doc.type;

                            return (
                              <div key={doc.type}>
                                <div className={`p-4 rounded-xl border ${isUploaded ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-100 bg-gray-50/30'}`}>
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      {isUploaded ? (
                                        <CheckCircle2 size={18} className="text-emerald-500" />
                                      ) : (
                                        <FileText size={18} className="text-gray-400" />
                                      )}
                                      <div>
                                        <p className="text-sm font-medium text-gray-700">
                                          {doc.label}
                                          {doc.required && <span className="text-red-400 ml-0.5">*</span>}
                                        </p>
                                        {doc.hint && <p className="text-xs text-gray-400">{doc.hint}</p>}
                                      </div>
                                    </div>
                                    <div>
                                      <input
                                        ref={el => { fileInputRefs.current[doc.type] = el; }}
                                        type="file"
                                        accept="image/*,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                        className="hidden"
                                        onChange={e => {
                                          const file = e.target.files?.[0];
                                          if (file) handleFileUpload(doc.type, file);
                                          e.target.value = '';
                                        }}
                                      />
                                      <button
                                        onClick={() => fileInputRefs.current[doc.type]?.click()}
                                        disabled={isUploading || isLocked}
                                        className={`text-xs px-3 py-2 rounded-lg font-medium flex items-center gap-1.5 transition-all ${
                                          isUploaded
                                            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                            : 'btn-primary'
                                        } disabled:opacity-50`}
                                      >
                                        {isUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                                        {isUploaded ? 'Re-upload' : 'Upload'}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                                {renderDocFlag(doc.type)}
                              </div>
                            );
                          })
                        )}

                        {/* "Any one" hint for identity */}
                        {category.anyOne && hasIdentityProof && (
                          <p className="text-xs text-emerald-600 flex items-center gap-1">
                            <CheckCircle2 size={12} /> Identity proof requirement met
                          </p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        {/* Submit Button */}
        {!isLocked && (
          <>
            <motion.button
              whileHover={{ scale: canSubmit ? 1.01 : 1 }}
              whileTap={{ scale: canSubmit ? 0.99 : 1 }}
              onClick={handleSubmitKyc}
              disabled={!canSubmit || submitting}
              className="w-full btn-primary py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              Submit for HR Verification
            </motion.button>

            {!canSubmit && (
              <div className="flex items-center gap-2 mt-3 justify-center">
                <AlertTriangle size={14} className="text-amber-500" />
                <p className="text-xs text-gray-400">
                  {combinedPdfUploaded
                    ? 'Ready to submit!'
                    : `Upload all mandatory documents (${completedMandatory}/${totalMandatory} done)`}
                </p>
              </div>
            )}
          </>
        )}

        {kycStatus === 'SUBMITTED' && (
          <div className="text-center mt-4">
            <p className="text-sm text-blue-600">Your documents are being reviewed by HR. You'll be notified once verified.</p>
          </div>
        )}

        {kycStatus === 'VERIFIED' && (
          <div className="text-center mt-4">
            <p className="text-sm text-emerald-600">Your KYC is verified! You now have full access to the platform.</p>
          </div>
        )}
      </div>
    </div>
  );
}
