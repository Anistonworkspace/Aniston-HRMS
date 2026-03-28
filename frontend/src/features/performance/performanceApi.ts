import { api } from '../../app/api';

interface PerformanceQuery {
  employeeId?: string;
}

export const performanceApi = api.injectEndpoints({
  endpoints: (builder) => ({
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
    getCycles: builder.query<any, void>({
      query: () => '/performance/cycles',
      providesTags: [{ type: 'Performance', id: 'CYCLES' }],
    }),
  }),
});

export const {
  useGetGoalsQuery,
  useCreateGoalMutation,
  useUpdateGoalMutation,
  useGetReviewsQuery,
  useGetCyclesQuery,
} = performanceApi;
