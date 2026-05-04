import { createApi, fetchBaseQuery, type BaseQueryFn } from '@reduxjs/toolkit/query/react';
import { Capacitor } from '@capacitor/core';
import toast from 'react-hot-toast';
import type { RootState } from './store';

// In native Capacitor (Android/iOS), relative URLs resolve to capacitor://localhost
// which has no backend. Always use the full production URL on native platforms.
const API_URL = Capacitor.isNativePlatform()
  ? 'https://hr.anistonav.com/api'
  : (import.meta.env.VITE_API_URL || 'http://localhost:4000/api');

const baseQuery = fetchBaseQuery({
  baseUrl: API_URL,
  credentials: 'include',
  prepareHeaders: (headers, { getState }) => {
    const token = (getState() as RootState).auth.accessToken;
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    // Tell the backend this is a native Capacitor client so it returns refreshToken in the body
    // (httpOnly cookies can't be sent cross-origin from capacitor://localhost).
    if (Capacitor.isNativePlatform()) {
      headers.set('X-Native-App', 'true');
    }
    return headers;
  },
});

// Mutex to prevent concurrent token refresh requests
let refreshPromise: Promise<boolean> | null = null;

// Auto-refresh on 401
const baseQueryWithReauth: BaseQueryFn = async (args, api, extraOptions) => {
  let result = await baseQuery(args, api, extraOptions);

  if (result.error && result.error.status === 401) {
    // Session revoked by force-login from another device — logout immediately, no refresh
    const errCode = (result.error.data as any)?.error?.code;
    if (errCode === 'SESSION_REVOKED') {
      if (Capacitor.isNativePlatform()) localStorage.removeItem('nativeRefreshToken');
      api.dispatch({ type: 'auth/logout' });
      return result;
    }
    // Use mutex to prevent parallel refresh requests
    if (!refreshPromise) {
      refreshPromise = (async () => {
        // On native, cookies can't be sent cross-origin — include the stored token in the body
        const storedNativeToken = Capacitor.isNativePlatform()
          ? localStorage.getItem('nativeRefreshToken')
          : null;

        const refreshResult = await baseQuery(
          {
            url: '/auth/refresh',
            method: 'POST',
            body: storedNativeToken ? { refreshToken: storedNativeToken } : undefined,
          },
          api,
          extraOptions
        );
        if (refreshResult.data) {
          const data = refreshResult.data as { data: { accessToken: string; refreshToken?: string } };
          api.dispatch({
            type: 'auth/setAccessToken',
            payload: data.data.accessToken,
          });
          // Rotate stored native refresh token
          if (data.data.refreshToken && Capacitor.isNativePlatform()) {
            localStorage.setItem('nativeRefreshToken', data.data.refreshToken);
          }
          return true;
        } else {
          if (Capacitor.isNativePlatform()) localStorage.removeItem('nativeRefreshToken');
          api.dispatch({ type: 'auth/logout' });
          return false;
        }
      })().finally(() => { refreshPromise = null; });
    }

    const refreshed = await refreshPromise;
    if (refreshed) {
      // Retry original request with new token
      result = await baseQuery(args, api, extraOptions);
    }
  }

  // Show error toast for failed requests (excluding 401 which is handled by reauth)
  if (result.error) {
    const status = result.error.status;
    // Don't toast on 401 (handled by reauth), 404 (callers decide), or offline (already handled)
    if (status !== 401 && status !== 'FETCH_ERROR') {
      const message =
        (result.error as any)?.data?.error?.message ||
        (result.error as any)?.data?.message ||
        (result.error as any)?.error ||
        `Error ${status}: Something went wrong. Please try again.`;
      // Always toast 403 permission denials (employee perm layer blocks), only toast other errors on mutations
      if (status === 403) {
        toast.error(message, { id: `api-err-403`, duration: 5000 });
      } else if ((args as any)?.method && (args as any).method !== 'GET') {
        toast.error(message, { id: `api-err-${status}`, duration: 4000 });
      }
    }
  }

  return result;
};

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  // Re-fetch stale queries when user switches back to the tab or reconnects — ensures
  // config changes made on another device are reflected without a full page reload
  refetchOnFocus: true,
  refetchOnReconnect: true,
  keepUnusedDataFor: 30, // 30s — keeps settings configs fresh across tab switches
  tagTypes: [
    'Employee',
    'EmployeeList',
    'Department',
    'Designation',
    'Dashboard',
    'Attendance',
    'Leave',
    'LeaveBalance',
    'Payroll',
    'WalkIn',
    'Document',
    'Recruitment',
    'Helpdesk',
    'Holiday',
    'Announcements',
    'SocialPosts',
    'TeamsConfig',
    'Asset',
    'Exit',
    'AiConfig',
    'Invitation',
    'WhatsApp',
    'WhatsAppStatus',
    'WhatsAppChats',
    'WhatsAppContacts',
    'WhatsAppMessages',
    'WhatsAppHrmsMessages',
    'WhatsAppConversations',
    'WhatsAppDbContacts',
    'KnowledgeBase',
    'Activation',
    'Policy',
    'Performance',
    'Kyc',
    'Onboarding',
    'PermissionPresets',
    'PermissionOverrides',
    'MyPermissions',
    'AgentSetup',
    'SalaryTemplate',
    'OfficeLocation',
    'Settings',
    'EmailConfig',
    'Letter',
    'Branding',
    'Backup',
    'DeletionRequests',
    'MFA',
    'ProfileEditRequest',
    'Notification',
    'NotificationUnread',
    'DocumentTemplates',
    'DocumentOcr',
    'GPSTrail',
    'CrashReport',
  ],
  endpoints: () => ({}),
});
