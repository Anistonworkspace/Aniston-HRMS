import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { setCredentials } from './authSlice';
import { useAppDispatch } from '../../app/store';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  useEffect(() => {
    const accessToken = searchParams.get('accessToken');
    const userParam = searchParams.get('user');

    if (accessToken && userParam) {
      try {
        const user = JSON.parse(decodeURIComponent(userParam));
        dispatch(setCredentials({ user, accessToken }));

        // Clear sensitive data from URL
        window.history.replaceState({}, '', '/auth/callback');

        toast.success('Welcome back!');
        navigate('/dashboard', { replace: true });
      } catch {
        toast.error('SSO login failed — invalid response');
        navigate('/login', { replace: true });
      }
    } else {
      const error = searchParams.get('error');
      if (error) toast.error(decodeURIComponent(error));
      navigate('/login', { replace: true });
    }
  }, [searchParams, dispatch, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={32} className="animate-spin" style={{ color: 'var(--primary-color)' }} />
        <p className="text-sm text-gray-500">Completing sign in...</p>
      </div>
    </div>
  );
}
