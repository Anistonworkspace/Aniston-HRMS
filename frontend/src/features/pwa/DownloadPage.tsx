/**
 * DownloadPage — /download
 *
 * Native app download page shown in onboarding emails and WhatsApp messages.
 * Replaces the old PWA install instructions with direct native-app download.
 *
 * Two buttons:
 *   • Android  → direct APK download (https://hr.anistonav.com/downloads/aniston-hrms.apk)
 *   • iOS      → App Store link      (update APP_STORE_URL after publishing)
 *
 * Auto-detects the visitor's OS and highlights the matching button.
 */
import { motion } from 'framer-motion';
import { Smartphone, Shield, MapPin, Bell, ExternalLink, ChevronRight } from 'lucide-react';

// Guide pages — users land here from email/WhatsApp and get step-by-step instructions
const ANDROID_GUIDE_URL = '/download/android';
const IOS_GUIDE_URL = '/download/ios';

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const isAndroid = /Android/i.test(ua);
const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;

function AndroidIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.523 15.341a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1Zm-11.046 0a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1ZM6.5 10h11v5.5A1.5 1.5 0 0 1 16 17H8a1.5 1.5 0 0 1-1.5-1.5V10ZM14.7 4.2 15.9 2 14.5 1.3l-1.2 2.3a6.1 6.1 0 0 0-2.6 0L9.5 1.3 8.1 2l1.2 2.2A5.5 5.5 0 0 0 6.5 9H17.5a5.5 5.5 0 0 0-2.8-4.8Z" />
    </svg>
  );
}

function AppleIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

interface DownloadButtonProps {
  href: string;
  icon: React.ReactNode;
  platform: string;
  subtitle: string;
  highlighted: boolean;
  download?: boolean;
}

function DownloadButton({ href, icon, platform, subtitle, highlighted, download }: DownloadButtonProps) {
  return (
    <motion.a
      href={href}
      {...(download ? { download: '' } : { target: '_blank', rel: 'noopener noreferrer' })}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      className={`flex items-center gap-4 w-full px-5 py-4 rounded-2xl border-2 transition-all
        ${highlighted
          ? 'text-white shadow-lg'
          : 'bg-white border-gray-200 text-gray-800 hover:border-gray-300 hover:shadow-md'
        }`}
      style={highlighted ? { background: 'var(--primary-color)', borderColor: 'var(--primary-color)' } : undefined}
    >
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0
        ${highlighted ? 'bg-white/20' : 'bg-gray-50'}`}>
        <span className={highlighted ? 'text-white' : 'text-gray-700'}>
          {icon}
        </span>
      </div>
      <div className="text-left flex-1">
        <p className={`font-display font-bold text-base leading-tight ${highlighted ? 'text-white' : 'text-gray-900'}`}>
          {platform}
        </p>
        <p className={`text-xs mt-0.5 ${highlighted ? 'text-white/80' : 'text-gray-500'}`}>
          {subtitle}
        </p>
      </div>
      <ChevronRight size={18} className={highlighted ? 'text-white/70' : 'text-gray-400'} />
    </motion.a>
  );
}

export default function DownloadPage() {
  // Detect if running as already-installed native app
  const isStandalone = typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches;
  const isCapacitorNative = !!(window as any).Capacitor?.isNativePlatform?.();

  if (isCapacitorNative || isStandalone) {
    // Already installed — redirect to login
    window.location.replace('/login');
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex flex-col overflow-y-auto">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10">

        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 mb-10"
        >
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: 'var(--primary-color)' }}>
            <span className="text-white font-bold text-2xl font-display">A</span>
          </div>
          <div>
            <h1 className="text-xl font-display font-bold text-gray-900">Aniston HRMS</h1>
            <p className="text-xs text-gray-500">Employee Self-Service App</p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.08 }}
          className="w-full max-w-sm"
        >
          {/* Card */}
          <div className="bg-white/85 backdrop-blur-xl rounded-3xl shadow-xl border border-white/50 p-7">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ background: 'var(--primary-highlighted-color)' }}>
              <Smartphone size={32} style={{ color: 'var(--primary-color)' }} />
            </div>

            <h2 className="text-2xl font-display font-bold text-gray-900 text-center mb-1">
              Download the App
            </h2>
            <p className="text-gray-500 text-sm text-center mb-7">
              Get the full Aniston HRMS experience — attendance, leaves, payslips, and more.
            </p>

            {/* OS label */}
            {(isAndroid || isIOS) && (
              <p className="text-xs font-semibold text-center mb-3 uppercase tracking-wide" style={{ color: 'var(--primary-color)' }}>
                {isAndroid ? 'Android detected — recommended:' : 'iPhone / iPad detected — recommended:'}
              </p>
            )}

            {/* Download buttons */}
            <div className="space-y-3">
              <DownloadButton
                href={ANDROID_GUIDE_URL}
                icon={<AndroidIcon size={26} />}
                platform="Install on Android"
                subtitle="Step-by-step guide · Android 7+"
                highlighted={isAndroid || (!isIOS)}
              />
              <DownloadButton
                href={IOS_GUIDE_URL}
                icon={<AppleIcon size={26} />}
                platform="Install on iPhone / iPad"
                subtitle="Add to Home Screen guide · iOS 15+"
                highlighted={isIOS}
              />
            </div>

            <div className="mt-5 pt-5 border-t border-gray-100 text-center">
              <a
                href="/login"
                className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                <ExternalLink size={13} />
                Continue in browser instead
              </a>
            </div>
          </div>

          {/* Permissions card */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="mt-4 bg-white/65 backdrop-blur-lg rounded-2xl border border-white/50 p-5"
          >
            <h3 className="text-sm font-display font-bold text-gray-800 mb-3 text-center">
              After installing, allow these permissions:
            </h3>
            <div className="space-y-2.5">
              <div className="flex items-start gap-3 bg-white/80 rounded-xl p-3.5 border border-gray-100">
                <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <MapPin size={18} className="text-blue-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-800">Location</p>
                  <p className="text-xs text-gray-500">GPS attendance check-in &amp; geofencing</p>
                </div>
                <span className="text-xs font-semibold text-red-500 bg-red-50 px-2 py-0.5 rounded-lg flex-shrink-0 self-center">Required</span>
              </div>
              <div className="flex items-start gap-3 bg-white/80 rounded-xl p-3.5 border border-gray-100">
                <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                  <Bell size={18} className="text-amber-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-800">Notifications</p>
                  <p className="text-xs text-gray-500">Leave approvals, announcements &amp; reminders</p>
                </div>
                <span className="text-xs font-semibold text-red-500 bg-red-50 px-2 py-0.5 rounded-lg flex-shrink-0 self-center">Required</span>
              </div>
              <div className="flex items-start gap-3 bg-white/80 rounded-xl p-3.5 border border-gray-100">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                  <Shield size={18} className="text-emerald-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-800">Auto-updates</p>
                  <p className="text-xs text-gray-500">App updates automatically when a new version is released</p>
                </div>
                <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg flex-shrink-0 self-center">Built-in</span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>

      <footer className="text-center text-xs text-gray-400 py-4">
        Aniston Technologies LLP
      </footer>
    </div>
  );
}
