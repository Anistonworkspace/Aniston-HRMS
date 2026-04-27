import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Upload, RotateCcw, Check, X, Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

type Mode = 'idle' | 'camera' | 'processing' | 'preview';

interface Props {
  onPhotoReady: (file: File) => void;
  isUploading?: boolean;
  isUploaded?: boolean;
  uploadedFileName?: string;
  className?: string;
}

async function applyWhiteBackground(blob: Blob): Promise<File> {
  // Dynamically import to keep the heavy model out of the initial bundle
  const { removeBackground } = await import('@imgly/background-removal');

  // 60-second timeout — model download can hang on slow mobile connections
  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
    Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Background removal timed out')), ms)
      ),
    ]);

  // removeBackground returns a PNG blob with transparent background
  const noBgBlob = await withTimeout(
    removeBackground(blob, {
      // Reduce model quality for faster processing in onboarding context
      model: 'small',
      output: { format: 'image/png', quality: 0.95 },
    }),
    60_000,
  );

  // Composite onto white canvas and export as JPEG
  const img = new Image();
  const objUrl = URL.createObjectURL(noBgBlob);
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('Failed to load processed image'));
    img.src = objUrl;
  });
  URL.revokeObjectURL(objUrl);

  const canvas = document.createElement('canvas');
  // Target ~600×600 for a passport photo — resize if larger
  const MAX = 600;
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);

  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return new Promise<File>((res, rej) => {
    canvas.toBlob(
      (b) => b ? res(new File([b], 'passport_photo.jpg', { type: 'image/jpeg' })) : rej(new Error('Canvas export failed')),
      'image/jpeg',
      0.92,
    );
  });
}

export default function PassportPhotoUploader({ onPhotoReady, isUploading, isUploaded, uploadedFileName, className }: Props) {
  const [mode, setMode] = useState<Mode>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [processedFile, setProcessedFile] = useState<File | null>(null);
  const [processingStep, setProcessingStep] = useState('');
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Stop camera stream on unmount
  useEffect(() => {
    return () => stopCamera();
  }, []);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
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
        ? 'Camera not available in this browser. Please open this app in Safari (iPhone) or Chrome (Android), or use the Upload Photo option instead.'
        : err?.name === 'NotReadableError' || err?.name === 'TrackStartError'
        ? 'Camera is in use by another app. Close other apps using the camera and try again.'
        : 'Could not start camera. Use the Upload Photo option instead.';
      setCameraError(msg);
    }
  };

  const capturePhoto = useCallback(async () => {
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

    canvas.toBlob(async (blob) => {
      if (!blob) {
        toast.error('Failed to capture photo. Please try again or use the Upload option.');
        return;
      }
      stopCamera();
      await processImage(blob);
    }, 'image/jpeg', 0.95);
  }, []);

  const processImage = async (blob: Blob) => {
    setMode('processing');
    setProcessingError(null);
    try {
      setProcessingStep('Detecting subject…');
      const file = await applyWhiteBackground(blob);
      setProcessingStep('Applying white background…');
      // Small delay so user sees the final step message
      await new Promise(r => setTimeout(r, 200));

      const url = URL.createObjectURL(file);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(url);
      setProcessedFile(file);
      setMode('preview');
    } catch (err: any) {
      setProcessingError('Background removal failed. You can still use the photo as-is.');
      // Fall back: use original blob as-is with white bg via canvas
      try {
        const img = new Image();
        const tempUrl = URL.createObjectURL(blob);
        await new Promise<void>((res) => { img.onload = () => res(); img.src = tempUrl; });
        URL.revokeObjectURL(tempUrl);
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        const ctx = cv.getContext('2d')!;
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0);
        cv.toBlob((b) => {
          if (!b) return;
          const f = new File([b], 'passport_photo.jpg', { type: 'image/jpeg' });
          const u = URL.createObjectURL(f);
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          setPreviewUrl(u);
          setProcessedFile(f);
          setMode('preview');
        }, 'image/jpeg', 0.92);
      } catch { setMode('idle'); }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Photo must be under 10 MB. Please choose a smaller image.');
      return;
    }
    await processImage(file);
  };

  const handleConfirm = () => {
    if (processedFile) {
      onPhotoReady(processedFile);
      setMode('idle');
    }
  };

  const handleRetake = () => {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
    setProcessedFile(null);
    setProcessingError(null);
    setMode('idle');
  };

  const handleCancelCamera = () => {
    stopCamera();
    setMode('idle');
    setCameraError(null);
  };

  // Uploaded state: show done card
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
          onClick={() => { fileRef.current?.click(); }}
          className="text-xs bg-white border border-emerald-300 text-emerald-700 px-3 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors"
        >
          Replace
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={handleFileUpload} />
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
              className="group flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed border-gray-200 hover:border-brand-400 hover:bg-brand-50 transition-all"
            >
              <div className="w-10 h-10 rounded-full bg-brand-100 group-hover:bg-brand-200 flex items-center justify-center transition-colors">
                <Camera size={20} className="text-brand-600" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-700">Take Photo</p>
                <p className="text-[11px] text-gray-400 mt-0.5">Use your camera · BG removed</p>
              </div>
            </button>

            <label className="group flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed border-gray-200 hover:border-brand-400 hover:bg-brand-50 transition-all cursor-pointer">
              <div className="w-10 h-10 rounded-full bg-indigo-100 group-hover:bg-indigo-200 flex items-center justify-center transition-colors">
                <Upload size={20} className="text-indigo-600" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-700">Upload Photo</p>
                <p className="text-[11px] text-gray-400 mt-0.5">JPG / PNG · BG removed</p>
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
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-800">{cameraError}</p>
                  <button onClick={handleCancelCamera} className="text-xs text-red-600 underline mt-1">Go back</button>
                </div>
              </div>
            ) : (
              <>
                <div className="relative rounded-xl overflow-hidden bg-black aspect-square">
                  {/* Oval face guide overlay */}
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

        {/* PROCESSING — AI bg removal */}
        {mode === 'processing' && (
          <motion.div key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-10 gap-4">
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-brand-50 flex items-center justify-center">
                <Sparkles size={28} className="text-brand-500" />
              </div>
              <Loader2 size={20} className="animate-spin text-brand-400 absolute -top-1 -right-1" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-gray-700">Removing background…</p>
              <p className="text-xs text-gray-400 mt-1">{processingStep}</p>
              <p className="text-[11px] text-gray-400 mt-2">This may take a few seconds the first time</p>
            </div>
          </motion.div>
        )}

        {/* PREVIEW — result with white background */}
        {mode === 'preview' && previewUrl && (
          <motion.div key="preview" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="space-y-3">
            {processingError && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-center gap-2">
                <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" />
                <p className="text-xs text-amber-700">{processingError}</p>
              </div>
            )}

            <div className="flex flex-col items-center gap-2">
              {/* Result photo */}
              <div className="relative">
                <div className="w-40 h-48 rounded-xl overflow-hidden shadow-md border-4 border-white ring-1 ring-gray-200">
                  <img src={previewUrl} alt="Passport photo preview" className="w-full h-full object-cover" />
                </div>
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                  White background
                </div>
              </div>
              <p className="text-xs text-gray-500 text-center mt-3">
                {processingError ? 'Using original with white background' : 'Background removed and replaced with white'}
              </p>
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
