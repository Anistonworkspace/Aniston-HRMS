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
  }),
});

export const {
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
} = payrollApi;
