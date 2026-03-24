import { api } from '../../app/api';

export const leaveApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getLeaveTypes: builder.query<any, void>({
      query: () => '/leaves/types',
      providesTags: ['Leave'],
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

    createLeaveType: builder.mutation<any, any>({
      query: (body) => ({ url: '/leaves/types', method: 'POST', body }),
      invalidatesTags: ['Leave'],
    }),

    updateLeaveType: builder.mutation<any, { id: string; data: any }>({
      query: ({ id, data }) => ({ url: `/leaves/types/${id}`, method: 'PATCH', body: data }),
      invalidatesTags: ['Leave'],
    }),

    deleteLeaveType: builder.mutation<any, string>({
      query: (id) => ({ url: `/leaves/types/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Leave'],
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
  useCreateLeaveTypeMutation,
  useUpdateLeaveTypeMutation,
  useDeleteLeaveTypeMutation,
} = leaveApi;
