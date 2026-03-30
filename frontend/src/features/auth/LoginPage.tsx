import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Loader2, Users, BarChart3, Shield, Clock, X, Mail } from 'lucide-react';
import { useLoginMutation } from './authApi';
import { setCredentials } from './authSlice';
import { useAppDispatch, useAppSelector } from '../../app/store';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showForgot, setShowForgot] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [login, { isLoading }] = useLoginMutation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const isAuthenticated = useAppSelector((state: any) => state.auth.isAuthenticated);

  // Redirect if already logged in
  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard', { replace: true });
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await login({ email, password }).unwrap();
      if (result.success && result.data) {
        dispatch(setCredentials({
          user: result.data.user,
          accessToken: result.data.accessToken,
        }));
        toast.success('Welcome back!');
        navigate('/dashboard');
      }
    } catch (err: any) {
      const message = err?.data?.error?.message || 'Login failed. Please try again.';
      toast.error(message);
    }
  };

  const handleDemoLogin = () => {
    setEmail('superadmin@anistonav.com');
    setPassword('Superadmin@1234');
  };

  return (
    <div className="min-h-screen flex">
      {/* Left — Form Side */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
        className="flex-1 flex flex-col justify-center px-6 sm:px-12 lg:px-20 xl:px-28 bg-white"
      >
        <div className="w-full max-w-[420px] mx-auto">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-10">
            <img src="/logo.png" alt="Aniston" className="w-10 h-10 object-contain" />
            <span className="text-xl font-display font-bold text-gray-900">Aniston HRMS</span>
          </div>

          {/* Heading */}
          <h1 className="text-2xl font-display font-bold text-gray-900 mb-1">Sign in</h1>
          <p className="text-gray-500 text-sm mb-8">to access Aniston HRMS</p>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address or mobile number"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all"
                required
              />
            </div>

            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 pr-12 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center text-gray-500 gap-2 cursor-pointer">
                <input type="checkbox" className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                Remember me
              </label>
              <button type="button" onClick={() => setShowForgot(true)} className="text-brand-600 hover:text-brand-700 font-medium transition-colors">
                Forgot password?
              </button>
            </div>

            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              type="submit"
              disabled={isLoading}
              className="w-full bg-brand-600 hover:bg-brand-700 text-white py-3 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {isLoading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : null}
              {isLoading ? 'Signing in...' : 'Sign In'}
            </motion.button>
          </form>

          <p className="text-center text-xs text-gray-400 mt-6">
            Contact your HR administrator to get an invitation link
          </p>

          {/* Demo login — dev only */}
          {import.meta.env.DEV && (
            <button
              onClick={handleDemoLogin}
              className="w-full text-center text-xs text-gray-400 hover:text-brand-600 mt-4 transition-colors"
            >
              Demo — Click to fill admin credentials
            </button>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-gray-300 text-xs mt-12">
          &copy; {new Date().getFullYear()} Aniston Technologies LLP. All rights reserved.
        </p>
      </motion.div>

      {/* Right — Brand Side (hidden on mobile) */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="hidden lg:flex lg:flex-1 bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 flex-col justify-center items-center p-12 xl:p-20 relative overflow-hidden"
      >
        {/* Decorative circles */}
        <div className="absolute top-10 right-10 w-72 h-72 bg-white/5 rounded-full blur-2xl" />
        <div className="absolute bottom-10 left-10 w-56 h-56 bg-brand-400/10 rounded-full blur-2xl" />
        <div className="absolute top-1/2 left-1/3 w-40 h-40 bg-white/5 rounded-full" />

        <div className="relative z-10 max-w-md text-center">
          {/* Logo mark */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.4, type: 'spring', stiffness: 150 }}
            className="inline-flex items-center justify-center w-24 h-24 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 mb-8 p-3"
          >
            <img src="/logo.png" alt="Aniston" className="w-full h-full object-contain brightness-0 invert" />
          </motion.div>

          <h2 className="text-3xl font-display font-bold text-white mb-4">
            Welcome to Aniston HRMS
          </h2>
          <p className="text-white/70 text-base leading-relaxed mb-10">
            The complete HR platform built for modern organizations. Manage your workforce with intelligence.
          </p>

          {/* Feature highlights */}
          <div className="grid grid-cols-2 gap-4 text-left">
            {[
              { icon: Users, label: 'Employee Management', desc: 'Complete lifecycle' },
              { icon: Clock, label: 'Smart Attendance', desc: '3 tracking modes' },
              { icon: BarChart3, label: 'Payroll & Compliance', desc: 'Indian statutory' },
              { icon: Shield, label: 'AI Recruitment', desc: 'Smart scoring' },
            ].map((feature, i) => (
              <motion.div
                key={feature.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 + i * 0.1 }}
                className="bg-white/10 backdrop-blur-sm border border-white/10 rounded-xl p-4"
              >
                <feature.icon size={20} className="text-white/80 mb-2" />
                <p className="text-white text-sm font-semibold">{feature.label}</p>
                <p className="text-white/50 text-xs mt-0.5">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Forgot Password Modal */}
      {showForgot && <ForgotPasswordModal onClose={() => setShowForgot(false)} />}
    </div>
  );
}

function ForgotPasswordModal({ onClose }: { onClose: () => void }) {
  const [forgotEmail, setForgotEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail) return;
    setSending(true);
    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
      await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      });
      setSent(true);
    } catch {
      // Even on error, show success to prevent email enumeration
      setSent(true);
    }
    setSending(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-display font-semibold text-gray-800">Reset Password</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        {sent ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <Mail size={24} className="text-emerald-500" />
            </div>
            <p className="text-sm text-gray-700 font-medium">Check your email</p>
            <p className="text-xs text-gray-500 mt-1">If an account exists with that email, we've sent a password reset link.</p>
            <button onClick={onClose} className="btn-primary mt-4 text-sm w-full">Done</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-gray-500">Enter your email and we'll send you a link to reset your password.</p>
            <input type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)}
              placeholder="your@email.com" className="input-glass w-full" required autoFocus />
            <button type="submit" disabled={sending} className="btn-primary w-full flex items-center justify-center gap-2">
              {sending && <Loader2 size={16} className="animate-spin" />} Send Reset Link
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
