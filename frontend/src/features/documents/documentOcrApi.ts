import { api } from '../../app/api';

export const documentOcrApi = api.injectEndpoints({
  endpoints: (builder) => ({
    triggerDocumentOcr: builder.mutation<any, string>({
      query: (documentId) => ({
        url: `/documents/${documentId}/ocr`,
        method: 'POST',
      }),
      invalidatesTags: (_r, _e, id) => [{ type: 'DocumentOcr' as any, id }],
    }),
    getDocumentOcr: builder.query<any, string>({
      query: (documentId) => `/documents/${documentId}/ocr`,
      providesTags: (_r, _e, id) => [{ type: 'DocumentOcr' as any, id }],
    }),
    updateDocumentOcr: builder.mutation<any, { documentId: string; body: Record<string, any> }>({
      query: ({ documentId, body }) => ({
        url: `/documents/${documentId}/ocr`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_r, _e, { documentId }) => [{ type: 'DocumentOcr' as any, id: documentId }],
    }),
    crossValidateEmployee: builder.mutation<any, string>({
      query: (employeeId) => ({
        url: `/documents/ocr/cross-validate/${employeeId}`,
        method: 'POST',
      }),
    }),
    getEmployeeOcrSummary: builder.query<any, string>({
      query: (employeeId) => `/documents/ocr/employee/${employeeId}`,
      providesTags: ['DocumentOcr' as any],
    }),
    deepRecheckDocument: builder.mutation<any, string>({
      query: (documentId) => ({
        url: `/documents/${documentId}/ocr/deep-recheck`,
        method: 'POST',
      }),
      invalidatesTags: (_r, _e, id) => [{ type: 'DocumentOcr' as any, id }],
    }),
    triggerAllEmployeeOcr: builder.mutation<any, string>({
      query: (employeeId) => ({
        url: `/documents/ocr/employee/${employeeId}/trigger-all`,
        method: 'POST',
      }),
      invalidatesTags: ['DocumentOcr' as any],
    }),
  }),
});

export const {
  useTriggerDocumentOcrMutation,
  useGetDocumentOcrQuery,
  useUpdateDocumentOcrMutation,
  useCrossValidateEmployeeMutation,
  useGetEmployeeOcrSummaryQuery,
  useDeepRecheckDocumentMutation,
  useTriggerAllEmployeeOcrMutation,
} = documentOcrApi;
