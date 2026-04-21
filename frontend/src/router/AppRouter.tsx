import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppUpdateGuard from '../features/app-update/AppUpdateGuard';
import AppShell from '../components/layout/AppShell';
import ProtectedRoute from './ProtectedRoute';
import ErrorBoundary from '../components/ErrorBoundary';
import RouteErrorBoundary from '../components/layout/RouteErrorBoundary';

// Lazy-loaded pages
const LoginPage = lazy(() => import('../features/auth/LoginPage'));
const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage'));
const EmployeeListPage = lazy(() => import('../features/employee/EmployeeListPage'));
const EmployeeDetailPage = lazy(() => import('../features/employee/EmployeeDetailPage'));
const AttendancePage = lazy(() => import('../features/attendance/AttendancePage'));
const LeavePage = lazy(() => import('../features/leaves/LeavePage'));
const PayrollPage = lazy(() => import('../features/payroll/PayrollPage'));
const SalaryTemplatesPage = lazy(() => import('../features/payroll/SalaryTemplatesPage'));
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
const AndroidInstallPage = lazy(() => import('../features/pwa/AndroidInstallPage'));
const IosInstallPage = lazy(() => import('../features/pwa/IosInstallPage'));
const ShareTargetPage = lazy(() => import('../features/pwa/ShareTargetPage'));
const OpenFilePage = lazy(() => import('../features/pwa/OpenFilePage'));
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
const ResetPasswordPage = lazy(() => import('../features/auth/ResetPasswordPage'));
const KycGatePage = lazy(() => import('../features/kyc/KycGatePage'));
const KycHrReviewPage = lazy(() => import('../features/kyc/KycHrReviewPage'));
const MyDocumentsPage = lazy(() => import('../features/my-documents/MyDocumentsPage'));
const EmployeeOnboardingPage = lazy(() => import('../features/onboarding/EmployeeOnboardingPage'));
const SendBulkEmailPage = lazy(() => import('../features/employee/SendBulkEmailPage'));
const BulkEmailPage = lazy(() => import('../features/bulk-email/BulkEmailPage'));

function PageLoader() {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  return (
    <div className="h-[100dvh] bg-surface-1 overflow-hidden">
      {isMobile ? (
        <>
          {/* Mobile skeleton */}
          <div className="h-14 bg-white border-b border-gray-100 flex items-center justify-between px-4">
            <div className="w-24 h-5 bg-gray-100 rounded animate-pulse" />
            <div className="flex gap-3">
              <div className="w-8 h-8 bg-gray-100 rounded-full animate-pulse" />
              <div className="w-8 h-8 bg-gray-100 rounded-full animate-pulse" />
            </div>
          </div>
          <div className="p-4 space-y-4">
            <div className="space-y-2">
              <div className="w-48 h-6 bg-gray-100 rounded animate-pulse" />
              <div className="w-64 h-4 bg-gray-50 rounded animate-pulse" />
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-6 flex items-center justify-center">
              <div className="w-40 h-40 rounded-full bg-gray-100 animate-pulse" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 space-y-2">
                  <div className="w-16 h-3 bg-gray-50 rounded animate-pulse" />
                  <div className="w-12 h-5 bg-gray-100 rounded animate-pulse" />
                </div>
              ))}
            </div>
          </div>
          <div className="fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-gray-100 flex items-center justify-around px-4">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex flex-col items-center gap-1">
                <div className="w-6 h-6 bg-gray-100 rounded animate-pulse" />
                <div className="w-8 h-2 bg-gray-50 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="flex h-full">
          <div className="w-60 bg-white border-r border-gray-200 p-4 space-y-4 hidden md:block">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 bg-brand-100 rounded-lg animate-pulse" />
              <div className="w-20 h-5 bg-gray-100 rounded animate-pulse" />
            </div>
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="flex items-center gap-3 py-2">
                <div className="w-5 h-5 bg-gray-100 rounded animate-pulse" />
                <div className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: `${50 + i * 8}%` }} />
              </div>
            ))}
          </div>
          <div className="flex-1">
            <div className="h-16 bg-white border-b border-gray-100 flex items-center justify-between px-6">
              <div className="w-64 h-9 bg-gray-50 rounded-lg animate-pulse" />
              <div className="w-32 h-8 bg-gray-100 rounded-lg animate-pulse" />
            </div>
            <div className="p-6 space-y-6">
              <div className="w-56 h-7 bg-gray-100 rounded animate-pulse" />
              <div className="grid grid-cols-4 gap-4">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
                    <div className="w-10 h-10 bg-gray-100 rounded-lg animate-pulse" />
                    <div className="w-16 h-7 bg-gray-100 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <AppUpdateGuard>
      <ErrorBoundary>
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
          <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
          <Route path="/download" element={<DownloadPage />} />
          <Route path="/download/android" element={<AndroidInstallPage />} />
          <Route path="/download/ios" element={<IosInstallPage />} />
          {/* PWA OS integrations — no auth required */}
          <Route path="/share-target" element={<ShareTargetPage />} />
          <Route path="/open-file" element={<OpenFilePage />} />

          {/* Walk-In Kiosk (public, no auth) */}
          <Route path="/walk-in" element={<KioskLayout />}>
            <Route index element={<WalkInKioskPage />} />
          </Route>

          {/* Employee Onboarding — no sidebar, just the onboarding wizard */}
          <Route path="/employee-onboarding" element={<ProtectedRoute><EmployeeOnboardingPage /></ProtectedRoute>} />

          {/* KYC Gate — no sidebar, just the KYC form */}
          <Route path="/kyc-pending" element={<ProtectedRoute><RouteErrorBoundary pageName="KYC"><KycGatePage /></RouteErrorBoundary></ProtectedRoute>} />

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
            <Route path="/pending-approvals" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER']}><PendingApprovalsPage /></ProtectedRoute>} />
            <Route path="/employees" element={<EmployeeListPage />} />

            {/* Placeholder routes */}
            <Route path="/attendance" element={<AttendancePage />} />
            <Route path="/attendance/employee/:employeeId" element={<EmployeeAttendanceDetailPage />} />
            <Route path="/activity-tracking" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER']}><ActivityTrackingPage /></ProtectedRoute>} />
            <Route path="/leaves" element={<LeavePage />} />
            <Route path="/payroll" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER', 'EMPLOYEE', 'INTERN']}><RouteErrorBoundary pageName="Payroll"><PayrollPage /></RouteErrorBoundary></ProtectedRoute>} />
            <Route path="/salary-templates" element={<Navigate to="/payroll" replace />} />
            <Route path="/recruitment" element={<RouteErrorBoundary pageName="Recruitment"><RecruitmentPage /></RouteErrorBoundary>} />
            <Route path="/recruitment/:jobId" element={<JobDetailPage />} />
            <Route path="/recruitment/candidate/:id" element={<CandidateDetailPage />} />
            <Route path="/recruitment/public-applications/:id" element={<PublicApplicationDetailPage />} />
            <Route path="/performance" element={<PerformancePage />} />
            <Route path="/policies" element={<PoliciesPage />} />
            <Route path="/announcements" element={<AnnouncementsPage />} />
            <Route path="/org-chart" element={<OrgChartPage />} />
            <Route path="/helpdesk" element={<RouteErrorBoundary pageName="Helpdesk"><HelpdeskPage /></RouteErrorBoundary>} />
            <Route path="/reports" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER']}><RouteErrorBoundary pageName="Reports"><ReportsPage /></RouteErrorBoundary></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR']}><RouteErrorBoundary pageName="Settings"><SettingsPage /></RouteErrorBoundary></ProtectedRoute>} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/roster" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR']}><RosterPage /></ProtectedRoute>} />
            <Route path="/hiring-passed" element={<HiringPassedPage />} />
            <Route path="/interview-assignments" element={<InterviewAssignmentsPage />} />
            <Route path="/assets" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']}><AssetManagementPage /></ProtectedRoute>} />
            <Route path="/my-assets" element={<MyAssetsPage />} />
            <Route path="/my-documents" element={<MyDocumentsPage />} />
            <Route path="/kyc-review" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR']}><KycHrReviewPage /></ProtectedRoute>} />
            <Route path="/walk-in-management" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR']}><WalkInManagementPage /></ProtectedRoute>} />
            <Route path="/walk-in-management/:id" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR']}><WalkInDetailPage /></ProtectedRoute>} />
            <Route path="/send-bulk-email" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR']}><SendBulkEmailPage /></ProtectedRoute>} />
            <Route path="/bulk-email" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR']}><BulkEmailPage /></ProtectedRoute>} />
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
      </ErrorBoundary>
      </AppUpdateGuard>
    </BrowserRouter>
  );
}
