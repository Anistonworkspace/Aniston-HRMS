import { api } from '../../app/api';
import type { ApiResponse, DashboardStats, SuperAdminDashboardStats, HRDashboardStats } from '@aniston/shared';

export const dashboardApi = api.injectEndpoints({
  endpoints: (builder) => ({
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
  useGetDashboardStatsQuery,
  useGetSuperAdminStatsQuery,
  useGetHRStatsQuery,
  useGetPendingApprovalsAllQuery,
} = dashboardApi;
