/**
 * AppUpdateGuard — Automatic update handler for all platforms.
 *
 * ── Web (Desktop browser + PWA installed) ────────────────────────────────────
 * When a new SW is detected (= new build deployed):
 *   1. Shows a small non-blocking toast at the top: "Updating in 3…"
 *   2. Auto-reloads after 3 seconds — no user click required.
 *   3. User can click "Reload Now" to apply immediately.
 *   On apply: clears all runtime caches → sends SKIP_WAITING → page reloads.
 *
 * ── Android / iOS (Capacitor native app) ─────────────────────────────────────
 * Checks /api/app-updates/latest on every app launch via @capgo/capacitor-updater.
 * When a newer OTA bundle exists: shows full-screen modal with download progress.
 */
import { useEffect, useRef, useState, ReactNode } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, RefreshCw, Smartphone, CheckCircle2, AlertCircle, RefreshCcw } from 'lucide-react';

interface UpdateManifest {
  version: string;
  url: string;
  mandatory: boolean;
  notes?: string;
}

type Phase = 'idle' | 'update-available' | 'downloading' | 'installing' | 'error';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isNative(): boolean {
  try {
    return !!(window as any).Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

async function getUpdater() {
  // eslint-disable-next-line no-new-func
  const { CapacitorUpdater } = await (new Function('m', 'return import(m)'))('@capgo/capacitor-updater');
  return CapacitorUpdater;
}

async function clearAllCaches(): Promise<void> {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    try {
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHES' });
    } catch { /* ignore */ }
  }
  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch { /* ignore */ }
  }
  try { sessionStorage.clear(); } catch { /* ignore */ }
}

// ─── Web Update Toast ─────────────────────────────────────────────────────────
// Small non-blocking banner at the top — auto-reloads after countdown

interface WebUpdateToastProps {
  countdown: number;
  onNow: () => void;
}

function WebUpdateToast({ countdown, onNow }: WebUpdateToastProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -60 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -60 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 bg-indigo-600 text-white px-5 py-3 rounded-2xl shadow-2xl shadow-indigo-200 text-sm font-medium"
    >
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}
      >
        <RefreshCcw size={16} />
      </motion.div>
      <span>
        New version available — reloading in <strong>{countdown}s</strong>
      </span>
      <button
        onClick={onNow}
        className="ml-1 bg-white/20 hover:bg-white/30 transition-colors text-white text-xs font-semibold px-3 py-1.5 rounded-xl"
      >
        Reload Now
      </button>
    </motion.div>
  );
}

// ─── Native update screen ─────────────────────────────────────────────────────

interface UpdateScreenProps {
  manifest: UpdateManifest;
  phase: Phase;
  progress: number;
  onUpdate: () => void;
  onLater?: () => void;
  errorMsg?: string;
}

function UpdateScreen({ manifest, phase, progress, onUpdate, onLater, errorMsg }: UpdateScreenProps) {
  const isBusy = phase === 'downloading' || phase === 'installing';

  return (
    <div className="fixed inset-0 z-[9999] bg-gradient-to-br from-brand-50 via-white to-indigo-50 flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-sm"
      >
        <div className="flex justify-center mb-8">
          <div className="w-24 h-24 bg-brand-600 rounded-3xl flex items-center justify-center shadow-xl shadow-brand-200">
            <span className="text-white text-4xl font-bold font-display">A</span>
          </div>
        </div>

        <div className="bg-white/90 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/50 p-8 text-center">

          {phase === 'error' ? (
            <>
              <div className="w-14 h-14 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <AlertCircle size={28} className="text-red-500" />
              </div>
              <h2 className="text-xl font-display font-bold text-gray-900 mb-2">Update Failed</h2>
              <p className="text-sm text-gray-500 mb-6">{errorMsg || 'Could not apply the update. Please check your connection and try again.'}</p>
              <button
                onClick={onUpdate}
                className="w-full bg-brand-600 hover:bg-brand-700 text-white py-3.5 rounded-2xl font-semibold transition-colors mb-3"
              >
                Try Again
              </button>
              {onLater && (
                <button onClick={onLater} className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
                  Continue without updating
                </button>
              )}
            </>
          ) : phase === 'installing' ? (
            <>
              <div className="w-14 h-14 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={28} className="text-emerald-500" />
              </div>
              <h2 className="text-xl font-display font-bold text-gray-900 mb-2">Installing…</h2>
              <p className="text-sm text-gray-500">Clearing old cache and applying update. The app will restart shortly.</p>
            </>
          ) : (
            <>
              <div className="inline-flex items-center gap-1.5 bg-brand-50 text-brand-600 text-xs font-semibold px-3 py-1 rounded-full mb-5">
                <Smartphone size={12} />
                Update Available
                {manifest.version && manifest.version !== 'builtin' && manifest.version !== 'New' && (
                  <span>— v{manifest.version}</span>
                )}
              </div>

              <h2 className="text-2xl font-display font-bold text-gray-900 mb-2">
                New Version Ready
              </h2>
              <p className="text-sm text-gray-500 mb-2">
                {manifest.notes || 'A new version of Aniston HRMS is available with the latest features and improvements.'}
              </p>

              {manifest.mandatory ? (
                <p className="text-xs text-amber-600 bg-amber-50 rounded-xl px-3 py-2 mb-6">
                  This update is required to continue using the app.
                </p>
              ) : (
                <p className="text-xs text-gray-400 mb-6">You can update now or continue using the current version.</p>
              )}

              {phase === 'downloading' && (
                <div className="mb-5">
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-1">
                    <motion.div
                      className="h-full bg-brand-600 rounded-full"
                      animate={{ width: `${progress}%` }}
                      transition={{ ease: 'linear' }}
                    />
                  </div>
                  <p className="text-xs text-gray-400">{progress}% downloaded</p>
                </div>
              )}

              <motion.button
                whileHover={!isBusy ? { scale: 1.02 } : {}}
                whileTap={!isBusy ? { scale: 0.97 } : {}}
                onClick={onUpdate}
                disabled={isBusy}
                className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-70 text-white py-4 rounded-2xl font-semibold text-base flex items-center justify-center gap-2.5 shadow-lg shadow-brand-200 transition-colors mb-3"
              >
                {isBusy ? (
                  <>
                    <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
                      <RefreshCw size={18} />
                    </motion.div>
                    {phase === 'downloading' ? 'Downloading…' : 'Installing…'}
                  </>
                ) : (
                  <>
                    <Download size={18} />
                    Update Now
                  </>
                )}
              </motion.button>

              {!manifest.mandatory && onLater && (
                <button
                  onClick={onLater}
                  disabled={isBusy}
                  className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 disabled:opacity-40 transition-colors"
                >
                  Later
                </button>
              )}
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">Aniston Technologies LLP</p>
      </motion.div>
    </div>
  );
}

// ─── Web SW update detector ───────────────────────────────────────────────────

interface WebUpdateDetectorProps {
  onUpdateAvailable: (triggerUpdate: () => void) => void;
}

function WebUpdateDetector({ onUpdateAvailable }: WebUpdateDetectorProps) {
  const { updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      if (registration.waiting) {
        onUpdateAvailable(() => updateServiceWorker(true));
        return;
      }

      // Poll every 30s while the app is open
      setInterval(() => registration.update(), 30_000);

      // Check when user switches back to this tab
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          registration.update();
        }
      });

      registration.addEventListener('updatefound', () => {
        const newSW = registration.installing;
        if (!newSW) return;
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            onUpdateAvailable(() => updateServiceWorker(true));
          }
        });
      });
    },
    onNeedRefresh() {
      onUpdateAvailable(() => updateServiceWorker(true));
    },
    onOfflineReady() {
      console.info('[AppUpdateGuard] App is ready for offline use.');
    },
  });
  return null;
}

// ─── Main guard ───────────────────────────────────────────────────────────────

export default function AppUpdateGuard({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [manifest, setManifest] = useState<UpdateManifest | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  // Web-specific: countdown before auto-reload
  const [webCountdown, setWebCountdown] = useState(3);

  const [isNativeApp] = useState(() => isNative());
  const webTriggerRef = useRef<(() => void) | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Native OTA update check ───────────────────────────────────────────────
  useEffect(() => {
    if (!isNativeApp) return;

    (async () => {
      try {
        const updater = await getUpdater();
        await updater.notifyAppReady();

        const { bundle } = await updater.current();
        const currentVersion: string = bundle?.version ?? 'builtin';
        if (currentVersion === 'builtin') return;

        const res = await fetch('https://hr.anistonav.com/api/app-updates/latest', { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        if (!json.success || !json.data?.version || !json.data?.url) return;

        const latest: UpdateManifest = json.data;
        if (latest.version !== currentVersion) {
          setManifest(latest);
          setPhase('update-available');
        }
      } catch (err) {
        console.warn('[AppUpdateGuard] native update check error:', err);
      }
    })();
  }, [isNativeApp]);

  // ── Web: auto-apply update with countdown toast ───────────────────────────
  const applyWebUpdate = async () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setPhase('installing');
    await clearAllCaches();
    if (webTriggerRef.current) {
      webTriggerRef.current();
    } else {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg?.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      }
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      }, { once: true });
    }
  };

  const handleWebUpdateAvailable = (triggerFn: () => void) => {
    webTriggerRef.current = triggerFn;
    setWebCountdown(3);
    setPhase('update-available');

    // Start 3-second countdown then auto-apply
    let count = 3;
    countdownRef.current = setInterval(() => {
      count -= 1;
      setWebCountdown(count);
      if (count <= 0) {
        clearInterval(countdownRef.current!);
        applyWebUpdate();
      }
    }, 1000);
  };

  // ── Native update action ──────────────────────────────────────────────────
  const handleNativeUpdate = async () => {
    if (!manifest) return;
    setPhase('downloading');
    setProgress(0);
    setErrorMsg('');

    try {
      const updater = await getUpdater();
      const listener = await updater.addListener('download', (info: { percent: number }) => {
        setProgress(Math.round(info.percent));
      });
      const bundle = await updater.download({ url: manifest.url, version: manifest.version });
      listener.remove();
      setPhase('installing');
      await clearAllCaches();
      await updater.set(bundle);
      await new Promise((r) => setTimeout(r, 400));
      window.location.reload();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Download failed. Please try again.');
      setPhase('error');
    }
  };

  const handleLater = () => setDismissed(true);

  const showWebToast = !isNativeApp && phase === 'update-available' && !dismissed;
  const showNativeModal = isNativeApp && phase !== 'idle' && !dismissed;

  return (
    <>
      {!isNativeApp && (
        <WebUpdateDetector onUpdateAvailable={handleWebUpdateAvailable} />
      )}

      {children}

      <AnimatePresence>
        {/* Web: small non-blocking countdown toast — auto-reloads, no user action needed */}
        {showWebToast && (
          <WebUpdateToast
            key="web-update-toast"
            countdown={webCountdown}
            onNow={applyWebUpdate}
          />
        )}

        {/* Native: full-screen modal with download progress */}
        {showNativeModal && manifest && (
          <UpdateScreen
            key="native-update-screen"
            manifest={manifest}
            phase={phase}
            progress={progress}
            onUpdate={handleNativeUpdate}
            onLater={!manifest.mandatory ? handleLater : undefined}
            errorMsg={errorMsg}
          />
        )}
      </AnimatePresence>
    </>
  );
}
