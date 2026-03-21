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
  }),
});

export const {
  useGetEmployeesQuery,
  useGetEmployeeQuery,
  useCreateEmployeeMutation,
  useUpdateEmployeeMutation,
  useDeleteEmployeeMutation,
} = employeeApi;
