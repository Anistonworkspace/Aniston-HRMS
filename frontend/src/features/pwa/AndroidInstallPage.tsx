/**
 * AndroidInstallPage — /download/android
 *
 * Two install methods for Android:
 *   1. Install as PWA (Chrome "Add to Home Screen") — one tap, recommended
 *   2. Download APK — fallback if PWA prompt not available
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download, Settings, ToggleRight, CheckCircle2, ChevronRight,
  Smartphone, AlertTriangle, ArrowLeft, Star, Plus, RefreshCw,
} from 'lucide-react';

const APK_URL = 'https://hr.anistonav.com/downloads/aniston-hrms.apk';

// ── Step card ─────────────────────────────────────────────────────────────────
interface StepProps {
  number: number;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  highlight?: boolean;
  screen?: React.ReactNode;
}

function Step({ number, title, subtitle, icon, highlight, screen }: StepProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: number * 0.06 }}
      className={`rounded-2xl border p-5 ${highlight ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-100'}`}
    >
      <div className="flex items-start gap-4">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm ${highlight ? 'bg-amber-500 text-white' : 'bg-brand-600 text-white'}`}>
          {number}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-gray-900 text-base leading-tight">{title}</p>
          <p className="text-sm text-gray-500 mt-1 leading-relaxed">{subtitle}</p>
        </div>
        <div className={`flex-shrink-0 ${highlight ? 'text-amber-500' : 'text-brand-500'}`}>{icon}</div>
      </div>
      {screen && <div className="mt-4">{screen}</div>}
    </motion.div>
  );
}

// ── Mockups ───────────────────────────────────────────────────────────────────

function DownloadNotifMockup() {
  return (
    <div className="bg-gray-900 rounded-xl p-3 max-w-xs mx-auto">
      <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2">
        <div className="w-6 h-6 rounded bg-green-500 flex items-center justify-center flex-shrink-0">
          <Download size={12} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-xs font-semibold truncate">aniston-hrms.apk</p>
          <p className="text-gray-400 text-xs">Download complete · Tap to open</p>
        </div>
      </div>
      <p className="text-gray-500 text-xs text-center mt-2">↑ Tap this notification</p>
    </div>
  );
}

function UnknownSourceMockup() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden max-w-xs mx-auto shadow-sm">
      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
        <p className="text-sm font-bold text-gray-900">Install unknown app?</p>
      </div>
      <div className="px-4 py-3">
        <p className="text-xs text-gray-600 leading-relaxed mb-3">
          Your phone is not allowed to install unknown apps from this source. You can change this in Settings.
        </p>
        <div className="flex gap-2 justify-end">
          <div className="px-3 py-1.5 rounded-lg border border-gray-200">
            <span className="text-xs text-gray-500">Cancel</span>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-brand-600">
            <span className="text-xs text-white font-semibold">Settings →</span>
          </div>
        </div>
      </div>
      <p className="text-gray-400 text-xs text-center pb-2">↑ Tap "Settings"</p>
    </div>
  );
}

function AllowSourceMockup() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden max-w-xs mx-auto shadow-sm">
      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center gap-2">
        <ArrowLeft size={14} className="text-gray-500" />
        <p className="text-sm font-bold text-gray-900">Install unknown apps</p>
      </div>
      <div className="px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Allow from this source</p>
            <p className="text-xs text-gray-500">Chrome / Files / My Files</p>
          </div>
          <div className="w-11 h-6 bg-brand-600 rounded-full flex items-center justify-end px-0.5">
            <div className="w-5 h-5 bg-white rounded-full shadow" />
          </div>
        </div>
      </div>
      <p className="text-gray-400 text-xs text-center pb-2">↑ Toggle ON, then press Back</p>
    </div>
  );
}

function ChromeMenuMockup() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden max-w-xs mx-auto shadow-sm">
      <div className="bg-gray-50 px-3 py-2 flex items-center gap-2 border-b border-gray-100">
        <div className="flex-1 bg-white rounded-lg px-3 py-1.5 text-xs text-gray-600 border border-gray-200">
          hr.anistonav.com
        </div>
        <motion.div
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          className="w-7 h-7 flex items-center justify-center"
        >
          <span className="text-blue-600 font-bold text-base leading-none">⋮</span>
        </motion.div>
      </div>
      <div className="py-1">
        {['New tab', 'New incognito tab', 'Bookmarks', 'History'].map(item => (
          <div key={item} className="px-4 py-2 text-xs text-gray-500">{item}</div>
        ))}
        <motion.div
          animate={{ backgroundColor: ['#EFF6FF', '#DBEAFE', '#EFF6FF'] }}
          transition={{ repeat: Infinity, duration: 1.4 }}
          className="flex items-center gap-3 px-4 py-2"
        >
          <Plus size={14} className="text-blue-600" />
          <span className="text-xs font-semibold text-blue-700">Add to Home screen</span>
        </motion.div>
      </div>
      <p className="text-gray-400 text-xs text-center py-1.5">↑ Tap ⋮ → "Add to Home screen"</p>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AndroidInstallPage() {
  const [pwaPrompt, setPwaPrompt] = useState<any>(null);
  const [pwaInstalled, setPwaInstalled] = useState(false);
  const [activeTab, setActiveTab] = useState<'pwa' | 'apk'>('pwa');
  const promptRef = useRef<any>(null);

  // Capture the beforeinstallprompt event (Chrome fires this when PWA is installable)
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      promptRef.current = e;
      setPwaPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // Detect if already installed as PWA
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setPwaInstalled(true);
    }
    window.addEventListener('appinstalled', () => setPwaInstalled(true));

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handlePwaInstall = async () => {
    const prompt = promptRef.current;
    if (!prompt) return;
    prompt.prompt();
    const result = await prompt.userChoice;
    if (result.outcome === 'accepted') {
      setPwaInstalled(true);
    }
  };

  if (pwaInstalled) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50 flex items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 max-w-sm w-full text-center">
          <CheckCircle2 size={48} className="text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-display font-bold text-gray-900 mb-2">App Installed!</h2>
          <p className="text-sm text-gray-500 mb-6">Aniston HRMS is on your home screen. Tap the icon to open it.</p>
          <a href="/login"
            className="block w-full bg-brand-600 text-white py-3.5 rounded-2xl font-semibold text-sm">
            Open App
          </a>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50">
      <div className="max-w-md mx-auto px-4 py-8 pb-16">

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-brand-600 to-brand-700 rounded-2xl flex items-center justify-center shadow-lg shadow-brand-200 mx-auto mb-4">
            <span className="text-white font-bold text-2xl font-display">A</span>
          </div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Install on Android</h1>
          <p className="text-gray-500 text-sm mt-1">Aniston HRMS · Choose your install method</p>
        </motion.div>

        {/* Tab selector */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
          className="bg-gray-100 rounded-2xl p-1 flex mb-6">
          <button
            onClick={() => setActiveTab('pwa')}
            className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all ${activeTab === 'pwa'
              ? 'bg-white shadow text-brand-600'
              : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Star size={14} className="inline mr-1.5 mb-0.5" />
            Install App (Recommended)
          </button>
          <button
            onClick={() => setActiveTab('apk')}
            className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all ${activeTab === 'apk'
              ? 'bg-white shadow text-green-600'
              : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Download size={14} className="inline mr-1.5 mb-0.5" />
            Download APK
          </button>
        </motion.div>

        <AnimatePresence mode="wait">

          {/* ── PWA Tab ─────────────────────────────────────────────────────── */}
          {activeTab === 'pwa' && (
            <motion.div key="pwa" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}>

              <div className="bg-brand-50 border border-brand-200 rounded-2xl p-4 mb-5 flex gap-3">
                <Star size={18} className="text-brand-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-brand-800">Recommended — No APK needed</p>
                  <p className="text-xs text-brand-700 mt-0.5 leading-relaxed">
                    Install directly from Chrome. No Play Store, no APK download.
                    Updates automatically with every new version.
                  </p>
                </div>
              </div>

              {pwaPrompt ? (
                /* Chrome has the install prompt ready — one tap install */
                <>
                  <motion.button
                    onClick={handlePwaInstall}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    className="flex items-center justify-center gap-3 w-full bg-brand-600 hover:bg-brand-700 text-white py-4 rounded-2xl font-display font-bold text-lg shadow-lg shadow-brand-200 transition-colors mb-6"
                  >
                    <Plus size={22} />
                    Install App — One Tap
                  </motion.button>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center mb-6">
                    <CheckCircle2 size={20} className="text-emerald-500 mx-auto mb-1" />
                    <p className="text-xs font-semibold text-emerald-800">Chrome is ready to install</p>
                    <p className="text-xs text-emerald-700 mt-0.5">Tap the button above — Chrome will ask you to confirm</p>
                  </div>
                </>
              ) : (
                /* Chrome prompt not captured yet — show manual Chrome menu steps */
                <>
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-5 flex gap-3">
                    <AlertTriangle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-amber-800">Open this page in Chrome</p>
                      <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
                        The install button works in Chrome browser. If you're in another browser, open Chrome and visit{' '}
                        <strong>hr.anistonav.com/download/android</strong>
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-1">
                      In Chrome, follow these steps:
                    </p>
                    <Step number={1} title='Tap the ⋮ menu (top right of Chrome)'
                      subtitle='Three dots in the top-right corner of Chrome browser.'
                      icon={<Smartphone size={20} />}
                      screen={<ChromeMenuMockup />} />
                    <Step number={2} title='"Add to Home screen"'
                      subtitle='Scroll down in the menu and tap "Add to Home screen".'
                      icon={<Plus size={20} />} highlight />
                    <Step number={3} title='Tap "Add" to confirm'
                      subtitle='A dialog appears — tap Add. The Aniston HRMS icon appears on your home screen.'
                      icon={<CheckCircle2 size={20} />} />
                    <Step number={4} title='Open from home screen and sign in'
                      subtitle='Tap the Aniston HRMS icon. Sign in with your email and password.'
                      icon={<ChevronRight size={20} />} />
                  </div>
                </>
              )}

              <div className="mt-5 pt-4 border-t border-gray-100 text-center">
                <button onClick={() => setActiveTab('apk')}
                  className="text-sm text-gray-400 hover:text-green-600 transition-colors">
                  APK not working? Switch to APK download →
                </button>
              </div>
            </motion.div>
          )}

          {/* ── APK Tab ─────────────────────────────────────────────────────── */}
          {activeTab === 'apk' && (
            <motion.div key="apk" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}>

              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-5 flex gap-3">
                <AlertTriangle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">Not on Play Store yet</p>
                  <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
                    You need to allow installation from outside the Play Store.
                    One-time step — takes 30 seconds.
                  </p>
                </div>
              </div>

              <motion.a
                href={APK_URL}
                download="aniston-hrms.apk"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                className="flex items-center justify-center gap-3 w-full bg-green-600 hover:bg-green-700 text-white py-4 rounded-2xl font-display font-bold text-lg shadow-lg shadow-green-200 transition-colors mb-6"
              >
                <Download size={22} />
                Download APK (~15 MB)
              </motion.a>

              <div className="space-y-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-1 mb-2">
                  After tapping Download, follow these steps:
                </p>
                <Step number={1} title="Wait for download to complete"
                  subtitle='Your browser downloads the APK (~15 MB). Tap the notification when done.'
                  icon={<Download size={20} />}
                  screen={<DownloadNotifMockup />} />
                <Step number={2} title='Tap "Settings" on the warning'
                  subtitle='Android shows "Install unknown app?" — tap Settings.'
                  icon={<Settings size={20} />} highlight
                  screen={<UnknownSourceMockup />} />
                <Step number={3} title='Turn ON "Allow from this source"'
                  subtitle='Toggle ON, then press Back to return to the install screen.'
                  icon={<ToggleRight size={20} />} highlight
                  screen={<AllowSourceMockup />} />
                <Step number={4} title='Tap "Install"'
                  subtitle='The app installs in seconds. You only do this once.'
                  icon={<CheckCircle2 size={20} />} />
                <Step number={5} title='Open and sign in'
                  subtitle='Find Aniston HRMS on your home screen and sign in.'
                  icon={<ChevronRight size={20} />} />
              </div>

              <div className="mt-5 pt-4 border-t border-gray-100 text-center">
                <button onClick={() => setActiveTab('pwa')}
                  className="text-sm text-gray-400 hover:text-brand-600 transition-colors flex items-center gap-1 mx-auto">
                  <RefreshCw size={13} />
                  Try PWA install instead (no APK needed)
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <p className="text-center text-xs text-gray-400 mt-8">
          Having trouble? Contact HR at{' '}
          <a href="mailto:hr@anistonav.com" className="text-brand-600 underline">hr@anistonav.com</a>
        </p>
      </div>
    </div>
  );
}
