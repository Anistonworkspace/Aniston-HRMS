import { api } from '../../app/api';

export const recruitmentApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getJobOpenings: builder.query<any, { page?: number; limit?: number; status?: string; search?: string }>({
      query: (params) => ({ url: '/recruitment/jobs', params }),
      providesTags: ['Recruitment'],
    }),
    getJobById: builder.query<any, string>({
      query: (id) => `/recruitment/jobs/${id}`,
      providesTags: (result, error, id) => [{ type: 'Recruitment' as const, id }, 'Recruitment'],
    }),
    createJob: builder.mutation<any, any>({
      query: (body) => ({ url: '/recruitment/jobs', method: 'POST', body }),
      invalidatesTags: ['Recruitment'],
    }),
    updateJob: builder.mutation<any, { id: string; data: any }>({
      query: ({ id, data }) => ({ url: `/recruitment/jobs/${id}`, method: 'PATCH', body: data }),
      invalidatesTags: ['Recruitment'],
    }),
    deleteJob: builder.mutation<any, string>({
      query: (id) => ({ url: `/recruitment/jobs/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Recruitment'],
    }),
    getApplications: builder.query<any, { jobId: string; status?: string }>({
      query: ({ jobId, status }) => ({ url: `/recruitment/jobs/${jobId}/applications`, params: status ? { status } : {} }),
      providesTags: ['Recruitment'],
    }),
    getApplicationById: builder.query<any, string>({
      query: (id) => `/recruitment/applications/${id}`,
      providesTags: ['Recruitment'],
    }),
    moveApplicationStage: builder.mutation<any, { id: string; status: string }>({
      query: ({ id, status }) => ({ url: `/recruitment/applications/${id}/stage`, method: 'PATCH', body: { status } }),
      invalidatesTags: ['Recruitment'],
    }),
    bulkMoveApplicationStage: builder.mutation<any, { ids: string[]; status: string }>({
      query: ({ ids, status }) => ({ url: '/recruitment/applications/bulk-stage', method: 'POST', body: { ids, status } }),
      invalidatesTags: ['Recruitment'],
    }),
    addInterviewScore: builder.mutation<any, any>({
      query: (body) => ({ url: '/recruitment/scores', method: 'POST', body }),
      invalidatesTags: ['Recruitment'],
    }),
    triggerAIScoring: builder.mutation<any, string>({
      query: (id) => ({ url: `/recruitment/applications/${id}/ai-score`, method: 'POST' }),
      invalidatesTags: ['Recruitment'],
    }),
    createOffer: builder.mutation<any, any>({
      query: (body) => ({ url: '/recruitment/offers', method: 'POST', body }),
      invalidatesTags: ['Recruitment'],
    }),
    updateOfferStatus: builder.mutation<any, { id: string; status: string }>({
      query: ({ id, status }) => ({ url: `/recruitment/offers/${id}/status`, method: 'PATCH', body: { status } }),
      invalidatesTags: ['Recruitment'],
    }),
    getPipelineStats: builder.query<any, void>({
      query: () => '/recruitment/pipeline/stats',
      providesTags: ['Recruitment'],
    }),
    shareJobEmail: builder.mutation<any, { jobId: string; email: string; message?: string }>({
      query: ({ jobId, ...body }) => ({ url: `/recruitment/jobs/${jobId}/share-email`, method: 'POST', body }),
      invalidatesTags: ['Recruitment'],
    }),
    getReadyForOnboarding: builder.query<any, void>({
      query: () => '/recruitment/ready-for-onboarding',
      providesTags: ['Recruitment'],
    }),
    bulkInviteWalkIns: builder.mutation<any, { walkInIds: string[] }>({
      query: (body) => ({ url: '/recruitment/bulk-invite', method: 'POST', body }),
      invalidatesTags: ['Recruitment'],
    }),
    getApplicationMcqQuestions: builder.query<any, string>({
      query: (applicationId) => `/recruitment/applications/${applicationId}/mcq-questions`,
      providesTags: ['Recruitment'],
    }),
    scoreApplicationMcq: builder.mutation<any, { applicationId: string; answers: { questionId: string; selectedOption: string }[] }>({
      query: ({ applicationId, ...body }) => ({ url: `/recruitment/applications/${applicationId}/mcq-score`, method: 'POST', body }),
      invalidatesTags: ['Recruitment'],
    }),

    // ── Bulk Resume ──────────────────────────────────────────────────────────
    uploadBulkResumes: builder.mutation<any, FormData>({
      query: (formData) => ({ url: '/recruitment/bulk-resume/upload', method: 'POST', body: formData }),
      invalidatesTags: ['Recruitment'],
    }),
    listBulkUploads: builder.query<any, void>({
      query: () => '/recruitment/bulk-resume',
      providesTags: ['Recruitment'],
    }),
    getBulkUpload: builder.query<any, string>({
      query: (uploadId) => `/recruitment/bulk-resume/${uploadId}`,
      providesTags: (result, error, id) => [{ type: 'Recruitment' as const, id }, 'Recruitment'],
    }),
    createApplicationFromBulkItem: builder.mutation<any, { itemId: string; jobOpeningId: string }>({
      query: ({ itemId, jobOpeningId }) => ({
        url: `/recruitment/bulk-resume/${itemId}/create-application`,
        method: 'POST',
        body: { jobOpeningId },
      }),
      invalidatesTags: ['Recruitment'],
    }),
    deleteBulkUpload: builder.mutation<any, string>({
      query: (uploadId) => ({ url: `/recruitment/bulk-resume/uploads/${uploadId}`, method: 'DELETE' }),
      invalidatesTags: ['Recruitment'],
    }),
    deleteBulkResumeItem: builder.mutation<any, string>({
      query: (itemId) => ({ url: `/recruitment/bulk-resume/items/${itemId}`, method: 'DELETE' }),
      invalidatesTags: ['Recruitment'],
    }),
  }),
});

export const {
  useGetJobOpeningsQuery,
  useGetJobByIdQuery,
  useCreateJobMutation,
  useUpdateJobMutation,
  useDeleteJobMutation,
  useGetApplicationsQuery,
  useGetApplicationByIdQuery,
  useMoveApplicationStageMutation,
  useBulkMoveApplicationStageMutation,
  useAddInterviewScoreMutation,
  useTriggerAIScoringMutation,
  useCreateOfferMutation,
  useUpdateOfferStatusMutation,
  useGetPipelineStatsQuery,
  useShareJobEmailMutation,
  useGetReadyForOnboardingQuery,
  useBulkInviteWalkInsMutation,
  useGetApplicationMcqQuestionsQuery,
  useScoreApplicationMcqMutation,
  useUploadBulkResumesMutation,
  useListBulkUploadsQuery,
  useGetBulkUploadQuery,
  useCreateApplicationFromBulkItemMutation,
  useDeleteBulkUploadMutation,
  useDeleteBulkResumeItemMutation,
} = recruitmentApi;
