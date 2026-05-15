import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle, XCircle, Shield, Building2 } from 'lucide-react';
import { useValidateActivationQuery, useCompleteActivationMutation } from './activationApi';
import { setCredentials } from './authSlice';
import { useAppDispatch } from '../../app/store';
import toast from 'react-hot-toast';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

export default function ActivateAccountPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [searchParams] = useSearchParams();
  const [completeActivation, { isLoading: completing }] = useCompleteActivationMutation();
  const { data: validationRes, isLoading: validating, isError } = useValidateActivationQuery(token!, { skip: !token });

  const validation = validationRes?.data;
  const [activated, setActivated] = useState(false);

  // Handle SSO callback: if returning from Microsoft SSO with accessToken, complete activation
  useEffect(() => {
    const accessToken = searchParams.get('accessToken');
    const userParam = searchParams.get('user');

    if (accessToken && userParam && token && !activated) {
      (async () => {
        try {
          await completeActivation(token).unwrap();
          const user = JSON.parse(decodeURIComponent(userParam));
          dispatch(setCredentials({ user, accessToken }));
          window.history.replaceState({}, '', `/activate/${token}`);
          setActivated(true);
          toast.success('Account activated successfully!');
          // Redirect to profile with onboarding flag
          setTimeout(() => navigate('/profile?onboarding=true', { replace: true }), 1500);
        } catch {
          toast.error('Failed to complete activation');
        }
      })();
    }
  }, [searchParams, token, completeActivation, dispatch, navigate, activated]);

  if (validating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={32} className="animate-spin" style={{ color: 'var(--primary-color)' }} />
          <p className="text-sm text-gray-500">Validating activation link...</p>
        </div>
      </div>
    );
  }

  if (isError || !validation || !validation.valid) {
    const reason = validation?.reason;
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 via-white to-orange-50">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-2xl shadow-xl p-8 max-w-md mx-4 text-center"
        >
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <XCircle size={32} className="text-red-500" />
          </div>
          <h1 className="text-xl font-display font-bold text-gray-900 mb-2">
            {reason === 'expired' ? 'Activation Link Expired' : reason === 'already_activated' ? 'Already Activated' : 'Invalid Activation Link'}
          </h1>
          <p className="text-gray-500 text-sm mb-6">
            {reason === 'expired'
              ? 'This activation link has expired. Please contact your HR administrator to receive a new one.'
              : reason === 'already_activated'
              ? 'Your account has already been activated. You can log in normally.'
              : 'This activation link is not valid. Please contact your HR administrator.'}
          </p>
          {reason === 'already_activated' ? (
            <button onClick={() => navigate('/login')} className="btn-primary w-full">
              Go to Login
            </button>
          ) : (
            <p className="text-xs text-gray-400">Contact HR for assistance</p>
          )}
        </motion.div>
      </div>
    );
  }

  if (activated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 via-white to-emerald-50">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-2xl shadow-xl p-8 max-w-md mx-4 text-center"
        >
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={32} className="text-emerald-500" />
          </div>
          <h1 className="text-xl font-display font-bold text-gray-900 mb-2">Account Activated!</h1>
          <p className="text-gray-500 text-sm">Redirecting you to complete your profile...</p>
          <Loader2 size={20} className="animate-spin mx-auto mt-4" style={{ color: 'var(--primary-color)' }} />
        </motion.div>
      </div>
    );
  }

  // Show activation page with SSO button
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-xl p-8 max-w-md mx-4 w-full"
      >
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--primary-highlighted-color)' }}>
            <Shield size={32} style={{ color: 'var(--primary-color)' }} />
          </div>
          <h1 className="text-2xl font-display font-bold text-gray-900 mb-2">Activate Your Account</h1>
          <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
            <Building2 size={14} className="text-gray-400" />
            <span>{validation.organizationName}</span>
          </div>
        </div>

        <p className="text-sm text-gray-500 text-center mb-6">
          Sign in with your Microsoft account to activate your Aniston HRMS access.
        </p>

        <button
          onClick={() => {
            // Redirect to Microsoft SSO, but with a returnTo param so we come back here
            window.location.href = `${API_URL}/auth/microsoft?returnTo=${encodeURIComponent(`/activate/${token}`)}`;
          }}
          disabled={completing}
          className="w-full flex items-center justify-center gap-3 px-6 py-3 rounded-xl border-2 border-gray-200 transition-all text-sm font-semibold text-gray-700"
        >
          {completing ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <svg width="20" height="20" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="9" height="9" fill="#f25022" />
              <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
              <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
            </svg>
          )}
          Sign in with Microsoft
        </button>

        <p className="text-xs text-gray-400 text-center mt-6">
          By activating, you agree to access your organization's HRMS portal.
        </p>
      </motion.div>
    </div>
  );
}
