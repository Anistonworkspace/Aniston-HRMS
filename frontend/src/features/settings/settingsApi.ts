import { api } from '../../app/api';

export const settingsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getOrgSettings: builder.query<any, void>({ query: () => '/settings/organization' }),
    updateOrg: builder.mutation<any, any>({
      query: (body) => ({ url: '/settings/organization', method: 'PATCH', body }),
    }),
    getLocations: builder.query<any, void>({ query: () => '/settings/locations' }),
    createLocation: builder.mutation<any, any>({
      query: (body) => ({ url: '/settings/locations', method: 'POST', body }),
    }),
    getAuditLogs: builder.query<any, { page?: number; entity?: string }>({
      query: (params) => ({ url: '/settings/audit-logs', params }),
    }),
    getSystemInfo: builder.query<any, void>({ query: () => '/settings/system' }),
    getEmailConfig: builder.query<any, void>({ query: () => '/settings/email' }),
    saveEmailConfig: builder.mutation<any, any>({
      query: (body) => ({ url: '/settings/email', method: 'POST', body }),
    }),
    testEmailConnection: builder.mutation<any, void>({
      query: () => ({ url: '/settings/email/test', method: 'POST' }),
    }),
  }),
});

export const {
  useGetOrgSettingsQuery,
  useUpdateOrgMutation,
  useGetLocationsQuery,
  useCreateLocationMutation,
  useGetAuditLogsQuery,
  useGetSystemInfoQuery,
  useGetEmailConfigQuery,
  useSaveEmailConfigMutation,
  useTestEmailConnectionMutation,
} = settingsApi;
