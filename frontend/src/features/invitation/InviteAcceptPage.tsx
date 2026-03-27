import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle2, AlertTriangle, Eye, EyeOff, Building2 } from 'lucide-react';
import { useValidateInvitationQuery, useCompleteInvitationMutation } from './invitationApi';
import toast from 'react-hot-toast';

export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
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

  const invitation = data?.data;

  // Pre-fill email from invitation
  useEffect(() => {
    if (invitation?.email) setEmail(invitation.email);
  }, [invitation?.email]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    try {
      const res = await complete({
        token: token!,
        data: { firstName, lastName, email, phone, password },
      }).unwrap();
      setSuccess(res.data);
      toast.success('Account created! Redirecting to onboarding...');
      // Redirect to the 7-step onboarding wizard after 2 seconds
      setTimeout(() => {
        navigate(res.data.onboardingUrl);
      }, 2000);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to create account');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-brand-600" />
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
          <p className="text-sm text-gray-500">Redirecting to onboarding wizard...</p>
          <Loader2 size={20} className="animate-spin text-brand-600 mx-auto mt-4" />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center px-4 py-8">
      <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className="bg-white rounded-2xl shadow-xl p-8 max-w-lg w-full">
        {/* Org Header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-xl bg-brand-100 flex items-center justify-center mx-auto mb-3">
            <Building2 size={28} className="text-brand-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Join {invitation.organization?.name || 'the team'}</h1>
          <p className="text-sm text-gray-500 mt-1">Complete your details below to create your account</p>
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
              className="input-glass w-full text-sm" placeholder="you@example.com"
              readOnly={!!invitation.email} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input value={phone} onChange={e => setPhone(e.target.value)}
              className="input-glass w-full text-sm" placeholder="9876543210" />
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
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
            <input value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              type="password" required className="input-glass w-full text-sm" placeholder="Repeat password" />
          </div>

          <button type="submit" disabled={completing || !firstName || !lastName || !email || !password}
            className="btn-primary w-full flex items-center justify-center gap-2 text-sm mt-2">
            {completing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            Create Account & Start Onboarding
          </button>
        </form>
      </motion.div>
    </div>
  );
}
