import { Capacitor, registerPlugin } from '@capacitor/core';

export interface PermissionStatus {
  location: boolean;
  backgroundLocation: boolean;
  notifications: boolean;
  batteryOptimization: boolean;
  gpsEnabled: boolean;
}

interface AppPermissionsPluginDef {
  checkAllPermissions(): Promise<PermissionStatus>;
  requestNotificationPermission(): Promise<{ granted: boolean; prompted?: boolean }>;
  isGpsEnabled(): Promise<{ enabled: boolean }>;
  openGpsSettings(): Promise<void>;
  openAppSettings(): Promise<void>;
  getDeviceInfo(): Promise<{ manufacturer: string; brand: string; model: string; sdkInt: number }>;
}

const AppPermissions = registerPlugin<AppPermissionsPluginDef>('AppPermissions', {
  web: {
    checkAllPermissions: async () => ({
      location: true,
      backgroundLocation: true,
      notifications: true,
      batteryOptimization: true,
      gpsEnabled: true,
    }),
    requestNotificationPermission: async () => ({ granted: true }),
    isGpsEnabled: async () => ({ enabled: true }),
    openGpsSettings: async () => {},
    openAppSettings: async () => {},
    getDeviceInfo: async () => ({ manufacturer: 'web', brand: 'web', model: 'web', sdkInt: 0 }),
  },
});

const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export async function checkAllPermissions(): Promise<PermissionStatus> {
  if (!isAndroid) {
    return { location: true, backgroundLocation: true, notifications: true, batteryOptimization: true, gpsEnabled: true };
  }
  try {
    return await AppPermissions.checkAllPermissions();
  } catch {
    return { location: false, backgroundLocation: false, notifications: false, batteryOptimization: false, gpsEnabled: false };
  }
}

export async function requestNotificationPermission(): Promise<{ granted: boolean; prompted?: boolean }> {
  if (!isAndroid) return { granted: true };
  try {
    return await AppPermissions.requestNotificationPermission();
  } catch {
    return { granted: false };
  }
}

export async function isGpsEnabled(): Promise<boolean> {
  if (!isAndroid) return true;
  try {
    const { enabled } = await AppPermissions.isGpsEnabled();
    return enabled;
  } catch {
    return false;
  }
}

export async function openGpsSettings(): Promise<void> {
  if (!isAndroid) return;
  try {
    await AppPermissions.openGpsSettings();
  } catch {}
}

export async function openAppSettings(): Promise<void> {
  if (!isAndroid) return;
  try {
    await AppPermissions.openAppSettings();
  } catch {}
}

export async function getDeviceInfo(): Promise<{ manufacturer: string; brand: string; model: string; sdkInt: number }> {
  if (!isAndroid) return { manufacturer: 'web', brand: 'web', model: 'web', sdkInt: 0 };
  try {
    return await AppPermissions.getDeviceInfo();
  } catch {
    return { manufacturer: 'unknown', brand: 'unknown', model: 'unknown', sdkInt: 0 };
  }
}
