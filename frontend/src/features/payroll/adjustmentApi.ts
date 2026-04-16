import { api } from '../../app/api';

export const adjustmentApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getRunAdjustments: builder.query<any, string>({
      query: (runId) => `/payroll-adjustments/run/${runId}`,
      providesTags: ['Payroll'],
    }),

    // Employees eligible for adjustment on a given run (needed for DRAFT runs where no records exist)
    getRunEligibleEmployees: builder.query<any, string>({
      query: (runId) => `/payroll-adjustments/run/${runId}/employees`,
      providesTags: ['Payroll'],
    }),

    getEmployeeAdjustments: builder.query<any, { employeeId: string; runId?: string }>({
      query: ({ employeeId, runId }) => ({
        url: `/payroll-adjustments/employee/${employeeId}`,
        params: runId ? { runId } : undefined,
      }),
      providesTags: ['Payroll'],
    }),

    createAdjustment: builder.mutation<any, {
      payrollRunId: string; employeeId: string;
      type: string; componentName: string;
      amount: number; isDeduction: boolean; reason: string;
    }>({
      query: (body) => ({ url: '/payroll-adjustments', method: 'POST', body }),
      invalidatesTags: ['Payroll'],
    }),

    bulkCreateAdjustments: builder.mutation<any, {
      payrollRunId: string;
      adjustments: Array<{
        employeeId: string; type: string; componentName: string;
        amount: number; isDeduction: boolean; reason: string;
      }>;
    }>({
      query: (body) => ({ url: '/payroll-adjustments/bulk', method: 'POST', body }),
      invalidatesTags: ['Payroll'],
    }),

    approveAdjustment: builder.mutation<any, { id: string; status: 'APPROVED' | 'REJECTED' }>({
      query: ({ id, status }) => ({
        url: `/payroll-adjustments/${id}/approve`,
        method: 'PATCH',
        body: { status },
      }),
      invalidatesTags: ['Payroll'],
    }),

    deleteAdjustment: builder.mutation<any, string>({
      query: (id) => ({ url: `/payroll-adjustments/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Payroll'],
    }),
  }),
});

export const {
  useGetRunAdjustmentsQuery,
  useGetRunEligibleEmployeesQuery,
  useGetEmployeeAdjustmentsQuery,
  useCreateAdjustmentMutation,
  useBulkCreateAdjustmentsMutation,
  useApproveAdjustmentMutation,
  useDeleteAdjustmentMutation,
} = adjustmentApi;
