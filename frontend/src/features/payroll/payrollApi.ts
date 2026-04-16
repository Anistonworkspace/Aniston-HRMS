import { api } from '../../app/api';

export const payrollApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getPayrollRuns: builder.query<any, void>({
      query: () => '/payroll/runs',
      providesTags: ['Payroll'],
    }),

    createPayrollRun: builder.mutation<any, { month: number; year: number }>({
      query: (body) => ({ url: '/payroll/runs', method: 'POST', body }),
      invalidatesTags: ['Payroll'],
    }),

    processPayroll: builder.mutation<any, string>({
      query: (id) => ({ url: `/payroll/runs/${id}/process`, method: 'POST' }),
      invalidatesTags: ['Payroll'],
    }),

    getPayrollRecords: builder.query<any, string>({
      query: (runId) => `/payroll/runs/${runId}/records`,
      providesTags: ['Payroll'],
    }),

    getMyPayslips: builder.query<any, { month?: number; year?: number } | void>({
      query: (params) => ({
        url: '/payroll/my-payslips',
        params: params || undefined,
      }),
      providesTags: ['Payroll'],
    }),

    getSalaryStructure: builder.query<any, string>({
      query: (employeeId) => `/payroll/salary-structure/${employeeId}`,
      providesTags: ['Payroll'],
    }),

    saveSalaryStructure: builder.mutation<any, { employeeId: string; data: any }>({
      query: ({ employeeId, data }) => ({
        url: `/payroll/salary-structure/${employeeId}`,
        method: 'POST',
        body: data,
      }),
      invalidatesTags: ['Payroll'],
    }),

    amendPayrollRecord: builder.mutation<any, { recordId: string; data: any }>({
      query: ({ recordId, data }) => ({
        url: `/payroll/records/${recordId}/amend`,
        method: 'PATCH',
        body: data,
      }),
      invalidatesTags: ['Payroll'],
    }),

    getSalaryHistory: builder.query<any, string>({
      query: (employeeId) => `/payroll/salary-history/${employeeId}`,
      providesTags: ['Payroll'],
    }),

    detectAnomalies: builder.mutation<any, string>({
      query: (runId) => ({ url: `/payroll/ai-anomaly-check/${runId}`, method: 'POST' }),
    }),

    importSalaries: builder.mutation<any, FormData>({
      query: (formData) => ({
        url: '/payroll/import',
        method: 'POST',
        body: formData,
      }),
      invalidatesTags: ['Payroll'],
    }),

    lockPayrollRun: builder.mutation<any, string>({
      query: (id) => ({ url: `/payroll/runs/${id}/lock`, method: 'POST' }),
      invalidatesTags: ['Payroll'],
    }),

    unlockPayrollRun: builder.mutation<any, string>({
      query: (id) => ({ url: `/payroll/runs/${id}/unlock`, method: 'POST' }),
      invalidatesTags: ['Payroll'],
    }),

    saveSalaryStructureDynamic: builder.mutation<any, { employeeId: string; data: any }>({
      query: ({ employeeId, data }) => ({
        url: `/payroll/employee/${employeeId}/salary`,
        method: 'PUT',
        body: data,
      }),
      invalidatesTags: ['Payroll', 'Employee'],
    }),

    sendPayrollEmail: builder.mutation<any, string>({
      query: (runId) => ({ url: `/payroll/runs/${runId}/send-email`, method: 'POST' }),
    }),

    // Pre-flight check before processing payroll
    getPayrollPreflight: builder.query<any, void>({
      query: () => '/payroll/preflight',
      providesTags: ['Payroll'],
    }),

    // Payroll deletion requests
    requestPayrollDeletion: builder.mutation<any, { payrollRunId: string; reason: string; notes?: string }>({
      query: (body) => ({ url: '/payroll-deletion-requests', method: 'POST', body }),
      invalidatesTags: ['Payroll'],
    }),

    getPayrollDeletionRequests: builder.query<any, { status?: string } | void>({
      query: (params) => ({ url: '/payroll-deletion-requests', params: params || {} }),
      providesTags: ['Payroll'],
    }),

    approvePayrollDeletion: builder.mutation<any, string>({
      query: (id) => ({ url: `/payroll-deletion-requests/${id}/approve`, method: 'POST' }),
      invalidatesTags: ['Payroll'],
    }),

    rejectPayrollDeletion: builder.mutation<any, { id: string; rejectionReason?: string }>({
      query: ({ id, ...body }) => ({ url: `/payroll-deletion-requests/${id}/reject`, method: 'POST', body }),
      invalidatesTags: ['Payroll'],
    }),

    dismissPayrollDeletion: builder.mutation<any, string>({
      query: (id) => ({ url: `/payroll-deletion-requests/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Payroll'],
    }),
  }),
});

export const {
  useGetPayrollPreflightQuery,
  useGetPayrollRunsQuery,
  useCreatePayrollRunMutation,
  useProcessPayrollMutation,
  useGetPayrollRecordsQuery,
  useGetMyPayslipsQuery,
  useGetSalaryStructureQuery,
  useSaveSalaryStructureMutation,
  useAmendPayrollRecordMutation,
  useGetSalaryHistoryQuery,
  useDetectAnomaliesMutation,
  useImportSalariesMutation,
  useLockPayrollRunMutation,
  useUnlockPayrollRunMutation,
  useSaveSalaryStructureDynamicMutation,
  useSendPayrollEmailMutation,
  useRequestPayrollDeletionMutation,
  useGetPayrollDeletionRequestsQuery,
  useApprovePayrollDeletionMutation,
  useRejectPayrollDeletionMutation,
  useDismissPayrollDeletionMutation,
} = payrollApi;
