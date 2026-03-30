import { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, RotateCcw, Check, X } from 'lucide-react';

interface CameraCaptureProps {
  onCapture: (blob: Blob) => void;
  onCancel?: () => void;
}

export default function CameraCapture({ onCapture, onCancel }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  const startCamera = useCallback(async () => {
    try {
      setError(null);
      // Stop any existing stream
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });

      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError('Camera access denied. Please allow camera access in your browser settings.');
      } else if (err.name === 'NotFoundError') {
        setError('No camera found on this device.');
      } else {
        setError('Failed to access camera. Please try again.');
      }
    }
  }, [facingMode]);

  useEffect(() => {
    startCamera();
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [facingMode]);

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Mirror for selfie mode
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);

    canvas.toBlob((blob) => {
      if (blob) {
        setCapturedBlob(blob);
        setCapturedImage(canvas.toDataURL('image/jpeg', 0.9));
        // Stop camera after capture
        stream?.getTracks().forEach(track => track.stop());
      }
    }, 'image/jpeg', 0.9);
  };

  const handleRetake = () => {
    setCapturedImage(null);
    setCapturedBlob(null);
    startCamera();
  };

  const handleConfirm = () => {
    if (capturedBlob) {
      onCapture(capturedBlob);
    }
  };

  if (error) {
    return (
      <div className="bg-gray-100 rounded-xl p-8 text-center">
        <Camera size={32} className="text-gray-400 mx-auto mb-3" />
        <p className="text-sm text-red-600 mb-3">{error}</p>
        <button onClick={startCamera} className="btn-primary text-sm">Try Again</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <canvas ref={canvasRef} className="hidden" />

      {capturedImage ? (
        <div className="space-y-3">
          <div className="relative rounded-xl overflow-hidden bg-black">
            <img src={capturedImage} alt="Captured" className="w-full max-h-80 object-contain" />
          </div>
          <div className="flex gap-3">
            <button onClick={handleRetake} className="btn-secondary flex-1 flex items-center justify-center gap-2 text-sm">
              <RotateCcw size={16} /> Retake
            </button>
            <button onClick={handleConfirm} className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm">
              <Check size={16} /> Use Photo
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative rounded-xl overflow-hidden bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full max-h-80 object-contain"
              style={facingMode === 'user' ? { transform: 'scaleX(-1)' } : undefined}
            />
            {/* Oval guide overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-48 h-60 border-2 border-white/50 rounded-full" />
            </div>
          </div>
          <div className="flex gap-3">
            {onCancel && (
              <button onClick={onCancel} className="btn-secondary flex items-center justify-center gap-2 text-sm px-4">
                <X size={16} /> Cancel
              </button>
            )}
            <button onClick={handleCapture} className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm">
              <Camera size={16} /> Capture Photo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
