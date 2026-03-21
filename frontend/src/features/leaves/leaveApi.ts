import { api } from '../../app/api';

export const leaveApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getLeaveTypes: builder.query<any, void>({
      query: () => '/leaves/types',
    }),

    getLeaveBalances: builder.query<any, void>({
      query: () => '/leaves/balances',
      providesTags: ['LeaveBalance'],
    }),

    applyLeave: builder.mutation<any, {
      leaveTypeId: string;
      startDate: string;
      endDate: string;
      isHalfDay?: boolean;
      halfDaySession?: string;
      reason: string;
    }>({
      query: (body) => ({ url: '/leaves/apply', method: 'POST', body }),
      invalidatesTags: ['Leave', 'LeaveBalance', 'Dashboard'],
    }),

    getMyLeaves: builder.query<any, { page?: number; limit?: number; status?: string }>({
      query: (params) => ({ url: '/leaves/my', params }),
      providesTags: ['Leave'],
    }),

    cancelLeave: builder.mutation<any, string>({
      query: (id) => ({ url: `/leaves/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Leave', 'LeaveBalance'],
    }),

    getPendingApprovals: builder.query<any, { page?: number; limit?: number }>({
      query: (params) => ({ url: '/leaves/approvals', params }),
      providesTags: ['Leave'],
    }),

    handleLeaveAction: builder.mutation<any, { id: string; action: string; remarks?: string }>({
      query: ({ id, ...body }) => ({ url: `/leaves/${id}/action`, method: 'PATCH', body }),
      invalidatesTags: ['Leave', 'LeaveBalance', 'Dashboard'],
    }),

    getHolidays: builder.query<any, { year?: number }>({
      query: (params) => ({ url: '/leaves/holidays', params }),
    }),
  }),
});

export const {
  useGetLeaveTypesQuery,
  useGetLeaveBalancesQuery,
  useApplyLeaveMutation,
  useGetMyLeavesQuery,
  useCancelLeaveMutation,
  useGetPendingApprovalsQuery,
  useHandleLeaveActionMutation,
  useGetHolidaysQuery,
} = leaveApi;
