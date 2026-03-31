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
  }),
});

export const { useSendBulkEmailMutation } = employeeBulkApi;
