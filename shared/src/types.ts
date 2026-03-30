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
