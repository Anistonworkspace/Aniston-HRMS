import { Capacitor, registerPlugin } from '@capacitor/core';

interface InAppUpdatePluginDef {
  checkUpdate(): Promise<{ available: boolean; versionCode: number; updateType: 'FLEXIBLE' | 'IMMEDIATE'; stalenessDays: number; error?: string }>;
  startFlexibleUpdate(): Promise<{ started: boolean; reason?: string }>;
  startImmediateUpdate(): Promise<{ started: boolean; reason?: string }>;
  completeFlexibleUpdate(): Promise<void>;
}

const InAppUpdatePlugin = registerPlugin<InAppUpdatePluginDef>('InAppUpdate', {
  web: {
    checkUpdate: async () => ({ available: false, versionCode: 0, updateType: 'FLEXIBLE', stalenessDays: 0 }),
    startFlexibleUpdate: async () => ({ started: false }),
    startImmediateUpdate: async () => ({ started: false }),
    completeFlexibleUpdate: async () => {},
  },
});

const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export async function checkForAppUpdate() {
  if (!isAndroid) return null;
  try {
    return await InAppUpdatePlugin.checkUpdate();
  } catch {
    return null;
  }
}

export async function startAppUpdate(type: 'FLEXIBLE' | 'IMMEDIATE' = 'FLEXIBLE') {
  if (!isAndroid) return;
  if (type === 'IMMEDIATE') {
    await InAppUpdatePlugin.startImmediateUpdate();
  } else {
    await InAppUpdatePlugin.startFlexibleUpdate();
  }
}

export async function completeFlexibleUpdate() {
  if (!isAndroid) return;
  await InAppUpdatePlugin.completeFlexibleUpdate();
}
