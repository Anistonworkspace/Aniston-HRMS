import { api } from '../../app/api';

export const reportApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getHeadcount: builder.query<any, void>({
      query: () => '/reports/headcount',
      providesTags: ['Employee', 'Dashboard'],
    }),
    getAttendanceSummary: builder.query<
      any,
      { startDate?: string; endDate?: string; includePendingRegularizations?: boolean }
    >({
      query: (params) => ({ url: '/reports/attendance-summary', params }),
      providesTags: ['Attendance'],
    }),
    getLeaveSummary: builder.query<any, void>({
      query: () => '/reports/leave-summary',
      providesTags: ['Leave'],
    }),
    getPayrollSummary: builder.query<any, void>({
      query: () => '/reports/payroll-summary',
      providesTags: ['Payroll'],
    }),
    getRecruitmentFunnel: builder.query<any, void>({
      query: () => '/reports/recruitment-funnel',
      providesTags: ['Recruitment'],
    }),
    getAttendanceDetail: builder.query<
      any,
      { from?: string; to?: string; departmentId?: string; employeeId?: string; status?: string; page?: number; limit?: number }
    >({
      query: (params) => ({ url: '/reports/attendance-detail', params }),
      providesTags: ['Attendance'],
    }),
    getLeaveDetail: builder.query<
      any,
      { month?: number; year?: number; leaveTypeId?: string; status?: string; departmentId?: string; page?: number; limit?: number }
    >({
      query: (params) => ({ url: '/reports/leave-detail', params }),
      providesTags: ['Leave'],
    }),
  }),
});

export const {
  useGetHeadcountQuery,
  useGetAttendanceSummaryQuery,
  useGetLeaveSummaryQuery,
  useGetPayrollSummaryQuery,
  useGetRecruitmentFunnelQuery,
  useGetAttendanceDetailQuery,
  useGetLeaveDetailQuery,
} = reportApi;
