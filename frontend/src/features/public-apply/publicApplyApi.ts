import { api } from '../../app/api';

export const publicApplyApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getJobForm: builder.query<any, string>({
      query: (token) => `/jobs/form/${token}`,
    }),
    submitPublicApplication: builder.mutation<any, { token: string; formData: FormData }>({
      query: ({ token, formData }) => ({
        url: `/jobs/form/${token}/apply`,
        method: 'POST',
        body: formData,
      }),
    }),
    trackApplication: builder.query<any, string>({
      query: (uid) => `/jobs/track/${uid}`,
    }),
    generateJobQuestions: builder.mutation<any, string>({
      query: (jobId) => ({ url: `/jobs/${jobId}/generate-questions`, method: 'POST' }),
      invalidatesTags: ['Recruitment'],
    }),
    getPublicApplications: builder.query<any, { page?: number; limit?: number; jobId?: string }>({
      query: (params) => ({ url: '/jobs/applications', params }),
      providesTags: ['Recruitment'],
    }),
    getPublicApplicationDetail: builder.query<any, string>({
      query: (id) => `/jobs/applications/${id}`,
      providesTags: (result, error, id) => [{ type: 'Recruitment' as const, id }, 'Recruitment'],
    }),
    scheduleInterview: builder.mutation<any, { applicationId: string; data: any }>({
      query: ({ applicationId, data }) => ({ url: `/jobs/applications/${applicationId}/schedule-interview`, method: 'POST', body: data }),
      invalidatesTags: (result, error, { applicationId }) => [{ type: 'Recruitment' as const, id: applicationId }, 'Recruitment'],
    }),
    previewScheduleMessage: builder.mutation<any, { applicationId: string; data: any }>({
      query: ({ applicationId, data }) => ({ url: `/jobs/applications/${applicationId}/schedule-preview`, method: 'POST', body: data }),
    }),
    generateRoundQuestions: builder.mutation<any, string>({
      query: (roundId) => ({ url: `/jobs/rounds/${roundId}/generate-questions`, method: 'POST' }),
      invalidatesTags: ['Recruitment'],
    }),
    scoreRound: builder.mutation<any, { roundId: string; score: number; feedback: string }>({
      query: ({ roundId, ...body }) => ({ url: `/jobs/rounds/${roundId}/score`, method: 'PATCH', body }),
      invalidatesTags: ['Recruitment'],
    }),
    createInterviewRound: builder.mutation<any, { applicationId: string; roundType: string; conductedBy: string; scheduledAt?: string }>({
      query: ({ applicationId, ...body }) => ({ url: `/jobs/applications/${applicationId}/rounds`, method: 'POST', body }),
      invalidatesTags: (result, error, { applicationId }) => [{ type: 'Recruitment' as const, id: applicationId }, 'Recruitment'],
    }),
    finalizeCandidate: builder.mutation<any, { applicationId: string; finalStatus: string }>({
      query: ({ applicationId, finalStatus }) => ({ url: `/jobs/applications/${applicationId}/finalize`, method: 'POST', body: { finalStatus } }),
      // GAP-4 FIX: invalidate specific app + global list so HiringPassedTab refreshes
      invalidatesTags: (result, error, { applicationId }) => [{ type: 'Recruitment' as const, id: applicationId }, 'Recruitment'],
    }),
    getInterviewTasks: builder.query<any, void>({
      query: () => '/jobs/interview-tasks',
      providesTags: ['Recruitment'],
    }),
    // M-1: MCQ questions for internal applicant
    getApplicationMCQQuestions: builder.query<any, string>({
      query: (applicationId) => `/recruitment/applications/${applicationId}/mcq-questions`,
      providesTags: (result, error, id) => [{ type: 'Recruitment' as const, id }],
    }),
    // M-1: Score MCQ answers for internal applicant
    scoreInternalMCQ: builder.mutation<any, { applicationId: string; answers: Array<{ questionId: string; selectedOption: string }> }>({
      query: ({ applicationId, answers }) => ({ url: `/recruitment/applications/${applicationId}/mcq-score`, method: 'POST', body: { answers } }),
      invalidatesTags: (result, error, { applicationId }) => [{ type: 'Recruitment' as const, id: applicationId }, 'Recruitment'],
    }),
    // M-2: Unified ready-for-onboarding view
    getReadyForOnboarding: builder.query<any, void>({
      query: () => '/recruitment/ready-for-onboarding',
      providesTags: ['Recruitment'],
    }),
    // M-3: Bulk send onboarding invites to walk-in candidates
    bulkSendOnboardingInvites: builder.mutation<any, string[]>({
      query: (walkInIds) => ({ url: '/recruitment/bulk-invite', method: 'POST', body: { walkInIds } }),
      invalidatesTags: ['Recruitment', 'WalkIn', 'Dashboard'],
    }),
  }),
});

export const {
  useGetJobFormQuery,
  useSubmitPublicApplicationMutation,
  useTrackApplicationQuery,
  useGenerateJobQuestionsMutation,
  useGetPublicApplicationsQuery,
  useGetPublicApplicationDetailQuery,
  useScheduleInterviewMutation,
  usePreviewScheduleMessageMutation,
  useGenerateRoundQuestionsMutation,
  useScoreRoundMutation,
  useCreateInterviewRoundMutation,
  useFinalizeCandidateMutation,
  useGetInterviewTasksQuery,
  useGetApplicationMCQQuestionsQuery,
  useScoreInternalMCQMutation,
  useGetReadyForOnboardingQuery,
  useBulkSendOnboardingInvitesMutation,
} = publicApplyApi;
