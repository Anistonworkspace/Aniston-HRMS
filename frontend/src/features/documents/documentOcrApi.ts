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
      providesTags: (_r, _e, employeeId) => [{ type: 'DocumentOcr' as any, id: `employee-${employeeId}` }],
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
      invalidatesTags: (_r, _e, employeeId) => [{ type: 'DocumentOcr' as any, id: `employee-${employeeId}` }],
    }),
    reprocessDocument: builder.mutation<any, string>({
      query: (documentId) => ({
        url: `/documents/${documentId}/ocr/reprocess`,
        method: 'POST',
      }),
      invalidatesTags: (_r, _e, id) => [{ type: 'DocumentOcr' as any, id }],
    }),

    getDocumentOcrHistory: builder.query<any, string>({
      query: (documentId) => `/documents/${documentId}/ocr/history`,
      providesTags: (_r, _e, id) => [{ type: 'DocumentOcr' as any, id: `history-${id}` }],
    }),

    orgBulkTriggerOcr: builder.mutation<any, void>({
      query: () => ({ url: '/documents/ocr/org-bulk-trigger', method: 'POST' }),
    }),

    hrApproveDocument: builder.mutation<any, string>({
      query: (documentId) => ({ url: `/documents/${documentId}/hr-approve`, method: 'PATCH' }),
      invalidatesTags: (_r, _e, id) => [{ type: 'DocumentOcr' as any, id }, 'Kyc' as any],
    }),

    hrRejectDocument: builder.mutation<any, { documentId: string; reason: string }>({
      query: ({ documentId, reason }) => ({
        url: `/documents/${documentId}/hr-reject`,
        method: 'PATCH',
        body: { reason },
      }),
      invalidatesTags: (_r, _e, { documentId }) => [{ type: 'DocumentOcr' as any, id: documentId }, 'Kyc' as any],
    }),

    compareFacesForEmployee: builder.mutation<any, string>({
      query: (employeeId) => ({
        url: `/documents/ocr/face-compare/${employeeId}`,
        method: 'POST',
      }),
    }),

    getKycAnalytics: builder.query<any, void>({
      query: () => '/onboarding/kyc/analytics',
      keepUnusedDataFor: 300,
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
  useReprocessDocumentMutation,
  useGetDocumentOcrHistoryQuery,
  useOrgBulkTriggerOcrMutation,
  useHrApproveDocumentMutation,
  useHrRejectDocumentMutation,
  useCompareFacesForEmployeeMutation,
  useGetKycAnalyticsQuery,
} = documentOcrApi;
