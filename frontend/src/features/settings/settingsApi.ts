import { api } from '../../app/api';

export const settingsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getOrgSettings: builder.query<any, void>({ query: () => '/settings/organization', providesTags: ['Settings'] }),
    updateOrg: builder.mutation<any, any>({
      query: (body) => ({ url: '/settings/organization', method: 'PATCH', body }),
      invalidatesTags: ['Settings'],
    }),
    getLocations: builder.query<any, void>({ query: () => '/settings/locations', providesTags: ['Settings'] }),
    createLocation: builder.mutation<any, any>({
      query: (body) => ({ url: '/settings/locations', method: 'POST', body }),
      invalidatesTags: ['Settings'],
    }),
    getAuditLogs: builder.query<any, { page?: number; entity?: string }>({
      query: (params) => ({ url: '/settings/audit-logs', params }),
      providesTags: ['Settings'],
    }),
    getSystemInfo: builder.query<any, void>({ query: () => '/settings/system' }),
    getEmailConfig: builder.query<any, void>({ query: () => '/settings/email', providesTags: ['Settings'] }),
    saveEmailConfig: builder.mutation<any, any>({
      query: (body) => ({ url: '/settings/email', method: 'POST', body }),
      invalidatesTags: ['Settings'],
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
    // Salary visibility rules
    getSalaryVisibilityRules: builder.query<any, void>({
      query: () => '/payroll/visibility-rules',
      providesTags: ['Payroll'],
    }),
    setSalaryVisibilityRule: builder.mutation<any, { employeeId: string; visibleToHR: boolean; visibleToManager: boolean; hiddenReason?: string }>({
      query: (body) => ({ url: '/payroll/visibility-rules', method: 'POST', body }),
      invalidatesTags: ['Payroll'],
    }),
    updateSalaryVisibilityRule: builder.mutation<any, { employeeId: string; visibleToHR: boolean; visibleToManager: boolean; hiddenReason?: string }>({
      query: ({ employeeId, ...body }) => ({ url: `/payroll/visibility-rules/${employeeId}`, method: 'PATCH', body }),
      invalidatesTags: ['Payroll'],
    }),
    // AI Config
    getAiConfig: builder.query<any, void>({
      query: () => '/settings/ai-config',
      providesTags: ['AiConfig'],
    }),
    saveAiConfig: builder.mutation<any, { provider: string; apiKey?: string; baseUrl?: string | null; modelName: string }>({
      query: (body) => ({ url: '/settings/ai-config', method: 'PUT', body }),
      invalidatesTags: ['AiConfig'],
    }),
    testAiConnection: builder.mutation<any, { modelName?: string; baseUrl?: string; provider?: string; apiKey?: string } | void>({
      query: (body) => ({ url: '/settings/ai-config/test', method: 'POST', body: body || {} }),
    }),
    testAdminNotificationEmail: builder.mutation<any, void>({
      query: () => ({ url: '/settings/organization/test-admin-email', method: 'POST' }),
    }),
    // Agent Setup
    getAgentSetupList: builder.query<any, void>({
      query: () => '/agent/setup/employees',
      providesTags: ['AgentSetup'],
    }),
    generateAgentCode: builder.mutation<any, { employeeId: string }>({
      query: (body) => ({ url: '/agent/setup/generate-code', method: 'POST', body }),
      invalidatesTags: ['AgentSetup'],
    }),
    regenerateAgentCode: builder.mutation<any, { employeeId: string }>({
      query: (body) => ({ url: '/agent/setup/regenerate-code', method: 'POST', body }),
      invalidatesTags: ['AgentSetup'],
    }),
    bulkGenerateAgentCodes: builder.mutation<any, void>({
      query: () => ({ url: '/agent/setup/bulk-generate', method: 'POST' }),
      invalidatesTags: ['AgentSetup'],
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
  useGetSalaryVisibilityRulesQuery,
  useSetSalaryVisibilityRuleMutation,
  useUpdateSalaryVisibilityRuleMutation,
  useGetAiConfigQuery,
  useSaveAiConfigMutation,
  useTestAiConnectionMutation,
  useTestAdminNotificationEmailMutation,
  useGetAgentSetupListQuery,
  useGenerateAgentCodeMutation,
  useRegenerateAgentCodeMutation,
  useBulkGenerateAgentCodesMutation,
} = settingsApi;
