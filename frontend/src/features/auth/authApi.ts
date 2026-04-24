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
    forgotPassword: builder.mutation<ApiResponse<null>, { email: string }>({
      query: (body) => ({
        url: '/auth/forgot-password',
        method: 'POST',
        body,
      }),
    }),
    resetPassword: builder.mutation<ApiResponse<null>, { token: string; password: string; confirmPassword: string }>({
      query: (body) => ({
        url: '/auth/reset-password',
        method: 'POST',
        body,
      }),
    }),

    // ── MFA ─────────────────────────────────────────────────────────────────
    getMfaStatus: builder.query<ApiResponse<{ isEnabled: boolean; enabledAt: string | null }>, void>({
      query: () => '/auth/mfa/status',
      providesTags: ['MFA'],
    }),
    setupMfa: builder.mutation<ApiResponse<{ qrCode: string; secret: string; otpauthUrl: string; backupCodes: string[] }>, void>({
      query: () => ({ url: '/auth/mfa/setup', method: 'POST' }),
    }),
    verifyMfaSetup: builder.mutation<ApiResponse<{ message: string }>, { code: string }>({
      query: (body) => ({ url: '/auth/mfa/verify-setup', method: 'POST', body }),
      invalidatesTags: ['MFA'],
    }),
    verifyMfa: builder.mutation<ApiResponse<LoginResponse>, { tempToken: string; token: string }>({
      query: (body) => ({ url: '/auth/mfa/verify', method: 'POST', body }),
    }),
    disableMfa: builder.mutation<ApiResponse<{ message: string }>, { code: string }>({
      query: (body) => ({ url: '/auth/mfa/disable', method: 'POST', body }),
      invalidatesTags: ['MFA'],
    }),
    adminResetPassword: builder.mutation<ApiResponse<null>, { targetUserId: string }>({
      query: (body) => ({ url: '/auth/admin-reset-password', method: 'POST', body }),
    }),
  }),
});

export const {
  useLoginMutation,
  useLogoutMutation,
  useGetMeQuery,
  useChangePasswordMutation,
  useForgotPasswordMutation,
  useResetPasswordMutation,
  useGetMfaStatusQuery,
  useSetupMfaMutation,
  useVerifyMfaSetupMutation,
  useVerifyMfaMutation,
  useDisableMfaMutation,
  useAdminResetPasswordMutation,
} = authApi;
