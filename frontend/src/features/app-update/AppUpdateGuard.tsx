/**
 * AppUpdateGuard — Automatic update detection for all platforms.
 *
 * ── Web (Desktop browser + PWA installed) ────────────────────────────────────
 * The service worker calls self.skipWaiting() immediately on install, so it
 * activates and takes control of all open tabs right away. This fires a
 * `controllerchange` event in every open tab. AppUpdateGuard listens for it
 * and shows a sticky "New version ready — Reload Now" banner at the top.
 * No manual service worker unregistering needed. No DevTools. Ever.
 *
 * Flow:
 *   1. Deploy pushed → new sw.js on server
 *   2. Browser polls every 30 s (or on tab focus) → fetches new sw.js → installs
 *   3. New SW calls skipWaiting() → activates → claims all tabs
 *   4. `controllerchange` fires in every open tab
 *   5. Banner appears: "New version ready — Reload Now"
 *   6. User clicks → page reloads with new JS/CSS
 *
 * ── Android / iOS (Capacitor native app) ─────────────────────────────────────
 * Checks /api/app-updates/latest on every launch. Shows full-screen modal
 * with download progress when a newer OTA bundle is available.
 */
import { useEffect, useRef, useState, ReactNode } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
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
  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch { /* ignore */ }
  }
  try { sessionStorage.clear(); } catch { /* ignore */ }
}

// ─── Web Update Banner ────────────────────────────────────────────────────────
// Sticky non-blocking banner — stays until user clicks "Reload Now"

interface WebUpdateBannerProps {
  onReload: () => void;
}

function WebUpdateBanner({ onReload }: WebUpdateBannerProps) {
  const prefersReducedMotion = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: prefersReducedMotion ? 0 : -64 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: prefersReducedMotion ? 0 : -64 }}
      transition={prefersReducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 28 }}
      className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between gap-3 bg-indigo-600 text-white px-5 py-3 shadow-lg"
    >
      <div className="flex items-center gap-2.5 text-sm font-medium">
        <motion.div
          animate={prefersReducedMotion ? {} : { rotate: 360 }}
          transition={prefersReducedMotion ? { duration: 0 } : { repeat: Infinity, duration: 2, ease: 'linear' }}
        >
          <RefreshCcw size={15} />
        </motion.div>
        <span>A new version of Aniston HRMS is ready.</span>
      </div>
      <button
        onClick={onReload}
        className="flex-shrink-0 bg-white text-indigo-600 text-sm font-semibold px-4 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors"
      >
        Reload Now
      </button>
    </motion.div>
  );
}

// ─── SW polling (keeps registration alive + polls for updates) ────────────────

function SWPoller() {
  useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Poll every 30 s while the app is open
      setInterval(() => registration.update(), 30_000);
      // Also check when user switches back to this tab
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update();
      });
    },
  });
  return null;
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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6" style={{ background: 'var(--primary-highlighted-color)' }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-sm"
      >
        <div className="flex justify-center mb-8">
          <div className="w-24 h-24 rounded-3xl flex items-center justify-center shadow-xl" style={{ background: 'var(--primary-color)' }}>
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
              <p className="text-sm text-gray-500 mb-6">{errorMsg || 'Could not apply the update. Please try again.'}</p>
              <button onClick={onUpdate} className="w-full py-3.5 rounded-2xl font-semibold transition-colors mb-3" style={{ background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' }}>
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
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full mb-5" style={{ background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' }}>
                <Smartphone size={12} />
                Update Available
                {manifest.version && manifest.version !== 'builtin' && manifest.version !== 'New' && (
                  <span>— v{manifest.version}</span>
                )}
              </div>

              <h2 className="text-2xl font-display font-bold text-gray-900 mb-2">New Version Ready</h2>
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
                      className="h-full rounded-full" style={{ background: 'var(--primary-color)' }}
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
                className="w-full disabled:opacity-70 py-4 rounded-2xl font-semibold text-base flex items-center justify-center gap-2.5 shadow-lg transition-colors mb-3" style={{ background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' }}
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
                <button onClick={onLater} disabled={isBusy} className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 disabled:opacity-40 transition-colors">
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

// ─── Main guard ───────────────────────────────────────────────────────────────

export default function AppUpdateGuard({ children }: { children: ReactNode }) {
  const [showWebBanner, setShowWebBanner] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [manifest, setManifest] = useState<UpdateManifest | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const hasReloaded = useRef(false);

  const [isNativeApp] = useState(() => isNative());

  // ── Web: listen for controllerchange → new SW took control → show banner ──
  useEffect(() => {
    if (isNativeApp || !('serviceWorker' in navigator)) return;

    const handleControllerChange = () => {
      // Guard: don't show banner if this is the very first SW install
      // (controller goes from null → new SW = first visit, not an update)
      // We detect updates by checking if there was already a controller before.
      if (!hasReloaded.current) {
        setShowWebBanner(true);
      }
    };

    // Track whether a controller was already present at mount
    // If controller is null at mount, this is a fresh install — not an update
    const hadControllerAtMount = !!navigator.serviceWorker.controller;
    hasReloaded.current = !hadControllerAtMount; // suppress banner on fresh install

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
  }, [isNativeApp]);

  const handleWebReload = async () => {
    await clearAllCaches();
    window.location.reload();
  };

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

  return (
    <>
      {/* Keep SW registration alive + poll for updates every 30s */}
      {!isNativeApp && <SWPoller />}

      {children}

      <AnimatePresence>
        {/* Web: sticky top banner — appears when new SW takes control */}
        {showWebBanner && (
          <WebUpdateBanner key="web-banner" onReload={handleWebReload} />
        )}

        {/* Native: full-screen modal with download progress */}
        {isNativeApp && phase !== 'idle' && !dismissed && manifest && (
          <UpdateScreen
            key="native-update-screen"
            manifest={manifest}
            phase={phase}
            progress={progress}
            onUpdate={handleNativeUpdate}
            onLater={!manifest.mandatory ? () => setDismissed(true) : undefined}
            errorMsg={errorMsg}
          />
        )}
      </AnimatePresence>
    </>
  );
}
