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

// ===== Agent / Activity Tracking Types =====
interface ActivityLogEntry {
  id: string;
  employeeId: string;
  date: string;
  timestamp: string;
  activeApp: string | null;
  activeWindow: string | null;
  activeUrl: string | null;
  category: 'PRODUCTIVE' | 'NEUTRAL' | 'UNPRODUCTIVE' | null;
  durationSeconds: number;
  idleSeconds: number;
  keystrokes: number;
  mouseClicks: number;
  mouseDistance: number;
}

interface ActivitySummary {
  logCount: number;
  totalActiveMinutes: number;
  totalIdleMinutes: number;
  totalKeystrokes: number;
  totalClicks: number;
  topApps: Array<{ app: string; minutes: number }>;
}

interface ActivityLogResponse {
  logs: ActivityLogEntry[];
  summary: ActivitySummary;
}

interface AgentScreenshot {
  id: string;
  employeeId: string;
  date: string;
  timestamp: string;
  imageUrl: string;
  activeApp: string | null;
  activeWindow: string | null;
}

interface AgentStatusResponse {
  isActive: boolean;
  lastHeartbeat: string | null;
}

interface AgentPairCodeResponse {
  code: string;
  expiresAt?: string;
}

interface AgentLiveModeResponse {
  enabled: boolean;
  intervalSeconds?: number;
}

export const attendanceApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getTodayStatus: builder.query<{ success: boolean; data: TodayStatus }, void>({
      query: () => '/attendance/today',
      providesTags: ['Attendance'],
    }),

    clockIn: builder.mutation<any, { latitude?: number; longitude?: number; source?: string; siteName?: string; notes?: string; deviceType?: 'mobile' | 'desktop'; isPwa?: boolean }>({
      query: (body) => ({
        url: '/attendance/clock-in',
        method: 'POST',
        body: {
          ...body,
          // Auto-detect PWA standalone mode for mobile attendance validation
          isPwa: body.isPwa ?? (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true),
        },
      }),
      invalidatesTags: ['Attendance', 'Dashboard'],
    }),

    clockOut: builder.mutation<any, { latitude?: number; longitude?: number; deviceType?: 'mobile' | 'desktop'; isPwa?: boolean }>({
      query: (body) => ({
        url: '/attendance/clock-out',
        method: 'POST',
        body: {
          ...body,
          isPwa: body.isPwa ?? (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true),
        },
      }),
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

    getEmployeeActivityLogs: builder.query<{ success: boolean; data: ActivityLogResponse }, { employeeId: string; date: string }>({
      query: ({ employeeId, date }) => `/agent/activity/${employeeId}/${date}`,
    }),

    getEmployeeScreenshots: builder.query<{ success: boolean; data: AgentScreenshot[] }, { employeeId: string; date: string }>({
      query: ({ employeeId, date }) => `/agent/screenshots/${employeeId}/${date}`,
    }),

    getAgentStatus: builder.query<{ success: boolean; data: AgentStatusResponse }, void>({
      query: () => '/agent/status',
      providesTags: ['Attendance'],
    }),

    generateAgentPairCode: builder.mutation<{ success: boolean; data: AgentPairCodeResponse }, void>({
      query: () => ({ url: '/agent/pair/generate', method: 'POST' }),
      invalidatesTags: ['Attendance'],
    }),

    setAgentLiveMode: builder.mutation<{ success: boolean; data: AgentLiveModeResponse }, { employeeId: string; enabled: boolean; intervalSeconds?: number }>({
      query: (body) => ({ url: '/agent/live-mode', method: 'POST', body }),
      invalidatesTags: ['Attendance'],
    }),

    getAgentLiveMode: builder.query<{ success: boolean; data: AgentLiveModeResponse }, string>({
      query: (employeeId) => `/agent/live-mode/${employeeId}`,
      providesTags: ['Attendance'],
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

    // =========================================================================
    // ENTERPRISE COMMAND CENTER
    // =========================================================================

    getCommandCenterStats: builder.query<any, { date?: string }>({
      query: (params) => ({ url: '/attendance/command-center/stats', params }),
      providesTags: ['Attendance'],
    }),

    getEnhancedAttendance: builder.query<any, {
      page?: number; limit?: number; startDate?: string; endDate?: string;
      department?: string; status?: string; workMode?: string; search?: string;
      designation?: string; managerId?: string; shiftType?: string;
      anomalyType?: string; regularizationStatus?: string; employeeType?: string;
      sortBy?: string; sortOrder?: string;
    }>({
      query: (params) => ({ url: '/attendance/command-center/records', params }),
      providesTags: ['Attendance'],
    }),

    getAnomalies: builder.query<any, {
      date?: string; type?: string; severity?: string; resolution?: string;
      employeeId?: string; page?: number; limit?: number;
    }>({
      query: (params) => ({ url: '/attendance/command-center/anomalies', params }),
      providesTags: ['Attendance'],
    }),

    resolveAnomaly: builder.mutation<any, { id: string; resolution: string; remarks?: string }>({
      query: ({ id, ...body }) => ({ url: `/attendance/command-center/anomalies/${id}/resolve`, method: 'PATCH', body }),
      invalidatesTags: ['Attendance'],
    }),

    getLiveBoard: builder.query<any, void>({
      query: () => '/attendance/command-center/live',
      providesTags: ['Attendance'],
    }),

    detectAnomalies: builder.mutation<any, { date?: string }>({
      query: (params) => ({ url: '/attendance/command-center/detect-anomalies', method: 'POST', params }),
      invalidatesTags: ['Attendance'],
    }),

    getEmployeeAttendanceDetail: builder.query<any, { employeeId: string; date: string }>({
      query: ({ employeeId, date }) => `/attendance/command-center/employee/${employeeId}/${date}`,
      providesTags: ['Attendance'],
    }),

    // ===== P1.1: Attendance Policy =====
    getAttendancePolicy: builder.query<any, void>({
      query: () => '/attendance/policy',
      providesTags: ['Attendance'],
    }),
    updateAttendancePolicy: builder.mutation<any, any>({
      query: (body) => ({ url: '/attendance/policy', method: 'PUT', body }),
      invalidatesTags: ['Attendance'],
    }),

    // ===== P1.2: Bulk Upload =====
    bulkUploadAttendance: builder.mutation<any, { rows: any[] }>({
      query: (body) => ({ url: '/attendance/bulk/upload', method: 'POST', body }),
      invalidatesTags: ['Attendance'],
    }),

    // ===== P1.3: Monthly Report =====
    getMonthlyReport: builder.query<any, { month: number; year: number }>({
      query: ({ month, year }) => `/attendance/monthly-report?month=${month}&year=${year}`,
    }),

    // ===== P2.7: Self-Service Report =====
    getMyReport: builder.query<any, { month: number; year: number }>({
      query: ({ month, year }) => `/attendance/my/report?month=${month}&year=${year}`,
    }),

    // ===== P2.9: Geofence Map =====
    getCheckInMapData: builder.query<any, string>({
      query: (attendanceId) => `/attendance/check-in-map/${attendanceId}`,
    }),

    // ===== P2.10: Overtime =====
    submitOvertimeRequest: builder.mutation<any, { date: string; plannedHours: number; reason: string }>({
      query: (body) => ({ url: '/attendance/overtime', method: 'POST', body }),
      invalidatesTags: ['Attendance'],
    }),
    getMyOvertimeRequests: builder.query<any, void>({
      query: () => '/attendance/overtime/my',
      providesTags: ['Attendance'],
    }),
    getAllOvertimeRequests: builder.query<any, void>({
      query: () => '/attendance/overtime',
      providesTags: ['Attendance'],
    }),
    handleOvertimeRequest: builder.mutation<any, { id: string; action: string; remarks?: string }>({
      query: ({ id, ...body }) => ({ url: `/attendance/overtime/${id}`, method: 'PATCH', body }),
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
  // Enterprise Command Center
  useGetCommandCenterStatsQuery,
  useGetEnhancedAttendanceQuery,
  useGetAnomaliesQuery,
  useResolveAnomalyMutation,
  useGetLiveBoardQuery,
  useDetectAnomaliesMutation,
  useGetEmployeeAttendanceDetailQuery,
  // P1.1
  useGetAttendancePolicyQuery,
  useUpdateAttendancePolicyMutation,
  // P1.2
  useBulkUploadAttendanceMutation,
  // P1.3
  useGetMonthlyReportQuery,
  // P2.7
  useGetMyReportQuery,
  // P2.9
  useGetCheckInMapDataQuery,
  // P2.10
  useSubmitOvertimeRequestMutation,
  useGetMyOvertimeRequestsQuery,
  useGetAllOvertimeRequestsQuery,
  useHandleOvertimeRequestMutation,
} = attendanceApi;
