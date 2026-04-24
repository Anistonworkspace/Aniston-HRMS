import { api } from '../../app/api';

// ===== Backup Types =====
export type BackupCategory = 'DATABASE' | 'FILES';

export interface DatabaseBackup {
  id: string;
  filename: string;
  filePath: string;
  sizeBytes: string; // BigInt serialized as string
  category: BackupCategory;
  type: 'MANUAL' | 'SCHEDULED';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'DELETED';
  notes: string | null;
  createdById: string | null;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface BackupStats {
  totalBackups: number;
  totalDbBackups: number;
  totalFilesBackups: number;
  lastDbBackupAt: string | null;
  lastDbBackupSize: string | null;
  lastFilesBackupAt: string | null;
  lastFilesBackupSize: string | null;
  nextScheduledAt: string | null;
}

export interface BackupAvailability {
  pgDump: { available: boolean; path: string | null; method: string | null; envVar: string; hint: string | null };
  psql: { available: boolean; path: string | null; method: string | null; envVar: string; hint: string | null };
}

export interface BackupListResponse {
  success: boolean;
  backups: DatabaseBackup[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  stats: BackupStats;
}

// ===== Agent Setup Types =====
interface AgentSetupEmployee {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  email: string | null;
  avatar: string | null;
  workMode: string | null;
  department: string | null;
  agentPairingCode: string | null;
  agentPairedAt: string | null;
  agentStatus: { isActive: boolean; lastHeartbeat: string | null };
}

interface GenerateCodeResponse {
  code: string;
  isNew: boolean;
}

interface BulkGenerateResponse {
  generated: number;
  total: number;
}

export const settingsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getOrgSettings: builder.query<any, void>({ query: () => '/settings/organization', providesTags: ['Settings'] }),
    updateOrg: builder.mutation<any, any>({
      query: (body) => ({ url: '/settings/organization', method: 'PATCH', body }),
      invalidatesTags: ['Settings'],
    }),
    getLocations: builder.query<any, void>({ query: () => '/settings/locations', providesTags: ['Settings'] }),
    createLocation: builder.mutation<any, any>({
      query: (body) => ({ url: '/settings/locations', method: 'POST', body }),
      invalidatesTags: ['Settings'],
    }),
    getAuditLogs: builder.query<any, { page?: number; entity?: string }>({
      query: (params) => ({ url: '/settings/audit-logs', params }),
      providesTags: ['Settings'],
    }),
    getSystemInfo: builder.query<any, void>({ query: () => '/settings/system' }),
    getEmailConfig: builder.query<any, void>({ query: () => '/settings/email', providesTags: ['Settings', 'EmailConfig'] }),
    saveEmailConfig: builder.mutation<any, any>({
      query: (body) => ({ url: '/settings/email', method: 'POST', body }),
      invalidatesTags: ['EmailConfig'],
    }),
    testEmailConnection: builder.mutation<any, void>({
      query: () => ({ url: '/settings/email/test', method: 'POST' }),
    }),
    getTeamsConfig: builder.query<any, void>({
      query: () => '/settings/teams',
      providesTags: ['TeamsConfig'],
    }),
    saveTeamsConfig: builder.mutation<any, any>({
      query: (body) => ({ url: '/settings/teams', method: 'POST', body }),
      invalidatesTags: ['TeamsConfig'],
    }),
    testTeamsConnection: builder.mutation<any, void>({
      query: () => ({ url: '/settings/teams/test', method: 'POST' }),
    }),
    syncTeamsEmployees: builder.mutation<any, void>({
      query: () => ({ url: '/settings/teams/sync', method: 'POST' }),
      invalidatesTags: ['Employee', 'EmployeeList'],
    }),
    // Salary visibility rules
    getSalaryVisibilityRules: builder.query<any, void>({
      query: () => '/payroll/visibility-rules',
      providesTags: ['Payroll'],
    }),
    setSalaryVisibilityRule: builder.mutation<any, { employeeId: string; visibleToHR: boolean; visibleToManager: boolean; hiddenReason?: string }>({
      query: (body) => ({ url: '/payroll/visibility-rules', method: 'POST', body }),
      invalidatesTags: ['Payroll'],
    }),
    updateSalaryVisibilityRule: builder.mutation<any, { employeeId: string; visibleToHR: boolean; visibleToManager: boolean; hiddenReason?: string }>({
      query: ({ employeeId, ...body }) => ({ url: `/payroll/visibility-rules/${employeeId}`, method: 'PATCH', body }),
      invalidatesTags: ['Payroll'],
    }),
    // AI Config
    getAiConfig: builder.query<any, void>({
      query: () => '/settings/ai-config',
      providesTags: ['AiConfig'],
    }),
    saveAiConfig: builder.mutation<any, { provider: string; apiKey?: string; baseUrl?: string | null; modelName: string }>({
      query: (body) => ({ url: '/settings/ai-config', method: 'PUT', body }),
      invalidatesTags: ['AiConfig'],
    }),
    testAiConnection: builder.mutation<any, { modelName?: string; baseUrl?: string; provider?: string; apiKey?: string } | void>({
      query: (body) => ({ url: '/settings/ai-config/test', method: 'POST', body: body || {} }),
    }),
    testAdminNotificationEmail: builder.mutation<any, void>({
      query: () => ({ url: '/settings/organization/test-admin-email', method: 'POST' }),
    }),
    // Agent Setup
    getAgentSetupList: builder.query<{ success: boolean; data: AgentSetupEmployee[] }, void>({
      query: () => '/agent/setup/employees',
      providesTags: ['AgentSetup'],
    }),
    generateAgentCode: builder.mutation<{ success: boolean; data: GenerateCodeResponse }, { employeeId: string }>({
      query: (body) => ({ url: '/agent/setup/generate-code', method: 'POST', body }),
      invalidatesTags: ['AgentSetup'],
    }),
    regenerateAgentCode: builder.mutation<{ success: boolean; data: GenerateCodeResponse }, { employeeId: string }>({
      query: (body) => ({ url: '/agent/setup/regenerate-code', method: 'POST', body }),
      invalidatesTags: ['AgentSetup'],
    }),
    bulkGenerateAgentCodes: builder.mutation<{ success: boolean; data: BulkGenerateResponse }, void>({
      query: () => ({ url: '/agent/setup/bulk-generate', method: 'POST' }),
      invalidatesTags: ['AgentSetup'],
    }),

    // Backup — availability pre-flight
    checkBackupAvailability: builder.query<{ success: boolean; data: BackupAvailability }, void>({
      query: () => '/settings/backup/check',
      providesTags: ['Backup'],
    }),
    // Database Backup
    listBackups: builder.query<BackupListResponse, { page?: number; category?: BackupCategory }>({
      query: (params) => ({ url: '/settings/backup', params }),
      providesTags: ['Backup'],
    }),
    getBackupStats: builder.query<{ success: boolean; data: BackupStats }, void>({
      query: () => '/settings/backup/stats',
      providesTags: ['Backup'],
    }),
    createBackup: builder.mutation<{ success: boolean; data: DatabaseBackup }, { category: BackupCategory }>({
      query: (body) => ({ url: '/settings/backup', method: 'POST', body }),
      invalidatesTags: ['Backup'],
    }),
    deleteBackup: builder.mutation<{ success: boolean }, string>({
      query: (id) => ({ url: `/settings/backup/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Backup'],
    }),
    restoreBackup: builder.mutation<{ success: boolean; data: any }, string>({
      query: (id) => ({ url: `/settings/backup/${id}/restore`, method: 'POST' }),
      invalidatesTags: ['Backup'],
    }),
    restoreFilesBackup: builder.mutation<{ success: boolean; data: any }, string>({
      query: (id) => ({ url: `/settings/backup/${id}/restore-files`, method: 'POST' }),
      invalidatesTags: ['Backup'],
    }),

    // Document Templates
    getDocumentTemplates: builder.query<{ success: boolean; data: Array<{ id: string; key: string; label: string; required: boolean; isDefault: boolean }> }, void>({
      query: () => '/settings/document-templates',
      providesTags: ['DocumentTemplates'],
    }),
    upsertDocumentTemplate: builder.mutation<any, { key: string; label: string; required?: boolean; isDefault?: boolean }>({
      query: (body) => ({ url: '/settings/document-templates', method: 'POST', body }),
      invalidatesTags: ['DocumentTemplates'],
    }),
    deleteDocumentTemplate: builder.mutation<any, string>({
      query: (id) => ({ url: `/settings/document-templates/${id}`, method: 'DELETE' }),
      invalidatesTags: ['DocumentTemplates'],
    }),

    // ── System Logs (SUPER_ADMIN only) ────────────────────────────────────────
    getSystemLogSummary: builder.query<any, void>({
      query: () => '/settings/system-logs/summary',
    }),
    getSystemLogs: builder.query<any, {
      page?: number;
      limit?: number;
      level?: string;
      source?: string;
      search?: string;
      dateFrom?: string;
      dateTo?: string;
      sort?: 'asc' | 'desc';
    }>({
      query: (params) => ({ url: '/settings/system-logs', params }),
    }),
    getAiServiceLogs: builder.query<any, number>({
      query: (lines = 200) => ({ url: '/settings/system-logs/ai-service', params: { lines } }),
    }),
    getAiServiceHealth: builder.query<{ success: boolean; data: { status: 'online' | 'offline' | 'degraded'; latencyMs?: number; service?: string; version?: string; url?: string; error?: string; httpStatus?: number } }, void>({
      query: () => '/settings/system-logs/ai-health',
    }),
  }),
});

export const {
  useGetOrgSettingsQuery,
  useUpdateOrgMutation,
  useGetLocationsQuery,
  useCreateLocationMutation,
  useGetAuditLogsQuery,
  useGetSystemInfoQuery,
  useGetEmailConfigQuery,
  useSaveEmailConfigMutation,
  useTestEmailConnectionMutation,
  useGetTeamsConfigQuery,
  useSaveTeamsConfigMutation,
  useTestTeamsConnectionMutation,
  useSyncTeamsEmployeesMutation,
  useGetSalaryVisibilityRulesQuery,
  useSetSalaryVisibilityRuleMutation,
  useUpdateSalaryVisibilityRuleMutation,
  useGetAiConfigQuery,
  useSaveAiConfigMutation,
  useTestAiConnectionMutation,
  useTestAdminNotificationEmailMutation,
  useGetAgentSetupListQuery,
  useGenerateAgentCodeMutation,
  useRegenerateAgentCodeMutation,
  useBulkGenerateAgentCodesMutation,
  useCheckBackupAvailabilityQuery,
  useListBackupsQuery,
  useGetBackupStatsQuery,
  useCreateBackupMutation,
  useDeleteBackupMutation,
  useRestoreBackupMutation,
  useRestoreFilesBackupMutation,
  useGetSystemLogSummaryQuery,
  useGetSystemLogsQuery,
  useGetAiServiceLogsQuery,
  useGetAiServiceHealthQuery,
  useGetDocumentTemplatesQuery,
  useUpsertDocumentTemplateMutation,
  useDeleteDocumentTemplateMutation,
} = settingsApi;
