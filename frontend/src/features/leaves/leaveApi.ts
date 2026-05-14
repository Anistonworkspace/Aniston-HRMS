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
      providesTags: ['Leave', 'Holiday'],
    }),

    createLeaveType: builder.mutation<any, any>({
      query: (body) => ({ url: '/leaves/types', method: 'POST', body }),
      invalidatesTags: ['Leave', 'LeaveBalance'],
    }),

    updateLeaveType: builder.mutation<any, { id: string; data: any }>({
      query: ({ id, data }) => ({ url: `/leaves/types/${id}`, method: 'PATCH', body: data }),
      invalidatesTags: ['Leave', 'LeaveBalance'],
    }),

    deleteLeaveType: builder.mutation<any, string>({
      query: (id) => ({ url: `/leaves/types/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Leave', 'LeaveBalance'],
    }),

    // Holiday CRUD (via /api/holidays)
    createHoliday: builder.mutation<any, any>({
      query: (body) => ({ url: '/holidays', method: 'POST', body }),
      invalidatesTags: ['Leave', 'Holiday', 'Dashboard'],
    }),
    bulkCreateHolidays: builder.mutation<any, { holidays: any[] }>({
      query: (body) => ({ url: '/holidays/bulk', method: 'POST', body }),
      invalidatesTags: ['Leave', 'Holiday', 'Dashboard'],
    }),
    updateHoliday: builder.mutation<any, { id: string; data: any }>({
      query: ({ id, data }) => ({ url: `/holidays/${id}`, method: 'PATCH', body: data }),
      invalidatesTags: ['Leave', 'Holiday', 'Dashboard'],
    }),
    deleteHoliday: builder.mutation<any, string>({
      query: (id) => ({ url: `/holidays/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Leave', 'Holiday', 'Dashboard'],
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

    getDraftsCount: builder.query<any, void>({
      query: () => '/leaves/drafts-count',
      providesTags: ['Leave'],
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

    updateHandover: builder.mutation<any, { id: string; backupEmployeeId?: string; handoverNotes?: string; taskHandovers?: any[] }>({
      query: ({ id, ...body }) => ({ url: `/leaves/${id}/handover`, method: 'PATCH', body }),
      invalidatesTags: ['Leave'],
    }),

    getLeaveAudit: builder.query<any, string>({
      query: (id) => `/leaves/${id}/audit`,
      providesTags: ['Leave'],
    }),

    // All leaves (admin view with status filter — for Approved/Rejected/All tabs)
    getAllLeaves: builder.query<any, { page?: number; limit?: number; status?: string; year?: number }>({
      query: (params) => ({ url: '/leaves/all', params }),
      providesTags: ['Leave'],
    }),

    // All employees' leave balances + applied leave summary (HR view)
    getAllEmployeeLeaveBalances: builder.query<any, { year?: number; search?: string }>({
      query: (params) => ({ url: '/leaves/employee-balances', params }),
      providesTags: ['Leave', 'LeaveBalance'],
    }),

    // Single employee full leave overview: balances + all requests for year
    getEmployeeLeaveOverview: builder.query<any, { employeeId: string; year?: number }>({
      query: ({ employeeId, year }) => ({ url: `/leaves/employee-overview/${employeeId}`, params: year ? { year } : {} }),
      providesTags: (result, error, { employeeId }) => [{ type: 'Leave' as const, id: employeeId }, 'LeaveBalance'],
    }),

    // Org-level leave settings (working days)
    getOrgLeaveSettings: builder.query<{ workingDays: string }, void>({
      query: () => '/leaves/org-settings',
      providesTags: ['Leave'],
    }),
    updateOrgLeaveSettings: builder.mutation<any, { workingDays: string }>({
      query: (body) => ({ url: '/leaves/org-settings', method: 'PATCH', body }),
      invalidatesTags: ['Leave'],
    }),

    // HR: manually adjust an employee's leave balance allocation
    adjustLeaveBalance: builder.mutation<any, { employeeId: string; leaveTypeId: string; allocated: number; year?: number; reason?: string }>({
      query: ({ employeeId, leaveTypeId, ...body }) => ({
        url: `/leaves/balance/${employeeId}/${leaveTypeId}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['LeaveBalance', 'Leave'],
    }),

    // Leave Policy CRUD
    getLeavePolicies: builder.query<any, void>({
      query: () => '/leaves/policies',
      providesTags: ['Leave'],
    }),
    createLeavePolicy: builder.mutation<any, any>({
      query: (body) => ({ url: '/leaves/policies', method: 'POST', body }),
      invalidatesTags: ['Leave', 'LeaveBalance'],
    }),
    updateLeavePolicy: builder.mutation<any, { id: string; data: any }>({
      query: ({ id, data }) => ({ url: `/leaves/policies/${id}`, method: 'PATCH', body: data }),
      invalidatesTags: ['Leave', 'LeaveBalance'],
    }),
    deleteLeavePolicy: builder.mutation<any, string>({
      query: (id) => ({ url: `/leaves/policies/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Leave', 'LeaveBalance'],
    }),
    recalculatePolicyAllocations: builder.mutation<any, { id: string; year?: number }>({
      query: ({ id, year }) => ({ url: `/leaves/policies/${id}/recalculate`, method: 'POST', body: { year } }),
      invalidatesTags: ['LeaveBalance', 'Leave'],
    }),

    recalculateEmployeeAllocation: builder.mutation<any, { employeeId: string; year?: number }>({
      query: ({ employeeId, year }) => ({ url: `/leaves/recalculate-employee/${employeeId}`, method: 'POST', body: year ? { year } : {} }),
      invalidatesTags: (result, error, { employeeId }) => [
        { type: 'Leave' as const, id: employeeId },
        { type: 'LeaveBalance' as const, id: employeeId },
        'LeaveBalance',
        'Leave',
      ],
    }),

    // Employee leave adjustments (manual previous-used + balance corrections)
    getEmployeeAdjustments: builder.query<any, { employeeId: string; year?: number }>({
      query: ({ employeeId, year }) => ({ url: `/leaves/adjustments/${employeeId}`, params: year ? { year } : {} }),
      providesTags: (result, error, { employeeId }) => [{ type: 'LeaveBalance' as const, id: employeeId }, 'LeaveBalance'],
    }),
    submitConditionResponse: builder.mutation<any, { id: string; response: string }>({
      query: ({ id, response }) => ({ url: `/leaves/${id}/condition-response`, method: 'POST', body: { response } }),
      invalidatesTags: (result, error, { id }) => [{ type: 'Leave' as const, id }, 'Leave'],
    }),

    postConditionMessage: builder.mutation<any, { id: string; message: string; senderRole: 'HR' | 'EMPLOYEE' }>({
      query: ({ id, message, senderRole }) => ({ url: `/leaves/${id}/condition-message`, method: 'POST', body: { message, senderRole } }),
      invalidatesTags: ['Leave', 'LeaveApproval'],
    }),

    resolveConditionalLeave: builder.mutation<any, { id: string; action: 'APPROVE' | 'REJECT'; remarks?: string }>({
      query: ({ id, action, remarks }) => ({ url: `/leaves/${id}/resolve-condition`, method: 'POST', body: { action, remarks } }),
      invalidatesTags: ['Leave', 'LeaveApproval', 'LeaveBalance'],
    }),

    createEmployeeAdjustment: builder.mutation<any, {
      employeeId: string;
      adjustmentType: 'PREVIOUS_USED' | 'BALANCE_CORRECTION';
      leaveTypeId: string;
      year?: number;
      days: number;
      reason: string;
      effectiveDate?: string;
    }>({
      query: ({ employeeId, ...body }) => ({ url: `/leaves/adjustments/${employeeId}`, method: 'POST', body }),
      invalidatesTags: (result, error, { employeeId }) => [
        { type: 'Leave' as const, id: employeeId },     // triggers getEmployeeLeaveOverview refetch
        { type: 'LeaveBalance' as const, id: employeeId },
        'LeaveBalance',
        'Leave',
      ],
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
  useGetDraftsCountQuery,
  useGetLeaveDetailQuery,
  useGetManagerReviewQuery,
  useGetHrReviewQuery,
  useUpdateHandoverMutation,
  useGetLeaveAuditQuery,
  useGetAllLeavesQuery,
  useGetAllEmployeeLeaveBalancesQuery,
  useGetEmployeeLeaveOverviewQuery,
  useGetOrgLeaveSettingsQuery,
  useUpdateOrgLeaveSettingsMutation,
  useAdjustLeaveBalanceMutation,
  // Leave Policy
  useGetLeavePoliciesQuery,
  useCreateLeavePolicyMutation,
  useUpdateLeavePolicyMutation,
  useDeleteLeavePolicyMutation,
  useRecalculatePolicyAllocationsMutation,
  // Adjustments
  useGetEmployeeAdjustmentsQuery,
  useCreateEmployeeAdjustmentMutation,
  useRecalculateEmployeeAllocationMutation,
  // Condition Response
  useSubmitConditionResponseMutation,
  usePostConditionMessageMutation,
  useResolveConditionalLeaveMutation,
} = leaveApi;
