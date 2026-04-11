// ============================================
// Aniston HRMS — Shared API Types
// ============================================

/**
 * Standard API response envelope
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  message?: string;
  error?: ApiError;
  meta?: PaginationMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string[]>;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Feature-level permissions that HR can control per-role or per-employee.
 * All default to true. false = feature restricted.
 */
export interface FeaturePermissions {
  canMarkAttendance: boolean;
  canViewAttendanceHistory: boolean;
  canApplyLeaves: boolean;
  canViewLeaveBalance: boolean;
  canViewPayslips: boolean;
  canDownloadPayslips: boolean;
  canViewDocuments: boolean;
  canDownloadDocuments: boolean;
  canViewDashboardStats: boolean;
  canViewAnnouncements: boolean;
  canViewPolicies: boolean;
  canRaiseHelpdeskTickets: boolean;
  canViewOrgChart: boolean;
  canViewPerformance: boolean;
  canViewEditProfile: boolean;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Auth types
 */
export interface LoginRequest {
  email: string;
  password: string;
  deviceId?: string;
  deviceType?: string;
  userAgent?: string;
  forceLogin?: boolean;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  employeeId?: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  organizationId: string;
  kycCompleted?: boolean;
  onboardingComplete?: boolean;
  exitAccess?: ExitAccessInfo | null;
}

export interface ExitAccessInfo {
  canViewDashboard: boolean;
  canViewPayslips: boolean;
  canDownloadPayslips: boolean;
  canViewAttendance: boolean;
  canMarkAttendance: boolean;
  canApplyLeave: boolean;
  canViewLeaveBalance: boolean;
  canViewDocuments: boolean;
  canDownloadDocuments: boolean;
  canViewHelpdesk: boolean;
  canCreateTicket: boolean;
  canViewAnnouncements: boolean;
  canViewProfile: boolean;
  accessExpiresAt?: string;
}

export interface RefreshResponse {
  accessToken: string;
}

/**
 * Employee types
 */
export interface EmployeeListItem {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  department: { id: string; name: string } | null;
  designation: { id: string; name: string } | null;
  workMode: string;
  status: string;
  joiningDate: string;
  avatar?: string;
  user?: {
    id?: string;
    role?: string;
    lastLoginAt?: string | null;
    microsoftId?: string | null;
    [key: string]: unknown;
  } | null;
}

export interface EmployeeDetail extends EmployeeListItem {
  personalEmail?: string;
  dateOfBirth?: string;
  gender: string;
  bloodGroup?: string;
  maritalStatus?: string;
  address?: {
    current?: AddressData;
    permanent?: AddressData;
  };
  emergencyContact?: {
    name: string;
    relationship: string;
    phone: string;
    email?: string;
  };
  manager?: { id: string; firstName: string; lastName: string; employeeCode: string };
  officeLocation?: { id: string; name: string };
  probationEndDate?: string;
  documents: DocumentItem[];
  createdAt: string;
  updatedAt: string;
  user?: {
    id?: string;
    role?: string;
    lastLoginAt?: string | null;
    microsoftId?: string | null;
    [key: string]: unknown;
  } | null;
  bankAccountNumber?: string | null;
  currentShift?: {
    id?: string;
    name: string;
    startTime: string;
    endTime: string;
    [key: string]: unknown;
  } | null;
  ctc?: number | string | null;
  exitStatus?: string | null;
  lastWorkingDate?: string | null;
  exitType?: string | null;
}

export interface AddressData {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
}

export interface DocumentItem {
  id: string;
  name: string;
  type: string;
  fileUrl: string;
  status: string;
  uploadedAt: string;
  verifiedAt?: string;
  verifiedBy?: string;
  rejectionReason?: string;
}

export interface CreateEmployeeRequest {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  personalEmail?: string;
  dateOfBirth?: string;
  gender: string;
  departmentId?: string;
  designationId?: string;
  workMode: string;
  officeLocationId?: string;
  managerId?: string;
  joiningDate: string;
  ctc?: number;
  status?: string;
  [key: string]: unknown;
}

/**
 * Dashboard types
 */
export interface DashboardStats {
  totalEmployees: number;
  activeEmployees: number;
  departmentCount: number;
  presentToday: number;
  onLeaveToday: number;
  openPositions: number;
  pendingLeaves: number;
  hiringPassed: number;
  upcomingBirthdays: { id: string; firstName: string; lastName: string; dateOfBirth: string }[];
  recentHires: { id: string; firstName: string; lastName: string; joiningDate: string }[];
}

/**
 * Super Admin Dashboard — company-level analytics
 */
export interface SuperAdminDashboardStats {
  // KPI Grid
  totalEmployees: number;
  activeEmployees: number;
  attritionRate: number; // % employees left in last 12 months
  monthlyPayrollCost: number; // total net pay of last completed payroll
  openPositions: number;
  newHiresThisMonth: number;

  // Trends (last 6 months)
  hiringTrend: { month: string; hires: number; exits: number }[];
  attendanceTrend: { month: string; avgPercentage: number }[];
  leaveTrend: { month: string; totalDays: number }[];

  // Alerts
  alerts: DashboardAlert[];

  // Recent Activity
  recentHires: { id: string; firstName: string; lastName: string; joiningDate: string; department?: string }[];
  recentExits: { id: string; firstName: string; lastName: string; lastWorkingDate: string; department?: string }[];

  // Department headcount
  departmentBreakdown: { name: string; count: number }[];

  // Birthdays
  upcomingBirthdays: { id: string; firstName: string; lastName: string; dateOfBirth: string; avatar?: string }[];
}

export interface DashboardAlert {
  type: 'warning' | 'danger' | 'info';
  title: string;
  message: string;
  action?: string; // route to navigate
}

/**
 * HR Dashboard — daily operations
 */
export interface HRDashboardStats {
  // Today's Attendance Status
  todayAttendance: {
    present: number;
    absent: number;
    late: number;
    onLeave: number;
    notCheckedIn: number;
    workFromHome: number;
    totalActive: number;
  };

  // Action Center — pending counts
  pendingActions: {
    leaveRequests: number;
    regularizations: number;
    helpdeskTickets: number;
    documentsToVerify: number;
    pendingOnboarding: number;
  };

  // Attention Required
  attentionItems: AttentionItem[];

  // Quick Stats
  upcomingBirthdays: { id: string; firstName: string; lastName: string; dateOfBirth: string; avatar?: string }[];
  recentHires: { id: string; firstName: string; lastName: string; joiningDate: string; department?: string }[];

  // Today's leave details
  todayLeaves: { id: string; employeeName: string; leaveType: string; days: number }[];
}

export interface AttentionItem {
  type: 'late' | 'missing_checkout' | 'leave_conflict' | 'probation_ending' | 'document_expiry';
  title: string;
  description: string;
  employeeId?: string;
  employeeName?: string;
  action?: string;
}
