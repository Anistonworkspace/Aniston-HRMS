import { api } from '../../app/api';

export const performanceApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getGoals: builder.query<any, void>({ query: () => '/performance/goals' }),
    createGoal: builder.mutation<any, any>({ query: (body) => ({ url: '/performance/goals', method: 'POST', body }) }),
    updateGoal: builder.mutation<any, { id: string; data: any }>({
      query: ({ id, data }) => ({ url: `/performance/goals/${id}`, method: 'PATCH', body: data }),
    }),
    getReviews: builder.query<any, void>({ query: () => '/performance/reviews' }),
    getCycles: builder.query<any, void>({ query: () => '/performance/cycles' }),
  }),
});

export const {
  useGetGoalsQuery,
  useCreateGoalMutation,
  useUpdateGoalMutation,
  useGetReviewsQuery,
  useGetCyclesQuery,
} = performanceApi;
