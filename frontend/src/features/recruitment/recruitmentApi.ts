import { api } from '../../app/api';

export const recruitmentApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getJobOpenings: builder.query<any, { page?: number; limit?: number; status?: string; search?: string }>({
      query: (params) => ({ url: '/recruitment/jobs', params }),
      providesTags: ['Recruitment'],
    }),
    getJobById: builder.query<any, string>({
      query: (id) => `/recruitment/jobs/${id}`,
    }),
    createJob: builder.mutation<any, any>({
      query: (body) => ({ url: '/recruitment/jobs', method: 'POST', body }),
      invalidatesTags: ['Recruitment'],
    }),
    updateJob: builder.mutation<any, { id: string; data: any }>({
      query: ({ id, data }) => ({ url: `/recruitment/jobs/${id}`, method: 'PATCH', body: data }),
      invalidatesTags: ['Recruitment'],
    }),
    getApplications: builder.query<any, { jobId: string; status?: string }>({
      query: ({ jobId, status }) => ({ url: `/recruitment/jobs/${jobId}/applications`, params: status ? { status } : {} }),
    }),
    getApplicationById: builder.query<any, string>({
      query: (id) => `/recruitment/applications/${id}`,
    }),
    moveApplicationStage: builder.mutation<any, { id: string; status: string }>({
      query: ({ id, status }) => ({ url: `/recruitment/applications/${id}/stage`, method: 'PATCH', body: { status } }),
      invalidatesTags: ['Recruitment'],
    }),
    addInterviewScore: builder.mutation<any, any>({
      query: (body) => ({ url: '/recruitment/scores', method: 'POST', body }),
    }),
    triggerAIScoring: builder.mutation<any, string>({
      query: (id) => ({ url: `/recruitment/applications/${id}/ai-score`, method: 'POST' }),
    }),
    createOffer: builder.mutation<any, any>({
      query: (body) => ({ url: '/recruitment/offers', method: 'POST', body }),
    }),
    getPipelineStats: builder.query<any, void>({
      query: () => '/recruitment/pipeline/stats',
    }),
  }),
});

export const {
  useGetJobOpeningsQuery,
  useGetJobByIdQuery,
  useCreateJobMutation,
  useUpdateJobMutation,
  useGetApplicationsQuery,
  useGetApplicationByIdQuery,
  useMoveApplicationStageMutation,
  useAddInterviewScoreMutation,
  useTriggerAIScoringMutation,
  useCreateOfferMutation,
  useGetPipelineStatsQuery,
} = recruitmentApi;
