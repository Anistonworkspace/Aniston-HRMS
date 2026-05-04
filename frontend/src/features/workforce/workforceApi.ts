import { api } from '../../app/api';
import type { ApiResponse } from '@aniston/shared';

// ---- Shift types ----

export interface Shift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  shiftType: string;
  gracePeriodMinutes?: number;
  graceMinutes?: number;
  fullDayHours?: number;
  halfDayHours?: number;
  trackingIntervalMinutes?: number | null;
  isDefault: boolean;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateShiftRequest {
  name: string;
  startTime: string;
  endTime: string;
  shiftType?: string;
  gracePeriodMinutes?: number;
  isDefault?: boolean;
}

export interface UpdateShiftRequest {
  name?: string;
  startTime?: string;
  endTime?: string;
  shiftType?: string;
  gracePeriodMinutes?: number;
  isDefault?: boolean;
}

export interface AssignShiftRequest {
  employeeId: string;
  shiftId: string;
  locationId?: string;
  startDate: string;
  endDate?: string;
}

export interface ShiftAssignment {
  id: string;
  employeeId: string;
  shiftId: string;
  locationId?: string | null;
  organizationId?: string | null;
  startDate: string;
  endDate?: string | null;
  assignedBy: string;
  shift: Shift;
  location?: { id: string; name: string; geofence?: { coordinates: { lat: number; lng: number } | null; radiusMeters: number } | null } | null;
  employee?: {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
  };
  createdAt: string;
  updatedAt: string;
}

// ---- Office Location types ----

export interface OfficeLocation {
  id: string;
  name: string;
  address: string;
  city: string;
  state?: string;
  country?: string;
  pincode?: string;
  latitude?: number | null;
  longitude?: number | null;
  geofenceRadius?: number | null;
  isHeadOffice?: boolean;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
  geofence?: {
    id: string;
    coordinates: { lat: number; lng: number } | null;
    radiusMeters: number;
    strictMode?: boolean;
  } | null;
}

export interface CreateLocationRequest {
  name: string;
  address: string;
  city: string;
  state?: string;
  country?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  geofenceRadius?: number;
  strictMode?: boolean;
  isHeadOffice?: boolean;
  autoCheckIn?: boolean;
  autoCheckOut?: boolean;
}

export interface UpdateLocationRequest {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
  geofenceRadius?: number;
  isHeadOffice?: boolean;
}

export const workforceApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // Shifts
    getShifts: builder.query<ApiResponse<Shift[]>, void>({
      query: () => '/workforce/shifts',
      providesTags: ['Attendance'],
    }),
    createShift: builder.mutation<ApiResponse<Shift>, CreateShiftRequest>({
      query: (body) => ({ url: '/workforce/shifts', method: 'POST', body }),
      invalidatesTags: ['Attendance'],
    }),
    updateShift: builder.mutation<ApiResponse<Shift>, { id: string; data: UpdateShiftRequest }>({
      query: ({ id, data }) => ({ url: `/workforce/shifts/${id}`, method: 'PATCH', body: data }),
      invalidatesTags: ['Attendance'],
    }),
    deleteShift: builder.mutation<ApiResponse<null>, string>({
      query: (id) => ({ url: `/workforce/shifts/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Attendance'],
    }),
    assignShift: builder.mutation<ApiResponse<ShiftAssignment>, AssignShiftRequest>({
      query: (body) => ({ url: '/workforce/shifts/assign', method: 'POST', body }),
      // Invalidate both Attendance (shift assignments) AND EmployeeList (workMode badge update)
      invalidatesTags: ['Attendance', 'EmployeeList'],
    }),
    autoAssignDefault: builder.mutation<ApiResponse<{ assigned: number; message?: string }>, void>({
      query: () => ({ url: '/workforce/shifts/auto-assign', method: 'POST' }),
      invalidatesTags: ['Attendance', 'EmployeeList'],
    }),
    getEmployeeShift: builder.query<ApiResponse<ShiftAssignment | null>, string>({
      query: (employeeId) => `/workforce/shifts/employee/${employeeId}`,
      providesTags: ['Attendance'],
    }),
    getAllAssignments: builder.query<ApiResponse<ShiftAssignment[]>, void>({
      query: () => '/workforce/shifts/assignments',
      providesTags: ['Attendance'],
    }),

    // Office Locations
    getLocations: builder.query<ApiResponse<OfficeLocation[]>, void>({
      query: () => '/workforce/locations',
      providesTags: ['Attendance'],
    }),
    createLocation: builder.mutation<ApiResponse<OfficeLocation>, CreateLocationRequest>({
      query: (body) => ({ url: '/workforce/locations', method: 'POST', body }),
      invalidatesTags: ['Attendance'],
    }),
    updateLocation: builder.mutation<ApiResponse<OfficeLocation>, { id: string; data: UpdateLocationRequest }>({
      query: ({ id, data }) => ({ url: `/workforce/locations/${id}`, method: 'PATCH', body: data }),
      invalidatesTags: ['Attendance'],
    }),
    deleteLocation: builder.mutation<ApiResponse<null>, string>({
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
