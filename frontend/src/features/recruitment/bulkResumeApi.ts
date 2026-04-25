import { api } from '../../app/api';

export const bulkResumeApi = api.injectEndpoints({
  endpoints: (builder) => ({
    uploadBulkResumes: builder.mutation<any, FormData>({
      query: (formData) => ({
        url: '/recruitment/bulk-resume/upload',
        method: 'POST',
        body: formData,
      }),
      invalidatesTags: ['Recruitment'],
    }),
    getBulkUploads: builder.query<any, void>({
      query: () => '/recruitment/bulk-resume',
      providesTags: ['Recruitment'],
    }),
    getBulkUpload: builder.query<any, string>({
      query: (uploadId) => `/recruitment/bulk-resume/${uploadId}`,
      providesTags: ['Recruitment'],
    }),
    createApplicationFromItem: builder.mutation<any, { itemId: string; jobOpeningId: string }>({
      query: ({ itemId, jobOpeningId }) => ({
        url: `/recruitment/bulk-resume/${itemId}/create-application`,
        method: 'POST',
        body: { jobOpeningId },
      }),
      invalidatesTags: ['Recruitment'],
    }),
    deleteBulkUpload: builder.mutation<any, string>({
      query: (uploadId) => ({ url: `/recruitment/bulk-resume/${uploadId}`, method: 'DELETE' }),
      invalidatesTags: ['Recruitment'],
    }),
    deleteBulkResumeItem: builder.mutation<any, string>({
      query: (itemId) => ({ url: `/recruitment/bulk-resume/items/${itemId}`, method: 'DELETE' }),
      invalidatesTags: ['Recruitment'],
    }),
    sendBulkResumeInvite: builder.mutation<any, { itemId: string; inviteType: 'email' | 'whatsapp'; phone?: string; jobId: string }>({
      query: ({ itemId, ...body }) => ({
        url: `/recruitment/bulk-resume/${itemId}/invite`,
        method: 'POST',
        body,
      }),
    }),
  }),
});

export const {
  useUploadBulkResumesMutation,
  useGetBulkUploadsQuery,
  useGetBulkUploadQuery,
  useCreateApplicationFromItemMutation,
  useDeleteBulkUploadMutation,
  useDeleteBulkResumeItemMutation,
  useSendBulkResumeInviteMutation,
} = bulkResumeApi;
