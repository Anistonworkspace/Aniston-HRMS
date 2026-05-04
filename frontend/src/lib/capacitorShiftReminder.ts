import { Capacitor, registerPlugin } from '@capacitor/core';

interface ShiftReminderPluginDef {
  schedule(opts: { shiftStartEpochMs: number; shiftName: string }): Promise<{ scheduled: boolean; triggerAt?: number; reason?: string }>;
  cancel(): Promise<void>;
}

const ShiftReminderPlugin = registerPlugin<ShiftReminderPluginDef>('ShiftReminder', {
  web: {
    schedule: async () => ({ scheduled: false, reason: 'web' }),
    cancel: async () => {},
  },
});

const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

/**
 * Schedule a local notification 15 min before shift start.
 * shiftStartEpochMs: Unix timestamp in milliseconds (e.g. new Date('2026-05-06T09:00:00').getTime())
 */
export async function scheduleShiftReminder(shiftStartEpochMs: number, shiftName: string) {
  if (!isAndroid) return;
  try {
    await ShiftReminderPlugin.schedule({ shiftStartEpochMs, shiftName });
  } catch { /* ok */ }
}

/** Cancel the pending shift reminder (call after successful check-in). */
export async function cancelShiftReminder() {
  if (!isAndroid) return;
  try {
    await ShiftReminderPlugin.cancel();
  } catch { /* ok */ }
}
