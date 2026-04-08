import { useState, useRef } from 'react';
import { Upload, Building2, PenLine, Stamp, Loader2, Check, Image } from 'lucide-react';
import { toast } from 'react-hot-toast';
import {
  useGetBrandingQuery,
  useUpdateBrandingMutation,
  useUploadLogoMutation,
  useUploadSignatureMutation,
  useUploadStampMutation,
} from './brandingApi';

const API_BASE = import.meta.env.VITE_API_URL === '/api' ? '' : (import.meta.env.VITE_API_URL?.replace('/api', '') || '');

function getFileUrl(path: string | null | undefined) {
  if (!path) return null;
  return `${API_BASE}${path}`;
}

export default function BrandingTab() {
  const { data: brandingRes, isLoading } = useGetBrandingQuery();
  const [updateBranding, { isLoading: updating }] = useUpdateBrandingMutation();
  const [uploadLogo, { isLoading: uploadingLogo }] = useUploadLogoMutation();
  const [uploadSignature, { isLoading: uploadingSig }] = useUploadSignatureMutation();
  const [uploadStamp, { isLoading: uploadingStamp }] = useUploadStampMutation();

  const branding = brandingRes?.data;

  const [companyName, setCompanyName] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [initialized, setInitialized] = useState(false);

  // Initialize form values from API data
  if (branding && !initialized) {
    setCompanyName(branding.companyName || '');
    setCompanyAddress(branding.companyAddress || '');
    setInitialized(true);
  }

  const logoRef = useRef<HTMLInputElement>(null);
  const sigRef = useRef<HTMLInputElement>(null);
  const stampRef = useRef<HTMLInputElement>(null);

  const handleSaveText = async () => {
    try {
      await updateBranding({ companyName: companyName.trim(), companyAddress: companyAddress.trim() }).unwrap();
      toast.success('Branding updated');
    } catch { toast.error('Failed to update branding'); }
  };

  const handleUpload = async (type: 'logo' | 'signature' | 'stamp', file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      if (type === 'logo') await uploadLogo(formData).unwrap();
      else if (type === 'signature') await uploadSignature(formData).unwrap();
      else await uploadStamp(formData).unwrap();
      toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} uploaded`);
    } catch (err: any) { toast.error(err?.data?.error?.message || `Failed to upload ${type}`); }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-800">Company Branding</h3>
        <p className="text-sm text-gray-500 mt-1">Upload your company logo, authorized signature, and stamp. These will be automatically applied to all generated letters.</p>
      </div>

      {/* Company Details */}
      <div className="layer-card p-5 space-y-4">
        <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Building2 size={16} className="text-indigo-600" /> Company Details
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Company Name</label>
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="input-glass w-full text-sm"
              placeholder="e.g. Aniston Technologies LLP"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Company Address</label>
            <input
              value={companyAddress}
              onChange={(e) => setCompanyAddress(e.target.value)}
              className="input-glass w-full text-sm"
              placeholder="e.g. 123 Tech Park, Bengaluru 560001"
            />
          </div>
        </div>
        <button onClick={handleSaveText} disabled={updating}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors">
          {updating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Save Details
        </button>
      </div>

      {/* Upload Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Logo */}
        <div className="layer-card p-5 space-y-3">
          <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Image size={16} className="text-indigo-600" /> Company Logo
          </h4>
          <p className="text-xs text-gray-500">Appears on the top of every letter</p>

          {branding?.logoUrl ? (
            <div className="bg-gray-50 rounded-lg p-3 flex items-center justify-center min-h-[80px]">
              <img src={getFileUrl(branding.logoUrl)!} alt="Logo" className="max-h-16 object-contain" />
            </div>
          ) : (
            <div className="bg-gray-50 rounded-lg p-6 flex items-center justify-center text-gray-400">
              <Image size={32} />
            </div>
          )}

          <input ref={logoRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => e.target.files?.[0] && handleUpload('logo', e.target.files[0])} />
          <button onClick={() => logoRef.current?.click()} disabled={uploadingLogo}
            className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors">
            {uploadingLogo ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {branding?.logoUrl ? 'Replace Logo' : 'Upload Logo'}
          </button>
        </div>

        {/* Signature */}
        <div className="layer-card p-5 space-y-3">
          <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <PenLine size={16} className="text-indigo-600" /> Authorized Signature
          </h4>
          <p className="text-xs text-gray-500">Placed above the signature line</p>

          {branding?.signatureUrl ? (
            <div className="bg-gray-50 rounded-lg p-3 flex items-center justify-center min-h-[80px]">
              <img src={getFileUrl(branding.signatureUrl)!} alt="Signature" className="max-h-16 object-contain" />
            </div>
          ) : (
            <div className="bg-gray-50 rounded-lg p-6 flex items-center justify-center text-gray-400">
              <PenLine size={32} />
            </div>
          )}

          <input ref={sigRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => e.target.files?.[0] && handleUpload('signature', e.target.files[0])} />
          <button onClick={() => sigRef.current?.click()} disabled={uploadingSig}
            className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors">
            {uploadingSig ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {branding?.signatureUrl ? 'Replace Signature' : 'Upload Signature'}
          </button>
        </div>

        {/* Stamp */}
        <div className="layer-card p-5 space-y-3">
          <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Stamp size={16} className="text-indigo-600" /> Company Stamp
          </h4>
          <p className="text-xs text-gray-500">Displayed next to the signature</p>

          {branding?.stampUrl ? (
            <div className="bg-gray-50 rounded-lg p-3 flex items-center justify-center min-h-[80px]">
              <img src={getFileUrl(branding.stampUrl)!} alt="Stamp" className="max-h-16 object-contain" />
            </div>
          ) : (
            <div className="bg-gray-50 rounded-lg p-6 flex items-center justify-center text-gray-400">
              <Stamp size={32} />
            </div>
          )}

          <input ref={stampRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => e.target.files?.[0] && handleUpload('stamp', e.target.files[0])} />
          <button onClick={() => stampRef.current?.click()} disabled={uploadingStamp}
            className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors">
            {uploadingStamp ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {branding?.stampUrl ? 'Replace Stamp' : 'Upload Stamp'}
          </button>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-700">
          <strong>Note:</strong> Branding assets are applied to newly generated letters only. Existing letters will retain their original branding.
        </p>
      </div>
    </div>
  );
}
