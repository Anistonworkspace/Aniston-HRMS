import { api } from '../../app/api';

export const exitApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getExitRequests: builder.query<any, { page?: number; status?: string; department?: string }>({
      query: (params) => ({ url: '/employees/exit-requests', params }),
      providesTags: ['Exit'],
    }),
    getExitDetails: builder.query<any, string>({
      query: (id) => `/employees/${id}/exit-details`,
      providesTags: ['Exit'],
    }),
    submitResignation: builder.mutation<any, { reason: string; lastWorkingDate: string }>({
      query: (body) => ({ url: '/employees/me/resign', method: 'POST', body }),
      invalidatesTags: ['Exit', 'Employee'],
    }),
    approveExit: builder.mutation<any, { id: string; body: { lastWorkingDate?: string; notes?: string } }>({
      query: ({ id, body }) => ({ url: `/employees/${id}/approve-exit`, method: 'POST', body }),
      invalidatesTags: ['Exit', 'Employee'],
    }),
    completeExit: builder.mutation<any, string>({
      query: (id) => ({ url: `/employees/${id}/complete-exit`, method: 'POST' }),
      invalidatesTags: ['Exit', 'Employee'],
    }),
    withdrawResignation: builder.mutation<any, string>({
      query: (id) => ({ url: `/employees/${id}/withdraw-resignation`, method: 'POST' }),
      invalidatesTags: ['Exit', 'Employee'],
    }),
    initiateTermination: builder.mutation<any, { id: string; body: { reason: string; lastWorkingDate: string; notes?: string } }>({
      query: ({ id, body }) => ({ url: `/employees/${id}/terminate`, method: 'POST', body }),
      invalidatesTags: ['Exit', 'Employee'],
    }),
    returnAssetForExit: builder.mutation<any, string>({
      query: (assignmentId) => ({ url: `/assets/assignments/${assignmentId}/return`, method: 'PATCH' }),
      invalidatesTags: ['Exit', 'Asset'],
    }),
  }),
});

export const {
  useGetExitRequestsQuery,
  useGetExitDetailsQuery,
  useSubmitResignationMutation,
  useApproveExitMutation,
  useCompleteExitMutation,
  useWithdrawResignationMutation,
  useInitiateTerminationMutation,
  useReturnAssetForExitMutation,
} = exitApi;
