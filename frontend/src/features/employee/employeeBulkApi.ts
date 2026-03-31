import { api } from '../../app/api';

export const employeeBulkApi = api.injectEndpoints({
  endpoints: (builder) => ({
    sendBulkEmail: builder.mutation<
      { success: boolean; data: { queued: number } },
      { employeeIds: string[]; templateType: 'app-download' | 'attendance-instructions' }
    >({
      query: (body) => ({
        url: '/employees/send-bulk-email',
        method: 'POST',
        body,
      }),
    }),
    sendBulkOnboardingInvite: builder.mutation<
      { success: boolean; data: { sentCount: number; skippedCount: number; totalRequested: number; errors: string[] }; message: string },
      { emails: string[]; role?: string; departmentId?: string; designationId?: string }
    >({
      query: (body) => ({
        url: '/invitations/bulk',
        method: 'POST',
        body,
      }),
    }),
  }),
});

export const { useSendBulkEmailMutation, useSendBulkOnboardingInviteMutation } = employeeBulkApi;
