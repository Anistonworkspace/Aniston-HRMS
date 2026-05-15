import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Upload, RotateCcw, Check, X, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

type Mode = 'idle' | 'camera' | 'preview';

interface Props {
  onPhotoReady: (file: File) => void;
  isUploading?: boolean;
  isUploaded?: boolean;
  uploadedFileName?: string;
  className?: string;
}

export default function PassportPhotoUploader({ onPhotoReady, isUploading, isUploaded, uploadedFileName, className }: Props) {
  const [mode, setMode] = useState<Mode>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const showPreview = (file: File) => {
    const url = URL.createObjectURL(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(url);
    setPhotoFile(file);
    setMode('preview');
  };

  const startCamera = async () => {
    setCameraError(null);
    setMode('camera');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 }, aspectRatio: 1 },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err: any) {
      const msg = err?.name === 'NotAllowedError'
        ? 'Camera permission denied. Please allow camera access in your browser settings, then try again.'
        : err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError'
        ? 'Camera not available. Please use the Upload Photo option instead.'
        : err?.name === 'NotReadableError' || err?.name === 'TrackStartError'
        ? 'Camera is in use by another app. Close other apps using the camera and try again.'
        : 'Could not start camera. Use the Upload Photo option instead.';
      setCameraError(msg);
    }
  };

  const capturePhoto = useCallback(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight) {
      toast.error('Camera is not ready yet. Please wait a moment and try again.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) {
        toast.error('Failed to capture photo. Please try again or use the Upload option.');
        return;
      }
      stopCamera();
      const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
      showPreview(file);
    }, 'image/jpeg', 0.95);
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Photo must be under 10 MB. Please choose a smaller image.');
      return;
    }
    showPreview(file);
  };

  const handleConfirm = () => {
    if (photoFile) {
      onPhotoReady(photoFile);
      setMode('idle');
    }
  };

  const handleRetake = () => {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
    setPhotoFile(null);
    setMode('idle');
  };

  const handleCancelCamera = () => {
    stopCamera();
    setMode('idle');
    setCameraError(null);
  };

  // Uploaded state — show done card
  if (isUploaded && mode === 'idle') {
    return (
      <div className={cn('rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4 flex items-center gap-4', className)}>
        <div className="w-14 h-14 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
          <Check className="w-7 h-7 text-emerald-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-emerald-800">Passport Photo Uploaded</p>
          <p className="text-xs text-emerald-600 mt-0.5 truncate">{uploadedFileName || 'Pending HR review'}</p>
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          className="text-xs bg-white border border-emerald-300 text-emerald-700 px-3 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors"
        >
          Replace
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <AnimatePresence mode="wait">

        {/* IDLE — two buttons */}
        {mode === 'idle' && (
          <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={startCamera}
              className="group flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed border-gray-200 hover:bg-gray-50 transition-all"
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center transition-colors" style={{ background: 'var(--primary-highlighted-color)' }}>
                <Camera size={20} style={{ color: 'var(--primary-color)' }} />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-700">Take Photo</p>
                <p className="text-[11px] text-gray-400 mt-0.5">Use your camera</p>
              </div>
            </button>

            <label className="group flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed border-gray-200 hover:bg-gray-50 transition-all cursor-pointer">
              <div className="w-10 h-10 rounded-full bg-indigo-100 group-hover:bg-indigo-200 flex items-center justify-center transition-colors">
                <Upload size={20} className="text-indigo-600" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-700">Upload Photo</p>
                <p className="text-[11px] text-gray-400 mt-0.5">JPG / PNG / HEIC</p>
              </div>
              <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" className="hidden"
                onChange={handleFileUpload} />
            </label>
          </motion.div>
        )}

        {/* CAMERA — live webcam */}
        {mode === 'camera' && (
          <motion.div key="camera" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="space-y-3">
            {cameraError ? (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm font-medium text-red-800">{cameraError}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleCancelCamera} className="flex-1 btn-secondary text-xs py-2">
                    Go back
                  </button>
                  <label className="flex-[2] btn-primary text-xs py-2 flex items-center justify-center gap-1.5 cursor-pointer">
                    <Upload size={13} /> Upload Photo Instead
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                      className="hidden"
                      onChange={(e) => { stopCamera(); setCameraError(null); handleFileUpload(e); }}
                    />
                  </label>
                </div>
              </div>
            ) : (
              <>
                <div className="relative rounded-xl overflow-hidden bg-black aspect-square">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover scale-x-[-1]"
                  />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-48 h-64 border-4 border-white/70 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
                  </div>
                  <p className="absolute bottom-3 left-0 right-0 text-center text-xs text-white/80">
                    Position your face inside the oval
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={handleCancelCamera}
                    className="flex-1 btn-secondary flex items-center justify-center gap-2 py-2.5 text-sm">
                    <X size={15} /> Cancel
                  </button>
                  <button type="button" onClick={capturePhoto}
                    className="flex-[2] btn-primary flex items-center justify-center gap-2 py-2.5 text-sm">
                    <Camera size={15} /> Capture Photo
                  </button>
                </div>
              </>
            )}
          </motion.div>
        )}

        {/* PREVIEW */}
        {mode === 'preview' && previewUrl && (
          <motion.div key="preview" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="space-y-3">
            <div className="flex flex-col items-center gap-2">
              <div className="w-40 h-48 rounded-xl overflow-hidden shadow-md border-4 border-white ring-1 ring-gray-200">
                <img src={previewUrl} alt="Photo preview" className="w-full h-full object-cover" />
              </div>
              <p className="text-xs text-gray-500 text-center mt-1">Review your photo before uploading</p>
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={handleRetake}
                className="flex-1 btn-secondary flex items-center justify-center gap-1.5 text-sm py-2.5">
                <RotateCcw size={14} /> Retake
              </button>
              <button type="button" onClick={handleConfirm} disabled={isUploading}
                className="flex-[2] btn-primary flex items-center justify-center gap-1.5 text-sm py-2.5">
                {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {isUploading ? 'Uploading…' : 'Use this photo'}
              </button>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
