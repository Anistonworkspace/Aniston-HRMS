import { api } from '../../app/api';

export interface CrashReport {
  id: string;
  type: string;
  message: string;
  stack?: string;
  context?: string;
  appVersion?: string;
  platform?: string;
  osVersion?: string;
  device?: string;
  ipAddress?: string;
  employeeId?: string;
  organizationId: string;
  createdAt: string;
  employee?: { employeeCode: string; user: { name: string } } | null;
}

export interface CrashStats {
  total: number;
  last24h: number;
  last7d: number;
  byType: { type: string; _count: { id: number } }[];
}

export const crashReportApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getCrashReports: builder.query<{ data: CrashReport[]; meta: any }, { page?: number; limit?: number }>({
      query: ({ page = 1, limit = 50 } = {}) => `/crash-reports?page=${page}&limit=${limit}`,
      providesTags: ['CrashReport' as any],
    }),
    getCrashStats: builder.query<{ data: CrashStats }, void>({
      query: () => '/crash-reports/stats',
      providesTags: ['CrashReport' as any],
    }),
    deleteCrashReport: builder.mutation<any, string>({
      query: (id) => ({ url: `/crash-reports/${id}`, method: 'DELETE' }),
      invalidatesTags: ['CrashReport' as any],
    }),
    clearAllCrashReports: builder.mutation<any, void>({
      query: () => ({ url: '/crash-reports', method: 'DELETE' }),
      invalidatesTags: ['CrashReport' as any],
    }),
  }),
});

export const {
  useGetCrashReportsQuery,
  useGetCrashStatsQuery,
  useDeleteCrashReportMutation,
  useClearAllCrashReportsMutation,
} = crashReportApi;
