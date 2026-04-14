import { api } from '../../app/api';

interface PerformanceQuery {
  employeeId?: string;
}

export const performanceApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getPerformanceSummary: builder.query<any, { employeeId?: string } | void>({
      query: (params) => ({
        url: (params as any)?.employeeId
          ? `/performance/summary/${(params as any).employeeId}`
          : '/performance/summary',
      }),
      providesTags: [{ type: 'Performance', id: 'SUMMARY' }],
    }),
    getGoals: builder.query<any, PerformanceQuery | void>({
      query: (params) => ({ url: '/performance/goals', params: params || {} }),
      providesTags: [{ type: 'Performance', id: 'GOALS' }],
    }),
    createGoal: builder.mutation<any, any>({
      query: (body) => ({ url: '/performance/goals', method: 'POST', body }),
      invalidatesTags: [{ type: 'Performance', id: 'GOALS' }],
    }),
    updateGoal: builder.mutation<any, { id: string; data: any }>({
      query: ({ id, data }) => ({ url: `/performance/goals/${id}`, method: 'PATCH', body: data }),
      invalidatesTags: [{ type: 'Performance', id: 'GOALS' }],
    }),
    getReviews: builder.query<any, PerformanceQuery | void>({
      query: (params) => ({ url: '/performance/reviews', params: params || {} }),
      providesTags: [{ type: 'Performance', id: 'REVIEWS' }],
    }),
    createReview: builder.mutation<any, any>({
      query: (body) => ({ url: '/performance/reviews', method: 'POST', body }),
      invalidatesTags: [{ type: 'Performance', id: 'REVIEWS' }],
    }),
    updateReview: builder.mutation<any, { id: string; data: any }>({
      query: ({ id, data }) => ({ url: `/performance/reviews/${id}`, method: 'PATCH', body: data }),
      invalidatesTags: [{ type: 'Performance', id: 'REVIEWS' }],
    }),
    getCycles: builder.query<any, void>({
      query: () => '/performance/cycles',
      providesTags: [{ type: 'Performance', id: 'CYCLES' }],
    }),
    createCycle: builder.mutation<any, any>({
      query: (body) => ({ url: '/performance/cycles', method: 'POST', body }),
      invalidatesTags: [{ type: 'Performance', id: 'CYCLES' }],
    }),
    updateCycle: builder.mutation<any, { id: string; data: any }>({
      query: ({ id, data }) => ({ url: `/performance/cycles/${id}`, method: 'PATCH', body: data }),
      invalidatesTags: [{ type: 'Performance', id: 'CYCLES' }],
    }),
  }),
});

export const {
  useGetPerformanceSummaryQuery,
  useGetGoalsQuery,
  useCreateGoalMutation,
  useUpdateGoalMutation,
  useGetReviewsQuery,
  useCreateReviewMutation,
  useUpdateReviewMutation,
  useGetCyclesQuery,
  useCreateCycleMutation,
  useUpdateCycleMutation,
} = performanceApi;
