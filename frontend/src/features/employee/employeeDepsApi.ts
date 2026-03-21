import { api } from '../../app/api';

export const employeeDepsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getDepartments: builder.query<any, void>({
      query: () => '/departments',
      providesTags: ['Department'],
    }),
    getDesignations: builder.query<any, void>({
      query: () => '/designations',
      providesTags: ['Designation'],
    }),
  }),
});

export const { useGetDepartmentsQuery, useGetDesignationsQuery } = employeeDepsApi;
