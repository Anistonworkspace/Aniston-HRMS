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

// Auto-refresh on 401
const baseQueryWithReauth: BaseQueryFn = async (args, api, extraOptions) => {
  let result = await baseQuery(args, api, extraOptions);

  if (result.error && result.error.status === 401) {
    // Try to refresh
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
      // Retry original request
      result = await baseQuery(args, api, extraOptions);
    } else {
      api.dispatch({ type: 'auth/logout' });
    }
  }

  return result;
};

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
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
  ],
  endpoints: () => ({}),
});
