import { useEffect, useRef, useState } from 'react';
import { X, Sparkles, Share, Plus, WifiOff, RefreshCw } from 'lucide-react';
import { Capacitor } from '@capacitor/core';

/**
 * PWAUpdatePrompt — lightweight ambient PWA helpers.
 *
 * Responsibilities:
 *   • Offline banner (shown globally whenever navigator.onLine is false)
 *   • Mobile install hint:
 *       - Android Chrome  → "Install Now" button via beforeinstallprompt
 *       - Android other   → manual "⋮ → Add to Home screen" instructions
 *       - iOS Safari      → "Share → Add to Home Screen" instructions
 *       - Desktop         → one-time hint via localStorage (if Chrome prompt fires)
 *
 * Dismiss behaviour:
 *   • Mobile  → sessionStorage  (dismisses for this browser session only;
 *                                 shows again every time the user reopens the site)
 *   • Desktop → localStorage    (dismisses once, permanently)
 *
 * NOTE: SW update logic lives in AppUpdateGuard (features/app-update/).
 */

// Stable UA checks (evaluated once at module load, not per render)
const _ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const isMobile  = /Android|iPhone|iPad|iPod|Mobile/i.test(_ua);
const isIOS     = /iPhone|iPad|iPod/i.test(_ua) && !(window as any).MSStream;
const isAndroid = /Android/i.test(_ua);

export default function PWAUpdatePrompt() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOnline  = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener('online',  goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online',  goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return (
    <>
      {/* ── Offline banner ──────────────────────────────────────────────── */}
      {isOffline && (
        <div className="fixed top-0 left-0 right-0 z-[9999] bg-red-500 text-white text-xs font-semibold py-2 px-4 shadow-lg flex items-center justify-center gap-2">
          <WifiOff size={14} className="flex-shrink-0" />
          <span>No internet connection — Please connect to continue using Aniston HRMS</span>
          <button
            onClick={() => window.location.reload()}
            className="ml-2 flex items-center gap-1 underline underline-offset-2 text-white/90 hover:text-white transition-colors"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        </div>
      )}

      {/* ── Install hint ────────────────────────────────────────────────── */}
      <InstallHint />
    </>
  );
}

function InstallHint() {
  const [show, setShow]                   = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  // Track whether prompt is still pending (might fire after mount)
  const promptPendingRef = useRef(false);
  const timerRef         = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // ── 0. Never show inside native APK — app is already installed ───
    if (Capacitor.isNativePlatform()) return;

    // ── 1. Skip if already installed (running as standalone PWA) ──────
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true;
    if (isStandalone) return;

    // ── 2. Skip on /download/* pages — user already sees install guide ─
    if (window.location.pathname.startsWith('/download')) return;

    // ── 3. Dismiss logic:
    //       Mobile  → sessionStorage (per browser session — shows every new visit)
    //       Desktop → localStorage   (permanent one-time dismiss)
    const storage = isMobile ? sessionStorage : localStorage;
    if (storage.getItem('pwa-install-dismissed')) return;

    // ── 4. iOS Safari — no beforeinstallprompt; show manual steps ─────
    if (isIOS) {
      timerRef.current = setTimeout(() => setShow(true), 3500);
      return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }

    // ── 5. Android / Desktop — try to capture beforeinstallprompt ──────
    //    main.tsx captures the event before any lazy route loads and stores
    //    it on window.__pwaInstallPrompt. Read that first.
    const earlyPrompt = (window as any).__pwaInstallPrompt;
    if (earlyPrompt) {
      setDeferredPrompt(earlyPrompt);
      timerRef.current = setTimeout(() => setShow(true), 3500);
    } else {
      // Prompt hasn't fired yet — mark pending
      promptPendingRef.current = true;
    }

    // Listen for the prompt if it fires after this component mounts
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      if (promptPendingRef.current) {
        timerRef.current = setTimeout(() => setShow(true), 3500);
        promptPendingRef.current = false;
      }
    };
    const onPromptReady = () => {
      const p = (window as any).__pwaInstallPrompt;
      if (p && promptPendingRef.current) {
        setDeferredPrompt(p);
        timerRef.current = setTimeout(() => setShow(true), 3500);
        promptPendingRef.current = false;
      }
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('pwa-prompt-ready', onPromptReady);

    // ── 6. Android fallback: if no prompt after 6 s, show manual steps ─
    //    (Covers Samsung Internet, Firefox, Brave, etc. — no beforeinstallprompt)
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    if (isAndroid && !earlyPrompt) {
      fallbackTimer = setTimeout(() => {
        if (promptPendingRef.current) {
          promptPendingRef.current = false;
          setShow(true); // shows without deferredPrompt → manual instruction UI
        }
      }, 6000);
    }

    return () => {
      if (timerRef.current)  clearTimeout(timerRef.current);
      if (fallbackTimer)     clearTimeout(fallbackTimer);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('pwa-prompt-ready', onPromptReady);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setShow(false);
  };

  const handleDismiss = () => {
    setShow(false);
    const storage = isMobile ? sessionStorage : localStorage;
    storage.setItem('pwa-install-dismissed', '1');
  };

  if (!show) return null;

  // ── iOS Safari: manual "Share → Add to Home Screen" instructions ────
  if (isIOS) {
    return (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9998] w-[calc(100%-2rem)] max-w-sm animate-in slide-in-from-bottom-4 fade-in duration-300">
        <div className="bg-white/97 backdrop-blur-xl rounded-2xl shadow-2xl border border-indigo-100 p-4">
          <div className="flex items-start gap-3">
            {/* App icon */}
            <div className="w-11 h-11 rounded-xl bg-indigo-600 flex items-center justify-center flex-shrink-0 shadow-sm">
              <span className="text-white font-bold text-lg font-display leading-none">A</span>
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 leading-tight">Install Aniston HRMS</p>
              <p className="text-xs text-gray-500 mt-0.5 mb-3 leading-relaxed">
                Add to your home screen for a full native-app experience.
              </p>

              {/* Step-by-step instructions */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-gray-700">
                  <div className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-indigo-600 font-bold text-[10px]">1</span>
                  </div>
                  <span>Tap the <Share size={11} className="inline mb-0.5 text-indigo-500" /> <strong>Share</strong> button in Safari</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-700">
                  <div className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-indigo-600 font-bold text-[10px]">2</span>
                  </div>
                  <span>Tap <Plus size={11} className="inline mb-0.5 text-indigo-500" /> <strong>"Add to Home Screen"</strong></span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-700">
                  <div className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-indigo-600 font-bold text-[10px]">3</span>
                  </div>
                  <span>Tap <strong>"Add"</strong> — done! Opens like a real app.</span>
                </div>
              </div>

              {/* Bottom pointer reminder */}
              <p className="text-xs text-indigo-600 font-medium text-center mt-3 pt-2 border-t border-indigo-50">
                ↓ Tap the Share button at the bottom of Safari ↓
              </p>
            </div>

            <button
              onClick={handleDismiss}
              className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Android Chrome: one-tap install (beforeinstallprompt available) ─
  if (deferredPrompt) {
    return (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9998] w-[calc(100%-2rem)] max-w-sm animate-in slide-in-from-bottom-4 fade-in duration-300">
        <div className="bg-white/97 backdrop-blur-xl rounded-2xl shadow-2xl border border-indigo-100 p-4 flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-indigo-600 flex items-center justify-center flex-shrink-0 shadow-sm">
            <span className="text-white font-bold text-lg font-display leading-none">A</span>
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900">Install Aniston HRMS</p>
            <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
              Add to home screen — works offline, feels like a native app.
            </p>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={handleInstall}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
              >
                Install Now
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
            className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
            aria-label="Dismiss"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  // ── Android other browser / no prompt: manual Chrome menu steps ─────
  if (isAndroid) {
    return (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9998] w-[calc(100%-2rem)] max-w-sm animate-in slide-in-from-bottom-4 fade-in duration-300">
        <div className="bg-white/97 backdrop-blur-xl rounded-2xl shadow-2xl border border-indigo-100 p-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-indigo-600 flex items-center justify-center flex-shrink-0 shadow-sm">
              <span className="text-white font-bold text-lg font-display leading-none">A</span>
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">Install Aniston HRMS</p>
              <p className="text-xs text-gray-500 mt-0.5 mb-3">Install as an app for the best experience.</p>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-gray-700">
                  <div className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-indigo-600 font-bold text-[10px]">1</span>
                  </div>
                  <span>Open this page in <strong>Chrome</strong></span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-700">
                  <div className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-indigo-600 font-bold text-[10px]">2</span>
                  </div>
                  <span>Tap <strong>⋮</strong> menu → <strong>"Add to Home screen"</strong></span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-700">
                  <div className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-indigo-600 font-bold text-[10px]">3</span>
                  </div>
                  <span>Tap <strong>"Add"</strong> to confirm</span>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-3">
                <a
                  href="/download/android"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
                >
                  View full guide
                </a>
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
              className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Desktop: one-time install hint (only when Chrome fires the prompt) ─
  if (deferredPrompt === null && !isMobile) return null; // should not reach here but safety guard

  return (
    <div className="fixed bottom-6 right-6 z-[9998] w-80 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="bg-white/97 backdrop-blur-xl rounded-2xl shadow-2xl border border-indigo-100 p-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
          <Sparkles size={20} className="text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">Install Aniston HRMS</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
            Install as a desktop app for faster access and offline support.
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
          className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
