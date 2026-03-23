import { api } from '../../app/api';

export const walkInApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // Public: Get open jobs for kiosk dropdown
    getWalkInJobs: builder.query<any, string | void>({
      query: (orgId) => ({
        url: '/walk-in/jobs',
        params: orgId ? { orgId } : {},
      }),
    }),

    // Public: Register walk-in candidate
    registerWalkIn: builder.mutation<any, any>({
      query: (body) => ({
        url: '/walk-in/register',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['WalkIn'],
    }),

    // Public: Get by token number (status check)
    getWalkInByToken: builder.query<any, string>({
      query: (token) => `/walk-in/token/${token}`,
      providesTags: ['WalkIn'],
    }),

    // HR: Get today's walk-ins
    getTodayWalkIns: builder.query<any, { page?: number; limit?: number; status?: string; date?: string; search?: string }>({
      query: (params) => ({ url: '/walk-in/today', params }),
      providesTags: ['WalkIn'],
    }),

    // HR: Get walk-in by ID
    getWalkInById: builder.query<any, string>({
      query: (id) => `/walk-in/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'WalkIn', id }],
    }),

    // HR: Update candidate details
    updateWalkInCandidate: builder.mutation<any, { id: string; data: any }>({
      query: ({ id, data }) => ({
        url: `/walk-in/${id}`,
        method: 'PATCH',
        body: data,
      }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'WalkIn', id }, 'WalkIn'],
    }),

    // HR: Update walk-in status
    updateWalkInStatus: builder.mutation<any, { id: string; status: string }>({
      query: ({ id, status }) => ({
        url: `/walk-in/${id}/status`,
        method: 'PATCH',
        body: { status },
      }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'WalkIn', id }, 'WalkIn'],
    }),

    // HR: Add notes
    addWalkInNotes: builder.mutation<any, { id: string; notes: string }>({
      query: ({ id, notes }) => ({
        url: `/walk-in/${id}/notes`,
        method: 'POST',
        body: { notes },
      }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'WalkIn', id }, 'WalkIn'],
    }),

    // HR: Add interview round
    addInterviewRound: builder.mutation<any, { walkInId: string; roundName: string; interviewerName?: string; scheduledAt?: string }>({
      query: ({ walkInId, ...body }) => ({
        url: `/walk-in/${walkInId}/rounds`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_r, _e, { walkInId }) => [{ type: 'WalkIn', id: walkInId }, 'WalkIn'],
    }),

    // HR: Update interview round
    updateInterviewRound: builder.mutation<any, { walkInId: string; roundId: string; data: any }>({
      query: ({ walkInId, roundId, data }) => ({
        url: `/walk-in/${walkInId}/rounds/${roundId}`,
        method: 'PATCH',
        body: data,
      }),
      invalidatesTags: (_r, _e, { walkInId }) => [{ type: 'WalkIn', id: walkInId }, 'WalkIn'],
    }),

    // HR: Delete interview round
    deleteInterviewRound: builder.mutation<any, { walkInId: string; roundId: string }>({
      query: ({ walkInId, roundId }) => ({
        url: `/walk-in/${walkInId}/rounds/${roundId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_r, _e, { walkInId }) => [{ type: 'WalkIn', id: walkInId }, 'WalkIn'],
    }),

    // HR: Convert to application
    convertWalkIn: builder.mutation<any, string>({
      query: (id) => ({
        url: `/walk-in/${id}/convert`,
        method: 'PATCH',
      }),
      invalidatesTags: ['WalkIn'],
    }),

    // HR: Delete walk-in
    deleteWalkIn: builder.mutation<any, string>({
      query: (id) => ({
        url: `/walk-in/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['WalkIn'],
    }),

    // HR: Hire walk-in candidate and send onboarding invite
    hireWalkIn: builder.mutation<any, { id: string; teamsEmail: string }>({
      query: ({ id, teamsEmail }) => ({
        url: `/walk-in/${id}/hire`,
        method: 'POST',
        body: { teamsEmail },
      }),
      invalidatesTags: ['WalkIn'],
    }),
  }),
});

export const {
  useGetWalkInJobsQuery,
  useRegisterWalkInMutation,
  useGetWalkInByTokenQuery,
  useLazyGetWalkInByTokenQuery,
  useGetTodayWalkInsQuery,
  useGetWalkInByIdQuery,
  useUpdateWalkInCandidateMutation,
  useUpdateWalkInStatusMutation,
  useAddWalkInNotesMutation,
  useAddInterviewRoundMutation,
  useUpdateInterviewRoundMutation,
  useDeleteInterviewRoundMutation,
  useConvertWalkInMutation,
  useDeleteWalkInMutation,
  useHireWalkInMutation,
} = walkInApi;
