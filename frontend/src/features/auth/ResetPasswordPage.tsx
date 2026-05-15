import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle, XCircle, KeyRound, Eye, EyeOff, Check, X } from 'lucide-react';
import { useResetPasswordMutation } from './authApi';

const PASSWORD_RULES = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'Uppercase letter (A-Z)', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'Lowercase letter (a-z)', test: (p: string) => /[a-z]/.test(p) },
  { label: 'Number (0-9)', test: (p: string) => /[0-9]/.test(p) },
  { label: 'Special character (!@#$...)', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [resetPassword, { isLoading }] = useResetPasswordMutation();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const allRulesPassed = PASSWORD_RULES.every((r) => r.test(password));
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;
  const canSubmit = allRulesPassed && passwordsMatch && !isLoading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !token) return;

    try {
      await resetPassword({ token, password, confirmPassword }).unwrap();
      setSuccess(true);
    } catch (err: any) {
      const msg = err?.data?.error?.message || 'Invalid or expired reset link. Please request a new one.';
      setError(msg);
    }
  };

  if (success) {
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
          <h1 className="text-xl font-display font-bold text-gray-900 mb-2">Password Reset Successful</h1>
          <p className="text-gray-500 text-sm mb-6">
            Your password has been updated. You can now log in with your new password.
          </p>
          <button onClick={() => navigate('/login')} className="btn-primary w-full">
            Go to Login
          </button>
        </motion.div>
      </div>
    );
  }

  if (error) {
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
          <h1 className="text-xl font-display font-bold text-gray-900 mb-2">Reset Failed</h1>
          <p className="text-gray-500 text-sm mb-6">{error}</p>
          <button onClick={() => navigate('/login')} className="btn-primary w-full">
            Back to Login
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50 px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full"
      >
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--primary-highlighted-color)' }}>
            <KeyRound size={32} style={{ color: 'var(--primary-color)' }} />
          </div>
          <h1 className="text-2xl font-display font-bold text-gray-900 mb-2">Create New Password</h1>
          <p className="text-sm text-gray-500">Enter your new password below</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* New Password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter new password"
                className="input-glass w-full text-sm pr-10"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className="input-glass w-full text-sm pr-10"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Password Strength Checklist */}
          {password.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="space-y-1.5 pt-1"
            >
              {PASSWORD_RULES.map((rule) => {
                const passed = rule.test(password);
                return (
                  <div key={rule.label} className="flex items-center gap-2 text-xs">
                    {passed ? (
                      <Check size={14} className="text-emerald-500 shrink-0" />
                    ) : (
                      <X size={14} className="text-gray-300 shrink-0" />
                    )}
                    <span className={passed ? 'text-emerald-600' : 'text-gray-400'}>{rule.label}</span>
                  </div>
                );
              })}
              {confirmPassword.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  {passwordsMatch ? (
                    <Check size={14} className="text-emerald-500 shrink-0" />
                  ) : (
                    <X size={14} className="text-red-400 shrink-0" />
                  )}
                  <span className={passwordsMatch ? 'text-emerald-600' : 'text-red-400'}>Passwords match</span>
                </div>
              )}
            </motion.div>
          )}

          <button type="submit" disabled={!canSubmit} className="btn-primary w-full mt-2">
            {isLoading ? <Loader2 size={18} className="animate-spin mx-auto" /> : 'Reset Password'}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center mt-6">
          Remember your password?{' '}
          <button onClick={() => navigate('/login')} className="hover:underline" style={{ color: 'var(--primary-color)' }}>
            Back to Login
          </button>
        </p>
      </motion.div>
    </div>
  );
}
