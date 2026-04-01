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

    projectSiteCheckIn: builder.mutation<any, { siteName: string; siteAddress?: string; notes?: string; latitude?: number; longitude?: number; photoUrl?: string }>({
      query: (body) => ({ url: '/attendance/project-site/check-in', method: 'POST', body }),
      invalidatesTags: ['Attendance'],
    }),

    getProjectSiteCheckIns: builder.query<any, { date?: string }>({
      query: (params) => ({ url: '/attendance/project-site/my', params }),
      providesTags: ['Attendance'],
    }),

    getEmployeeAttendance: builder.query<any, { employeeId: string; startDate: string; endDate: string }>({
      query: ({ employeeId, ...params }) => ({ url: `/attendance/employee/${employeeId}`, params }),
      providesTags: ['Attendance'],
    }),

    markAttendance: builder.mutation<any, { employeeId: string; date: string; status: string; workMode?: string }>({
      query: (body) => ({ url: '/attendance/mark', method: 'POST', body }),
      invalidatesTags: ['Attendance'],
    }),

    getEmployeeGPSTrail: builder.query<any, { employeeId: string; date: string }>({
      query: ({ employeeId, date }) => `/attendance/gps-trail/${employeeId}/${date}`,
    }),

    getAttendanceLogs: builder.query<any, { employeeId: string; date: string }>({
      query: ({ employeeId, date }) => `/attendance/logs/${employeeId}/${date}`,
      providesTags: ['Attendance'],
    }),

    sendActivityPulse: builder.mutation<any, { isActive: boolean; tabVisible: boolean }>({
      query: (body) => ({ url: '/attendance/activity-pulse', method: 'POST', body }),
    }),

    getEmployeeActivityLogs: builder.query<any, { employeeId: string; date: string }>({
      query: ({ employeeId, date }) => `/agent/activity/${employeeId}/${date}`,
    }),

    getEmployeeScreenshots: builder.query<any, { employeeId: string; date: string }>({
      query: ({ employeeId, date }) => `/agent/screenshots/${employeeId}/${date}`,
    }),

    getAgentStatus: builder.query<any, void>({
      query: () => '/agent/status',
    }),

    generateAgentPairCode: builder.mutation<any, void>({
      query: () => ({ url: '/agent/pair/generate', method: 'POST' }),
    }),

    setAgentLiveMode: builder.mutation<any, { employeeId: string; enabled: boolean; intervalSeconds?: number }>({
      query: (body) => ({ url: '/agent/live-mode', method: 'POST', body }),
    }),

    getAgentLiveMode: builder.query<any, string>({
      query: (employeeId) => `/agent/live-mode/${employeeId}`,
    }),

    // Pending regularizations (HR view)
    getPendingRegularizations: builder.query<any, void>({
      query: () => '/attendance/regularizations/pending',
      providesTags: ['Attendance'],
    }),
    handleRegularization: builder.mutation<any, { id: string; action: string; remarks?: string }>({
      query: ({ id, ...body }) => ({ url: `/attendance/regularization/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Attendance'],
    }),

    // Hybrid schedule
    getHybridSchedule: builder.query<any, string>({
      query: (employeeId) => `/attendance/hybrid-schedule/${employeeId}`,
      providesTags: ['Attendance'],
    }),
    setHybridSchedule: builder.mutation<any, { employeeId: string; officeDays: number[]; wfhDays: number[]; notes?: string }>({
      query: ({ employeeId, ...body }) => ({ url: `/attendance/hybrid-schedule/${employeeId}`, method: 'PUT', body }),
      invalidatesTags: ['Attendance'],
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
  useProjectSiteCheckInMutation,
  useGetProjectSiteCheckInsQuery,
  useGetEmployeeAttendanceQuery,
  useMarkAttendanceMutation,
  useGetEmployeeGPSTrailQuery,
  useGetAttendanceLogsQuery,
  useSendActivityPulseMutation,
  useGetEmployeeActivityLogsQuery,
  useGetEmployeeScreenshotsQuery,
  useGetAgentStatusQuery,
  useGenerateAgentPairCodeMutation,
  useSetAgentLiveModeMutation,
  useGetAgentLiveModeQuery,
  useGetPendingRegularizationsQuery,
  useHandleRegularizationMutation,
  useGetHybridScheduleQuery,
  useSetHybridScheduleMutation,
} = attendanceApi;
