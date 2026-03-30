import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { FileText, Camera, Upload, CheckCircle2, Clock, XCircle, Loader2, AlertTriangle } from 'lucide-react';
import { useAppSelector } from '../../app/store';
import { useGetMyKycStatusQuery, useUploadKycDocumentMutation, useUploadKycPhotoMutation, useSubmitKycMutation } from './kycApi';
import CameraCapture from './CameraCapture';
import toast from 'react-hot-toast';

const REQUIRED_DOCS = [
  { type: 'AADHAAR', label: 'Aadhaar Card', description: 'Front & back scan or clear photo' },
  { type: 'PAN', label: 'PAN Card', description: 'Clear scan or photo' },
];

const statusConfig: Record<string, { icon: any; color: string; bg: string; label: string }> = {
  PENDING: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', label: 'Pending — Upload your documents' },
  SUBMITTED: { icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', label: 'Submitted — Under HR Review' },
  VERIFIED: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', label: 'Verified — KYC Complete' },
  REJECTED: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50 border-red-200', label: 'Rejected — Please re-upload' },
};

export default function KycGatePage() {
  const user = useAppSelector(s => s.auth.user);
  const { data: kycRes, isLoading, refetch } = useGetMyKycStatusQuery();
  const [uploadDoc] = useUploadKycDocumentMutation();
  const [uploadPhoto] = useUploadKycPhotoMutation();
  const [submitKyc, { isLoading: submitting }] = useSubmitKycMutation();

  const [showCamera, setShowCamera] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

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
  const submittedDocs: string[] = kyc?.submittedDocs || [];
  const photoUrl = kyc?.photoUrl || null;
  const rejectionReason = kyc?.rejectionReason || null;
  const status = statusConfig[kycStatus] || statusConfig.PENDING;
  const StatusIcon = status.icon;

  const allDocsUploaded = REQUIRED_DOCS.every(d => submittedDocs.includes(d.type));
  const canSubmit = allDocsUploaded && photoUrl && kycStatus !== 'SUBMITTED' && kycStatus !== 'VERIFIED';

  const handleFileUpload = async (docType: string, file: File) => {
    setUploading(docType);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', docType);
      formData.append('name', docType.replace(/_/g, ' '));
      formData.append('employeeId', user?.employeeId || '');
      await uploadDoc({ employeeId: user?.employeeId || '', formData }).unwrap();
      toast.success(`${docType.replace(/_/g, ' ')} uploaded`);
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Upload failed');
    }
    setUploading(null);
  };

  const handlePhotoCapture = async (blob: Blob) => {
    setShowCamera(false);
    setUploading('PHOTO');
    try {
      const formData = new FormData();
      formData.append('photo', blob, 'kyc-photo.jpg');
      await uploadPhoto({ employeeId: user?.employeeId || '', formData }).unwrap();
      toast.success('Photo captured successfully');
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Photo upload failed');
    }
    setUploading(null);
  };

  const handleSubmitKyc = async () => {
    try {
      await submitKyc(user?.employeeId || '').unwrap();
      toast.success('KYC submitted for review');
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Submission failed');
    }
  };

  return (
    <div className="min-h-screen bg-surface-1 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-50 mb-4">
            <FileText size={28} className="text-brand-600" />
          </div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Complete Your KYC</h1>
          <p className="text-gray-500 text-sm mt-2">
            Please upload your identity documents and photo to access the HRMS platform.
          </p>
        </div>

        {/* Status Banner */}
        <div className={`layer-card p-4 flex items-center gap-3 border mb-6 ${status.bg}`}>
          <StatusIcon size={20} className={status.color} />
          <div>
            <p className={`font-semibold text-sm ${status.color}`}>{status.label}</p>
            {rejectionReason && kycStatus === 'REJECTED' && (
              <p className="text-xs text-red-500 mt-1">Reason: {rejectionReason}</p>
            )}
          </div>
        </div>

        {/* Document Upload Cards */}
        <div className="space-y-4 mb-6">
          {REQUIRED_DOCS.map(doc => {
            const isUploaded = submittedDocs.includes(doc.type);
            const isUploading = uploading === doc.type;

            return (
              <div key={doc.type} className={`layer-card p-5 border ${isUploaded ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-200'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {isUploaded ? (
                      <CheckCircle2 size={20} className="text-emerald-500" />
                    ) : (
                      <FileText size={20} className="text-gray-400" />
                    )}
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{doc.label} <span className="text-red-400">*</span></p>
                      <p className="text-xs text-gray-400">{doc.description}</p>
                    </div>
                  </div>
                  <div>
                    <input
                      ref={el => { fileInputRefs.current[doc.type] = el; }}
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(doc.type, file);
                        e.target.value = '';
                      }}
                    />
                    <button
                      onClick={() => fileInputRefs.current[doc.type]?.click()}
                      disabled={isUploading || kycStatus === 'SUBMITTED'}
                      className={`text-xs px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-all ${
                        isUploaded
                          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          : 'btn-primary'
                      } disabled:opacity-50`}
                    >
                      {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                      {isUploaded ? 'Re-upload' : 'Upload'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Photo Capture */}
          <div className={`layer-card p-5 border ${photoUrl ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-200'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {photoUrl ? (
                  <CheckCircle2 size={20} className="text-emerald-500" />
                ) : (
                  <Camera size={20} className="text-gray-400" />
                )}
                <div>
                  <p className="text-sm font-semibold text-gray-800">Live Photo <span className="text-red-400">*</span></p>
                  <p className="text-xs text-gray-400">Capture a clear photo of your face</p>
                </div>
              </div>
              {photoUrl && !showCamera && (
                <img src={photoUrl} alt="KYC Photo" className="w-12 h-12 rounded-lg object-cover border border-gray-200" />
              )}
              <button
                onClick={() => setShowCamera(true)}
                disabled={uploading === 'PHOTO' || kycStatus === 'SUBMITTED'}
                className={`text-xs px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-all ${
                  photoUrl ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'btn-primary'
                } disabled:opacity-50`}
              >
                {uploading === 'PHOTO' ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                {photoUrl ? 'Retake' : 'Capture'}
              </button>
            </div>

            {showCamera && (
              <div className="mt-4">
                <CameraCapture onCapture={handlePhotoCapture} onCancel={() => setShowCamera(false)} />
              </div>
            )}
          </div>
        </div>

        {/* Submit Button */}
        {kycStatus !== 'SUBMITTED' && kycStatus !== 'VERIFIED' && (
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
        )}

        {!canSubmit && kycStatus !== 'SUBMITTED' && kycStatus !== 'VERIFIED' && (
          <div className="flex items-center gap-2 mt-3 justify-center">
            <AlertTriangle size={14} className="text-amber-500" />
            <p className="text-xs text-gray-400">Upload all required documents and capture your photo to submit</p>
          </div>
        )}

        {kycStatus === 'SUBMITTED' && (
          <div className="text-center mt-4">
            <p className="text-sm text-blue-600">Your documents are being reviewed by HR. You'll be notified once verified.</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
