import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../app/store';
import { useGetMeQuery } from '../features/auth/authApi';
import { setUser, logout } from '../features/auth/authSlice';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

// Roles that bypass KYC and onboarding gates (they are admins, not regular employees)
const GATE_EXEMPT_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];

export default function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { isAuthenticated, user, accessToken } = useAppSelector((state) => state.auth);
  const location = useLocation();
  const dispatch = useAppDispatch();

  // Fetch user info when we have a token but no user (e.g., after page refresh)
  const shouldFetchUser = isAuthenticated && !user && !!accessToken;
  const { data: meData, isLoading, isError } = useGetMeQuery(undefined, {
    skip: !shouldFetchUser,
  });

  useEffect(() => {
    if (meData?.data) {
      dispatch(setUser(meData.data));
    }
  }, [meData, dispatch]);

  useEffect(() => {
    if (isError && shouldFetchUser) {
      dispatch(logout());
    }
  }, [isError, shouldFetchUser, dispatch]);

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Show loading while restoring user session or waiting for user data to hydrate
  if (shouldFetchUser || (isAuthenticated && !user && isLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-brand-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-400">Loading your workspace...</p>
        </div>
      </div>
    );
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  // Onboarding Gate: redirect new employees with incomplete onboarding
  // Don't gate the onboarding route itself, profile, or logout
  const isOnboardingExemptRoute =
    location.pathname === '/employee-onboarding' ||
    location.pathname === '/kyc-pending' ||
    location.pathname === '/profile';

  if (
    user &&
    !GATE_EXEMPT_ROLES.includes(user.role) &&
    user.onboardingComplete === false &&
    !user.exitAccess &&
    !isOnboardingExemptRoute
  ) {
    return <Navigate to="/employee-onboarding" replace />;
  }

  // KYC Gate: redirect employees with incomplete KYC to the KYC page
  const isKycExemptRoute = location.pathname === '/kyc-pending' || location.pathname === '/profile' || location.pathname === '/employee-onboarding';
  if (
    user &&
    !GATE_EXEMPT_ROLES.includes(user.role) &&
    user.onboardingComplete !== false && // Only after onboarding is done
    user.kycCompleted === false &&
    !user.exitAccess &&
    !isKycExemptRoute
  ) {
    return <Navigate to="/kyc-pending" replace />;
  }

  return <>{children}</>;
}
