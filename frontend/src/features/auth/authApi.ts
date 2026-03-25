import { api } from '../../app/api';
import type { ApiResponse, LoginRequest, LoginResponse, AuthUser } from '@aniston/shared';

export const authApi = api.injectEndpoints({
  endpoints: (builder) => ({
    login: builder.mutation<ApiResponse<LoginResponse>, LoginRequest>({
      query: (credentials) => ({
        url: '/auth/login',
        method: 'POST',
        body: credentials,
      }),
    }),
    logout: builder.mutation<ApiResponse<null>, void>({
      query: () => ({
        url: '/auth/logout',
        method: 'POST',
      }),
    }),
    getMe: builder.query<ApiResponse<AuthUser>, void>({
      query: () => '/auth/me',
    }),
    changePassword: builder.mutation<any, { currentPassword: string; newPassword: string }>({
      query: (body) => ({
        url: '/auth/change-password',
        method: 'POST',
        body,
      }),
    }),
    getSsoStatus: builder.query<ApiResponse<{ microsoftSsoEnabled: boolean }>, void>({
      query: () => '/auth/sso-status',
    }),
  }),
});

export const { useLoginMutation, useLogoutMutation, useGetMeQuery, useChangePasswordMutation, useGetSsoStatusQuery } = authApi;
