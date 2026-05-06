import { api } from '../../app/api';

interface TodayStatus {
  record: any | null;
  isCheckedIn: boolean;
  isCheckedOut: boolean;
  isOnBreak: boolean;
  activeBreak: any | null;
  workMode: string;
  totalHours: number | null;
  weekOffDays?: number[];
  shift?: { name: string; startTime: string; endTime: string } | null;
  hasShift?: boolean;
  geofenceViolation?: boolean;
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
  totalMouseDistance: number;
  topApps: Array<{ app: string; minutes: number }>;
  productivityScore: number | null;
  productiveMinutes: number;
  unproductiveMinutes: number;
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
  expiresIn?: number; // seconds until code expires (300 = 5 min)
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

    clockIn: builder.mutation<any, { latitude?: number; longitude?: number; accuracy?: number; gpsTimestamp?: string; source?: string; siteName?: string; notes?: string; deviceType?: 'mobile' | 'desktop'; isPwa?: boolean }>({
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

    clockOut: builder.mutation<any, { latitude?: number; longitude?: number; accuracy?: number; gpsTimestamp?: string; deviceType?: 'mobile' | 'desktop'; isPwa?: boolean }>({
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
      invalidatesTags: ['Attendance', 'Dashboard'],
    }),

    endBreak: builder.mutation<any, void>({
      query: () => ({ url: '/attendance/break/end', method: 'POST' }),
      invalidatesTags: ['Attendance', 'Dashboard'],
    }),

    getMyAttendance: builder.query<{ success: boolean; data: AttendanceData }, { startDate?: string; endDate?: string }>({
      query: (params) => ({ url: '/attendance/my', params }),
      providesTags: ['Attendance'],
    }),

    getAllAttendance: builder.query<any, { page?: number; limit?: number; startDate?: string; endDate?: string; department?: string; status?: string }>({
      query: (params) => ({ url: '/attendance/all', params }),
      providesTags: ['Attendance'],
    }),

    submitRegularization: builder.mutation<any, { attendanceId?: string; date?: string; reason: string; requestedCheckIn?: string; requestedCheckOut?: string }>({
      query: (body) => ({ url: '/attendance/regularization', method: 'POST', body }),
      invalidatesTags: ['Attendance', 'Dashboard'],
    }),

    storeGPSTrail: builder.mutation<any, { points: any[] }>({
      query: (body) => ({ url: '/attendance/gps-trail', method: 'POST', body }),
      // Use targeted GPS tag so only GPS-trail queries refetch, not all Attendance queries
      invalidatesTags: (_, __, arg) => [{ type: 'GPSTrail' as const, id: 'PENDING' }],
    }),

    projectSiteCheckIn: builder.mutation<any, { siteName: string; siteAddress?: string; notes?: string; latitude?: number; longitude?: number; photoUrl?: string }>({
      query: (body) => ({ url: '/attendance/project-site/check-in', method: 'POST', body }),
      invalidatesTags: ['Attendance', 'Dashboard'],
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
      invalidatesTags: ['Attendance', 'Payroll', 'Dashboard'],
    }),

    getEmployeeGPSTrail: builder.query<any, { employeeId: string; date: string }>({
      query: ({ employeeId, date }) => `/attendance/gps-trail/${employeeId}/${date}`,
      // Specific tag per employee+date — avoids over-invalidating all Attendance cache
      providesTags: (_, __, { employeeId, date }) => [
        { type: 'GPSTrail' as const, id: `${employeeId}:${date}` },
        { type: 'GPSTrail' as const, id: 'PENDING' },
      ],
    }),

    recordGPSConsent: builder.mutation<any, { consentVersion?: string }>({
      query: (body) => ({ url: '/attendance/gps-consent', method: 'POST', body }),
      invalidatesTags: ['Attendance'],
    }),

    getGPSConsentStatus: builder.query<any, void>({
      query: () => '/attendance/gps-consent',
      providesTags: ['Attendance'],
    }),

    getAttendanceLogs: builder.query<any, { employeeId: string; date: string }>({
      query: ({ employeeId, date }) => `/attendance/logs/${employeeId}/${date}`,
      providesTags: ['Attendance'],
    }),

    sendActivityPulse: builder.mutation<any, { isActive: boolean; tabVisible: boolean }>({
      query: (body) => ({ url: '/attendance/activity-pulse', method: 'POST', body }),
    }),

    // Bug #9: Single query returns summaries for ALL employees — eliminates N+1 from EmployeeRow
    getActivityBulkSummary: builder.query<{ success: boolean; data: Record<string, { logCount: number; totalActiveMinutes: number; totalIdleMinutes: number; productivityScore: number | null }> }, { date: string }>({
      query: ({ date }) => `/agent/activity/bulk-summary?date=${date}`,
      providesTags: ['Attendance'],
    }),

    // Returns an Excel workbook as a blob — trigger a browser download in the UI
    downloadActivityExcel: builder.query<Blob, { employeeId: string; date: string }>({
      query: ({ employeeId, date }) => ({
        url: `/agent/activity/export/${employeeId}/${date}`,
        responseHandler: async (response: Response) => {
          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || 'Export failed');
          }
          return response.blob();
        },
        cache: 'no-cache',
      }),
    }),

    getEmployeeActivityLogs: builder.query<{ success: boolean; data: ActivityLogResponse }, { employeeId: string; date: string }>({
      query: ({ employeeId, date }) => `/agent/activity/${employeeId}/${date}`,
      providesTags: ['Attendance'],
    }),

    getEmployeeScreenshots: builder.query<{ success: boolean; data: AgentScreenshot[] }, { employeeId: string; date: string }>({
      query: ({ employeeId, date }) => `/agent/screenshots/${employeeId}/${date}`,
      providesTags: ['Attendance'],
    }),

    getAgentStatus: builder.query<{ success: boolean; data: AgentStatusResponse }, void>({
      query: () => '/agent/status',
      providesTags: ['Attendance'],
    }),

    // Admin: check any employee's agent status
    getEmployeeAgentStatus: builder.query<{ success: boolean; data: AgentStatusResponse }, string>({
      query: (employeeId) => `/agent/status/${employeeId}`,
    }),

    // Check whether the installer exe is available for download
    getAgentDownloadStatus: builder.query<{ success: boolean; data: { available: boolean; downloadUrl: string | null; filename: string } }, void>({
      query: () => '/agent/download/status',
    }),

    generateAgentPairCode: builder.mutation<{ success: boolean; data: AgentPairCodeResponse }, void>({
      query: () => ({ url: '/agent/pair/generate', method: 'POST' }),
      invalidatesTags: ['Attendance'],
    }),

    setAgentLiveMode: builder.mutation<{ success: boolean; data: AgentLiveModeResponse }, { employeeId: string; enabled: boolean; intervalSeconds?: number }>({
      query: (body) => ({ url: '/agent/live-mode', method: 'POST', body }),
      invalidatesTags: (_, __, { employeeId }) => [
        'Attendance',
        { type: 'Attendance' as const, id: `LiveMode-${employeeId}` },
      ],
    }),

    getAgentLiveMode: builder.query<{ success: boolean; data: AgentLiveModeResponse }, string>({
      query: (employeeId) => `/agent/live-mode/${employeeId}`,
      providesTags: (_, __, employeeId) => [
        'Attendance',
        { type: 'Attendance' as const, id: `LiveMode-${employeeId}` },
      ],
    }),

    // Pending regularizations (HR view)
    getPendingRegularizations: builder.query<any, void>({
      query: () => '/attendance/regularizations/pending',
      providesTags: ['Attendance'],
    }),
    // All regularizations with filters (HR view)
    getRegularizations: builder.query<any, { status?: string; search?: string; date?: string; page?: number }>({
      query: (params) => {
        const q = new URLSearchParams();
        if (params.status) q.set('status', params.status);
        if (params.search) q.set('search', params.search);
        if (params.date) q.set('date', params.date);
        if (params.page) q.set('page', String(params.page));
        return `/attendance/regularizations?${q.toString()}`;
      },
      providesTags: ['Attendance'],
    }),
    handleRegularization: builder.mutation<any, { id: string; action: string; remarks?: string; approvalType?: string }>({
      query: ({ id, ...body }) => ({ url: `/attendance/regularization/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Attendance', 'Dashboard'],
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
      sortBy?: string; sortOrder?: string; isLate?: boolean;
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

    // ===== COMP-OFF =====
    getCompOffBalance: builder.query<{ success: boolean; data: { balance: number } }, void>({
      query: () => '/attendance/comp-off/balance',
      providesTags: ['Attendance'],
    }),
    getCompOffCredits: builder.query<{ success: boolean; data: any[] }, void>({
      query: () => '/attendance/comp-off/credits',
      providesTags: ['Attendance'],
    }),
    getOrgCompOffCredits: builder.query<{ success: boolean; data: any[] }, { status?: string }>({
      query: (params) => ({ url: '/attendance/comp-off/org', params }),
      providesTags: ['Attendance'],
    }),
    grantCompOff: builder.mutation<any, { employeeId: string; earnedDate: string; hoursWorked: number; notes?: string; expiryMonths?: number }>({
      query: (body) => ({ url: '/attendance/comp-off/grant', method: 'POST', body }),
      invalidatesTags: ['Attendance'],
    }),
    redeemCompOff: builder.mutation<any, { leaveRequestId: string }>({
      query: (body) => ({ url: '/attendance/comp-off/redeem', method: 'POST', body }),
      invalidatesTags: ['Attendance'],
    }),

    // ===== GEO LOCATIONS (named visit stops for field sales) =====
    getGeoLocations: builder.query<any, { startDate?: string; endDate?: string; employeeId?: string; page?: number; limit?: number }>({
      query: (params) => ({ url: '/attendance/geo-locations', params }),
      providesTags: ['Attendance'],
    }),
    updateLocationVisitName: builder.mutation<any, { id: string; customName: string }>({
      query: ({ id, customName }) => ({
        url: `/attendance/location-visits/${id}/name`,
        method: 'PATCH',
        body: { customName },
      }),
      invalidatesTags: ['Attendance'],
    }),

    getMyShiftHistory: builder.query<any, void>({
      query: () => '/shifts/my-history',
      providesTags: ['Attendance'],
    }),

    // ===== NATIVE GPS SERVICE SUPPORT =====
    gpsHeartbeat: builder.mutation<any, void>({
      query: () => ({ url: '/attendance/gps-heartbeat', method: 'POST' }),
    }),

    gpsTrackingStop: builder.mutation<any, void>({
      query: () => ({ url: '/attendance/gps-tracking-stop', method: 'POST' }),
    }),

    gpsAlert: builder.mutation<any, { alertType: 'PERMISSION_REVOKED' | 'FORCE_STOPPED' }>({
      query: (body) => ({ url: '/attendance/gps-alert', method: 'POST', body }),
    }),

    tagStop: builder.mutation<any, { lat: number; lng: number; name: string; timestamp?: string }>({
      query: (body) => ({ url: '/attendance/tag-stop', method: 'POST', body }),
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
  useGetActivityBulkSummaryQuery,
  useGetEmployeeActivityLogsQuery,
  useGetEmployeeScreenshotsQuery,
  useGetAgentStatusQuery,
  useGetEmployeeAgentStatusQuery,
  useGenerateAgentPairCodeMutation,
  useSetAgentLiveModeMutation,
  useGetAgentLiveModeQuery,
  useGetPendingRegularizationsQuery,
  useGetRegularizationsQuery,
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
  useGetAgentDownloadStatusQuery,
  useLazyDownloadActivityExcelQuery,
  // Comp-Off
  useGetCompOffBalanceQuery,
  useGetCompOffCreditsQuery,
  useGetOrgCompOffCreditsQuery,
  useGrantCompOffMutation,
  useRedeemCompOffMutation,
  // Geo Locations
  useGetGeoLocationsQuery,
  useUpdateLocationVisitNameMutation,
  // GPS Consent
  useRecordGPSConsentMutation,
  useGetGPSConsentStatusQuery,
  // Shift history (employee self-service)
  useGetMyShiftHistoryQuery,
  // Native GPS service support
  useGpsHeartbeatMutation,
  useGpsTrackingStopMutation,
  useGpsAlertMutation,
  useTagStopMutation,
} = attendanceApi;
