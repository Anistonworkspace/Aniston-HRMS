import { api } from '../../app/api';

interface TodayStatus {
  record: any | null;
  isCheckedIn: boolean;
  isCheckedOut: boolean;
  isOnBreak: boolean;
  activeBreak: any | null;
  workMode: string;
  totalHours: number | null;
}

interface AttendanceData {
  records: any[];
  holidays: any[];
  summary: {
    totalDays: number;
    present: number;
    absent: number;
    halfDay: number;
    onLeave: number;
    holidays: number;
    weekends: number;
    workFromHome: number;
    averageHours: number;
  };
}

export const attendanceApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getTodayStatus: builder.query<{ success: boolean; data: TodayStatus }, void>({
      query: () => '/attendance/today',
      providesTags: ['Attendance'],
    }),

    clockIn: builder.mutation<any, { latitude?: number; longitude?: number; source?: string; siteName?: string; notes?: string }>({
      query: (body) => ({ url: '/attendance/clock-in', method: 'POST', body }),
      invalidatesTags: ['Attendance', 'Dashboard'],
    }),

    clockOut: builder.mutation<any, { latitude?: number; longitude?: number }>({
      query: (body) => ({ url: '/attendance/clock-out', method: 'POST', body }),
      invalidatesTags: ['Attendance', 'Dashboard'],
    }),

    startBreak: builder.mutation<any, { type: string }>({
      query: (body) => ({ url: '/attendance/break/start', method: 'POST', body }),
      invalidatesTags: ['Attendance'],
    }),

    endBreak: builder.mutation<any, void>({
      query: () => ({ url: '/attendance/break/end', method: 'POST' }),
      invalidatesTags: ['Attendance'],
    }),

    getMyAttendance: builder.query<{ success: boolean; data: AttendanceData }, { startDate?: string; endDate?: string }>({
      query: (params) => ({ url: '/attendance/my', params }),
      providesTags: ['Attendance'],
    }),

    getAllAttendance: builder.query<any, { page?: number; limit?: number; startDate?: string; endDate?: string; department?: string; status?: string }>({
      query: (params) => ({ url: '/attendance/all', params }),
      providesTags: ['Attendance'],
    }),

    submitRegularization: builder.mutation<any, { attendanceId: string; reason: string; requestedCheckIn?: string; requestedCheckOut?: string }>({
      query: (body) => ({ url: '/attendance/regularization', method: 'POST', body }),
      invalidatesTags: ['Attendance'],
    }),

    storeGPSTrail: builder.mutation<any, { points: any[] }>({
      query: (body) => ({ url: '/attendance/gps-trail', method: 'POST', body }),
    }),
  }),
});

export const {
  useGetTodayStatusQuery,
  useClockInMutation,
  useClockOutMutation,
  useStartBreakMutation,
  useEndBreakMutation,
  useGetMyAttendanceQuery,
  useGetAllAttendanceQuery,
  useSubmitRegularizationMutation,
  useStoreGPSTrailMutation,
} = attendanceApi;
