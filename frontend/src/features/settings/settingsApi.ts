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
    getTeamsConfig: builder.query<any, void>({
      query: () => '/settings/teams',
      providesTags: ['TeamsConfig'],
    }),
    saveTeamsConfig: builder.mutation<any, any>({
      query: (body) => ({ url: '/settings/teams', method: 'POST', body }),
      invalidatesTags: ['TeamsConfig'],
    }),
    testTeamsConnection: builder.mutation<any, void>({
      query: () => ({ url: '/settings/teams/test', method: 'POST' }),
    }),
    syncTeamsEmployees: builder.mutation<any, void>({
      query: () => ({ url: '/settings/teams/sync', method: 'POST' }),
      invalidatesTags: ['Employee', 'EmployeeList'],
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
  useGetTeamsConfigQuery,
  useSaveTeamsConfigMutation,
  useTestTeamsConnectionMutation,
  useSyncTeamsEmployeesMutation,
} = settingsApi;
