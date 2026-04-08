import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, X, Sparkles } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * PWA notification component.
 *
 * registerType: 'autoUpdate' means the SW updates silently in the background.
 * We show a brief "App updated" toast once the new SW is activated (offlineReady / periodic check).
 * We also track when the app goes offline/online.
 */
export default function PWAUpdatePrompt() {
  const [showUpdated, setShowUpdated] = useState(false);
  const [isOffline,   setIsOffline]   = useState(!navigator.onLine);
  const firstRender = useRef(true);

  // With autoUpdate, useRegisterSW still provides hooks for offline-ready events
  useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      // Periodic update check every 60 s — new SW activates silently
      if (registration) {
        setInterval(() => registration.update(), 60 * 1000);
      }
    },
    onOfflineReady() {
      // SW has cached enough to work offline — show brief toast on SUBSEQUENT loads only
      if (!firstRender.current) {
        setShowUpdated(true);
        setTimeout(() => setShowUpdated(false), 4000);
      }
    },
    onRegisterError(error) {
      console.error('SW registration error:', error);
    },
  });

  // Mark first render as done after mount
  useEffect(() => {
    const t = setTimeout(() => { firstRender.current = false; }, 2000);
    return () => clearTimeout(t);
  }, []);

  // Online / offline banner
  useEffect(() => {
    const setOnline  = () => setIsOffline(false);
    const setOffline = () => setIsOffline(true);
    window.addEventListener('online',  setOnline);
    window.addEventListener('offline', setOffline);
    return () => {
      window.removeEventListener('online',  setOnline);
      window.removeEventListener('offline', setOffline);
    };
  }, []);

  return (
    <>
      {/* ── Offline banner ── */}
      {isOffline && (
        <div className="fixed top-0 left-0 right-0 z-[9999] bg-amber-500 text-white text-xs font-semibold text-center py-1.5 px-4 shadow-md">
          You're offline — some features may be unavailable
        </div>
      )}

      {/* ── App updated toast ── */}
      {showUpdated && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-xl border border-green-100 px-5 py-3.5 flex items-center gap-3 min-w-[260px]">
            <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 size={18} className="text-green-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900">App Updated</p>
              <p className="text-xs text-gray-500">Aniston HRMS is now up to date</p>
            </div>
            <button
              onClick={() => setShowUpdated(false)}
              className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── Install hint (shown once, dismissed forever) ── */}
      <InstallHint />
    </>
  );
}

/** Shows a one-time "Add to Home Screen" hint on mobile if app is not already installed. */
function InstallHint() {
  const [show, setShow] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    // Already installed as standalone — don't show
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true;
    if (isStandalone) return;

    // Check if dismissed before
    if (localStorage.getItem('pwa-install-dismissed')) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Show after a short delay so it doesn't pop up immediately
      setTimeout(() => setShow(true), 3000);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShow(false);
    }
  };

  const handleDismiss = () => {
    setShow(false);
    localStorage.setItem('pwa-install-dismissed', '1');
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9998] w-[calc(100%-2rem)] max-w-sm animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-indigo-100 p-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
          <Sparkles size={20} className="text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">Install Aniston HRMS</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
            Add to your home screen for faster access and offline support.
          </p>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={handleInstall}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
            >
              Install
            </button>
            <button
              onClick={handleDismiss}
              className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700 font-medium transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
        <button onClick={handleDismiss} className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 rounded-lg">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
