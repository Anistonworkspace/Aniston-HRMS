import { api } from '../../app/api';

interface DepartmentItem {
  id: string;
  name: string;
  slug?: string;
  code?: string;
  description?: string;
  isActive: boolean;
  parentDepartmentId?: string | null;
  parentDepartment?: { id: string; name: string } | null;
  _count?: { employees: number; designations: number };
  head?: { id: string; firstName: string; lastName: string } | null;
}

interface DesignationItem {
  id: string;
  name: string;
  slug?: string;
  code?: string;
  level?: number | null;
  levelBand?: string | null;
  description?: string;
  departmentId?: string | null;
  department?: { id: string; name: string } | null;
  isActive: boolean;
  _count?: { employees: number };
}

interface CreateDepartmentInput {
  name: string;
  code?: string;
  description?: string;
  headId?: string | null;
  parentDepartmentId?: string | null;
}

interface CreateDesignationInput {
  name: string;
  code?: string;
  level?: number;
  levelBand?: string;
  description?: string;
  departmentId?: string | null;
}

export const employeeDepsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getDepartments: builder.query<{ success: boolean; data: DepartmentItem[] }, { search?: string; isActive?: boolean } | void>({
      query: (params) => ({
        url: '/departments',
        params: params || undefined,
      }),
      providesTags: ['Department'],
    }),

    createDepartment: builder.mutation<{ success: boolean; data: DepartmentItem }, CreateDepartmentInput>({
      query: (body) => ({
        url: '/departments',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Department'],
    }),

    getDesignations: builder.query<{ success: boolean; data: DesignationItem[] }, { search?: string; departmentId?: string; isActive?: boolean } | void>({
      query: (params) => ({
        url: '/designations',
        params: params || undefined,
      }),
      providesTags: ['Designation'],
    }),

    createDesignation: builder.mutation<{ success: boolean; data: DesignationItem }, CreateDesignationInput>({
      query: (body) => ({
        url: '/designations',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Designation'],
    }),

    deleteDepartment: builder.mutation<{ success: boolean; message: string }, string>({
      query: (id) => ({ url: `/departments/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Department', 'Designation'],
    }),

    deleteDesignation: builder.mutation<{ success: boolean; message: string }, string>({
      query: (id) => ({ url: `/designations/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Designation'],
    }),

    getOfficeLocations: builder.query<any, void>({
      query: () => '/workforce/locations',
      providesTags: ['OfficeLocation'],
    }),

    getManagers: builder.query<any, void>({
      query: () => ({
        url: '/employees',
        params: { limit: 200, sortBy: 'firstName', sortOrder: 'asc' },
      }),
    }),
  }),
});

export const {
  useGetDepartmentsQuery,
  useCreateDepartmentMutation,
  useDeleteDepartmentMutation,
  useGetDesignationsQuery,
  useCreateDesignationMutation,
  useDeleteDesignationMutation,
  useGetOfficeLocationsQuery,
  useGetManagersQuery,
} = employeeDepsApi;
