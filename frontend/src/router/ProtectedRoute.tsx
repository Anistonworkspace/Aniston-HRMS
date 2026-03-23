import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../app/store';
import { useGetMeQuery } from '../features/auth/authApi';
import { setUser, logout } from '../features/auth/authSlice';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

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
      // Token is invalid/expired and refresh also failed — log out
      dispatch(logout());
    }
  }, [isError, shouldFetchUser, dispatch]);

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Show loading while restoring user session
  if (shouldFetchUser && isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-brand-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-400">Restoring session...</p>
        </div>
      </div>
    );
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
