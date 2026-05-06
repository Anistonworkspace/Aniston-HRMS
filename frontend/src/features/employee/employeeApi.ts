import { api } from '../../app/api';
import type { ApiResponse, PaginationMeta, EmployeeListItem, EmployeeDetail, CreateEmployeeRequest } from '@aniston/shared';

interface EmployeeListResponse {
  success: boolean;
  data: EmployeeListItem[];
  meta: PaginationMeta;
}

interface EmployeeQuery {
  page?: number;
  limit?: number;
  search?: string;
  department?: string;
  designation?: string;
  role?: string;
  status?: string;
  workMode?: string;
  onboardingStatus?: string;
  managerId?: string;
  officeLocationId?: string;
  joiningDateFrom?: string;
  joiningDateTo?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

interface EmployeeStats {
  total: number;
  active: number;
  probation: number;
  inactive: number;
  onboarding: number;
  noticePeriod: number;
  terminated: number;
  invited: number;
}

export const employeeApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getEmployees: builder.query<EmployeeListResponse, EmployeeQuery>({
      query: (params) => ({
        url: '/employees',
        params,
      }),
      providesTags: ['EmployeeList'],
    }),

    getEmployeeStats: builder.query<{ success: boolean; data: EmployeeStats }, void>({
      query: () => '/employees/stats',
      providesTags: ['EmployeeList'],
    }),

    getEmployee: builder.query<ApiResponse<EmployeeDetail>, string>({
      query: (id) => `/employees/${id}`,
      providesTags: (result, error, id) => [{ type: 'Employee', id }],
    }),

    createEmployee: builder.mutation<ApiResponse<EmployeeDetail>, CreateEmployeeRequest>({
      query: (body) => ({
        url: '/employees',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['EmployeeList', 'Dashboard', 'Payroll'],
    }),

    updateEmployee: builder.mutation<ApiResponse<EmployeeDetail>, { id: string; data: Partial<CreateEmployeeRequest> }>({
      query: ({ id, data }) => ({
        url: `/employees/${id}`,
        method: 'PATCH',
        body: data,
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: 'Employee', id },
        'EmployeeList',
        'Payroll',
        'Dashboard',
      ],
    }),

    deleteEmployee: builder.mutation<ApiResponse<null>, string>({
      query: (id) => ({
        url: `/employees/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['EmployeeList', 'Dashboard'],
    }),

    inviteEmployee: builder.mutation<any, { email: string; firstName?: string; lastName?: string }>({
      query: (body) => ({
        url: '/employees/invite',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['EmployeeList', 'Dashboard'],
    }),

    getLifecycleEvents: builder.query<any, string>({
      query: (id) => `/employees/${id}/events`,
      providesTags: (result, error, id) => [{ type: 'Employee', id }],
    }),

    addLifecycleEvent: builder.mutation<any, { employeeId: string; data: any }>({
      query: ({ employeeId, data }) => ({
        url: `/employees/${employeeId}/events`,
        method: 'POST',
        body: data,
      }),
      invalidatesTags: (result, error, { employeeId }) => [{ type: 'Employee', id: employeeId }],
    }),

    deleteLifecycleEvent: builder.mutation<any, { employeeId: string; eventId: string }>({
      query: ({ employeeId, eventId }) => ({
        url: `/employees/${employeeId}/events/${eventId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (result, error, { employeeId }) => [{ type: 'Employee', id: employeeId }],
    }),

    changeEmployeeRole: builder.mutation<any, { employeeId: string; role: string }>({
      query: ({ employeeId, role }) => ({
        url: `/employees/${employeeId}/role`,
        method: 'PATCH',
        body: { role },
      }),
      invalidatesTags: (result, error, { employeeId }) => [{ type: 'Employee', id: employeeId }, 'EmployeeList'],
    }),

    sendActivationInvite: builder.mutation<any, string>({
      query: (employeeId) => ({
        url: `/employees/${employeeId}/send-activation-invite`,
        method: 'POST',
      }),
      invalidatesTags: (result, error, employeeId) => [{ type: 'Employee', id: employeeId }],
    }),

    updateEmployeeManager: builder.mutation<any, { id: string; managerId: string | null }>({
      query: ({ id, managerId }) => ({
        url: `/employees/${id}`,
        method: 'PATCH',
        body: { managerId },
      }),
      invalidatesTags: ['EmployeeList'],
    }),

    // Enhanced bulk email with custom subject/body/filters
    sendEnhancedBulkEmail: builder.mutation<
      { success: boolean; data: { queued: number; totalMatched: number }; message: string },
      {
        templateType: 'WELCOME' | 'PAYROLL_REMINDER' | 'ATTENDANCE_REMINDER' | 'ANNOUNCEMENT' | 'CUSTOM';
        subject: string;
        body: string;
        recipientFilter?: {
          departmentIds?: string[];
          designationIds?: string[];
          statuses?: string[];
          roles?: string[];
        };
        testEmail?: string;
      }
    >({
      query: (body) => ({
        url: '/employees/bulk-email',
        method: 'POST',
        body,
      }),
    }),

    // Preview recipient count for bulk email
    getBulkEmailPreview: builder.query<
      { success: boolean; data: { recipientCount: number } },
      { departmentIds?: string; designationIds?: string; statuses?: string; roles?: string }
    >({
      query: (params) => ({ url: '/employees/bulk-email/preview', params }),
    }),

    // Unified bulk email — multipart/form-data with optional attachments
    sendUnifiedBulkEmail: builder.mutation<
      { success: boolean; data: { queued: number; totalMatched?: number; sentCount?: number }; message: string },
      FormData
    >({
      query: (formData) => ({
        url: '/employees/unified-bulk-email',
        method: 'POST',
        body: formData,
      }),
    }),

    // Org Chart — full tree (no pagination)
    getOrgChart: builder.query<{ success: boolean; data: any[] }, void>({
      query: () => '/employees/org-chart',
      providesTags: ['EmployeeList'],
    }),

    // Lightweight peer list — accessible by all authenticated employees (for handover/backup selection)
    getEmployeePeers: builder.query<{ success: boolean; data: any[] }, void>({
      query: () => '/employees/peers',
      providesTags: ['EmployeeList'],
    }),

    // Bank branch name campaign — sends email to all employees missing bankBranchName
    sendBankBranchCampaign: builder.mutation<{ success: boolean; data: { sent: number; total: number; message: string } }, void>({
      query: () => ({ url: '/employees/bank-branch-campaign', method: 'POST' }),
    }),

    // HR verifies or revokes bank details for an employee
    verifyBankByHr: builder.mutation<{ success: boolean; data: { verified: boolean } }, { employeeId: string; verified: boolean }>({
      query: ({ employeeId, verified }) => ({ url: `/employees/${employeeId}/verify-bank`, method: 'POST', body: { verified } }),
      invalidatesTags: (_result, _err, { employeeId }) => [{ type: 'Employee', id: employeeId }],
    }),

    // Employee self-confirms or flags their own bank details
    confirmBankByEmployee: builder.mutation<{ success: boolean; data: { confirmed: boolean } }, { confirmed: boolean }>({
      query: ({ confirmed }) => ({ url: '/employees/me/confirm-bank', method: 'POST', body: { confirmed } }),
      invalidatesTags: ['Employee'],
    }),
  }),
});

export const {
  useGetEmployeesQuery,
  useGetEmployeeStatsQuery,
  useGetEmployeeQuery,
  useCreateEmployeeMutation,
  useUpdateEmployeeMutation,
  useDeleteEmployeeMutation,
  useInviteEmployeeMutation,
  useGetLifecycleEventsQuery,
  useAddLifecycleEventMutation,
  useDeleteLifecycleEventMutation,
  useChangeEmployeeRoleMutation,
  useSendActivationInviteMutation,
  useUpdateEmployeeManagerMutation,
  useSendBankBranchCampaignMutation,
  useSendEnhancedBulkEmailMutation,
  useGetBulkEmailPreviewQuery,
  useSendUnifiedBulkEmailMutation,
  useGetOrgChartQuery,
  useGetEmployeePeersQuery,
  useVerifyBankByHrMutation,
  useConfirmBankByEmployeeMutation,
} = employeeApi;
