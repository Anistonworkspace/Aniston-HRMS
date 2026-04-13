/**
 * AndroidInstallPage — /download/android
 *
 * Step-by-step guide to download and install the APK on Android.
 * Linked from onboarding email and WhatsApp messages.
 */
import { motion } from 'framer-motion';
import { Download, Settings, ToggleRight, CheckCircle2, ChevronRight, Smartphone, AlertTriangle, ArrowLeft } from 'lucide-react';

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
      transition={{ delay: number * 0.07 }}
      className={`rounded-2xl border p-5 ${highlight
        ? 'bg-amber-50 border-amber-200'
        : 'bg-white border-gray-100'
      }`}
    >
      <div className="flex items-start gap-4">
        {/* Number badge */}
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm ${highlight ? 'bg-amber-500 text-white' : 'bg-brand-600 text-white'}`}>
          {number}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-gray-900 text-base leading-tight">{title}</p>
          <p className="text-sm text-gray-500 mt-1 leading-relaxed">{subtitle}</p>
        </div>
        <div className={`flex-shrink-0 ${highlight ? 'text-amber-500' : 'text-brand-500'}`}>
          {icon}
        </div>
      </div>

      {/* Inline phone screen mockup */}
      {screen && (
        <div className="mt-4 ml-13">
          {screen}
        </div>
      )}
    </motion.div>
  );
}

// ── Phone dialog mockups ──────────────────────────────────────────────────────

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
      {/* Dialog header */}
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
          {/* Toggle ON */}
          <div className="w-11 h-6 bg-brand-600 rounded-full flex items-center justify-end px-0.5">
            <div className="w-5 h-5 bg-white rounded-full shadow" />
          </div>
        </div>
      </div>
      <p className="text-gray-400 text-xs text-center pb-2">↑ Toggle this ON, then press Back</p>
    </div>
  );
}

function InstallConfirmMockup() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden max-w-xs mx-auto shadow-sm">
      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
        <p className="text-sm font-bold text-gray-900">Do you want to install this app?</p>
      </div>
      <div className="px-4 py-3">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center">
            <span className="text-white font-bold text-sm">A</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Aniston HRMS</p>
            <p className="text-xs text-gray-500">Aniston Technologies LLP</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <div className="px-3 py-1.5 rounded-lg border border-gray-200">
            <span className="text-xs text-gray-500">Cancel</span>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-brand-600">
            <span className="text-xs text-white font-semibold">Install</span>
          </div>
        </div>
      </div>
      <p className="text-gray-400 text-xs text-center pb-2">↑ Tap "Install"</p>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AndroidInstallPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50">
      <div className="max-w-md mx-auto px-4 py-8 pb-16">

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-brand-600 to-brand-700 rounded-2xl flex items-center justify-center shadow-lg shadow-brand-200 mx-auto mb-4">
            <span className="text-white font-bold text-2xl font-display">A</span>
          </div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Install on Android</h1>
          <p className="text-gray-500 text-sm mt-1">Aniston HRMS · Step-by-step guide</p>
        </motion.div>

        {/* Notice banner */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 flex gap-3"
        >
          <AlertTriangle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Not on Play Store yet</p>
            <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
              Our app is not on Google Play Store yet. You need to allow installation from outside the Play Store.
              This is a one-time step — takes 30 seconds.
            </p>
          </div>
        </motion.div>

        {/* Download button — big, prominent */}
        <motion.a
          href={APK_URL}
          download
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.15 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          className="flex items-center justify-center gap-3 w-full bg-green-600 hover:bg-green-700 text-white py-4 rounded-2xl font-display font-bold text-lg shadow-lg shadow-green-200 transition-colors mb-8"
        >
          <Download size={22} />
          Download for Android
        </motion.a>

        {/* Steps */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-1 mb-2">
            After tapping Download above, follow these steps:
          </p>

          <Step
            number={1}
            title="Tap the download button above"
            subtitle="Your browser will download the APK file (about 10–20 MB). You'll see a download notification at the top or bottom of your screen."
            icon={<Download size={20} />}
            screen={<DownloadNotifMockup />}
          />

          <Step
            number={2}
            title="Tap the notification or open Downloads"
            subtitle='Tap "Open" on the download notification. Or open your Files / Downloads app and find "aniston-hrms.apk".'
            icon={<Smartphone size={20} />}
          />

          <Step
            number={3}
            title='Tap "Settings" on the warning screen'
            subtitle='Android will ask "Install unknown app?" — this is normal for apps not on Play Store. Tap Settings.'
            icon={<Settings size={20} />}
            highlight
            screen={<UnknownSourceMockup />}
          />

          <Step
            number={4}
            title='Turn ON "Allow from this source"'
            subtitle='Toggle the switch to ON. Then press the back arrow to return to the install screen.'
            icon={<ToggleRight size={20} />}
            highlight
            screen={<AllowSourceMockup />}
          />

          <Step
            number={5}
            title='Tap "Install"'
            subtitle="The app will install in a few seconds. You only need to allow unknown sources once — future updates happen automatically inside the app."
            icon={<CheckCircle2 size={20} />}
            screen={<InstallConfirmMockup />}
          />

          <Step
            number={6}
            title="Open Aniston HRMS and sign in"
            subtitle="Tap Open or find the Aniston HRMS icon on your home screen. Sign in with the email and password you set during onboarding."
            icon={<ChevronRight size={20} />}
          />
        </div>

        {/* Success note */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mt-6 bg-green-50 border border-green-200 rounded-2xl p-4 text-center"
        >
          <CheckCircle2 size={24} className="text-green-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-green-800">You only do this once</p>
          <p className="text-xs text-green-700 mt-1 leading-relaxed">
            Future app updates will install automatically — no need to download anything again.
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
