import { api } from '../../app/api';

export const documentApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getDocuments: builder.query<any, { employeeId?: string; page?: number; limit?: number }>({
      query: (params) => ({ url: '/documents', params }),
      providesTags: ['Document'],
    }),

    uploadDocument: builder.mutation<any, FormData>({
      query: (body) => ({
        url: '/documents',
        method: 'POST',
        body,
      }),
      // Invalidate Employee so profile photo updates immediately after PHOTO upload
      // Invalidate Onboarding so step progress + uploadedDocTypes refresh
      invalidatesTags: ['Document', 'Employee', 'Onboarding'],
    }),

    verifyDocument: builder.mutation<any, { id: string; status: string; rejectionReason?: string }>({
      query: ({ id, ...body }) => ({
        url: `/documents/${id}/verify`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['Document', 'Employee'],
    }),

    deleteDocument: builder.mutation<any, { id: string; reason?: string }>({
      query: ({ id, reason }) => ({
        url: `/documents/${id}`,
        method: 'DELETE',
        body: reason ? { reason } : undefined,
      }),
      invalidatesTags: ['Document', 'Employee'],
    }),
  }),
});

export const {
  useGetDocumentsQuery,
  useUploadDocumentMutation,
  useVerifyDocumentMutation,
  useDeleteDocumentMutation,
} = documentApi;
