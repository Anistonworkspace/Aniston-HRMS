import { api } from '../../app/api';

export const publicApplyApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getJobForm: builder.query<any, string>({
      query: (token) => `/jobs/form/${token}`,
    }),
    submitPublicApplication: builder.mutation<any, { token: string; data: any }>({
      query: ({ token, data }) => ({ url: `/jobs/form/${token}/apply`, method: 'POST', body: data }),
    }),
    trackApplication: builder.query<any, string>({
      query: (uid) => `/jobs/track/${uid}`,
    }),
    generateJobQuestions: builder.mutation<any, string>({
      query: (jobId) => ({ url: `/jobs/${jobId}/generate-questions`, method: 'POST' }),
      invalidatesTags: ['Recruitment'],
    }),
    getPublicApplications: builder.query<any, { page?: number; jobId?: string }>({
      query: (params) => ({ url: '/jobs/applications', params }),
      providesTags: ['Recruitment'],
    }),
    getPublicApplicationDetail: builder.query<any, string>({
      query: (id) => `/jobs/applications/${id}`,
      providesTags: ['Recruitment'],
    }),
    scheduleInterview: builder.mutation<any, { applicationId: string; data: any }>({
      query: ({ applicationId, data }) => ({ url: `/jobs/applications/${applicationId}/schedule-interview`, method: 'POST', body: data }),
      invalidatesTags: ['Recruitment'],
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
    finalizeCandidate: builder.mutation<any, { applicationId: string; finalStatus: string }>({
      query: ({ applicationId, finalStatus }) => ({ url: `/jobs/applications/${applicationId}/finalize`, method: 'POST', body: { finalStatus } }),
      invalidatesTags: ['Recruitment'],
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
  useFinalizeCandidateMutation,
} = publicApplyApi;
