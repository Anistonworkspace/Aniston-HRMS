import { Capacitor, registerPlugin } from '@capacitor/core';

interface BiometricPluginDef {
  isAvailable(): Promise<{ available: boolean; reason: string }>;
  authenticate(opts: { reason: string }): Promise<{ success: boolean }>;
}

const BiometricPlugin = registerPlugin<BiometricPluginDef>('Biometric', {
  web: {
    isAvailable: async () => ({ available: false, reason: 'WEB' }),
    authenticate: async () => ({ success: true }), // no-op on web
  },
});

const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export async function isBiometricAvailable(): Promise<boolean> {
  if (!isAndroid) return false;
  try {
    const { available } = await BiometricPlugin.isAvailable();
    return available;
  } catch {
    return false;
  }
}

export async function authenticateBiometric(reason = 'Confirm your identity to continue'): Promise<boolean> {
  if (!isAndroid) return true;
  try {
    const { success } = await BiometricPlugin.authenticate({ reason });
    return success;
  } catch {
    return false;
  }
}
