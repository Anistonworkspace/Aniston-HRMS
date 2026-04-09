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

    previewLeave: builder.mutation<any, {
      leaveTypeId: string;
      startDate: string;
      endDate: string;
      isHalfDay: boolean;
      halfDaySession?: string;
    }>({
      query: (body) => ({ url: '/leaves/preview', method: 'POST', body }),
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

    handleLeaveAction: builder.mutation<any, { id: string; action: string; remarks?: string; conditionNote?: string }>({
      query: ({ id, ...body }) => ({ url: `/leaves/${id}/action`, method: 'PATCH', body }),
      invalidatesTags: (result, error, { id }) => [
        { type: 'Leave' as const, id },
        'Leave',
        'LeaveBalance',
        'Dashboard',
      ],
    }),

    getHolidays: builder.query<any, { year?: number }>({
      query: (params) => ({ url: '/leaves/holidays', params }),
      providesTags: ['Leave'],
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

    // Holiday CRUD (via /api/holidays)
    createHoliday: builder.mutation<any, any>({
      query: (body) => ({ url: '/holidays', method: 'POST', body }),
      invalidatesTags: ['Leave', 'Dashboard'],
    }),
    bulkCreateHolidays: builder.mutation<any, { holidays: any[] }>({
      query: (body) => ({ url: '/holidays/bulk', method: 'POST', body }),
      invalidatesTags: ['Leave', 'Dashboard'],
    }),
    updateHoliday: builder.mutation<any, { id: string; data: any }>({
      query: ({ id, data }) => ({ url: `/holidays/${id}`, method: 'PATCH', body: data }),
      invalidatesTags: ['Leave', 'Dashboard'],
    }),
    deleteHoliday: builder.mutation<any, string>({
      query: (id) => ({ url: `/holidays/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Leave', 'Dashboard'],
    }),
    getHolidaySuggestions: builder.query<any, { year?: number }>({
      query: (params) => ({ url: '/holidays/suggestions', params }),
    }),

    // ── Leave Impact Flow ──

    saveDraft: builder.mutation<any, {
      leaveTypeId: string; startDate: string; endDate: string;
      isHalfDay?: boolean; halfDaySession?: string; reason?: string; attachmentUrl?: string;
    }>({
      query: (body) => ({ url: '/leaves/draft', method: 'POST', body }),
      invalidatesTags: ['Leave'],
    }),

    submitDraft: builder.mutation<any, { id: string; acknowledgements?: { reviewedTasks: boolean; assignedHandover: boolean; acceptedVisibility: boolean } }>({
      query: ({ id, ...body }) => ({ url: `/leaves/${id}/submit`, method: 'POST', body }),
      invalidatesTags: (result, error, { id }) => [
        { type: 'Leave' as const, id },
        'Leave',
        'LeaveBalance',
        'Dashboard',
      ],
    }),

    getLeaveDetail: builder.query<any, string>({
      query: (id) => `/leaves/${id}/detail`,
      providesTags: (result, error, id) => [{ type: 'Leave' as const, id }],
    }),

    getManagerReview: builder.query<any, string>({
      query: (id) => `/leaves/${id}/manager-review`,
      providesTags: (result, error, id) => [{ type: 'Leave' as const, id }, 'Leave'],
    }),

    getHrReview: builder.query<any, string>({
      query: (id) => `/leaves/${id}/hr-review`,
      providesTags: (result, error, id) => [{ type: 'Leave' as const, id }, 'Leave'],
    }),

    updateHandover: builder.mutation<any, { id: string; backupEmployeeId: string; handoverNotes?: string; taskHandovers?: any[] }>({
      query: ({ id, ...body }) => ({ url: `/leaves/${id}/handover`, method: 'PATCH', body }),
      invalidatesTags: ['Leave'],
    }),

    getLeaveAudit: builder.query<any, string>({
      query: (id) => `/leaves/${id}/audit`,
      providesTags: ['Leave'],
    }),
  }),
});

export const {
  useGetLeaveTypesQuery,
  useGetLeaveBalancesQuery,
  useApplyLeaveMutation,
  usePreviewLeaveMutation,
  useGetMyLeavesQuery,
  useCancelLeaveMutation,
  useGetPendingApprovalsQuery,
  useHandleLeaveActionMutation,
  useGetHolidaysQuery,
  useCreateLeaveTypeMutation,
  useUpdateLeaveTypeMutation,
  useDeleteLeaveTypeMutation,
  useCreateHolidayMutation,
  useBulkCreateHolidaysMutation,
  useUpdateHolidayMutation,
  useDeleteHolidayMutation,
  useGetHolidaySuggestionsQuery,
  // Leave Impact Flow
  useSaveDraftMutation,
  useSubmitDraftMutation,
  useGetLeaveDetailQuery,
  useGetManagerReviewQuery,
  useGetHrReviewQuery,
  useUpdateHandoverMutation,
  useGetLeaveAuditQuery,
} = leaveApi;
