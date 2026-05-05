import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { AnimatePresence, motion } from 'framer-motion';
import {
  MapPin,
  Bell,
  Battery,
  Navigation,
  CheckCircle2,
  XCircle,
  Settings,
  Smartphone,
} from 'lucide-react';
import {
  checkAllPermissions,
  requestNotificationPermission,
  openGpsSettings,
  openAppSettings,
  type PermissionStatus,
} from '../lib/capacitorPermissions';

const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

// Shown once per app session (resets on full restart, not on background/resume)
let shownThisSession = false;

type Step = 'location' | 'bgLocation' | 'notifications' | 'battery' | 'autostart' | 'gps';

const STEPS: Step[] = ['location', 'bgLocation', 'notifications', 'battery', 'autostart', 'gps'];

interface StepMeta {
  icon: React.ReactNode;
  title: string;
  description: string;
  instructions: string[];       // numbered steps to show inside the card
  permKey: keyof PermissionStatus | 'autostart'; // 'autostart' is manual-confirm only
  actionLabel: string;
  grantedLabel: string;
  openSettings: boolean;
  manualConfirm: boolean;       // no API check — user taps "I've done this" to advance
}

const STEP_META: Record<Step, StepMeta> = {
  location: {
    icon: <MapPin className="w-10 h-10 text-indigo-400" />,
    title: 'Allow Location Access',
    description: 'Required to record GPS check-ins and field sales visits.',
    instructions: [
      'Tap "Open Settings" below',
      'Tap "Location"',
      'Select "Allow all the time"',
    ],
    permKey: 'location',
    actionLabel: 'Open Settings',
    grantedLabel: 'Location access granted',
    openSettings: true,
    manualConfirm: false,
  },
  bgLocation: {
    icon: <Navigation className="w-10 h-10 text-blue-400" />,
    title: 'Background Location',
    description: 'GPS trail must continue even when the screen is off or the app is in the background.',
    instructions: [
      'Tap "Open Settings" below',
      'Tap "Location"',
      'Change to "Allow all the time"',
    ],
    permKey: 'backgroundLocation',
    actionLabel: 'Open Settings',
    grantedLabel: 'Background location granted',
    openSettings: true,
    manualConfirm: false,
  },
  notifications: {
    icon: <Bell className="w-10 h-10 text-yellow-400" />,
    title: 'Enable Notifications',
    description: 'The GPS tracking notification keeps the service alive. Blocking it will stop background tracking.',
    instructions: [
      'Tap "Allow Notifications" below',
      'Tap "Allow" on the system dialog',
    ],
    permKey: 'notifications',
    actionLabel: 'Allow Notifications',
    grantedLabel: 'Notifications enabled',
    openSettings: false,
    manualConfirm: false,
  },
  battery: {
    icon: <Battery className="w-10 h-10 text-green-400" />,
    title: 'Disable Battery Restriction',
    description: 'Android restricts background apps to save battery. You must disable this so GPS stays active all day.',
    instructions: [
      'Tap "Open Settings" below',
      'Tap "Battery" or "Power"',
      'Select "No restrictions" or "Unrestricted"',
    ],
    permKey: 'batteryOptimization',
    actionLabel: 'Open Settings',
    grantedLabel: 'Battery unrestricted',
    openSettings: true,
    manualConfirm: false,
  },
  autostart: {
    icon: <Smartphone className="w-10 h-10 text-purple-400" />,
    title: 'Enable Auto-start',
    description: 'On Xiaomi, Samsung, Oppo and OnePlus devices you must enable Auto-start or the app cannot restart GPS after you swipe it away.',
    instructions: [
      'Tap "Open Settings" below',
      'Tap "Other permissions"',
      'Find "Auto-start" and turn it ON',
      'Also enable "Run in background"',
      'Tap "I\'ve enabled it" when done',
    ],
    permKey: 'autostart',       // not a real PermissionStatus key — handled specially
    actionLabel: 'Open Settings',
    grantedLabel: 'Auto-start enabled',
    openSettings: true,
    manualConfirm: true,        // no Android API to check — user confirms manually
  },
  gps: {
    icon: <Navigation className="w-10 h-10 text-emerald-400" />,
    title: 'Turn On GPS',
    description: 'Device GPS is currently off. Enable it so the app can record your location.',
    instructions: [
      'Tap "Open GPS Settings" below',
      'Enable "Location" or "GPS"',
      'Return to the app',
    ],
    permKey: 'gpsEnabled',
    actionLabel: 'Open GPS Settings',
    grantedLabel: 'GPS is on',
    openSettings: true,
    manualConfirm: false,
  },
};

export default function StartupPermissionGuard({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [perms, setPerms] = useState<PermissionStatus | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [autostartConfirmed, setAutostartConfirmed] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Which steps actually need attention on first check
  const neededSteps = perms
    ? STEPS.filter((s) => {
        if (s === 'autostart') return true; // always show — no API to pre-check
        return !perms[STEP_META[s].permKey as keyof PermissionStatus];
      })
    : STEPS;

  const currentStep: Step | undefined = neededSteps[stepIdx];
  const meta = currentStep ? STEP_META[currentStep] : null;
  const isLast = stepIdx >= neededSteps.length - 1;

  useEffect(() => {
    if (!isAndroid || shownThisSession) return;
    shownThisSession = true;

    checkAllPermissions().then((status) => {
      setPerms(status);
      const missing = STEPS.filter((s) => {
        if (s === 'autostart') return true;
        return !status[STEP_META[s].permKey as keyof PermissionStatus];
      });
      if (missing.length > 0) setVisible(true);
    });

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Poll every 1.5s while wizard is visible to detect permission changes
  useEffect(() => {
    if (!visible) return;
    pollRef.current = setInterval(async () => {
      const updated = await checkAllPermissions();
      setPerms(updated);
    }, 1500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [visible]);

  // Auto-advance when the current non-manual step becomes granted
  useEffect(() => {
    if (!perms || !currentStep || meta?.manualConfirm) return;
    const permKey = STEP_META[currentStep].permKey as keyof PermissionStatus;
    if (perms[permKey]) {
      setWaiting(false);
      advance();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perms, currentStep]);

  function advance() {
    if (isLast) {
      setVisible(false);
    } else {
      setAutostartConfirmed(false);
      setStepIdx((i) => i + 1);
    }
  }

  async function handleAction() {
    if (!meta || !currentStep) return;
    setWaiting(true);

    if (currentStep === 'notifications' && !meta.openSettings) {
      await requestNotificationPermission();
      setTimeout(async () => {
        const updated = await checkAllPermissions();
        setPerms(updated);
        setWaiting(false);
      }, 1200);
    } else if (currentStep === 'gps') {
      await openGpsSettings();
      setWaiting(false);
    } else {
      // location, bgLocation, battery, autostart — all open app settings
      await openAppSettings();
      setWaiting(false);
    }
  }

  if (!visible || !currentStep || !meta) return <>{children}</>;

  const isGranted = (() => {
    if (currentStep === 'autostart') return autostartConfirmed;
    if (!perms) return false;
    return perms[meta.permKey as keyof PermissionStatus];
  })();

  const progress = neededSteps.length > 0
    ? (stepIdx / neededSteps.length) * 100
    : 100;

  return (
    <>
      {children}
      <AnimatePresence>
        <motion.div
          key="perm-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/75 backdrop-blur-sm"
        >
          <motion.div
            key={currentStep}
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', damping: 24, stiffness: 300 }}
            className="w-full max-w-lg bg-gray-900 rounded-t-3xl px-6 pb-12 pt-6 shadow-2xl border border-white/10"
          >
            {/* Progress bar */}
            <div className="h-1 w-full bg-white/10 rounded-full mb-5">
              <div
                className="h-1 bg-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Step counter */}
            <p className="text-xs text-gray-500 mb-4 font-mono tracking-wide">
              STEP {stepIdx + 1} OF {neededSteps.length}
            </p>

            {/* Icon */}
            <div className="flex justify-center mb-4">
              <div className="p-4 bg-white/5 rounded-2xl">{meta.icon}</div>
            </div>

            {/* Title */}
            <h2 className="text-white text-xl font-semibold text-center mb-2">
              {meta.title}
            </h2>

            {/* Description */}
            <p className="text-gray-400 text-sm text-center mb-5 leading-relaxed">
              {meta.description}
            </p>

            {/* Step-by-step instructions */}
            <div className="bg-white/5 rounded-xl p-4 mb-5">
              {meta.instructions.map((line, i) => (
                <div key={i} className="flex items-start gap-3 mb-2 last:mb-0">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold mt-0.5">
                    {i + 1}
                  </span>
                  <span className="text-gray-300 text-sm leading-snug">{line}</span>
                </div>
              ))}
            </div>

            {/* Status badge */}
            {isGranted ? (
              <div className="flex items-center justify-center gap-2 text-green-400 text-sm mb-5">
                <CheckCircle2 className="w-4 h-4" />
                <span>{meta.grantedLabel}</span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 text-amber-400 text-sm mb-5">
                <XCircle className="w-4 h-4" />
                <span>Not done yet — this is required</span>
              </div>
            )}

            {/* Primary action button */}
            {!isGranted && (
              <button
                onClick={handleAction}
                disabled={waiting}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold py-4 rounded-xl transition-colors mb-3 text-base"
              >
                <Settings className="w-4 h-4" />
                {waiting ? 'Opening…' : meta.actionLabel}
              </button>
            )}

            {/* Manual confirm for autostart step */}
            {currentStep === 'autostart' && !autostartConfirmed && (
              <button
                onClick={() => setAutostartConfirmed(true)}
                className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white font-medium py-3.5 rounded-xl transition-colors mb-3"
              >
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                I've enabled it
              </button>
            )}

            {/* Continue button — only available once step is granted/confirmed */}
            {isGranted && (
              <button
                onClick={advance}
                className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 text-white font-semibold py-4 rounded-xl transition-colors text-base"
              >
                <CheckCircle2 className="w-4 h-4" />
                {isLast ? 'All done — Continue' : 'Continue'}
              </button>
            )}

            {/* Hard requirement notice — NO skip button */}
            <p className="text-center text-gray-600 text-xs mt-4">
              These permissions are required for GPS tracking to work in the background.
            </p>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </>
  );
}
