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

    // Public: Get by token number
    getWalkInByToken: builder.query<any, string>({
      query: (token) => `/walk-in/token/${token}`,
    }),

    // HR: Get today's walk-ins
    getTodayWalkIns: builder.query<any, { page?: number; limit?: number; status?: string; date?: string; search?: string }>({
      query: (params) => ({ url: '/walk-in/today', params }),
      providesTags: ['WalkIn'],
    }),

    // HR: Get walk-in by ID
    getWalkInById: builder.query<any, string>({
      query: (id) => `/walk-in/${id}`,
      providesTags: ['WalkIn'],
    }),

    // HR: Update walk-in status
    updateWalkInStatus: builder.mutation<any, { id: string; status: string }>({
      query: ({ id, status }) => ({
        url: `/walk-in/${id}/status`,
        method: 'PATCH',
        body: { status },
      }),
      invalidatesTags: ['WalkIn'],
    }),

    // HR: Add notes
    addWalkInNotes: builder.mutation<any, { id: string; notes: string }>({
      query: ({ id, notes }) => ({
        url: `/walk-in/${id}/notes`,
        method: 'POST',
        body: { notes },
      }),
      invalidatesTags: ['WalkIn'],
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
  }),
});

export const {
  useGetWalkInJobsQuery,
  useRegisterWalkInMutation,
  useGetWalkInByTokenQuery,
  useGetTodayWalkInsQuery,
  useGetWalkInByIdQuery,
  useUpdateWalkInStatusMutation,
  useAddWalkInNotesMutation,
  useConvertWalkInMutation,
  useDeleteWalkInMutation,
} = walkInApi;
