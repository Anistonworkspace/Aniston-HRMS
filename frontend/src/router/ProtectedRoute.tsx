import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../app/store';
import { useGetMeQuery } from '../features/auth/authApi';
import { setUser, logout, setSessionEndReason } from '../features/auth/authSlice';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

// Roles that bypass KYC and onboarding gates (they are admins, not regular employees)
const GATE_EXEMPT_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];

export default function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { isAuthenticated, user, accessToken, hydrating } = useAppSelector((state) => state.auth);
  const location = useLocation();
  const dispatch = useAppDispatch();

  // All hooks must be called unconditionally before any early return (Rules of Hooks)
  const shouldFetchUser = isAuthenticated && !user && !!accessToken;
  // Re-fetch /auth/me when user came from login (department is absent or undefined — login
  // response is a subset of /auth/me). This ensures full profile data is always loaded.
  const userNeedsHydration = isAuthenticated && !!user && !!accessToken && !user.department;
  // Also re-fetch /auth/me when Redux says onboarding incomplete — catches stale token after completion
  const shouldVerifyOnboarding = isAuthenticated && !!user && user.onboardingComplete === false && !GATE_EXEMPT_ROLES.includes(user?.role || '');
  const { data: meData, isLoading, isError, error: meError } = useGetMeQuery(undefined, {
    skip: (!shouldFetchUser && !userNeedsHydration && !shouldVerifyOnboarding) || hydrating,
  });

  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (meData?.data) {
      // Always sync fresh /auth/me data into Redux — fixes stale onboardingComplete after completion
      dispatch(setUser(meData.data));
    }
  }, [meData, dispatch]);

  useEffect(() => {
    if (isError && (shouldFetchUser || userNeedsHydration)) {
      const errCode = (meError as any)?.data?.error?.code;
      if (errCode === 'SESSION_REVOKED') {
        dispatch(setSessionEndReason('SESSION_REVOKED'));
      }
      dispatch(logout());
    }
  }, [isError, shouldFetchUser, userNeedsHydration, dispatch, meError]);

  // Safety timeout: if token verification takes >10s, force logout (stale token)
  useEffect(() => {
    if (!shouldFetchUser) return;
    const t = setTimeout(() => setTimedOut(true), 10000);
    return () => clearTimeout(t);
  }, [shouldFetchUser]);

  useEffect(() => {
    if (timedOut && shouldFetchUser) {
      dispatch(logout());
    }
  }, [timedOut, shouldFetchUser, dispatch]);

  // While AuthHydrator is restoring session from refresh token cookie, show skeleton
  if (hydrating) return <AppLoadingSkeleton />;

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Show app skeleton while restoring user session (looks like the real app)
  if (shouldFetchUser || (isAuthenticated && !user && isLoading)) {
    return <AppLoadingSkeleton />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  // Onboarding Gate: redirect new employees with incomplete onboarding
  // Don't gate the onboarding route itself, profile, logout, or MFA-required page
  const isOnboardingExemptRoute =
    location.pathname === '/employee-onboarding' ||
    location.pathname === '/mfa-required' ||
    location.pathname === '/kyc-pending' ||
    location.pathname === '/profile';

  // Use fresh /auth/me value when available to avoid acting on a stale token
  const freshOnboardingComplete = meData?.data?.onboardingComplete;
  const effectiveOnboardingComplete = freshOnboardingComplete !== undefined
    ? freshOnboardingComplete
    : user?.onboardingComplete;

  if (
    user &&
    !GATE_EXEMPT_ROLES.includes(user.role) &&
    effectiveOnboardingComplete === false &&
    !user.exitAccess &&
    !isOnboardingExemptRoute
  ) {
    // If we're still fetching fresh status, show skeleton rather than redirect prematurely
    if (shouldVerifyOnboarding && isLoading) return <AppLoadingSkeleton />;
    return <Navigate to="/employee-onboarding" replace />;
  }

  // Profile Completion Gate: redirect employees who haven't filled all required profile fields.
  // If onboarding was already completed, the only missing piece is MFA → show dedicated MFA page
  // instead of routing them back through the full 6-step onboarding wizard.
  if (
    user &&
    !GATE_EXEMPT_ROLES.includes(user.role) &&
    user.onboardingComplete !== false &&
    user.profileComplete === false &&
    !user.exitAccess &&
    !isOnboardingExemptRoute
  ) {
    return <Navigate to="/mfa-required" replace />;
  }

  // KYC Gate: route based on kycStatus
  //   PENDING / REUPLOAD_REQUIRED / REJECTED → back to onboarding Step 6 (upload docs in same wizard)
  //   SUBMITTED / PROCESSING / PENDING_HR_REVIEW → /kyc-pending (waiting for HR review)
  const isKycExemptRoute = location.pathname === '/kyc-pending' || location.pathname === '/profile' || location.pathname === '/employee-onboarding' || location.pathname === '/mfa-required';
  if (
    user &&
    !GATE_EXEMPT_ROLES.includes(user.role) &&
    user.onboardingComplete !== false &&
    user.profileComplete !== false &&
    user.kycCompleted === false &&
    !user.exitAccess
  ) {
    const docStatus = user.kycStatus ?? 'PENDING';
    const needsUpload = ['PENDING', 'REUPLOAD_REQUIRED', 'REJECTED'].includes(docStatus);
    if (needsUpload) {
      if (!isOnboardingExemptRoute) return <Navigate to="/employee-onboarding" replace />;
    } else {
      // SUBMITTED / PROCESSING / PENDING_HR_REVIEW — waiting for review
      if (!isKycExemptRoute) return <Navigate to="/kyc-pending" replace />;
    }
  }

  return <>{children}</>;
}

const SKELETON_WIDTHS = [68, 82, 75, 60, 90, 72, 65, 78];

/** Skeleton that mimics the real app layout — shows instantly on refresh */
function AppLoadingSkeleton() {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  if (isMobile) {
    return (
      <div className="min-h-screen bg-surface-1">
        {/* Mobile topbar skeleton */}
        <div className="h-14 bg-white border-b border-gray-100 flex items-center justify-between px-4">
          <div className="w-24 h-5 bg-gray-100 rounded animate-pulse" />
          <div className="flex gap-3">
            <div className="w-8 h-8 bg-gray-100 rounded-full animate-pulse" />
            <div className="w-8 h-8 bg-gray-100 rounded-full animate-pulse" />
          </div>
        </div>

        {/* Content skeleton */}
        <div className="p-4 space-y-4">
          {/* Greeting skeleton */}
          <div className="space-y-2">
            <div className="w-48 h-6 bg-gray-100 rounded animate-pulse" />
            <div className="w-64 h-4 bg-gray-50 rounded animate-pulse" />
          </div>

          {/* Stat cards skeleton */}
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 space-y-2">
                <div className="w-8 h-8 bg-gray-100 rounded-lg animate-pulse" />
                <div className="w-12 h-6 bg-gray-100 rounded animate-pulse" />
                <div className="w-20 h-3 bg-gray-50 rounded animate-pulse" />
              </div>
            ))}
          </div>

          {/* Quick actions skeleton */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
            <div className="w-28 h-5 bg-gray-100 rounded animate-pulse" />
            <div className="h-16 bg-gray-50 rounded-xl animate-pulse" />
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-12 bg-gray-50 rounded-lg animate-pulse" />
              ))}
            </div>
          </div>
        </div>

        {/* Mobile bottom nav skeleton */}
        <div className="fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-gray-100 flex items-center justify-around px-4">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="w-6 h-6 bg-gray-100 rounded animate-pulse" />
              <div className="w-8 h-2 bg-gray-50 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Desktop skeleton
  return (
    <div className="min-h-screen bg-surface-1 flex">
      {/* Sidebar skeleton */}
      <div className="w-60 bg-white border-r border-gray-200 p-4 space-y-4 hidden md:block">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 bg-brand-100 rounded-lg animate-pulse" />
          <div className="w-20 h-5 bg-gray-100 rounded animate-pulse" />
        </div>
        {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
          <div key={i} className="flex items-center gap-3 py-2">
            <div className="w-5 h-5 bg-gray-100 rounded animate-pulse" />
            <div className={`h-4 bg-gray-100 rounded animate-pulse`} style={{ width: `${SKELETON_WIDTHS[(i - 1) % SKELETON_WIDTHS.length]}%` }} />
          </div>
        ))}
      </div>

      {/* Main content */}
      <div className="flex-1">
        {/* Topbar skeleton */}
        <div className="h-16 bg-white border-b border-gray-100 flex items-center justify-between px-6">
          <div className="w-64 h-9 bg-gray-50 rounded-lg animate-pulse" />
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gray-100 rounded-full animate-pulse" />
            <div className="w-32 h-8 bg-gray-100 rounded-lg animate-pulse" />
          </div>
        </div>

        {/* Page content skeleton */}
        <div className="p-6 space-y-6">
          <div className="space-y-2">
            <div className="w-56 h-7 bg-gray-100 rounded animate-pulse" />
            <div className="w-80 h-4 bg-gray-50 rounded animate-pulse" />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
                <div className="w-10 h-10 bg-gray-100 rounded-lg animate-pulse" />
                <div className="w-16 h-7 bg-gray-100 rounded animate-pulse" />
                <div className="w-24 h-3 bg-gray-50 rounded animate-pulse" />
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
              <div className="w-32 h-5 bg-gray-100 rounded animate-pulse" />
              <div className="h-20 bg-gray-50 rounded-xl animate-pulse" />
              <div className="grid grid-cols-2 gap-3">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="h-12 bg-gray-50 rounded-lg animate-pulse" />
                ))}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-3">
              <div className="w-36 h-5 bg-gray-100 rounded animate-pulse" />
              {[1, 2, 3].map(i => (
                <div key={i} className="h-12 bg-gray-50 rounded-lg animate-pulse" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
