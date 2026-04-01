import { api } from '../../app/api';

export const workforceApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // Shifts
    getShifts: builder.query<any, void>({
      query: () => '/workforce/shifts',
      providesTags: ['Attendance'],
    }),
    createShift: builder.mutation<any, any>({
      query: (body) => ({ url: '/workforce/shifts', method: 'POST', body }),
      invalidatesTags: ['Attendance'],
    }),
    updateShift: builder.mutation<any, { id: string; data: any }>({
      query: ({ id, data }) => ({ url: `/workforce/shifts/${id}`, method: 'PATCH', body: data }),
      invalidatesTags: ['Attendance'],
    }),
    deleteShift: builder.mutation<any, string>({
      query: (id) => ({ url: `/workforce/shifts/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Attendance'],
    }),
    assignShift: builder.mutation<any, any>({
      query: (body) => ({ url: '/workforce/shifts/assign', method: 'POST', body }),
      invalidatesTags: ['Attendance'],
    }),
    autoAssignDefault: builder.mutation<any, void>({
      query: () => ({ url: '/workforce/shifts/auto-assign', method: 'POST' }),
      invalidatesTags: ['Attendance'],
    }),
    getEmployeeShift: builder.query<any, string>({
      query: (employeeId) => `/workforce/shifts/employee/${employeeId}`,
      providesTags: ['Attendance'],
    }),
    getAllAssignments: builder.query<any, void>({
      query: () => '/workforce/shifts/assignments',
      providesTags: ['Attendance'],
    }),

    // Office Locations
    getLocations: builder.query<any, void>({
      query: () => '/workforce/locations',
      providesTags: ['Attendance'],
    }),
    createLocation: builder.mutation<any, any>({
      query: (body) => ({ url: '/workforce/locations', method: 'POST', body }),
      invalidatesTags: ['Attendance'],
    }),
    updateLocation: builder.mutation<any, { id: string; data: any }>({
      query: ({ id, data }) => ({ url: `/workforce/locations/${id}`, method: 'PATCH', body: data }),
      invalidatesTags: ['Attendance'],
    }),
    deleteLocation: builder.mutation<any, string>({
      query: (id) => ({ url: `/workforce/locations/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Attendance'],
    }),
  }),
});

export const {
  useGetShiftsQuery,
  useCreateShiftMutation,
  useUpdateShiftMutation,
  useDeleteShiftMutation,
  useAssignShiftMutation,
  useAutoAssignDefaultMutation,
  useGetEmployeeShiftQuery,
  useGetAllAssignmentsQuery,
  useGetLocationsQuery,
  useCreateLocationMutation,
  useUpdateLocationMutation,
  useDeleteLocationMutation,
} = workforceApi;
