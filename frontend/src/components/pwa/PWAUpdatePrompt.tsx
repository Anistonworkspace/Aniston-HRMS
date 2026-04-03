import { useEffect, useState } from 'react';
import { RefreshCw, X, Sparkles, Loader2 } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export default function PWAUpdatePrompt() {
  const [dismissed, setDismissed] = useState(false);
  const [updating, setUpdating] = useState(false);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      // Check for updates every 60 seconds
      if (registration) {
        setInterval(() => {
          registration.update();
        }, 60 * 1000);
      }
    },
    onRegisterError(error) {
      console.error('SW registration error:', error);
    },
  });

  // When a new SW is waiting, clear all old caches proactively
  useEffect(() => {
    if (needRefresh) {
      caches.keys().then((names) => {
        names.forEach((name) => {
          if (name !== 'workbox-precache-v2') {
            caches.delete(name);
          }
        });
      });
    }
  }, [needRefresh]);

  const handleUpdate = async () => {
    if (updating) return;
    setUpdating(true);
    try {
      // Clear ALL caches before activating new SW
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
      // Activate new service worker and reload
      await updateServiceWorker(true);
      // Fallback: if updateServiceWorker doesn't reload within 3s, force reload
      setTimeout(() => { window.location.reload(); }, 3000);
    } catch {
      // If anything fails, just force reload
      window.location.reload();
    }
  };

  if (!needRefresh || dismissed) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] w-[calc(100%-2rem)] max-w-md animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-indigo-100 p-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
          <Sparkles size={20} className="text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">New Update Available</p>
          <p className="text-xs text-gray-500 mt-0.5">
            A new version of Aniston HRMS is ready. Update now to get the latest features.
          </p>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={handleUpdate}
              disabled={updating}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm disabled:opacity-70"
            >
              {updating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {updating ? 'Updating...' : 'Update Now'}
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700 font-medium transition-colors"
            >
              Later
            </button>
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
