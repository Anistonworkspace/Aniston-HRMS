import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import ProtectedRoute from './ProtectedRoute';

// Lazy-loaded pages
const LoginPage = lazy(() => import('../features/auth/LoginPage'));
const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage'));
const EmployeeListPage = lazy(() => import('../features/employee/EmployeeListPage'));
const EmployeeDetailPage = lazy(() => import('../features/employee/EmployeeDetailPage'));
const AttendancePage = lazy(() => import('../features/attendance/AttendancePage'));
const LeavePage = lazy(() => import('../features/leaves/LeavePage'));
const PayrollPage = lazy(() => import('../features/payroll/PayrollPage'));
const RecruitmentPage = lazy(() => import('../features/recruitment/RecruitmentPage'));
const OnboardingPortal = lazy(() => import('../features/onboarding/OnboardingPortal'));
const PerformancePage = lazy(() => import('../features/performance/PerformancePage'));
const PoliciesPage = lazy(() => import('../features/policies/PoliciesPage'));
const AnnouncementsPage = lazy(() => import('../features/announcements/AnnouncementsPage'));
const ReportsPage = lazy(() => import('../features/reports/ReportsPage'));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage'));
const OrgChartPage = lazy(() => import('../features/orgChart/OrgChartPage'));
const HelpdeskPage = lazy(() => import('../features/helpdesk/HelpdeskPage'));
const ProfilePage = lazy(() => import('../features/profile/ProfilePage'));
const PublicJobsPage = lazy(() => import('../features/jobs/PublicJobsPage'));
const KioskLayout = lazy(() => import('../features/walkIn/KioskLayout'));
const WalkInKioskPage = lazy(() => import('../features/walkIn/WalkInKioskPage'));
const WalkInManagementPage = lazy(() => import('../features/walkIn/WalkInManagementPage'));
const WalkInDetailPage = lazy(() => import('../features/walkIn/WalkInDetailPage'));
const JobDetailPage = lazy(() => import('../features/recruitment/JobDetailPage'));
const CandidateDetailPage = lazy(() => import('../features/recruitment/CandidateDetailPage'));
const PublicApplicationDetailPage = lazy(() => import('../features/recruitment/PublicApplicationDetailPage'));
const DownloadPage = lazy(() => import('../features/pwa/DownloadPage'));
const RosterPage = lazy(() => import('../features/roster/RosterPage'));
const HiringPassedPage = lazy(() => import('../features/hiring/HiringPassedPage'));
const InterviewAssignmentsPage = lazy(() => import('../features/interviews/InterviewAssignmentsPage'));
const AssetManagementPage = lazy(() => import('../features/assets/AssetManagementPage'));
const MyAssetsPage = lazy(() => import('../features/assets/MyAssetsPage'));
const EmployeeAttendanceDetailPage = lazy(() => import('../features/attendance/EmployeeAttendanceDetailPage'));
const ActivityTrackingPage = lazy(() => import('../features/activity/ActivityTrackingPage'));
const PendingApprovalsPage = lazy(() => import('../features/dashboard/PendingApprovalsPage'));
const ExitManagementPage = lazy(() => import('../features/exit/ExitManagementPage'));
const ExitDetailPage = lazy(() => import('../features/exit/ExitDetailPage'));
const InviteAcceptPage = lazy(() => import('../features/invitation/InviteAcceptPage'));
const WhatsAppPage = lazy(() => import('../features/whatsapp/WhatsAppPage'));
const PublicApplyPage = lazy(() => import('../features/public-apply/PublicApplyPage'));
const TrackApplicationPage = lazy(() => import('../features/public-apply/TrackApplicationPage'));
const ActivateAccountPage = lazy(() => import('../features/auth/ActivateAccountPage'));
const KycGatePage = lazy(() => import('../features/kyc/KycGatePage'));
const MyDocumentsPage = lazy(() => import('../features/my-documents/MyDocumentsPage'));
const EmployeeOnboardingPage = lazy(() => import('../features/onboarding/EmployeeOnboardingPage'));
const SendBulkEmailPage = lazy(() => import('../features/employee/SendBulkEmailPage'));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-3 border-brand-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-400">Loading...</p>
      </div>
    </div>
  );
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/onboarding/:token" element={<OnboardingPortal />} />
          <Route path="/onboarding/invite/:token" element={<InviteAcceptPage />} />
          <Route path="/jobs" element={<PublicJobsPage />} />
          <Route path="/apply/:token" element={<PublicApplyPage />} />
          <Route path="/track/:uid" element={<TrackApplicationPage />} />
          <Route path="/track" element={<TrackApplicationPage />} />
          <Route path="/activate/:token" element={<ActivateAccountPage />} />
          <Route path="/download" element={<DownloadPage />} />

          {/* Walk-In Kiosk (public, no auth) */}
          <Route path="/walk-in" element={<KioskLayout />}>
            <Route index element={<WalkInKioskPage />} />
          </Route>

          {/* Employee Onboarding — no sidebar, just the onboarding wizard */}
          <Route path="/employee-onboarding" element={<ProtectedRoute><EmployeeOnboardingPage /></ProtectedRoute>} />

          {/* KYC Gate — no sidebar, just the KYC form */}
          <Route path="/kyc-pending" element={<ProtectedRoute><KycGatePage /></ProtectedRoute>} />

          {/* Employee Detail — standalone (no sidebar), restricted to management */}
          <Route path="/employees/:id" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER']}><EmployeeDetailPage /></ProtectedRoute>} />

          {/* Protected routes */}
          <Route
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/pending-approvals" element={<PendingApprovalsPage />} />
            <Route path="/employees" element={<EmployeeListPage />} />

            {/* Placeholder routes */}
            <Route path="/attendance" element={<AttendancePage />} />
            <Route path="/attendance/employee/:employeeId" element={<EmployeeAttendanceDetailPage />} />
            <Route path="/activity-tracking" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER']}><ActivityTrackingPage /></ProtectedRoute>} />
            <Route path="/leaves" element={<LeavePage />} />
            <Route path="/payroll" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER', 'EMPLOYEE', 'INTERN']}><PayrollPage /></ProtectedRoute>} />
            <Route path="/recruitment" element={<RecruitmentPage />} />
            <Route path="/recruitment/:jobId" element={<JobDetailPage />} />
            <Route path="/recruitment/candidate/:id" element={<CandidateDetailPage />} />
            <Route path="/recruitment/public-applications/:id" element={<PublicApplicationDetailPage />} />
            <Route path="/performance" element={<PerformancePage />} />
            <Route path="/policies" element={<PoliciesPage />} />
            <Route path="/announcements" element={<AnnouncementsPage />} />
            <Route path="/org-chart" element={<OrgChartPage />} />
            <Route path="/helpdesk" element={<HelpdeskPage />} />
            <Route path="/reports" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER']}><ReportsPage /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR']}><SettingsPage /></ProtectedRoute>} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/roster" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR']}><RosterPage /></ProtectedRoute>} />
            <Route path="/hiring-passed" element={<HiringPassedPage />} />
            <Route path="/interview-assignments" element={<InterviewAssignmentsPage />} />
            <Route path="/assets" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']}><AssetManagementPage /></ProtectedRoute>} />
            <Route path="/my-assets" element={<MyAssetsPage />} />
            <Route path="/my-documents" element={<MyDocumentsPage />} />
            <Route path="/walk-in-management" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR']}><WalkInManagementPage /></ProtectedRoute>} />
            <Route path="/walk-in-management/:id" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR']}><WalkInDetailPage /></ProtectedRoute>} />
            <Route path="/send-bulk-email" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR']}><SendBulkEmailPage /></ProtectedRoute>} />
            <Route path="/whatsapp" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR']}><WhatsAppPage /></ProtectedRoute>} />
            <Route path="/exit-management" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR']}><ExitManagementPage /></ProtectedRoute>} />
            <Route path="/exit-management/:id" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR']}><ExitDetailPage /></ProtectedRoute>} />
            <Route path="/more" element={<ProfilePage />} />
          </Route>

          {/* Default redirect */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
