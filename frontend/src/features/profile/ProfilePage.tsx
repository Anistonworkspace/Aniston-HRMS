import { motion } from 'framer-motion';
import { User, Mail, Phone, Building2, MapPin, Calendar, Shield, Edit2, Key } from 'lucide-react';
import { useAppSelector } from '../../app/store';
import { useGetMeQuery } from '../auth/authApi';
import { getInitials, formatDate } from '../../lib/utils';

export default function ProfilePage() {
  const user = useAppSelector((s) => s.auth.user);
  const { data: meRes } = useGetMeQuery();
  const me = meRes?.data;

  return (
    <div className="page-container">
      <h1 className="text-2xl font-display font-bold text-gray-900 mb-6">My Profile</h1>

      {/* Profile header */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="layer-card p-6 mb-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
          <div className="w-24 h-24 rounded-2xl bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-3xl font-display">
            {getInitials(user?.firstName, user?.lastName)}
          </div>
          <div className="text-center sm:text-left flex-1">
            <h2 className="text-xl font-display font-bold text-gray-900">
              {user?.firstName} {user?.lastName}
            </h2>
            <p className="text-gray-500 text-sm mt-0.5">
              {me?.designation || 'No designation'} · {me?.department || 'No department'}
            </p>
            <div className="flex flex-wrap gap-3 mt-3 justify-center sm:justify-start">
              <span className="flex items-center gap-1.5 text-sm text-gray-500">
                <Mail size={14} className="text-gray-400" /> {user?.email}
              </span>
              <span className="flex items-center gap-1.5 text-sm text-gray-500">
                <Shield size={14} className="text-gray-400" /> {user?.role?.replace('_', ' ')}
              </span>
            </div>
          </div>
          <button className="btn-secondary flex items-center gap-2 text-sm">
            <Edit2 size={14} /> Edit Profile
          </button>
        </div>
      </motion.div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Account info */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="layer-card p-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <User size={16} className="text-brand-500" /> Account Information
          </h3>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-xs text-gray-400">Email</dt>
              <dd className="text-sm text-gray-700">{user?.email}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-xs text-gray-400">Role</dt>
              <dd className="text-sm text-gray-700">{user?.role?.replace('_', ' ')}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-xs text-gray-400">Employee ID</dt>
              <dd className="text-sm text-gray-700 font-mono" data-mono>{user?.employeeId?.substring(0, 8) || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-xs text-gray-400">Organization</dt>
              <dd className="text-sm text-gray-700">{user?.organizationId?.substring(0, 8) || '—'}</dd>
            </div>
          </dl>
        </motion.div>

        {/* Security */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="layer-card p-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Key size={16} className="text-amber-500" /> Security
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between py-3 px-4 bg-surface-2 rounded-lg">
              <div>
                <p className="text-sm font-medium text-gray-700">Password</p>
                <p className="text-xs text-gray-400">Last changed: Unknown</p>
              </div>
              <button className="text-xs text-brand-600 hover:text-brand-700 font-medium">Change</button>
            </div>
            <div className="flex items-center justify-between py-3 px-4 bg-surface-2 rounded-lg">
              <div>
                <p className="text-sm font-medium text-gray-700">Two-Factor Auth</p>
                <p className="text-xs text-gray-400">Not enabled</p>
              </div>
              <button className="text-xs text-brand-600 hover:text-brand-700 font-medium">Enable</button>
            </div>
            <div className="flex items-center justify-between py-3 px-4 bg-surface-2 rounded-lg">
              <div>
                <p className="text-sm font-medium text-gray-700">Active Sessions</p>
                <p className="text-xs text-gray-400">1 active session</p>
              </div>
              <button className="text-xs text-red-500 hover:text-red-600 font-medium">Revoke All</button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
