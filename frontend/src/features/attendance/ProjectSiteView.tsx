import { useState } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Camera, Check, Loader2, FileText, Clock } from 'lucide-react';
import { useProjectSiteCheckInMutation, useGetProjectSiteCheckInsQuery } from './attendanceApi';
import toast from 'react-hot-toast';

const SAMPLE_SITES = [
  'Construction Site A — Noida Sector 62',
  'Client Office — Gurgaon',
  'Warehouse — Manesar',
  'Branch Office — Dwarka',
  'Event Venue — CP',
];

export default function ProjectSiteView() {
  const [siteName, setSiteName] = useState('');
  const [notes, setNotes] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [isCapturing, setIsCapturing] = useState(false);

  const [checkIn, { isLoading }] = useProjectSiteCheckInMutation();
  const { data: checkInsData } = useGetProjectSiteCheckInsQuery({});

  const todayCheckIns = checkInsData?.data || [];

  const handleCapture = () => {
    // In production, use <input type="file" accept="image/*" capture="environment">
    // For now, simulate
    setPhotoUrl(`https://storage.aniston.in/uploads/site-photo-${Date.now()}.jpg`);
    toast.success('Photo captured (simulated)');
  };

  const handleCheckIn = async () => {
    if (!siteName) {
      toast.error('Please select a site');
      return;
    }

    try {
      let latitude: number | undefined;
      let longitude: number | undefined;

      // Try to get GPS
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
        );
        latitude = pos.coords.latitude;
        longitude = pos.coords.longitude;
      } catch {
        // GPS optional for project sites
      }

      await checkIn({
        siteName,
        notes: notes || undefined,
        latitude,
        longitude,
        photoUrl: photoUrl || undefined,
      }).unwrap();

      toast.success('Site check-in recorded!');
      setSiteName('');
      setNotes('');
      setPhotoUrl('');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Check-in failed');
    }
  };

  return (
    <div className="space-y-4">
      <div className="layer-card p-5">
        <h3 className="text-lg font-display font-bold text-gray-900 mb-1">Project Site Attendance</h3>
        <p className="text-sm text-gray-400 mb-4">Check in at each project site you visit today.</p>

        {/* Site Selection */}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Select Site *</label>
            <select
              value={siteName}
              onChange={e => setSiteName(e.target.value)}
              className="input-glass w-full"
            >
              <option value="">Choose a project site...</option>
              {SAMPLE_SITES.map(site => (
                <option key={site} value={site}>{site}</option>
              ))}
            </select>
          </div>

          {/* Photo Capture */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Site Photo</label>
            <div
              onClick={handleCapture}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all
                ${photoUrl ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 hover:border-brand-300'}`}
            >
              {photoUrl ? (
                <div className="flex items-center justify-center gap-2 text-emerald-600">
                  <Check className="w-5 h-5" />
                  <span className="font-medium">Photo captured</span>
                </div>
              ) : (
                <>
                  <Camera className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">Tap to capture site photo</p>
                </>
              )}
            </div>
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
            disabled={isLoading || !siteName}
            className={`w-full py-3 rounded-xl font-medium text-lg flex items-center justify-center gap-2 transition-colors
              ${siteName ? 'bg-brand-600 text-white hover:bg-brand-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
          >
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <MapPin className="w-5 h-5" />}
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
                <div className="w-8 h-8 rounded-full bg-brand-50 flex items-center justify-center shrink-0">
                  <MapPin className="w-4 h-4 text-brand-600" />
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
                {ci.checkInPhoto && (
                  <div className="w-10 h-10 rounded-lg bg-gray-200 shrink-0" />
                )}
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
