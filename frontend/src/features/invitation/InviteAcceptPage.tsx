import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle2, AlertTriangle, Eye, EyeOff, Building2, Shield } from 'lucide-react';
import { useValidateInvitationQuery, useCompleteInvitationMutation } from './invitationApi';
import { useAppDispatch } from '../../app/store';
import { setCredentials } from '../auth/authSlice';
import toast from 'react-hot-toast';

/** Password strength calculator */
function getPasswordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;

  if (score <= 2) return { score, label: 'Weak', color: 'bg-red-500' };
  if (score <= 4) return { score, label: 'Medium', color: 'bg-amber-500' };
  return { score, label: 'Strong', color: 'bg-green-500' };
}

export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { data, isLoading, isError } = useValidateInvitationQuery(token || '', { skip: !token });
  const [complete, { isLoading: completing }] = useCompleteInvitationMutation();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [success, setSuccess] = useState<any>(null);
  const [redirecting, setRedirecting] = useState(false);

  const invitation = data?.data;
  const strength = useMemo(() => getPasswordStrength(password), [password])

  // Pre-fill email from invitation
  useEffect(() => {
    if (invitation?.email) setEmail(invitation.email);
  }, [invitation?.email]);

  // Handle redirect after successful account creation — driven by state, not setTimeout
  useEffect(() => {
    if (!success || redirecting) return;
    const resData = success;

    if (resData.accessToken && resData.user) {
      // Give a brief moment for the success screen to display, then redirect
      const timer = setTimeout(() => {
        setRedirecting(true);
        if (resData.user.onboardingComplete === false) {
          navigate('/employee-onboarding', { replace: true });
        } else if (resData.user.kycCompleted === false) {
          navigate('/kyc-pending', { replace: true });
        } else {
          navigate('/dashboard', { replace: true });
        }
      }, 1200);
      return () => clearTimeout(timer);
    } else {
      const timer = setTimeout(() => {
        setRedirecting(true);
        navigate('/login', { replace: true });
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [success, redirecting, navigate]);

  const passwordValid = password.length >= 8 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^a-zA-Z0-9]/.test(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (!passwordValid) {
      toast.error('Password must contain uppercase, lowercase, number, and special character');
      return;
    }

    try {
      const res = await complete({
        token: token!,
        data: { firstName, lastName, email, phone, password },
      }).unwrap();

      const resData = res.data;

      // Auto-login if tokens are returned — set credentials FIRST, then show success
      if (resData.accessToken && resData.user) {
        dispatch(setCredentials({ user: resData.user, accessToken: resData.accessToken }));
        toast.success('Account created! Setting up your workspace...');
      } else {
        toast.success('Account created! Redirecting to login...');
      }

      // Setting success triggers the useEffect redirect
      setSuccess(resData);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to create account');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin" style={{ color: 'var(--primary-color)' }} />
      </div>
    );
  }

  if (isError || !invitation?.valid) {
    const reason = invitation?.reason;
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <AlertTriangle size={48} className="mx-auto text-amber-500 mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            {reason === 'expired' ? 'Invitation Expired' : reason === 'already_accepted' ? 'Already Accepted' : 'Invalid Invitation'}
          </h1>
          <p className="text-sm text-gray-500">
            {reason === 'expired'
              ? 'This invitation link has expired. Please contact HR for a new invitation.'
              : reason === 'already_accepted'
              ? 'This invitation has already been used. You can log in with your credentials.'
              : 'This invitation link is invalid. Please check the link or contact HR.'}
          </p>
          <button onClick={() => navigate('/login')} className="btn-primary mt-6 text-sm">
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center px-4">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <CheckCircle2 size={48} className="mx-auto text-green-500 mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Account Created!</h1>
          <p className="text-sm text-gray-500 mb-1">Employee Code: <span className="font-mono font-semibold">{success.employeeCode}</span></p>
          <p className="text-sm text-gray-500 mb-4">
            {redirecting
              ? 'Redirecting...'
              : success.accessToken
                ? 'Setting up your workspace...'
                : 'Redirecting to login...'}
          </p>
          <Loader2 size={20} className="animate-spin mx-auto" style={{ color: 'var(--primary-color)' }} />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] overflow-y-auto bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="flex min-h-full items-center justify-center px-4 py-8">
      <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className="bg-white rounded-2xl shadow-xl p-8 max-w-lg w-full">
        {/* Org Header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: 'var(--primary-highlighted-color)' }}>
            <Building2 size={28} style={{ color: 'var(--primary-color)' }} />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Join {invitation.organization?.name || 'the team'}</h1>
          <p className="text-sm text-gray-500 mt-1">Set your password to create your account</p>
          {invitation.role && invitation.role !== 'EMPLOYEE' && (
            <span className="inline-flex items-center gap-1 mt-2 px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
              <Shield size={12} /> {invitation.role.replace(/_/g, ' ')}
            </span>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
              <input value={firstName} onChange={e => setFirstName(e.target.value)} required
                className="input-glass w-full text-sm" placeholder="John" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
              <input value={lastName} onChange={e => setLastName(e.target.value)} required
                className="input-glass w-full text-sm" placeholder="Doe" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" required
              className="input-glass w-full text-sm bg-gray-50" placeholder="you@example.com"
              readOnly={!!invitation.email} />
            {invitation.email && (
              <p className="text-xs text-gray-400 mt-1">Email is pre-filled from your invitation</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input value={phone} onChange={e => setPhone(e.target.value)}
              className="input-glass w-full text-sm" placeholder="+91 9876543210" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Create Password</label>
            <div className="relative">
              <input value={password} onChange={e => setPassword(e.target.value)}
                type={showPassword ? 'text' : 'password'} required minLength={8}
                className="input-glass w-full text-sm pr-10" placeholder="Minimum 8 characters" />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {/* Password strength bar */}
            {password.length > 0 && (
              <div className="mt-2">
                <div className="flex gap-1 mb-1">
                  {[1, 2, 3, 4, 5, 6].map(i => (
                    <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= strength.score ? strength.color : 'bg-gray-200'}`} />
                  ))}
                </div>
                <p className={`text-xs ${strength.score <= 2 ? 'text-red-500' : strength.score <= 4 ? 'text-amber-500' : 'text-green-500'}`}>
                  {strength.label}
                </p>
                <ul className="text-xs text-gray-400 mt-1 space-y-0.5">
                  <li className={/[a-z]/.test(password) ? 'text-green-500' : ''}>Lowercase letter</li>
                  <li className={/[A-Z]/.test(password) ? 'text-green-500' : ''}>Uppercase letter</li>
                  <li className={/\d/.test(password) ? 'text-green-500' : ''}>Number</li>
                  <li className={/[^a-zA-Z0-9]/.test(password) ? 'text-green-500' : ''}>Special character (!@#$...)</li>
                </ul>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
            <input value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              type="password" required className="input-glass w-full text-sm" placeholder="Repeat password" />
            {confirmPassword && confirmPassword !== password && (
              <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
            )}
          </div>

          <button type="submit"
            disabled={completing || !firstName || !lastName || !email || !passwordValid || password !== confirmPassword}
            className="btn-primary w-full flex items-center justify-center gap-2 text-sm mt-2 disabled:opacity-50 disabled:cursor-not-allowed">
            {completing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            Create Account
          </button>
        </form>
      </motion.div>
      </div>
    </div>
  );
}
