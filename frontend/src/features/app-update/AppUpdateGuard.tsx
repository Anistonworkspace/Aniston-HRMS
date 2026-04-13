/**
 * AppUpdateGuard — Mandatory update gate for ALL platforms.
 *
 * ── Web (Desktop browser + PWA installed) ────────────────────────────────────
 * Listens for a waiting Service Worker via vite-plugin-pwa's useRegisterSW.
 * When a new SW is available (= new build deployed):
 *   1. Shows a full-screen mandatory "Update Ready" modal.
 *   2. User must click "Update Now" — no "Later" button on web.
 *   3. On confirm:
 *        a. Sends CLEAR_CACHES to SW  → all runtime caches (api-cache,
 *           static-assets, google-fonts, images) are deleted so stale
 *           API responses and old JS/CSS are gone.
 *        b. Clears sessionStorage (ephemeral page state).
 *        c. Calls updateServiceWorker(true) → sends SKIP_WAITING to the
 *           waiting SW → new SW activates → page reloads with fresh assets.
 *   Auth tokens in localStorage are deliberately preserved (kept in auth keys).
 *   Backend Redis: PM2 restart on every deploy + short TTLs handle staleness
 *   server-side; no client-initiated Redis flush needed.
 *
 * ── Android / iOS (Capacitor native app) ─────────────────────────────────────
 * Checks /api/app-updates/latest on every app launch via @capgo/capacitor-updater.
 * When a newer OTA bundle exists:
 *   1. Shows the same full-screen modal (mandatory by default).
 *   2. User must click "Update Now".
 *   3. On confirm:
 *        a. Downloads the bundle ZIP with progress bar.
 *        b. Clears browser caches (same CLEAR_CACHES logic).
 *        c. Applies bundle → Capacitor reloads the webview.
 *
 * Deploy a new build → push to main → CI creates bundle-X.Y.Z.zip,
 * updates manifest.json with mandatory:true → all platforms prompt on next open.
 */
import { useEffect, useRef, useState, ReactNode } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, RefreshCw, Smartphone, CheckCircle2, AlertCircle } from 'lucide-react';

interface UpdateManifest {
  version: string;
  url: string;
  mandatory: boolean;
  notes?: string;
}

type Phase = 'idle' | 'update-available' | 'downloading' | 'installing' | 'error';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** true only when running inside a real Capacitor Android/iOS shell */
function isNative(): boolean {
  try {
    return !!(window as any).Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

async function getUpdater() {
  // Indirect dynamic import so Vite never analyses the specifier at build time.
  // Package only present in native builds; guarded by isNative() before call.
  // eslint-disable-next-line no-new-func
  const { CapacitorUpdater } = await (new Function('m', 'return import(m)'))('@capgo/capacitor-updater');
  return CapacitorUpdater;
}

/**
 * Clears ALL browser-side caches so users see fresh data after an update:
 *   • All SW runtime caches (api-cache, static-assets, google-fonts, images)
 *   • sessionStorage (ephemeral tab state)
 *
 * Deliberately preserved (NOT cleared):
 *   • localStorage — contains auth tokens, user prefs, dismissed-state flags
 *   • Backend Redis — PM2 restart + short TTLs handle server-side staleness
 */
async function clearAllCaches(): Promise<void> {
  // 1. Tell the active SW to delete all its runtime caches
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    try {
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHES' });
    } catch { /* ignore — new SW will have empty caches anyway */ }
  }

  // 2. Also clear from the window side (covers cases where SW isn't controlling yet)
  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch { /* ignore */ }
  }

  // 3. Clear ephemeral tab state
  try { sessionStorage.clear(); } catch { /* ignore */ }
}

// ─── Update screen UI ─────────────────────────────────────────────────────────

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
        {/* Logo */}
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
              {/* Version badge */}
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

              {/* Download progress bar (native only — web skips straight to installing) */}
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
/**
 * Separate inner component so useRegisterSW (a React hook) is always called
 * unconditionally. Only rendered when NOT running inside a Capacitor native shell.
 */
interface WebUpdateDetectorProps {
  onUpdateAvailable: (triggerUpdate: () => void) => void;
}

function WebUpdateDetector({ onUpdateAvailable }: WebUpdateDetectorProps) {
  const { updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      // Check for new SW every 60 seconds while the app is open
      if (registration) {
        setInterval(() => registration.update(), 60_000);
      }
    },
    onNeedRefresh() {
      // A new SW has been downloaded and is waiting to activate.
      // Notify AppUpdateGuard to show the mandatory blocking modal.
      onUpdateAvailable(() => updateServiceWorker(true));
    },
    onOfflineReady() {
      // SW is ready for offline use — no UI needed, just log
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

  // Stable reference — set once on mount, never changes
  const [isNativeApp] = useState(() => isNative());

  // Stores the callback that activates the waiting SW (web platform only)
  const webTriggerRef = useRef<(() => void) | null>(null);

  // ── Native (Capacitor) OTA update check ───────────────────────────────────
  useEffect(() => {
    if (!isNativeApp) return;

    (async () => {
      try {
        const updater = await getUpdater();

        // Tell Capacitor the current bundle is healthy (prevents auto-rollback)
        await updater.notifyAppReady();

        // 'builtin' = fresh APK install — web assets already match the build.
        // Skip check to avoid a false update prompt right after first install.
        const { bundle } = await updater.current();
        const currentVersion: string = bundle?.version ?? 'builtin';
        if (currentVersion === 'builtin') return;

        // Fetch the latest OTA manifest
        const res = await fetch('https://hr.anistonav.com/api/app-updates/latest', {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const json = await res.json();

        // url: null means no bundle deployed yet — skip silently
        if (!json.success || !json.data?.version || !json.data?.url) return;

        const latest: UpdateManifest = json.data;
        if (latest.version !== currentVersion) {
          setManifest(latest);
          setPhase('update-available');
        }
      } catch (err) {
        // Non-fatal — if the check fails, let the app run normally
        console.warn('[AppUpdateGuard] native update check error:', err);
      }
    })();
  }, [isNativeApp]);

  // ── Web: called by WebUpdateDetector when a new SW is waiting ─────────────
  const handleWebUpdateAvailable = async (triggerFn: () => void) => {
    webTriggerRef.current = triggerFn;

    // Fetch version + notes from the server manifest for display in the modal
    let version = 'New';
    let notes = 'A new version of Aniston HRMS is ready with the latest features and improvements.';
    try {
      const res = await fetch('/api/app-updates/latest', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (json.data?.version && json.data.version !== 'builtin') {
          version = json.data.version;
        }
        if (json.data?.notes) notes = json.data.notes;
      }
    } catch { /* use fallback text */ }

    setManifest({ version, url: '', mandatory: true, notes });
    setPhase('update-available');
  };

  // ── Update action (shared by web and native) ──────────────────────────────
  const handleUpdate = async () => {
    if (!manifest) return;

    if (!isNativeApp) {
      // ── Web update ────────────────────────────────────────────────────────
      // Step 1: show "Installing" immediately so user sees feedback
      setPhase('installing');

      // Step 2: clear all browser-side caches (SW caches + sessionStorage)
      //         so the user sees fresh API data and new JS/CSS after reload
      await clearAllCaches();

      // Step 3: activate the waiting SW → it takes control → page reloads
      if (webTriggerRef.current) {
        webTriggerRef.current(); // updateServiceWorker(true) → SKIP_WAITING + reload
      } else {
        // Fallback: tell SW directly then reload
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg?.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
        }
        // Listen for SW controller change then reload
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          window.location.reload();
        }, { once: true });
      }
      return;
    }

    // ── Native (Capacitor) update ─────────────────────────────────────────
    setPhase('downloading');
    setProgress(0);
    setErrorMsg('');

    try {
      const updater = await getUpdater();

      // Stream download progress
      const listener = await updater.addListener('download', (info: { percent: number }) => {
        setProgress(Math.round(info.percent));
      });

      // Download the OTA bundle ZIP
      const bundle = await updater.download({
        url: manifest.url,
        version: manifest.version,
      });

      listener.remove();
      setPhase('installing');

      // Clear all browser-side caches before applying new bundle
      await clearAllCaches();

      // Apply bundle — Capacitor reloads the webview
      await updater.set(bundle);

      // Explicit reload as fallback for some Capacitor versions
      await new Promise((r) => setTimeout(r, 400));
      window.location.reload();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Download failed. Please try again.');
      setPhase('error');
    }
  };

  const handleLater = () => setDismissed(true);

  // Show the update screen if an update is available and not dismissed.
  // Web updates are always mandatory (manifest.mandatory = true) so onLater
  // is never passed → "Later" button never renders for web users.
  // Native: respects the mandatory flag from the server manifest.
  const showUpdate = phase !== 'idle' && !dismissed;

  return (
    <>
      {/* Web SW update detector — not rendered inside Capacitor native shell */}
      {!isNativeApp && (
        <WebUpdateDetector onUpdateAvailable={handleWebUpdateAvailable} />
      )}

      {children}

      <AnimatePresence>
        {showUpdate && manifest && (
          <UpdateScreen
            key="update-screen"
            manifest={manifest}
            phase={phase}
            progress={progress}
            onUpdate={handleUpdate}
            onLater={(!manifest.mandatory && isNativeApp) ? handleLater : undefined}
            errorMsg={errorMsg}
          />
        )}
      </AnimatePresence>
    </>
  );
}
