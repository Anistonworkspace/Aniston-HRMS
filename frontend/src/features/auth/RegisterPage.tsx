import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Loader2, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    company: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // Registration API will be implemented later
    setTimeout(() => {
      setIsLoading(false);
      toast.success('Account created! Please sign in.');
      navigate('/login');
    }, 1500);
  };

  return (
    <div className="min-h-screen flex">
      {/* Left — Brand Side (hidden on mobile) */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
        className="hidden lg:flex lg:flex-1 bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 flex-col justify-center items-center p-12 xl:p-20 relative overflow-hidden"
      >
        {/* Decorative circles */}
        <div className="absolute top-10 left-10 w-72 h-72 bg-white/5 rounded-full blur-2xl" />
        <div className="absolute bottom-20 right-10 w-56 h-56 bg-brand-400/10 rounded-full blur-2xl" />

        <div className="relative z-10 max-w-md text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.3, type: 'spring', stiffness: 150 }}
            className="inline-flex items-center justify-center w-24 h-24 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 mb-8 p-3"
          >
            <img src="/logo.png" alt="Aniston" className="w-full h-full object-contain brightness-0 invert" />
          </motion.div>

          <h2 className="text-3xl font-display font-bold text-white mb-4">
            Start your free trial
          </h2>
          <p className="text-white/70 text-base leading-relaxed mb-10">
            Experience the power of Aniston HRMS with a 30-day free trial. No credit card required.
          </p>

          {/* Benefits list */}
          <div className="space-y-4 text-left">
            {[
              'Complete employee lifecycle management',
              'Smart attendance with 3 tracking modes',
              'Indian statutory payroll compliance',
              'AI-powered recruitment pipeline',
              'Self-service onboarding portal',
            ].map((benefit, i) => (
              <motion.div
                key={benefit}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.1 }}
                className="flex items-center gap-3"
              >
                <CheckCircle size={18} className="text-emerald-300 flex-shrink-0" />
                <span className="text-white/80 text-sm">{benefit}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Right — Form Side */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
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
          <h1 className="text-2xl font-display font-bold text-gray-900 mb-1">Create your account</h1>
          <p className="text-gray-500 text-sm mb-8">Start your 30-day free trial</p>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <input
                type="text"
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="Full Name *"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all"
                required
              />
            </div>

            <div>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                placeholder="Email *"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all"
                required
              />
            </div>

            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={form.password}
                onChange={handleChange}
                placeholder="Password *"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 pr-12 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all"
                required
                minLength={8}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <div>
              <input
                type="tel"
                name="phone"
                value={form.phone}
                onChange={handleChange}
                placeholder="Phone Number *"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all"
                required
              />
            </div>

            <div>
              <input
                type="text"
                name="company"
                value={form.company}
                onChange={handleChange}
                placeholder="Company Name (optional)"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all"
              />
            </div>

            <div className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="rounded border-gray-300 text-brand-600 mt-0.5 focus:ring-brand-500" required />
              <span className="text-gray-500">
                I agree to the{' '}
                <a href="#" className="text-brand-600 hover:underline">Terms of Service</a>
                {' '}and{' '}
                <a href="#" className="text-brand-600 hover:underline">Privacy Policy</a>
              </span>
            </div>

            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              type="submit"
              disabled={isLoading}
              className="w-full bg-brand-600 hover:bg-brand-700 text-white py-3 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {isLoading && <Loader2 size={18} className="animate-spin" />}
              {isLoading ? 'Creating account...' : 'Create Account'}
            </motion.button>
          </form>

          {/* Sign in using */}
          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white px-3 text-gray-400">or sign up using</span>
              </div>
            </div>

            <div className="flex justify-center gap-4 mt-4">
              <button className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors">
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              </button>
              <button className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors">
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#0A66C2]" fill="currentColor">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Login link */}
          <p className="text-center text-sm text-gray-500 mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-brand-600 hover:text-brand-700 font-semibold transition-colors">
              Sign in
            </Link>
          </p>
        </div>

        <p className="text-center text-gray-300 text-xs mt-12">
          &copy; {new Date().getFullYear()} Aniston Technologies LLP. All rights reserved.
        </p>
      </motion.div>
    </div>
  );
}
