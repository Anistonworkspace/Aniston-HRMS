import { api } from '../../app/api';
import type { ApiResponse, DashboardStats } from '@aniston/shared';

export const dashboardApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getDashboardStats: builder.query<ApiResponse<DashboardStats>, void>({
      query: () => '/dashboard/stats',
      providesTags: ['Dashboard'],
    }),
    getPendingApprovalsAll: builder.query<any, { search?: string; page?: number; limit?: number }>({
      query: (params) => ({ url: '/dashboard/pending-approvals', params }),
      providesTags: ['Dashboard'],
    }),
  }),
});

export const { useGetDashboardStatsQuery, useGetPendingApprovalsAllQuery } = dashboardApi;
