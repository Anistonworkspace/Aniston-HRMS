import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import ProtectedRoute from './ProtectedRoute';

// Lazy-loaded pages
const LoginPage = lazy(() => import('../features/auth/LoginPage'));
const RegisterPage = lazy(() => import('../features/auth/RegisterPage'));
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

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
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
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/onboarding/:token" element={<OnboardingPortal />} />

          {/* Protected routes */}
          <Route
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/employees" element={<EmployeeListPage />} />
            <Route path="/employees/:id" element={<EmployeeDetailPage />} />

            {/* Placeholder routes */}
            <Route path="/attendance" element={<AttendancePage />} />
            <Route path="/leaves" element={<LeavePage />} />
            <Route path="/payroll" element={<PayrollPage />} />
            <Route path="/recruitment" element={<RecruitmentPage />} />
            <Route path="/performance" element={<PerformancePage />} />
            <Route path="/policies" element={<PoliciesPage />} />
            <Route path="/announcements" element={<AnnouncementsPage />} />
            <Route path="/helpdesk" element={<PlaceholderPage title="Helpdesk" />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<PlaceholderPage title="Settings" />} />
            <Route path="/profile" element={<PlaceholderPage title="Profile" />} />
            <Route path="/more" element={<PlaceholderPage title="More" />} />
          </Route>

          {/* Default redirect */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="page-container">
      <div className="layer-card p-12 text-center">
        <h1 className="text-2xl font-display font-bold text-gray-800">{title}</h1>
        <p className="text-gray-400 mt-2">This module is coming soon in Phase 2.</p>
      </div>
    </div>
  );
}
