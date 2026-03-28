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
  status?: string;
  workMode?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
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
      invalidatesTags: ['EmployeeList', 'Dashboard'],
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
  }),
});

export const {
  useGetEmployeesQuery,
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
} = employeeApi;
