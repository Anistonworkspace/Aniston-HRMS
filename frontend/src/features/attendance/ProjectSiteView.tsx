import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Camera, Check, Loader2, FileText, Clock, X } from 'lucide-react';
import { useProjectSiteCheckInMutation, useGetProjectSiteCheckInsQuery } from './attendanceApi';
import { useGetLocationsQuery } from '../workforce/workforceApi';
import { useAppSelector } from '../../app/store';
import toast from 'react-hot-toast';

export default function ProjectSiteView() {
  const [siteName, setSiteName] = useState('');
  const [notes, setNotes] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const accessToken = useAppSelector(s => s.auth.accessToken);

  const [checkIn, { isLoading }] = useProjectSiteCheckInMutation();
  const { data: checkInsData } = useGetProjectSiteCheckInsQuery({});
  const { data: locationsData } = useGetLocationsQuery();

  const locations = locationsData?.data || [];
  const todayCheckIns = checkInsData?.data || [];

  const handleCapture = async () => {
    // Check camera permission on mobile and provide feedback
    if (navigator.permissions) {
      try {
        const result = await navigator.permissions.query({ name: 'camera' as PermissionName });
        if (result.state === 'denied') {
          toast.error('Camera permission denied. Please enable it in browser settings to capture site photos.');
          return;
        }
      } catch { /* Permissions API may not support camera query — proceed anyway */ }
    }
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error('Photo must be under 5MB');
        return;
      }
      setPhotoFile(file);
      const reader = new FileReader();
      reader.onload = () => setPhotoPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const clearPhoto = () => {
    setPhotoFile(null);
    setPhotoPreview('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCheckIn = async () => {
    if (!siteName) {
      toast.error('Please select a site');
      return;
    }
    // Prevent duplicate check-in at the same site today
    const alreadyCheckedIn = todayCheckIns.some(
      (c: any) => c.siteName?.toLowerCase().trim() === siteName.toLowerCase().trim()
    );
    if (alreadyCheckedIn) {
      toast.error(`Already checked in at "${siteName}" today`);
      return;
    }
    if (isSubmitting) return; // debounce double-tap
    setIsSubmitting(true);

    try {
      let latitude: number | undefined;
      let longitude: number | undefined;
      let accuracy: number | undefined;

      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            maximumAge: 0,      // Force fresh GPS — never use cached position for site check-in
            timeout: 20000,     // 20 s to cover indoor GPS warm-up on mobile
          })
        );
        latitude = pos.coords.latitude;
        longitude = pos.coords.longitude;
        accuracy = pos.coords.accuracy;
      } catch (gpsErr: any) {
        // Notify user GPS is unavailable but allow check-in
        if (gpsErr?.code === 1) {
          toast('Location denied — check-in without GPS', { icon: '\u26A0\uFE0F' });
        }
      }

      // If photo exists, upload via FormData for efficiency (avoid base64 overhead on mobile)
      let photoUrl: string | undefined;
      if (photoFile) {
        const formData = new FormData();
        formData.append('file', photoFile);
        try {
          const apiBase = import.meta.env.VITE_API_URL || '/api';
          const uploadRes = await fetch(`${apiBase}/uploads/image`, {
            method: 'POST',
            body: formData,
            headers: { 'Authorization': `Bearer ${accessToken || ''}` },
          });
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            photoUrl = uploadData.data?.url || uploadData.url;
          }
        } catch {
          // Fall back to base64 if upload endpoint unavailable
          photoUrl = photoPreview || undefined;
        }
      }

      await checkIn({
        siteName,
        notes: notes || undefined,
        latitude,
        longitude,
        photoUrl,
      }).unwrap();

      toast.success('Site check-in recorded!');
      setSiteName('');
      setNotes('');
      clearPhoto();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Check-in failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="layer-card p-5">
        <h3 className="text-lg font-display font-bold text-gray-900 mb-1">Project Site Attendance</h3>
        <p className="text-sm text-gray-400 mb-4">Check in at each project site you visit today.</p>

        <div className="space-y-3">
          {/* Site Selection — from real API locations */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Select Site *</label>
            <select
              value={siteName}
              onChange={e => setSiteName(e.target.value)}
              className="input-glass w-full"
            >
              <option value="">Choose a project site...</option>
              {locations.map((loc: any) => (
                <option key={loc.id} value={loc.name}>
                  {loc.name}{loc.address ? ` — ${loc.address}` : ''}
                </option>
              ))}
            </select>
            {locations.length === 0 && (
              <p className="text-xs text-amber-500 mt-1">No sites configured. Ask HR to add locations in Roster → Office Locations.</p>
            )}
          </div>

          {/* Real Photo Capture */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Site Photo</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
            {photoPreview ? (
              <div className="relative rounded-xl overflow-hidden border-2 border-emerald-300">
                <img src={photoPreview} alt="Site photo" className="w-full h-32 object-cover" />
                <button onClick={clearPhoto}
                  className="absolute top-2 right-2 w-7 h-7 bg-black/50 text-white rounded-full flex items-center justify-center hover:bg-black/70">
                  <X size={14} />
                </button>
                <div className="absolute bottom-0 left-0 right-0 bg-emerald-600 text-white text-xs py-1 text-center font-medium">
                  Photo captured
                </div>
              </div>
            ) : (
              <div
                onClick={handleCapture}
                className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all border-gray-200"
              >
                <Camera className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">Tap to capture site photo</p>
                <p className="text-xs text-gray-400 mt-0.5">Opens camera on mobile</p>
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="input-glass w-full h-20 resize-none"
              placeholder="Any additional notes about this site visit..."
            />
          </div>

          <button
            onClick={handleCheckIn}
            disabled={isLoading || isSubmitting || !siteName}
            className={`w-full py-3 rounded-xl font-medium text-lg flex items-center justify-center gap-2 transition-colors
              ${siteName ? '' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
            style={siteName ? { background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' } : undefined}
          >
            {(isLoading || isSubmitting) ? <Loader2 className="w-5 h-5 animate-spin" /> : <MapPin className="w-5 h-5" />}
            Check In at Site
          </button>
        </div>
      </div>

      {/* Today's Check-ins */}
      {todayCheckIns.length > 0 && (
        <div className="layer-card p-5">
          <h4 className="font-display font-bold text-gray-900 mb-3">Today's Site Visits</h4>
          <div className="space-y-3">
            {todayCheckIns.map((ci: any, i: number) => (
              <motion.div
                key={ci.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg"
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--primary-highlighted-color)' }}>
                  <MapPin className="w-4 h-4" style={{ color: 'var(--primary-color)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{ci.siteName}</p>
                  {ci.notes && <p className="text-xs text-gray-500 mt-0.5">{ci.notes}</p>}
                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                    <Clock className="w-3 h-3" />
                    {new Date(ci.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                    {ci.checkInLat && (
                      <span className="font-mono" data-mono>
                        ({Number(ci.checkInLat).toFixed(4)}, {Number(ci.checkInLng).toFixed(4)})
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
