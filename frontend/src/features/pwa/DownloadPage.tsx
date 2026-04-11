import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Smartphone, Shield, MapPin, Bell, ChevronRight, ExternalLink, RefreshCw, X, Monitor, Apple } from 'lucide-react';

// ---------------------------------------------------------------------------
// Capture beforeinstallprompt BEFORE React renders.
// The event fires once — very early in page load. useEffect misses it.
// ---------------------------------------------------------------------------
let _capturedPrompt: any = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _capturedPrompt = e;
    window.dispatchEvent(new Event('pwa-prompt-ready'));
  });
}

// ---------------------------------------------------------------------------
// Visual step-by-step instructions overlay (when native prompt isn't available)
// ---------------------------------------------------------------------------
function InstallInstructionsModal({ onClose }: { onClose: () => void }) {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isEdge = navigator.userAgent.includes('Edg/');

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

        {isIOS ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-3">
              <Apple size={18} className="text-gray-700" />
              <span className="font-semibold text-gray-700 text-sm">Safari on iPhone / iPad</span>
            </div>
            {[
              { step: '1', text: 'Tap the Share button', detail: '⬆ at the bottom of the screen' },
              { step: '2', text: 'Scroll and tap "Add to Home Screen"', detail: 'Look for the + icon' },
              { step: '3', text: 'Tap "Add" in the top right', detail: 'The app icon will appear on your home screen' },
              { step: '4', text: 'Open the app from your Home Screen', detail: 'Tap the Aniston HRMS icon' },
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
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-3">
              <Monitor size={18} className="text-gray-700" />
              <span className="font-semibold text-gray-700 text-sm">{isEdge ? 'Microsoft Edge' : 'Google Chrome'}</span>
            </div>

            {/* Visual callout for address bar */}
            <div className="bg-gray-900 rounded-xl p-3 mb-2">
              <div className="bg-gray-700 rounded-lg px-3 py-2 flex items-center gap-2">
                <div className="flex-1 bg-gray-600 rounded text-gray-300 text-xs px-2 py-1 truncate">
                  https://hr.anistonav.com/download
                </div>
                {/* Fake install icon */}
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                  className="w-6 h-6 rounded bg-brand-500 flex items-center justify-center flex-shrink-0"
                >
                  <Download size={13} className="text-white" />
                </motion.div>
              </div>
              <p className="text-gray-400 text-xs text-center mt-2">↑ Look for this install icon in your address bar</p>
            </div>

            {[
              { step: '1', text: 'Look for the install icon', detail: 'A ⊕ or download icon appears in the right side of the address bar' },
              { step: '2', text: 'Click the install icon', detail: 'A popup will appear asking to install Aniston HRMS' },
              { step: '3', text: 'Click "Install"', detail: 'The app will open in its own window' },
            ].map(({ step, text, detail }) => (
              <div key={step} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{step}</div>
                <div>
                  <p className="text-sm font-semibold text-gray-800">{text}</p>
                  <p className="text-xs text-gray-500">{detail}</p>
                </div>
              </div>
            ))}

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
              <span className="text-amber-600 text-xs">💡</span>
              <p className="text-xs text-amber-700">
                Don't see the icon? Try <button onClick={() => window.location.reload()} className="font-semibold underline">reloading the page</button> or use Chrome / Edge for the best experience.
              </p>
            </div>
          </div>
        )}

        <div className="mt-6 space-y-2">
          <button
            onClick={() => window.location.reload()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw size={14} /> Reload page &amp; try again
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
  const [deferredPrompt, setDeferredPrompt] = useState<any>(_capturedPrompt);
  const [installed, setInstalled] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [checking, setChecking] = useState(true); // brief 1.5s wait for prompt
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

  // Already installed → go to login
  useEffect(() => {
    if (isStandalone) navigate('/login', { replace: true });
  }, [isStandalone, navigate]);

  // Listen for prompt arrival after mount
  useEffect(() => {
    const onReady = () => {
      setDeferredPrompt(_capturedPrompt);
      setChecking(false);
    };
    window.addEventListener('pwa-prompt-ready', onReady);
    window.addEventListener('appinstalled', () => setInstalled(true));

    // If already captured before mount, use it immediately
    if (_capturedPrompt) {
      setDeferredPrompt(_capturedPrompt);
      setChecking(false);
    } else {
      // Wait up to 1.5s for the event, then stop waiting
      const t = setTimeout(() => setChecking(false), 1500);
      return () => {
        clearTimeout(t);
        window.removeEventListener('pwa-prompt-ready', onReady);
      };
    }
    return () => window.removeEventListener('pwa-prompt-ready', onReady);
  }, []);

  // Auto-trigger install prompt when captured
  useEffect(() => {
    if (deferredPrompt) {
      const t = setTimeout(() => triggerInstall(), 800);
      return () => clearTimeout(t);
    }
  }, [deferredPrompt]);

  // Redirect after install
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
      _capturedPrompt = null;
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

              {/* Install Button — always shown */}
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
                ) : (
                  <>
                    <Download size={22} />
                    {deferredPrompt ? 'Install App' : 'How to Install'}
                  </>
                )}
              </motion.button>

              {!checking && !deferredPrompt && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3">
                  Your browser didn't offer automatic install. Tap above for step-by-step instructions.
                </p>
              )}

              {/* Skip link */}
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

      {/* Instructions overlay */}
      <AnimatePresence>
        {showInstructions && <InstallInstructionsModal onClose={() => setShowInstructions(false)} />}
      </AnimatePresence>
    </>
  );
}
