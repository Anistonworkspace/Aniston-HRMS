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
  ChevronRight,
  Settings,
} from 'lucide-react';
import {
  checkAllPermissions,
  requestNotificationPermission,
  openGpsSettings,
  openAppSettings,
  type PermissionStatus,
} from '../lib/capacitorPermissions';

// Only show on Android native — skip entirely on web / iOS
const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

// Session-level flag — guard shown once per app session (not once ever)
let shownThisSession = false;

type Step = 'location' | 'bgLocation' | 'notifications' | 'battery' | 'gps';

const STEPS: Step[] = ['location', 'bgLocation', 'notifications', 'battery', 'gps'];

interface StepMeta {
  icon: React.ReactNode;
  title: string;
  description: string;
  permKey: keyof PermissionStatus;
  actionLabel: string;
  grantedLabel: string;
  openSettings: boolean; // true → open Settings; false → in-plugin request
  skipIfGranted: boolean;
}

const STEP_META: Record<Step, StepMeta> = {
  location: {
    icon: <MapPin className="w-10 h-10 text-indigo-400" />,
    title: 'Location Access',
    description:
      'Aniston HRMS needs your location to record GPS check-ins and field sales visits.',
    permKey: 'location',
    actionLabel: 'Grant Location',
    grantedLabel: 'Location granted',
    openSettings: true,
    skipIfGranted: true,
  },
  bgLocation: {
    icon: <Navigation className="w-10 h-10 text-blue-400" />,
    title: 'Background Location',
    description:
      'Allow location access "All the time" so GPS trail continues when the app is in the background.',
    permKey: 'backgroundLocation',
    actionLabel: 'Open Settings',
    grantedLabel: 'Background location granted',
    openSettings: true,
    skipIfGranted: true,
  },
  notifications: {
    icon: <Bell className="w-10 h-10 text-yellow-400" />,
    title: 'Notifications',
    description:
      'Stay informed about leave approvals, payslips, and shift reminders via push notifications.',
    permKey: 'notifications',
    actionLabel: 'Allow Notifications',
    grantedLabel: 'Notifications enabled',
    openSettings: false,
    skipIfGranted: true,
  },
  battery: {
    icon: <Battery className="w-10 h-10 text-green-400" />,
    title: 'Battery Optimization',
    description:
      'Disable battery optimization for Aniston HRMS so GPS tracking is not paused by the system.',
    permKey: 'batteryOptimization',
    actionLabel: 'Open Settings',
    grantedLabel: 'Battery optimization disabled',
    openSettings: true,
    skipIfGranted: true,
  },
  gps: {
    icon: <Navigation className="w-10 h-10 text-emerald-400" />,
    title: 'Turn On GPS',
    description:
      'Your device GPS is currently off. Please enable it so the app can record your location.',
    permKey: 'gpsEnabled',
    actionLabel: 'Open GPS Settings',
    grantedLabel: 'GPS is on',
    openSettings: true,
    skipIfGranted: true,
  },
};

export default function StartupPermissionGuard({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [perms, setPerms] = useState<PermissionStatus | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Compute which steps are actually needed
  const neededSteps = perms
    ? STEPS.filter((s) => !perms[STEP_META[s].permKey])
    : STEPS;

  const currentStep: Step | undefined = neededSteps[stepIdx];
  const meta = currentStep ? STEP_META[currentStep] : null;
  const isLast = stepIdx >= neededSteps.length - 1;

  useEffect(() => {
    if (!isAndroid || shownThisSession) return;
    shownThisSession = true;

    checkAllPermissions().then((status) => {
      setPerms(status);
      const missing = STEPS.filter((s) => !status[STEP_META[s].permKey]);
      if (missing.length > 0) setVisible(true);
    });

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Poll for permission changes while the guard is shown
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

  // Auto-advance when current step becomes granted
  useEffect(() => {
    if (!perms || !currentStep) return;
    if (perms[STEP_META[currentStep].permKey]) {
      advanceOrClose();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perms, currentStep]);

  function advanceOrClose() {
    setWaiting(false);
    if (isLast) {
      setVisible(false);
    } else {
      setStepIdx((i) => i + 1);
    }
  }

  async function handleAction() {
    if (!meta || !currentStep) return;
    setWaiting(true);
    if (currentStep === 'notifications' && !meta.openSettings) {
      await requestNotificationPermission();
      // Re-check after short delay — system dialog is async
      setTimeout(async () => {
        const updated = await checkAllPermissions();
        setPerms(updated);
        setWaiting(false);
      }, 1200);
    } else if (currentStep === 'gps') {
      await openGpsSettings();
      setWaiting(false);
    } else {
      await openAppSettings();
      setWaiting(false);
    }
  }

  function handleSkip() {
    advanceOrClose();
  }

  if (!visible || !currentStep || !meta) return <>{children}</>;

  const granted = perms ? perms[meta.permKey] : false;
  const progress = neededSteps.length > 0 ? ((stepIdx) / neededSteps.length) * 100 : 100;

  return (
    <>
      {children}
      <AnimatePresence>
        <motion.div
          key="perm-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/70 backdrop-blur-sm"
        >
          <motion.div
            key={currentStep}
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 280 }}
            className="w-full max-w-lg bg-gray-900 rounded-t-3xl px-6 pb-10 pt-8 shadow-2xl border border-white/10"
          >
            {/* Progress bar */}
            <div className="h-1 w-full bg-white/10 rounded-full mb-6">
              <div
                className="h-1 bg-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Step counter */}
            <p className="text-xs text-gray-500 mb-4 font-mono">
              {stepIdx + 1} / {neededSteps.length}
            </p>

            {/* Icon */}
            <div className="flex justify-center mb-5">
              <div className="p-4 bg-white/5 rounded-2xl">{meta.icon}</div>
            </div>

            {/* Title + description */}
            <h2 className="text-white text-xl font-semibold text-center mb-2">{meta.title}</h2>
            <p className="text-gray-400 text-sm text-center mb-8 leading-relaxed">
              {meta.description}
            </p>

            {/* Status badge */}
            {granted ? (
              <div className="flex items-center justify-center gap-2 text-green-400 text-sm mb-6">
                <CheckCircle2 className="w-4 h-4" />
                <span>{meta.grantedLabel}</span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 text-red-400 text-sm mb-6">
                <XCircle className="w-4 h-4" />
                <span>Not granted yet</span>
              </div>
            )}

            {/* Action button */}
            {!granted && (
              <button
                onClick={handleAction}
                disabled={waiting}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-medium py-3.5 rounded-xl transition-colors mb-3"
              >
                {meta.openSettings ? <Settings className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                {waiting ? 'Opening…' : meta.actionLabel}
              </button>
            )}

            {/* Next / Done button */}
            {(granted || !waiting) && (
              <button
                onClick={granted ? advanceOrClose : handleSkip}
                className="w-full flex items-center justify-center gap-1 text-gray-400 hover:text-gray-200 text-sm py-2 transition-colors"
              >
                {granted ? (isLast ? 'Done' : 'Continue') : 'Skip for now'}
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </>
  );
}
