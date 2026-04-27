import { api } from '../../app/api';

export const exitApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // ── HR-facing list & detail ──────────────────────────────────────────────
    getExitRequests: builder.query<any, { page?: number; status?: string; department?: string }>({
      query: (params) => ({ url: '/employees/exit-requests', params }),
      providesTags: ['Exit'],
    }),
    getExitDetails: builder.query<any, string>({
      query: (id) => `/employees/${id}/exit-details`,
      providesTags: ['Exit'],
    }),

    // ── Resignation lifecycle ────────────────────────────────────────────────
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

    // ── Exit Access Config ───────────────────────────────────────────────────
    getExitAccessConfig: builder.query<any, string>({
      query: (employeeId) => `/exit-access/${employeeId}`,
      providesTags: ['Exit'],
    }),
    saveExitAccessConfig: builder.mutation<any, { employeeId: string; body: Record<string, any> }>({
      query: ({ employeeId, body }) => ({ url: `/exit-access/${employeeId}`, method: 'POST', body }),
      invalidatesTags: ['Exit'],
    }),
    revokeExitAccess: builder.mutation<any, string>({
      query: (employeeId) => ({ url: `/exit-access/${employeeId}`, method: 'DELETE' }),
      invalidatesTags: ['Exit'],
    }),

    // ── Last Working Day ─────────────────────────────────────────────────────
    setLastWorkingDay: builder.mutation<any, { id: string; lastWorkingDate: string }>({
      query: ({ id, lastWorkingDate }) => ({
        url: `/exit/${id}/last-working-day`,
        method: 'PATCH',
        body: { lastWorkingDate },
      }),
      invalidatesTags: ['Exit'],
    }),

    // ── Handover ─────────────────────────────────────────────────────────────
    getHandoverData: builder.query<any, string>({
      query: (id) => `/exit/${id}/handover`,
      providesTags: ['Exit'],
    }),
    addHandoverTask: builder.mutation<any, { id: string; body: { title: string; description?: string; category?: string; assignedToId?: string; dueDate?: string } }>({
      query: ({ id, body }) => ({ url: `/exit/${id}/handover`, method: 'POST', body }),
      invalidatesTags: ['Exit'],
    }),
    updateHandoverTask: builder.mutation<any, { taskId: string; body: Record<string, any> }>({
      query: ({ taskId, body }) => ({ url: `/exit/handover/${taskId}`, method: 'PATCH', body }),
      invalidatesTags: ['Exit'],
    }),
    deleteHandoverTask: builder.mutation<any, string>({
      query: (taskId) => ({ url: `/exit/handover/${taskId}`, method: 'DELETE' }),
      invalidatesTags: ['Exit'],
    }),

    // ── Full & Final ─────────────────────────────────────────────────────────
    getFnFDetails: builder.query<any, string>({
      query: (id) => `/exit/${id}/fnf`,
      providesTags: ['Exit'],
    }),
    generateExperienceLetter: builder.mutation<any, string>({
      query: (id) => ({ url: `/exit/${id}/fnf/experience-letter`, method: 'POST' }),
      invalidatesTags: ['Exit'],
    }),

    // ── IT Offboarding Checklist ─────────────────────────────────────────────
    getITChecklist: builder.query<any, string>({
      query: (employeeId) => `/exit/${employeeId}/it-checklist`,
      providesTags: ['Exit'],
    }),
    updateITChecklist: builder.mutation<any, { employeeId: string; field: string; value: boolean; notes?: string }>({
      query: ({ employeeId, ...body }) => ({ url: `/exit/${employeeId}/it-checklist`, method: 'PATCH', body }),
      invalidatesTags: ['Exit'],
    }),
    saveITNotes: builder.mutation<any, { employeeId: string; notes: string }>({
      query: ({ employeeId, notes }) => ({ url: `/exit/${employeeId}/it-checklist/notes`, method: 'PATCH', body: { notes } }),
      invalidatesTags: ['Exit'],
    }),

    // ── Exit Interview ────────────────────────────────────────────────────────
    getExitInterview: builder.query<any, string>({
      query: (employeeId) => `/exit/${employeeId}/exit-interview`,
      providesTags: ['Exit'],
    }),
    saveExitInterview: builder.mutation<any, { employeeId: string; body: Record<string, any> }>({
      query: ({ employeeId, body }) => ({ url: `/exit/${employeeId}/exit-interview`, method: 'POST', body }),
      invalidatesTags: ['Exit'],
    }),

    // ── Employee Self-Service ─────────────────────────────────────────────────
    getMyExitStatus: builder.query<any, void>({
      query: () => '/exit/me',
      providesTags: ['Exit'],
    }),
    confirmAssetReturn: builder.mutation<any, { itemId: string; employeeNotes?: string }>({
      query: ({ itemId, employeeNotes }) => ({
        url: `/exit/me/confirm-return/${itemId}`,
        method: 'POST',
        body: { employeeNotes },
      }),
      invalidatesTags: ['Exit'],
    }),
    undoAssetReturnConfirmation: builder.mutation<any, string>({
      query: (itemId) => ({ url: `/exit/me/confirm-return/${itemId}`, method: 'DELETE' }),
      invalidatesTags: ['Exit'],
    }),
  }),
});

export const {
  useGetITChecklistQuery,
  useUpdateITChecklistMutation,
  useSaveITNotesMutation,
  useGetExitInterviewQuery,
  useSaveExitInterviewMutation,
  useGetExitRequestsQuery,
  useGetExitDetailsQuery,
  useSubmitResignationMutation,
  useApproveExitMutation,
  useCompleteExitMutation,
  useWithdrawResignationMutation,
  useInitiateTerminationMutation,
  useReturnAssetForExitMutation,
  useGetExitAccessConfigQuery,
  useSaveExitAccessConfigMutation,
  useRevokeExitAccessMutation,
  useSetLastWorkingDayMutation,
  useGetHandoverDataQuery,
  useAddHandoverTaskMutation,
  useUpdateHandoverTaskMutation,
  useDeleteHandoverTaskMutation,
  useGetFnFDetailsQuery,
  useGenerateExperienceLetterMutation,
  useGetMyExitStatusQuery,
  useConfirmAssetReturnMutation,
  useUndoAssetReturnConfirmationMutation,
} = exitApi;
