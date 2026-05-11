import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { AnimatePresence, motion } from 'framer-motion';
import {
  MapPin,
  Bell,
  Battery,
  Navigation,
  Settings,
  CheckCircle2,
  XCircle,
  Smartphone,
  AlertTriangle,
} from 'lucide-react';
import {
  checkAllPermissions,
  requestNotificationPermission,
  openGpsSettings,
  openAppSettings,
  getDeviceInfo,
  type PermissionStatus,
} from '../lib/capacitorPermissions';
import { registerPlugin } from '@capacitor/core';

const GpsTracking = registerPlugin<{ recordDiagnostic?: (opts: { key: string; value: string }) => Promise<void> }>('GpsTracking', { web: {} as any });

const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

// Shown once per app session (resets on full restart, not on background/resume)
let shownThisSession = false;

// ── Autostart confirmation persistence ────────────────────────────────────────
// Keyed with _v1 so we can bump the key if we ever need to re-show the wizard.
const AUTOSTART_CONFIRMED_KEY = 'aniston_autostart_confirmed_v1';

function loadConfirmedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(AUTOSTART_CONFIRMED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveConfirmedIds(ids: Set<string>): void {
  try {
    localStorage.setItem(AUTOSTART_CONFIRMED_KEY, JSON.stringify([...ids]));
  } catch { /* storage full — ignore */ }
}

// ── OEM detection ─────────────────────────────────────────────────────────────

type OemCategory =
  | 'xiaomi'
  | 'samsung'
  | 'oppo'
  | 'realme'
  | 'vivo'
  | 'oneplus'
  | 'motorola'
  | 'google'
  | 'stock';

function detectOem(manufacturer: string, brand: string, sdkInt: number): OemCategory {
  const m = manufacturer.toLowerCase();
  const b = brand.toLowerCase();
  const combined = m + ' ' + b;

  if (combined.includes('xiaomi') || combined.includes('redmi') || combined.includes('poco')) return 'xiaomi';
  if (combined.includes('samsung')) return 'samsung';
  if (combined.includes('oppo')) return 'oppo';
  if (combined.includes('realme')) return 'realme';
  if (combined.includes('vivo') || combined.includes('iqoo')) return 'vivo';
  if (combined.includes('oneplus') || combined.includes('one plus')) return 'oneplus';
  if (combined.includes('motorola') || combined.includes('moto')) return 'motorola';
  if (combined.includes('google')) return 'google';
  if (sdkInt >= 1) return 'stock';
  return 'stock';
}

// ── Step definitions ──────────────────────────────────────────────────────────

type ActionType =
  | 'openAppSettings'
  | 'openBatterySettings'
  | 'openGpsSettings'
  | 'requestNotification'
  | 'confirm'
  | 'na';

interface StepDef {
  id: string;
  title: string;
  description: string;
  instructions: string[];
  permKey: keyof PermissionStatus | 'autostart_xiaomi' | 'autostart_samsung' | 'autostart_oppo' | 'autostart_vivo' | 'autostart_oneplus' | 'autostart_stock' | 'autostart_na';
  actionLabel: string;
  actionType: ActionType;
  grantedLabel: string;
  isRequired: boolean;
  canSkipIfNotFound: boolean;
  icon: React.ReactNode;
}

function buildSteps(oem: OemCategory): StepDef[] {
  const steps: StepDef[] = [];

  // ── Step 1: Location ──────────────────────────────────────────────────────
  steps.push({
    id: 'location',
    title: 'Allow Location (All the time)',
    description: "GPS needs 'Allow all the time' access. 'Only while using app' will stop tracking when your screen is off.",
    instructions: [
      'Open Settings below',
      'Tap Location',
      "Select 'Allow all the time'",
    ],
    permKey: 'location',
    actionLabel: 'Open Settings',
    actionType: 'openAppSettings',
    grantedLabel: 'Location access granted',
    isRequired: true,
    canSkipIfNotFound: false,
    icon: <MapPin className="w-10 h-10 text-indigo-400" />,
  });

  // ── Step 2: Background location ───────────────────────────────────────────
  steps.push({
    id: 'bgLocation',
    title: 'Background Location',
    description: "Confirm location is set to 'Allowed all the time' in App Permissions.",
    instructions: [
      'Open Settings below',
      'Tap Location',
      "Confirm 'Allowed all the time'",
    ],
    permKey: 'backgroundLocation',
    actionLabel: 'Open Settings',
    actionType: 'openAppSettings',
    grantedLabel: 'Background location granted',
    isRequired: true,
    canSkipIfNotFound: false,
    icon: <Navigation className="w-10 h-10 text-blue-400" />,
  });

  // ── Step 3: Notifications ─────────────────────────────────────────────────
  steps.push({
    id: 'notifications',
    title: 'Enable Notifications',
    description: 'The persistent GPS notification keeps the tracking service alive. Without it, Android may kill the service.',
    instructions: [
      'Tap Allow Notifications below',
      'Tap Allow on the system dialog',
    ],
    permKey: 'notifications',
    actionLabel: 'Allow Notifications',
    actionType: 'requestNotification',
    grantedLabel: 'Notifications enabled',
    isRequired: true,
    canSkipIfNotFound: false,
    icon: <Bell className="w-10 h-10 text-yellow-400" />,
  });

  // ── Step 4: Battery ───────────────────────────────────────────────────────
  let batteryDesc: string;
  let batteryInstructions: string[];

  if (oem === 'samsung') {
    batteryDesc = "Set battery to 'Unrestricted' and remove Aniston HRMS from Sleeping Apps so Android does not pause GPS in the background.";
    batteryInstructions = [
      'Open Settings below',
      'Tap Battery',
      "Select 'Unrestricted'",
      "Also go to: Settings → Battery → Background usage limits → remove Aniston HRMS from Sleeping apps",
    ];
  } else if (oem === 'xiaomi') {
    batteryDesc = "Set battery to 'No restrictions'. Without this, MIUI/HyperOS will kill GPS when the screen turns off.";
    batteryInstructions = [
      'Open Settings below (takes you to App Info)',
      "Tap 'Battery saver' or 'Battery'",
      "Select 'No restrictions'",
      'Also: Open Security app → Battery → find Aniston HRMS → No restrictions',
    ];
  } else {
    batteryDesc = "Set battery to 'No restrictions' or 'Unrestricted' so Android does not pause GPS in the background.";
    batteryInstructions = [
      'Open Settings below',
      'Tap Battery or Power',
      "Select 'No restrictions' or 'Unrestricted'",
    ];
  }

  steps.push({
    id: 'battery',
    title: 'Remove Battery Restriction',
    description: batteryDesc,
    instructions: batteryInstructions,
    permKey: 'batteryOptimization',
    actionLabel: 'Open Settings',
    actionType: 'openAppSettings',
    grantedLabel: 'Battery unrestricted',
    isRequired: true,
    canSkipIfNotFound: false,
    icon: <Battery className="w-10 h-10 text-green-400" />,
  });

  // ── Step 5: Autostart (OEM-conditional) ───────────────────────────────────
  if (oem === 'google' || oem === 'motorola') {
    // No autostart step needed — stock Android / Motorola handle background properly
  } else if (oem === 'xiaomi') {
    steps.push({
      id: 'autostart',
      title: 'Enable Autostart (Required on Xiaomi/POCO)',
      description:
        'MIUI and HyperOS kill background services when you swipe the app away unless Autostart is enabled. ' +
        'Without this, GPS stops the moment you leave the app.',
      instructions: [
        'Path 1 — Security app: Open the pre-installed Security (or Phone Manager) app → Autostart → find Aniston HRMS → enable toggle',
        'Path 2 — Settings: Settings → Apps → Manage apps → Aniston HRMS → Other permissions → Autostart → ON',
        'Path 3 — HyperOS (newer phones): Settings → Apps → Manage apps → Aniston HRMS → Battery saver → No restrictions',
        'Path 4 — HyperOS App Info: Long-press the Aniston HRMS app icon → App Info → Battery → No restrictions',
        'Lock the app: Open Recent Apps → long-press the Aniston HRMS card → tap the Lock icon (🔒)',
        "Tap 'I've enabled it' below when done",
      ],
      permKey: 'autostart_xiaomi',
      actionLabel: 'Open App Settings',
      actionType: 'confirm',
      grantedLabel: 'Autostart enabled',
      isRequired: true,
      canSkipIfNotFound: true,
      icon: <Smartphone className="w-10 h-10 text-purple-400" />,
    });
  } else if (oem === 'samsung') {
    steps.push({
      id: 'autostart',
      title: 'Background Activity (Samsung)',
      description: 'Samsung may put the GPS service to sleep. Remove it from the Sleeping apps list to ensure continuous tracking.',
      instructions: [
        'Open Settings below',
        'Go to Battery → Background usage limits',
        "Remove Aniston HRMS from 'Sleeping apps'",
        "If you see 'Allow background activity', enable it",
        "Tap 'Done' when finished",
      ],
      permKey: 'autostart_samsung',
      actionLabel: 'Open Settings',
      actionType: 'confirm',
      grantedLabel: 'Background activity allowed',
      isRequired: false,
      canSkipIfNotFound: true,
      icon: <Smartphone className="w-10 h-10 text-purple-400" />,
    });
  } else if (oem === 'oppo' || oem === 'realme') {
    steps.push({
      id: 'autostart',
      title: 'Auto Launch (ColorOS)',
      description: 'ColorOS restricts apps from launching automatically. Enable Auto Launch for Aniston HRMS to keep GPS running.',
      instructions: [
        'Open Settings below',
        'Go to Privacy/Security → Auto Launch',
        'Find Aniston HRMS and enable it',
        'Also check: Permission Management → Background App Freeze → disable for Aniston HRMS',
      ],
      permKey: 'autostart_oppo',
      actionLabel: 'Open Settings',
      actionType: 'confirm',
      grantedLabel: 'Auto launch enabled',
      isRequired: false,
      canSkipIfNotFound: true,
      icon: <Smartphone className="w-10 h-10 text-purple-400" />,
    });
  } else if (oem === 'vivo') {
    steps.push({
      id: 'autostart',
      title: 'Autostart (Vivo/iQOO)',
      description: "Vivo's FunTouch OS restricts background apps. Enable Autostart Management to keep GPS running.",
      instructions: [
        'Open Settings below',
        'Go to Apps → Autostart Management',
        'Enable Aniston HRMS',
        'Also: Settings → Battery → High background power → add app',
      ],
      permKey: 'autostart_vivo',
      actionLabel: 'Open Settings',
      actionType: 'confirm',
      grantedLabel: 'Autostart enabled',
      isRequired: false,
      canSkipIfNotFound: true,
      icon: <Smartphone className="w-10 h-10 text-purple-400" />,
    });
  } else if (oem === 'oneplus') {
    steps.push({
      id: 'autostart',
      title: 'Background Activity (OnePlus)',
      description: "OnePlus OxygenOS may restrict background apps. Set Battery Optimization to 'Don't optimize' for Aniston HRMS.",
      instructions: [
        'Open Settings below',
        'Go to Battery → Battery Optimization',
        "Find Aniston HRMS → select 'Don't optimize'",
        'Also check App Launch settings if present',
      ],
      permKey: 'autostart_oneplus',
      actionLabel: 'Open Settings',
      actionType: 'confirm',
      grantedLabel: 'Background activity allowed',
      isRequired: false,
      canSkipIfNotFound: true,
      icon: <Smartphone className="w-10 h-10 text-purple-400" />,
    });
  } else {
    // stock or unknown
    steps.push({
      id: 'autostart',
      title: 'Background Permission Check',
      description: 'Verify battery settings are unrestricted. No Auto-start setting is typically needed on this device.',
      instructions: [
        'Open App Settings below',
        "Check Battery → set to Unrestricted if not already done",
        'No Auto-start setting is typically needed on this device',
      ],
      permKey: 'autostart_stock',
      actionLabel: 'Open Settings',
      actionType: 'confirm',
      grantedLabel: 'Permissions verified',
      isRequired: false,
      canSkipIfNotFound: true,
      icon: <Smartphone className="w-10 h-10 text-purple-400" />,
    });
  }

  // ── Step 6: GPS on/off ────────────────────────────────────────────────────
  steps.push({
    id: 'gps',
    title: 'Turn On GPS',
    description: 'Device GPS is off. Enable it so location can be recorded.',
    instructions: [
      'Tap Open GPS Settings below',
      "Enable 'Location' or 'GPS'",
      'Return to the app',
    ],
    permKey: 'gpsEnabled',
    actionLabel: 'Open GPS Settings',
    actionType: 'openGpsSettings',
    grantedLabel: 'GPS is on',
    isRequired: true,
    canSkipIfNotFound: false,
    icon: <Navigation className="w-10 h-10 text-emerald-400" />,
  });

  return steps;
}

// ── Is this step "granted" based on current perms? ────────────────────────────
function isStepGranted(step: StepDef, perms: PermissionStatus | null, confirmedIds: Set<string>): boolean {
  const confirmKeys = ['autostart_xiaomi', 'autostart_samsung', 'autostart_oppo', 'autostart_vivo', 'autostart_oneplus', 'autostart_stock', 'autostart_na'];
  if (confirmKeys.includes(step.permKey)) {
    return confirmedIds.has(step.id);
  }
  if (!perms) return false;
  return !!perms[step.permKey as keyof PermissionStatus];
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function StartupPermissionGuard({ children }: { children: React.ReactNode }) {
  const [visible, setVisible]           = useState(false);
  const [perms, setPerms]               = useState<PermissionStatus | null>(null);
  const [steps, setSteps]               = useState<StepDef[]>([]);
  const [stepIdx, setStepIdx]           = useState(0);
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(() => loadConfirmedIds());
  const [cantFind, setCantFind]         = useState(false);
  const [waiting, setWaiting]           = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Build steps after detecting device OEM
  useEffect(() => {
    if (!isAndroid || shownThisSession) return;
    shownThisSession = true;

    const init = async () => {
      const [deviceInfo, status] = await Promise.all([
        getDeviceInfo(),
        checkAllPermissions(),
      ]);

      const oem = detectOem(deviceInfo.manufacturer, deviceInfo.brand, deviceInfo.sdkInt);
      const allSteps = buildSteps(oem);

      // Only show steps that are not already satisfied (load persisted confirmations)
      const persisted = loadConfirmedIds();
      const needed = allSteps.filter((s) => !isStepGranted(s, status, persisted));

      setPerms(status);
      setSteps(needed);
      if (needed.length > 0) setVisible(true);
    };

    init().catch(() => {});

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Poll every 1.5s while wizard is open
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

  const currentStep = steps[stepIdx] as StepDef | undefined;
  const isLast = stepIdx >= steps.length - 1;

  const granted = currentStep ? isStepGranted(currentStep, perms, confirmedIds) : false;

  // Auto-advance when a non-confirm step becomes granted
  useEffect(() => {
    if (!currentStep) return;
    const confirmKeys = ['autostart_xiaomi', 'autostart_samsung', 'autostart_oppo', 'autostart_vivo', 'autostart_oneplus', 'autostart_stock', 'autostart_na'];
    if (confirmKeys.includes(currentStep.permKey)) return; // manual confirm — never auto-advance
    if (granted) {
      setCantFind(false);
      advance();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perms, currentStep?.id]);

  function advance() {
    if (isLast) {
      setVisible(false);
    } else {
      setCantFind(false);
      setStepIdx((i) => i + 1);
    }
  }

  async function handleAction() {
    if (!currentStep) return;
    setWaiting(true);

    switch (currentStep.actionType) {
      case 'requestNotification':
        await requestNotificationPermission();
        setTimeout(async () => {
          const updated = await checkAllPermissions();
          setPerms(updated);
          setWaiting(false);
        }, 1200);
        break;
      case 'openGpsSettings':
        await openGpsSettings();
        setWaiting(false);
        break;
      case 'confirm':
        await openAppSettings();
        setWaiting(false);
        break;
      default:
        // openAppSettings, openBatterySettings
        await openAppSettings();
        setWaiting(false);
        break;
    }
  }

  function handleConfirm() {
    if (!currentStep) return;
    setConfirmedIds((prev) => {
      const next = new Set([...prev, currentStep.id]);
      saveConfirmedIds(next);
      return next;
    });
  }

  function handleCantFind() {
    setCantFind(true);
    // Record in native diagnostics so HR anomaly panel can see this device skipped autostart
    if (currentStep && isAndroid) {
      const label = currentStep.permKey.replace('autostart_', '') || 'unknown';
      try {
        GpsTracking.recordDiagnostic?.({ key: 'oemAutoStartNotFound', value: label + ':' + new Date().toISOString() }).catch(() => {});
      } catch { /* plugin may not have this method on older builds */ }
    }
  }

  if (!visible || !currentStep) return <>{children}</>;

  const isConfirmStep = ['autostart_xiaomi', 'autostart_samsung', 'autostart_oppo', 'autostart_vivo', 'autostart_oneplus', 'autostart_stock', 'autostart_na'].includes(currentStep.permKey);
  const progress = steps.length > 0 ? (stepIdx / steps.length) * 100 : 100;

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
            key={currentStep.id}
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
              STEP {stepIdx + 1} OF {steps.length}
            </p>

            {/* Icon */}
            <div className="flex justify-center mb-4">
              <div className="p-4 bg-white/5 rounded-2xl">{currentStep.icon}</div>
            </div>

            {/* Title */}
            <h2 className="text-white text-xl font-semibold text-center mb-2">
              {currentStep.title}
            </h2>

            {/* Description */}
            <p className="text-gray-400 text-sm text-center mb-5 leading-relaxed">
              {currentStep.description}
            </p>

            {/* Step-by-step instructions */}
            {!cantFind && (
              <div className="bg-white/5 rounded-xl p-4 mb-5">
                {currentStep.instructions.map((line, i) => (
                  <div key={i} className="flex items-start gap-3 mb-2 last:mb-0">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-gray-300 text-sm leading-snug">{line}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Can't find banner */}
            {cantFind && (
              <div className="bg-amber-900/40 border border-amber-600/40 rounded-xl p-4 mb-5 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-amber-200 text-sm leading-snug font-medium mb-1">
                    That's okay — tap Continue to proceed.
                  </p>
                  {currentStep?.permKey === 'autostart_xiaomi' ? (
                    <p className="text-amber-200/80 text-xs leading-relaxed">
                      On some Xiaomi/POCO devices the Autostart setting is inside{' '}
                      <span className="font-semibold">Security app → Autostart</span>. If you still
                      can't find it, try{' '}
                      <span className="font-semibold">
                        Settings → Privacy Protection → Special app access → Battery optimization
                      </span>{' '}
                      and set Aniston HRMS to "Not optimized". GPS may have reduced reliability
                      until this is set.
                    </p>
                  ) : (
                    <p className="text-amber-200/80 text-xs leading-relaxed">
                      GPS may have reduced reliability on this device without this setting.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Status badge */}
            {granted ? (
              <div className="flex items-center justify-center gap-2 text-green-400 text-sm mb-5">
                <CheckCircle2 className="w-4 h-4" />
                <span>{currentStep.grantedLabel}</span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 text-amber-400 text-sm mb-5">
                <XCircle className="w-4 h-4" />
                <span>{currentStep.isRequired ? 'Required — please complete this step' : 'Recommended for best GPS reliability'}</span>
              </div>
            )}

            {/* Primary action button — only when not yet granted */}
            {!granted && !cantFind && (
              <button
                onClick={handleAction}
                disabled={waiting}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold py-4 rounded-xl transition-colors mb-3 text-base"
              >
                <Settings className="w-4 h-4" />
                {waiting ? 'Opening…' : currentStep.actionLabel}
              </button>
            )}

            {/* Confirm button for confirm-type steps */}
            {isConfirmStep && !granted && !cantFind && (
              <button
                onClick={handleConfirm}
                className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white font-medium py-3.5 rounded-xl transition-colors mb-3"
              >
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                I've enabled it
              </button>
            )}

            {/* Continue button — shown when granted OR cantFind */}
            {(granted || cantFind) && (
              <button
                onClick={advance}
                className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 text-white font-semibold py-4 rounded-xl transition-colors text-base mb-3"
              >
                <CheckCircle2 className="w-4 h-4" />
                {isLast ? 'All done — Continue' : 'Continue'}
              </button>
            )}

            {/* "I can't find this setting" — only for confirm steps that allow skip */}
            {isConfirmStep && !granted && !cantFind && currentStep.canSkipIfNotFound && (
              <button
                onClick={handleCantFind}
                className="w-full text-center text-gray-500 text-xs py-2 hover:text-gray-400 transition-colors"
              >
                I can't find this setting
              </button>
            )}

            {/* Skip link — only for non-required, non-confirm steps */}
            {!currentStep.isRequired && !isConfirmStep && !granted && (
              <button
                onClick={advance}
                className="w-full text-center text-gray-500 text-xs py-2 hover:text-gray-400 transition-colors"
              >
                Skip (not required)
              </button>
            )}

            {/* Footer note */}
            {currentStep.isRequired && !cantFind && !granted && (
              <p className="text-center text-gray-600 text-xs mt-2">
                This permission is required for GPS tracking to work in the background.
              </p>
            )}

            {/* Xiaomi/POCO troubleshooting card — shown on the autostart step */}
            {currentStep.id === 'autostart' && steps.some(s => s.permKey === 'autostart_xiaomi') && (
              <div className="mt-3 bg-amber-950/30 border border-amber-700/30 rounded-xl p-3">
                <p className="text-amber-300 text-xs font-semibold mb-1">Xiaomi / POCO / Redmi Note</p>
                <p className="text-amber-200/70 text-xs leading-relaxed">
                  MIUI and HyperOS aggressively kill background apps. Even if the GPS notification
                  stays visible, location data may stop posting until Autostart and No Restrictions
                  (Battery) are both enabled. Check the GPS Diagnostics panel on the Attendance screen
                  after setup — it shows the exact reason if tracking stops.
                </p>
              </div>
            )}
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </>
  );
}
