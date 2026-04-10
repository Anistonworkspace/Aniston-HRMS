import { createApi, fetchBaseQuery, type BaseQueryFn } from '@reduxjs/toolkit/query/react';
import type { RootState } from './store';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const baseQuery = fetchBaseQuery({
  baseUrl: API_URL,
  credentials: 'include',
  prepareHeaders: (headers, { getState }) => {
    const token = (getState() as RootState).auth.accessToken;
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    return headers;
  },
});

// Mutex to prevent concurrent token refresh requests
let refreshPromise: Promise<boolean> | null = null;

// Auto-refresh on 401, with offline detection
const baseQueryWithReauth: BaseQueryFn = async (args, api, extraOptions) => {
  // Fail fast if offline — no point waiting for network timeout
  if (!navigator.onLine) {
    return {
      error: {
        status: 'FETCH_ERROR',
        error: 'You are offline. Please connect to the network and try again.',
      },
    };
  }

  let result = await baseQuery(args, api, extraOptions);

  if (result.error && result.error.status === 401) {
    // Use mutex to prevent parallel refresh requests
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const refreshResult = await baseQuery(
          { url: '/auth/refresh', method: 'POST' },
          api,
          extraOptions
        );
        if (refreshResult.data) {
          const data = refreshResult.data as { data: { accessToken: string } };
          api.dispatch({
            type: 'auth/setAccessToken',
            payload: data.data.accessToken,
          });
          return true;
        } else {
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
  ],
  endpoints: () => ({}),
});
