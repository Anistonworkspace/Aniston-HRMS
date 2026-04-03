import { api } from '../../app/api';
import type { ApiResponse, DashboardStats, SuperAdminDashboardStats, HRDashboardStats } from '@aniston/shared';

export interface DashboardSummaryResponse {
  success: boolean;
  role: 'SUPER_ADMIN' | 'HR' | 'EMPLOYEE';
  data: SuperAdminDashboardStats | HRDashboardStats | DashboardStats;
}

export const dashboardApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // Unified summary — returns role-appropriate data
    getDashboardSummary: builder.query<DashboardSummaryResponse, void>({
      query: () => '/dashboard/summary',
      providesTags: ['Dashboard'],
    }),
    // Role-specific endpoints (used by lazy-loaded components)
    getDashboardStats: builder.query<ApiResponse<DashboardStats>, void>({
      query: () => '/dashboard/stats',
      providesTags: ['Dashboard'],
    }),
    getSuperAdminStats: builder.query<ApiResponse<SuperAdminDashboardStats>, void>({
      query: () => '/dashboard/super-admin-stats',
      providesTags: ['Dashboard'],
    }),
    getHRStats: builder.query<ApiResponse<HRDashboardStats>, void>({
      query: () => '/dashboard/hr-stats',
      providesTags: ['Dashboard'],
    }),
    getPendingApprovalsAll: builder.query<any, { search?: string; page?: number; limit?: number }>({
      query: (params) => ({ url: '/dashboard/pending-approvals', params }),
      providesTags: ['Dashboard'],
    }),
  }),
});

export const {
  useGetDashboardSummaryQuery,
  useGetDashboardStatsQuery,
  useGetSuperAdminStatsQuery,
  useGetHRStatsQuery,
  useGetPendingApprovalsAllQuery,
} = dashboardApi;
