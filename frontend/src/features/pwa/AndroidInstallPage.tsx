/**
 * AndroidInstallPage — /download/android
 * Install as PWA (Chrome "Add to Home Screen") — recommended.
 * Native app available on Google Play Store.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings, CheckCircle2, ChevronRight,
  Smartphone, AlertTriangle, Plus, RefreshCw, Star,
} from 'lucide-react';

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
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm ${highlight ? 'bg-amber-500 text-white' : ''}`}
          style={!highlight ? { background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' } : undefined}>
          {number}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-gray-900 text-base leading-tight">{title}</p>
          <p className="text-sm text-gray-500 mt-1 leading-relaxed">{subtitle}</p>
        </div>
        <div className={`flex-shrink-0 ${highlight ? 'text-amber-500' : ''}`}
          style={!highlight ? { color: 'var(--primary-color)' } : undefined}>{icon}</div>
      </div>
      {screen && <div className="mt-4">{screen}</div>}
    </motion.div>
  );
}

// ── Chrome menu mockup ────────────────────────────────────────────────────────
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
  const promptRef = useRef<any>(null);

  useEffect(() => {
    const earlyPrompt = (window as any).__pwaInstallPrompt;
    if (earlyPrompt) {
      promptRef.current = earlyPrompt;
      setPwaPrompt(earlyPrompt);
    }

    const onPromptReady = () => {
      const p = (window as any).__pwaInstallPrompt;
      if (p && !promptRef.current) {
        promptRef.current = p;
        setPwaPrompt(p);
      }
    };
    window.addEventListener('pwa-prompt-ready', onPromptReady);

    const handler = (e: Event) => {
      e.preventDefault();
      promptRef.current = e;
      setPwaPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);

    if (window.matchMedia('(display-mode: standalone)').matches) {
      setPwaInstalled(true);
    }
    window.addEventListener('appinstalled', () => setPwaInstalled(true));

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('pwa-prompt-ready', onPromptReady);
    };
  }, []);

  const handlePwaInstall = async () => {
    const prompt = promptRef.current;
    if (!prompt) return;
    prompt.prompt();
    const result = await prompt.userChoice;
    if (result.outcome === 'accepted') setPwaInstalled(true);
  };

  if (pwaInstalled) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50 flex items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 max-w-sm w-full text-center">
          <CheckCircle2 size={48} className="text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-display font-bold text-gray-900 mb-2">App Installed!</h2>
          <p className="text-sm text-gray-500 mb-6">Aniston HRMS is on your home screen. Tap the icon to open it.</p>
          <a href="/login" className="block w-full py-3.5 rounded-2xl font-semibold text-sm" style={{ background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' }}>
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
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg mx-auto mb-4" style={{ background: 'var(--primary-color)' }}>
            <span className="text-white font-bold text-2xl font-display">A</span>
          </div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Install on Android</h1>
          <p className="text-gray-500 text-sm mt-1">Aniston HRMS · Install as app on your device</p>
        </motion.div>

        {/* Play Store badge */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}
          className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-5 flex gap-3 items-center">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center flex-shrink-0">
            <Star size={18} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-emerald-800">Available on Google Play Store</p>
            <p className="text-xs text-emerald-700 mt-0.5">Download from Play Store for the best experience with full background GPS support.</p>
          </div>
        </motion.div>

        <AnimatePresence mode="wait">
          <motion.div key="pwa" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}>

            <div className="rounded-2xl p-4 mb-5 flex gap-3 border" style={{ background: 'var(--primary-highlighted-color)', borderColor: 'var(--ui-border-color)' }}>
              <Star size={18} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--primary-color)' }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--primary-color)' }}>Also installable as PWA — No Play Store needed</p>
                <p className="text-xs mt-0.5 leading-relaxed text-gray-600">
                  Install directly from Chrome. Updates automatically with every new version.
                </p>
              </div>
            </div>

            {pwaPrompt ? (
              <>
                <motion.button
                  onClick={handlePwaInstall}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  className="flex items-center justify-center gap-3 w-full py-4 rounded-2xl font-display font-bold text-lg shadow-lg transition-colors mb-6"
                  style={{ background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' }}
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

            <div className="mt-6 bg-gray-50 border border-gray-200 rounded-2xl p-4 flex gap-3">
              <Settings size={16} className="text-gray-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-gray-600">After installing</p>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">Allow Location and Notification permissions when prompted — required for attendance and GPS tracking.</p>
              </div>
            </div>

            <div className="mt-5 pt-4 border-t border-gray-100 text-center">
              <a href="/download/ios" className="text-sm text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1 mx-auto justify-center">
                <RefreshCw size={13} />
                On iPhone / iPad instead? →
              </a>
            </div>
          </motion.div>
        </AnimatePresence>

        <p className="text-center text-xs text-gray-400 mt-8">
          Having trouble? Contact HR at{' '}
          <a href="mailto:hr@anistonav.com" className="underline" style={{ color: 'var(--primary-color)' }}>hr@anistonav.com</a>
        </p>
      </div>
    </div>
  );
}
