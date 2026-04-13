import { useEffect, useState } from 'react';
import { X, Sparkles } from 'lucide-react';

/**
 * PWAUpdatePrompt — lightweight ambient PWA helpers.
 *
 * Responsibilities:
 *   • Offline / online banner at the top of the screen
 *   • One-time "Add to Home Screen" install hint
 *
 * NOTE: SW update logic has been intentionally removed from this component.
 *       It now lives entirely in AppUpdateGuard (features/app-update/), which
 *       shows a mandatory full-screen blocking modal on all platforms (web,
 *       PWA, Android native, iOS native) and clears all caches before reload.
 */
export default function PWAUpdatePrompt() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

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

      {/* ── Install hint ── */}
      <InstallHint />
    </>
  );
}

/** Shows a one-time "Add to Home Screen" hint on mobile if not already installed. */
function InstallHint() {
  const [show, setShow] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    // Already installed as standalone — don't show
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true;
    if (isStandalone) return;

    // Already dismissed — never show again
    if (localStorage.getItem('pwa-install-dismissed')) return;

    // main.tsx captures beforeinstallprompt early and stores it on window
    const earlyPrompt = (window as any).__pwaInstallPrompt;
    if (earlyPrompt) {
      setDeferredPrompt(earlyPrompt);
      setTimeout(() => setShow(true), 3000);
      return;
    }

    // Fallback: listen for the event directly
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setTimeout(() => setShow(true), 3000);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // Also listen for the custom event dispatched by main.tsx
    const onReady = () => {
      const p = (window as any).__pwaInstallPrompt;
      if (p) {
        setDeferredPrompt(p);
        setTimeout(() => setShow(true), 3000);
      }
    };
    window.addEventListener('pwa-prompt-ready', onReady);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('pwa-prompt-ready', onReady);
    };
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
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 rounded-lg"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
