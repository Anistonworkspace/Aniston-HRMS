import { api } from '../../app/api';

export const reportApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getHeadcount: builder.query<any, void>({
      query: () => '/reports/headcount',
      providesTags: ['Employee', 'Dashboard'],
    }),
    getAttendanceSummary: builder.query<any, { startDate?: string; endDate?: string }>({
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
  }),
});

export const {
  useGetHeadcountQuery,
  useGetAttendanceSummaryQuery,
  useGetLeaveSummaryQuery,
  useGetPayrollSummaryQuery,
  useGetRecruitmentFunnelQuery,
} = reportApi;
