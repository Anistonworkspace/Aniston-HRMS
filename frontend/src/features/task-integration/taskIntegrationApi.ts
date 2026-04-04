import { api } from '../../app/api';

export const taskIntegrationApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getTaskConfig: builder.query<any, void>({
      query: () => '/task-integration/config',
      providesTags: ['Settings'],
    }),
    upsertTaskConfig: builder.mutation<any, { provider: string; apiKey: string; baseUrl?: string; workspaceId?: string }>({
      query: (body) => ({ url: '/task-integration/config', method: 'POST', body }),
      invalidatesTags: ['Settings'],
    }),
    testTaskConnection: builder.mutation<any, void>({
      query: () => ({ url: '/task-integration/config/test', method: 'POST' }),
    }),
    auditTasksForLeave: builder.mutation<any, { startDate: string; endDate: string; leaveType: string }>({
      query: (body) => ({ url: '/task-integration/audit-for-leave', method: 'POST', body }),
    }),
  }),
});

export const {
  useGetTaskConfigQuery,
  useUpsertTaskConfigMutation,
  useTestTaskConnectionMutation,
  useAuditTasksForLeaveMutation,
} = taskIntegrationApi;
