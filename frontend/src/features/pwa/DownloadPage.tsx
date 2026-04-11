import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Smartphone, Shield, MapPin, Bell, ChevronRight, ExternalLink, RefreshCw, X, Monitor, Apple, MoreVertical } from 'lucide-react';

// ---------------------------------------------------------------------------
// Read the install prompt captured in main.tsx (runs before this lazy chunk).
// ---------------------------------------------------------------------------
const getPrompt = () => (window as any).__pwaInstallPrompt ?? null;
const clearPrompt = () => { (window as any).__pwaInstallPrompt = null; };

// Device detection helpers
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const isIOS = /iPad|iPhone|iPod/.test(ua);
const isAndroid = /Android/.test(ua);
const isEdge = ua.includes('Edg/');
const isMobile = isIOS || isAndroid;

// ---------------------------------------------------------------------------
// Instructions modal — device-specific steps
// ---------------------------------------------------------------------------
function InstallInstructionsModal({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-display font-bold text-gray-900">How to Install</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-xl transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* ── Android Chrome ── */}
        {isAndroid && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Smartphone size={16} className="text-gray-600" />
              <span className="font-semibold text-gray-700 text-sm">Android — Chrome / Samsung Browser</span>
            </div>

            {/* Visual: browser menu */}
            <div className="bg-gray-900 rounded-2xl p-3 flex items-center justify-between">
              <span className="text-gray-300 text-xs">hr.anistonav.com</span>
              <motion.div
                animate={{ scale: [1, 1.3, 1] }}
                transition={{ repeat: Infinity, duration: 1.4 }}
                className="flex flex-col gap-[3px] px-1"
              >
                <div className="w-1 h-1 bg-white rounded-full" />
                <div className="w-1 h-1 bg-white rounded-full" />
                <div className="w-1 h-1 bg-white rounded-full" />
              </motion.div>
            </div>
            <p className="text-xs text-center text-gray-500 -mt-2">↑ Tap the 3-dot menu in your browser</p>

            {[
              { step: '1', icon: <MoreVertical size={14} />, text: 'Tap the ⋮ menu', detail: 'Top-right corner of Chrome' },
              { step: '2', icon: <Download size={14} />, text: 'Tap "Install app" or "Add to Home screen"', detail: 'Scroll down in the menu if needed' },
              { step: '3', icon: <ChevronRight size={14} />, text: 'Tap "Install" in the popup', detail: 'The Aniston HRMS icon will appear on your home screen' },
              { step: '4', icon: <Smartphone size={14} />, text: 'Open from your home screen', detail: 'Tap the Aniston HRMS icon to launch' },
            ].map(({ step, icon, text, detail }) => (
              <div key={step} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{step}</div>
                <div>
                  <p className="text-sm font-semibold text-gray-800 flex items-center gap-1">{icon}{text}</p>
                  <p className="text-xs text-gray-500">{detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── iOS Safari ── */}
        {isIOS && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Apple size={16} className="text-gray-600" />
              <span className="font-semibold text-gray-700 text-sm">iPhone / iPad — Safari</span>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700">
              Must use <strong>Safari</strong> — Chrome on iOS cannot install PWAs.
            </div>
            {[
              { step: '1', text: 'Tap the Share button ⬆', detail: 'At the bottom of Safari' },
              { step: '2', text: 'Tap "Add to Home Screen"', detail: 'Scroll down in the share sheet' },
              { step: '3', text: 'Tap "Add" top-right', detail: 'The app icon appears on your home screen' },
              { step: '4', text: 'Open from Home Screen', detail: 'Tap the Aniston HRMS icon' },
            ].map(({ step, text, detail }) => (
              <div key={step} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{step}</div>
                <div>
                  <p className="text-sm font-semibold text-gray-800">{text}</p>
                  <p className="text-xs text-gray-500">{detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Desktop Chrome / Edge ── */}
        {!isMobile && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Monitor size={16} className="text-gray-600" />
              <span className="font-semibold text-gray-700 text-sm">{isEdge ? 'Microsoft Edge' : 'Google Chrome'} — Desktop</span>
            </div>

            <div className="bg-gray-900 rounded-xl p-3">
              <div className="bg-gray-700 rounded-lg px-3 py-2 flex items-center gap-2">
                <div className="flex-1 bg-gray-600 rounded text-gray-300 text-xs px-2 py-1 truncate">
                  hr.anistonav.com/download
                </div>
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                  className="w-6 h-6 rounded bg-brand-500 flex items-center justify-center flex-shrink-0"
                >
                  <Download size={13} className="text-white" />
                </motion.div>
              </div>
              <p className="text-gray-400 text-xs text-center mt-2">↑ Install icon in the address bar</p>
            </div>

            {[
              { step: '1', text: 'Click the install icon ⊕', detail: 'Right side of the address bar' },
              { step: '2', text: 'Click "Install"', detail: 'In the popup that appears' },
              { step: '3', text: 'App opens in its own window', detail: 'Find it in your taskbar / applications' },
            ].map(({ step, text, detail }) => (
              <div key={step} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{step}</div>
                <div>
                  <p className="text-sm font-semibold text-gray-800">{text}</p>
                  <p className="text-xs text-gray-500">{detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 space-y-2">
          <button
            onClick={() => window.location.reload()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw size={14} /> Reload &amp; try again
          </button>
          <a
            href="/login"
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm text-gray-400 hover:text-brand-600 transition-colors"
          >
            <ExternalLink size={13} /> Skip — continue in browser
          </a>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main DownloadPage
// ---------------------------------------------------------------------------
export default function DownloadPage() {
  const navigate = useNavigate();
  const [deferredPrompt, setDeferredPrompt] = useState<any>(getPrompt());
  const [installed, setInstalled] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [checking, setChecking] = useState(!getPrompt()); // skip wait if already captured
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

  useEffect(() => {
    if (isStandalone) navigate('/login', { replace: true });
  }, [isStandalone, navigate]);

  useEffect(() => {
    const onReady = () => {
      setDeferredPrompt(getPrompt());
      setChecking(false);
    };
    window.addEventListener('pwa-prompt-ready', onReady);
    window.addEventListener('appinstalled', () => setInstalled(true));

    if (getPrompt()) {
      setDeferredPrompt(getPrompt());
      setChecking(false);
    } else {
      const t = setTimeout(() => setChecking(false), 1500);
      return () => {
        clearTimeout(t);
        window.removeEventListener('pwa-prompt-ready', onReady);
      };
    }
    return () => window.removeEventListener('pwa-prompt-ready', onReady);
  }, []);

  // Auto-trigger when prompt captured
  useEffect(() => {
    if (deferredPrompt) {
      const t = setTimeout(() => triggerInstall(), 800);
      return () => clearTimeout(t);
    }
  }, [deferredPrompt]);

  useEffect(() => {
    if (installed) {
      const t = setTimeout(() => navigate('/login', { replace: true }), 1500);
      return () => clearTimeout(t);
    }
  }, [installed, navigate]);

  const triggerInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') setInstalled(true);
      setDeferredPrompt(null);
      clearPrompt();
    }
  };

  const handleInstallClick = () => {
    if (deferredPrompt) {
      triggerInstall();
    } else {
      setShowInstructions(true);
    }
  };

  if (installed) {
    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-br from-emerald-50 via-white to-emerald-50 flex items-center justify-center p-6">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center">
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Shield size={40} className="text-emerald-600" />
          </div>
          <h1 className="text-2xl font-display font-bold text-gray-900 mb-2">App Installed!</h1>
          <p className="text-gray-500 mb-4">Redirecting to login...</p>
          <a href="/login" className="btn-primary inline-flex items-center gap-2">
            Open App <ChevronRight size={16} />
          </a>
        </motion.div>
      </div>
    );
  }

  if (isStandalone) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-gradient-to-br from-brand-50 via-white to-indigo-50 flex flex-col overflow-y-auto">
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-10">
          {/* Logo */}
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 mb-10">
            <div className="w-12 h-12 bg-gradient-to-br from-brand-600 to-brand-700 rounded-2xl flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-xl font-display">A</span>
            </div>
            <div>
              <h1 className="text-xl font-display font-bold text-gray-900">Aniston HRMS</h1>
              <p className="text-xs text-gray-500">Employee Self-Service App</p>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }} className="w-full max-w-md">
            <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl border border-white/50 p-8 text-center">
              <div className="w-20 h-20 bg-brand-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <Smartphone size={40} className="text-brand-600" />
              </div>
              <h2 className="text-2xl font-display font-bold text-gray-900 mb-2">
                Install Aniston HRMS
              </h2>
              <p className="text-gray-500 text-sm mb-8">
                Install the app on your device for the best experience — attendance, leave, payroll, and more.
              </p>

              {/* Install button — always visible */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleInstallClick}
                disabled={checking}
                className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white py-4 rounded-2xl font-semibold text-lg flex items-center justify-center gap-3 shadow-lg shadow-brand-200 transition-colors mb-3"
              >
                {checking ? (
                  <>
                    <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
                      <RefreshCw size={20} />
                    </motion.div>
                    Checking...
                  </>
                ) : deferredPrompt ? (
                  <><Download size={22} /> Install App</>
                ) : (
                  <><Download size={22} /> Install App</>
                )}
              </motion.button>

              <a href="/login" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-brand-600 transition-colors mt-1">
                <ExternalLink size={13} />
                Skip — open in browser instead
              </a>
            </div>

            {/* Permissions */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="mt-6 bg-white/60 backdrop-blur-lg rounded-2xl border border-white/50 p-6">
              <h3 className="text-sm font-display font-bold text-gray-800 mb-4 text-center">
                After installing, open the app and allow:
              </h3>
              <div className="space-y-3">
                <div className="flex items-start gap-3 bg-white/80 rounded-xl p-4 border border-gray-100">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                    <MapPin size={20} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Location Permission</p>
                    <p className="text-xs text-gray-500 mt-0.5">Required for GPS-based attendance check-in and geofencing</p>
                  </div>
                  <span className="ml-auto text-xs font-semibold text-red-500 bg-red-50 px-2 py-1 rounded-lg flex-shrink-0">Required</span>
                </div>
                <div className="flex items-start gap-3 bg-white/80 rounded-xl p-4 border border-gray-100">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                    <Bell size={20} className="text-amber-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Notification Permission</p>
                    <p className="text-xs text-gray-500 mt-0.5">Required for real-time alerts on leave approvals, announcements, and reminders</p>
                  </div>
                  <span className="ml-auto text-xs font-semibold text-red-500 bg-red-50 px-2 py-1 rounded-lg flex-shrink-0">Required</span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </div>

        <footer className="text-center text-xs text-gray-400 py-4">
          Aniston Technologies LLP
        </footer>
      </div>

      <AnimatePresence>
        {showInstructions && <InstallInstructionsModal onClose={() => setShowInstructions(false)} />}
      </AnimatePresence>
    </>
  );
}
