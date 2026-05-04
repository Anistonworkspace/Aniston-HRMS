import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, X, AlertTriangle } from 'lucide-react';
import { checkForAppUpdate, startAppUpdate } from '../../lib/capacitorUpdate';

export default function AppUpdateChecker() {
  const [updateInfo, setUpdateInfo] = useState<{
    available: boolean;
    updateType: 'FLEXIBLE' | 'IMMEDIATE';
    stalenessDays: number;
  } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    // Check 3s after mount so app finishes loading first
    const t = setTimeout(async () => {
      const info = await checkForAppUpdate();
      if (info?.available) setUpdateInfo(info);
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  if (!updateInfo || dismissed) return null;

  const isCritical = updateInfo.updateType === 'IMMEDIATE';

  const handleUpdate = async () => {
    setUpdating(true);
    await startAppUpdate(updateInfo.updateType);
    setUpdating(false);
    if (!isCritical) setDismissed(true);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -40 }}
        className={`fixed top-4 left-4 right-4 z-[9999] rounded-xl shadow-xl p-4 flex items-start gap-3 ${
          isCritical
            ? 'bg-red-600 text-white'
            : 'bg-indigo-600 text-white'
        }`}
      >
        {isCritical ? (
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
        ) : (
          <Download className="w-5 h-5 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1">
          <p className="font-semibold text-sm mb-0.5">
            {isCritical ? 'Critical Update Required' : 'App Update Available'}
          </p>
          <p className="text-xs opacity-90">
            {isCritical
              ? 'A required update must be installed before you can continue.'
              : `A new version of Aniston HRMS is available${updateInfo.stalenessDays > 0 ? ` (${updateInfo.stalenessDays} days old)` : ''}. Update now for the latest features.`}
          </p>
          <button
            onClick={handleUpdate}
            disabled={updating}
            className="mt-2 px-4 py-1.5 rounded-lg bg-white text-indigo-700 text-xs font-semibold hover:bg-indigo-50 transition-colors disabled:opacity-60"
          >
            {updating ? 'Starting update…' : isCritical ? 'Update Now (Required)' : 'Update Now'}
          </button>
        </div>
        {!isCritical && (
          <button
            onClick={() => setDismissed(true)}
            className="p-1 opacity-70 hover:opacity-100 flex-shrink-0"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
