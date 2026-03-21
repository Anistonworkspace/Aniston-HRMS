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
    }),

    getMyPayslips: builder.query<any, void>({
      query: () => '/payroll/my-payslips',
      providesTags: ['Payroll'],
    }),

    getSalaryStructure: builder.query<any, string>({
      query: (employeeId) => `/payroll/salary-structure/${employeeId}`,
    }),

    saveSalaryStructure: builder.mutation<any, { employeeId: string; data: any }>({
      query: ({ employeeId, data }) => ({
        url: `/payroll/salary-structure/${employeeId}`,
        method: 'POST',
        body: data,
      }),
      invalidatesTags: ['Payroll'],
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
} = payrollApi;
