/**
 * IosInstallPage — /download/ios
 *
 * Step-by-step guide to install Aniston HRMS on iPhone / iPad.
 * Since the app is not yet on the App Store, this guides users to
 * add the web app to their Home Screen via Safari (full-screen web app).
 * Linked from onboarding email and WhatsApp messages.
 */
import { motion } from 'framer-motion';
import { Share2, Plus, Smartphone, CheckCircle2, Clock, AlertTriangle, Star } from 'lucide-react';

// ── Safari / browser detection ────────────────────────────────────────────────
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
const isInAppBrowser = /WhatsApp|Instagram|FBAN|FBAV|Twitter|LinkedInApp|Snapchat|GSA/.test(ua);
const isSafariUA = /Safari/.test(ua) && !/CriOS/.test(ua) && !/FxiOS/.test(ua) && !/OPiOS/.test(ua) && !/Chrome/.test(ua);
// True Safari = iOS + Safari UA + not an in-app browser
const isAlreadyInSafari = isIOS && isSafariUA && !isInAppBrowser;
// Already installed as PWA
const isStandalone = typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true);

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
      transition={{ delay: number * 0.07 }}
      className={`rounded-2xl border p-5 ${highlight
        ? 'bg-blue-50 border-blue-200'
        : 'bg-white border-gray-100'
      }`}
    >
      <div className="flex items-start gap-4">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm ${highlight ? 'bg-blue-600 text-white' : 'bg-gray-900 text-white'}`}>
          {number}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-gray-900 text-base leading-tight">{title}</p>
          <p className="text-sm text-gray-500 mt-1 leading-relaxed">{subtitle}</p>
        </div>
        <div className={`flex-shrink-0 ${highlight ? 'text-blue-500' : 'text-gray-400'}`}>
          {icon}
        </div>
      </div>
      {screen && (
        <div className="mt-4">
          {screen}
        </div>
      )}
    </motion.div>
  );
}

// ── Safari mockups ────────────────────────────────────────────────────────────

function SafariBarMockup() {
  return (
    <div className="bg-gray-100 rounded-xl overflow-hidden max-w-xs mx-auto">
      {/* Safari address bar */}
      <div className="bg-gray-200 px-3 py-2 flex items-center gap-2">
        <div className="flex-1 bg-white rounded-lg px-3 py-1.5 flex items-center gap-1">
          <span className="text-xs text-gray-400">🔒</span>
          <span className="text-xs text-gray-700 font-medium">hr.anistonav.com</span>
        </div>
      </div>
      {/* Bottom toolbar */}
      <div className="bg-gray-200 px-4 py-2 flex items-center justify-around border-t border-gray-300 mt-1">
        <span className="text-gray-400 text-xs">‹</span>
        <span className="text-gray-400 text-xs">›</span>
        <motion.div
          animate={{ scale: [1, 1.25, 1] }}
          transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
          className="flex flex-col items-center"
        >
          <Share2 size={16} className="text-blue-500" />
          <span className="text-blue-500 text-xs font-semibold mt-0.5">Share</span>
        </motion.div>
        <span className="text-gray-400 text-xs">⊞</span>
        <span className="text-gray-400 text-xs">⋯</span>
      </div>
      <p className="text-gray-400 text-xs text-center py-1.5">↑ Tap the Share button (box with arrow)</p>
    </div>
  );
}

// ── Safari address bar ⋯ mockup (alternative method) ─────────────────────────
function SafariDotsMockup() {
  return (
    <div className="bg-gray-100 rounded-xl overflow-hidden max-w-xs mx-auto">
      {/* Safari address bar with highlighted ⋯ */}
      <div className="bg-gray-200 px-3 py-2 flex items-center gap-2">
        <div className="flex-1 bg-white rounded-lg px-3 py-1.5 flex items-center gap-1">
          <span className="text-xs text-gray-400">🔒</span>
          <span className="text-xs text-gray-700 font-medium">hr.anistonav.com</span>
        </div>
        <motion.div
          animate={{ scale: [1, 1.2, 1], backgroundColor: ['#EFF6FF', '#DBEAFE', '#EFF6FF'] }}
          transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
          className="w-8 h-8 rounded-lg flex items-center justify-center"
        >
          <span className="text-blue-600 font-bold text-base leading-none">⋯</span>
        </motion.div>
      </div>
      {/* Dropdown from ⋯ */}
      <div className="bg-white mx-2 mt-1 mb-2 rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {['Reload Page', 'Show Reader View', 'Copy Link'].map(item => (
          <div key={item} className="flex items-center gap-3 px-3 py-2 border-b border-gray-50">
            <div className="w-5 h-5 rounded bg-gray-100" />
            <span className="text-xs text-gray-500">{item}</span>
          </div>
        ))}
        <motion.div
          animate={{ backgroundColor: ['#EFF6FF', '#DBEAFE', '#EFF6FF'] }}
          transition={{ repeat: Infinity, duration: 1.4 }}
          className="flex items-center gap-3 px-3 py-2"
        >
          <div className="w-5 h-5 rounded bg-blue-100 flex items-center justify-center">
            <Plus size={12} className="text-blue-600" />
          </div>
          <span className="text-xs font-semibold text-blue-700">Add to Home Screen</span>
        </motion.div>
      </div>
      <p className="text-gray-400 text-xs text-center py-1.5">↑ Tap ⋯ → "Add to Home Screen"</p>
    </div>
  );
}

function ShareSheetMockup() {
  return (
    <div className="bg-gray-100 rounded-xl overflow-hidden max-w-xs mx-auto">
      <div className="bg-white rounded-t-xl p-3">
        <p className="text-xs font-semibold text-gray-500 text-center mb-3">Share Sheet</p>
        {/* App row */}
        <div className="flex gap-4 justify-center mb-4">
          {['Messages', 'Mail', 'WhatsApp'].map(app => (
            <div key={app} className="flex flex-col items-center gap-1">
              <div className="w-10 h-10 rounded-xl bg-gray-200" />
              <span className="text-xs text-gray-500">{app}</span>
            </div>
          ))}
        </div>
        {/* Action list */}
        <div className="space-y-0.5">
          {['Copy Link', 'Add Bookmark', 'Find on Page'].map(item => (
            <div key={item} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
              <div className="w-7 h-7 rounded-lg bg-gray-200" />
              <span className="text-sm text-gray-700">{item}</span>
            </div>
          ))}
          {/* Highlighted item */}
          <motion.div
            animate={{ backgroundColor: ['#EFF6FF', '#DBEAFE', '#EFF6FF'] }}
            transition={{ repeat: Infinity, duration: 1.4 }}
            className="flex items-center gap-3 rounded-lg px-3 py-2"
          >
            <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center">
              <Plus size={14} className="text-blue-600" />
            </div>
            <span className="text-sm font-semibold text-blue-700">Add to Home Screen</span>
          </motion.div>
        </div>
      </div>
      <p className="text-gray-400 text-xs text-center py-1.5">↑ Scroll down and tap "Add to Home Screen"</p>
    </div>
  );
}

function AddToHomeMockup() {
  return (
    <div className="bg-gray-100 rounded-xl overflow-hidden max-w-xs mx-auto">
      <div className="bg-white p-4">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm text-blue-500">Cancel</span>
          <span className="text-sm font-semibold text-gray-900">Add to Home Screen</span>
          <motion.span
            animate={{ opacity: [0.6, 1, 0.6] }}
            transition={{ repeat: Infinity, duration: 1.2 }}
            className="text-sm font-semibold text-blue-500"
          >
            Add
          </motion.span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-brand-600 flex items-center justify-center shadow-sm">
            <span className="text-white font-bold text-xl font-display">A</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Aniston HRMS</p>
            <p className="text-xs text-gray-400">hr.anistonav.com</p>
          </div>
        </div>
      </div>
      <p className="text-gray-400 text-xs text-center py-1.5">↑ Tap "Add" in the top right</p>
    </div>
  );
}

function HomeScreenMockup() {
  return (
    <div className="bg-gradient-to-br from-blue-400 to-purple-500 rounded-xl p-4 max-w-xs mx-auto">
      <div className="grid grid-cols-4 gap-3">
        {[...Array(7)].map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div className="w-12 h-12 rounded-2xl bg-white/20" />
            <div className="w-8 h-1.5 rounded bg-white/30" />
          </div>
        ))}
        {/* Highlighted app icon */}
        <motion.div
          animate={{ scale: [1, 1.12, 1] }}
          transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
          className="flex flex-col items-center gap-1"
        >
          <div className="w-12 h-12 rounded-2xl bg-brand-600 flex items-center justify-center shadow-lg">
            <span className="text-white font-bold font-display">A</span>
          </div>
          <span className="text-white text-xs text-center leading-none">Aniston HRMS</span>
        </motion.div>
      </div>
      <p className="text-white/70 text-xs text-center mt-3">↑ Tap the Aniston HRMS icon to open</p>
    </div>
  );
}

// ── Safari requirement warning ────────────────────────────────────────────────

function SafariWarning() {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3">
      <AlertTriangle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-amber-800">Must use Safari</p>
        <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
          Chrome, Firefox, and other browsers on iPhone <strong>cannot</strong> add apps to the Home Screen.
          You <strong>must</strong> use Safari for this to work.
        </p>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function IosInstallPage() {
  const webAppUrl = 'https://hr.anistonav.com';

  // Already installed — redirect to app
  if (isStandalone) {
    window.location.replace('/login');
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50">
      <div className="max-w-md mx-auto px-4 py-8 pb-16">

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl flex items-center justify-center shadow-lg mx-auto mb-4">
            <span className="text-white font-bold text-2xl font-display">A</span>
          </div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Install on iPhone / iPad</h1>
          <p className="text-gray-500 text-sm mt-1">Aniston HRMS · Step-by-step guide</p>
        </motion.div>

        {/* Coming soon banner */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-5 flex gap-3"
        >
          <Clock size={18} className="text-blue-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-blue-800">iOS App Store — Coming Soon</p>
            <p className="text-xs text-blue-700 mt-0.5 leading-relaxed">
              Our native iOS app will be available on the App Store soon. For now, you can install the
              full web app on your Home Screen — it works exactly like a native app.
            </p>
          </div>
        </motion.div>

        {isAlreadyInSafari ? (
          /* ── User IS already in Safari — show green banner + skip straight to steps ── */
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
            className="bg-emerald-50 border border-emerald-300 rounded-2xl p-4 mb-6 flex gap-3"
          >
            <Star size={18} className="text-emerald-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-emerald-800">You're already in Safari!</p>
              <p className="text-xs text-emerald-700 mt-0.5 leading-relaxed">
                You can install the app right now. Just follow the steps below — tap the Share button
                or the <strong>⋯</strong> button in the address bar.
              </p>
            </div>
          </motion.div>
        ) : (
          /* ── User is in an in-app browser (WhatsApp/Gmail) — show bridge ── */
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="mb-6">
              <SafariWarning />
            </motion.div>
            <motion.a
              href={webAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              className="flex items-center justify-center gap-3 w-full bg-gray-900 hover:bg-gray-800 text-white py-4 rounded-2xl font-display font-bold text-lg shadow-lg transition-colors mb-8"
            >
              <Smartphone size={22} />
              Open in Safari
            </motion.a>
          </>
        )}

        {/* Steps */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-1 mb-2">
            After opening Safari, follow these steps:
          </p>

          <Step
            number={1}
            title="Open hr.anistonav.com in Safari"
            subtitle='Tap the "Open in Safari" button above, or type hr.anistonav.com in the Safari address bar. Make sure you are using Safari — not Chrome or Firefox.'
            icon={<Smartphone size={20} />}
            highlight
          />

          {/* Two methods side-by-side label */}
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
            <p className="text-xs font-bold text-gray-700 text-center mb-3">Step 2 — Choose either method:</p>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                <Share2 size={18} className="text-blue-500 mx-auto mb-1" />
                <p className="text-xs font-bold text-blue-800">Method A</p>
                <p className="text-xs text-blue-600 mt-0.5">Share button<br/>at the bottom</p>
              </div>
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3">
                <span className="text-indigo-600 font-bold text-lg leading-none block mb-1">⋯</span>
                <p className="text-xs font-bold text-indigo-800">Method B</p>
                <p className="text-xs text-indigo-600 mt-0.5">3-dot button<br/>in address bar</p>
              </div>
            </div>
          </div>

          <Step
            number={2}
            title='Method A — Tap the Share button at the bottom'
            subtitle='At the bottom of Safari, tap the Share button — the box with an arrow pointing upward. Then scroll down and tap "Add to Home Screen".'
            icon={<Share2 size={20} />}
            screen={<SafariBarMockup />}
          />

          <Step
            number={3}
            title='Method B — Tap the ⋯ button in the address bar'
            subtitle='In the Safari address bar, tap the ⋯ (three dots) button on the right side. A menu drops down — tap "Add to Home Screen" from the list.'
            icon={<Plus size={20} />}
            highlight
            screen={<SafariDotsMockup />}
          />

          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-1 pt-2">
            Then continue with:
          </p>

          <Step
            number={4}
            title='"Add to Home Screen" in the share sheet'
            subtitle='If using Method A: a menu slides up from the bottom — scroll down and tap "Add to Home Screen".'
            icon={<Plus size={20} />}
            screen={<ShareSheetMockup />}
          />

          <Step
            number={5}
            title='Tap "Add" in the top right'
            subtitle='A preview screen appears showing the Aniston HRMS icon and name. Tap "Add" in the top-right corner to confirm.'
            icon={<Plus size={20} />}
            screen={<AddToHomeMockup />}
          />

          <Step
            number={6}
            title="Open from your Home Screen"
            subtitle='The Aniston HRMS icon now appears on your Home Screen. Tap it to open the app — it launches full screen, just like a native app.'
            icon={<CheckCircle2 size={20} />}
            screen={<HomeScreenMockup />}
          />

          <Step
            number={7}
            title="Sign in with your work email"
            subtitle="Enter the email and password you set during onboarding. Allow Location and Notification permissions when asked — these are required for attendance and alerts."
            icon={<CheckCircle2 size={20} />}
          />
        </div>

        {/* Success note */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mt-6 bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center"
        >
          <CheckCircle2 size={24} className="text-emerald-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-emerald-800">Works like a native app</p>
          <p className="text-xs text-emerald-700 mt-1 leading-relaxed">
            The Home Screen app opens full screen without the Safari toolbar. It loads the latest
            version automatically every time — no App Store updates needed.
          </p>
        </motion.div>

        {/* Help line */}
        <p className="text-center text-xs text-gray-400 mt-8">
          Having trouble? Contact HR at{' '}
          <a href="mailto:hr@anistonav.com" className="text-brand-600 underline">
            hr@anistonav.com
          </a>
        </p>
      </div>
    </div>
  );
}
