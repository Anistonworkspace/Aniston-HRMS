import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Mail, Phone, MapPin, Calendar, Building2, Briefcase, FileText, Shield, Send, Copy, Check } from 'lucide-react';
import { useGetEmployeeQuery } from './employeeApi';
import { useCreateOnboardingInviteMutation } from '../onboarding/onboardingApi';
import { getInitials, getStatusColor, formatDate, formatCurrency } from '../../lib/utils';
import toast from 'react-hot-toast';

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: response, isLoading } = useGetEmployeeQuery(id!);
  const employee = response?.data;
  const [createInvite, { isLoading: inviting }] = useCreateOnboardingInviteMutation();
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSendInvite = async () => {
    try {
      const result = await createInvite(id!).unwrap();
      const link = `${window.location.origin}${result.data.inviteUrl}`;
      setInviteLink(link);
      toast.success('Onboarding invite sent!');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to send invite');
    }
  };

  const handleCopyLink = () => {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Link copied!');
    }
  };

  if (isLoading) {
    return (
      <div className="page-container">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-48 bg-gray-100 rounded" />
          <div className="layer-card p-6 space-y-4">
            <div className="flex gap-4">
              <div className="w-20 h-20 rounded-xl bg-gray-100" />
              <div className="space-y-3 flex-1">
                <div className="h-5 w-40 bg-gray-100 rounded" />
                <div className="h-4 w-56 bg-gray-50 rounded" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="page-container">
        <div className="layer-card p-12 text-center">
          <p className="text-gray-500">Employee not found</p>
          <button onClick={() => navigate('/employees')} className="btn-primary mt-4">
            Back to Employees
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Back button */}
      <button
        onClick={() => navigate('/employees')}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 mb-4 transition-colors"
      >
        <ArrowLeft size={16} />
        Back to Employees
      </button>

      {/* Profile header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="layer-card p-6 mb-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-start gap-5">
          <div className="w-20 h-20 rounded-xl bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-2xl font-display flex-shrink-0">
            {getInitials(employee.firstName, employee.lastName)}
          </div>
          <div className="flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <h1 className="text-xl font-display font-bold text-gray-900">
                {employee.firstName} {employee.lastName}
              </h1>
              <span className={`badge ${getStatusColor(employee.status)}`}>
                {employee.status}
              </span>
            </div>
            <p className="text-gray-500 text-sm mt-0.5">
              {employee.designation?.name || 'No designation'} · {employee.department?.name || 'No department'}
            </p>
            <p className="text-gray-400 text-xs font-mono mt-1" data-mono>
              {employee.employeeCode}
            </p>

            <div className="flex flex-wrap gap-4 mt-4 text-sm text-gray-500">
              <span className="flex items-center gap-1.5">
                <Mail size={14} className="text-gray-400" />
                {employee.email}
              </span>
              <span className="flex items-center gap-1.5">
                <Phone size={14} className="text-gray-400" />
                {employee.phone}
              </span>
              <span className="flex items-center gap-1.5">
                <Calendar size={14} className="text-gray-400" />
                Joined {formatDate(employee.joiningDate, 'long')}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSendInvite} disabled={inviting}
              className="btn-secondary text-sm flex items-center gap-1.5">
              <Send size={14} /> {inviting ? 'Sending...' : 'Send Onboarding Invite'}
            </button>
            <button className="btn-primary text-sm">Edit Profile</button>
          </div>
          {inviteLink && (
            <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 w-full">
              <p className="text-xs text-emerald-700 truncate flex-1 font-mono" data-mono>{inviteLink}</p>
              <button onClick={handleCopyLink} className="text-emerald-600 hover:text-emerald-800 flex-shrink-0">
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          )}
        </div>
      </motion.div>

      {/* Info cards grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Personal Info */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="layer-card p-6"
        >
          <h2 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Shield size={16} className="text-brand-500" />
            Personal Information
          </h2>
          <dl className="space-y-3">
            <InfoRow label="Gender" value={employee.gender} />
            <InfoRow label="Date of Birth" value={employee.dateOfBirth ? formatDate(employee.dateOfBirth) : '—'} />
            <InfoRow label="Blood Group" value={employee.bloodGroup || '—'} />
            <InfoRow label="Marital Status" value={employee.maritalStatus || '—'} />
            <InfoRow label="Personal Email" value={employee.personalEmail || '—'} />
          </dl>
        </motion.div>

        {/* Employment Info */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="layer-card p-6"
        >
          <h2 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Building2 size={16} className="text-purple-500" />
            Employment Details
          </h2>
          <dl className="space-y-3">
            <InfoRow label="Department" value={employee.department?.name || '—'} />
            <InfoRow label="Designation" value={employee.designation?.name || '—'} />
            <InfoRow label="Work Mode" value={employee.workMode?.replace('_', ' ')} />
            <InfoRow label="Reports To" value={employee.manager ? `${employee.manager.firstName} ${employee.manager.lastName}` : '—'} />
            <InfoRow label="Office" value={employee.officeLocation?.name || '—'} />
            {employee.ctc && (
              <InfoRow label="CTC" value={formatCurrency(Number(employee.ctc))} mono />
            )}
          </dl>
        </motion.div>

        {/* Documents */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="layer-card p-6"
        >
          <h2 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <FileText size={16} className="text-amber-500" />
            Documents ({employee.documents?.length || 0})
          </h2>
          {employee.documents && employee.documents.length > 0 ? (
            <div className="space-y-2">
              {employee.documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between py-2 px-3 bg-surface-2 rounded-lg"
                >
                  <div>
                    <p className="text-sm text-gray-700">{doc.name}</p>
                    <p className="text-xs text-gray-400">{doc.type}</p>
                  </div>
                  <span className={`badge ${getStatusColor(doc.status)} text-xs`}>
                    {doc.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-6">No documents uploaded</p>
          )}
        </motion.div>

        {/* Emergency Contact */}
        {employee.emergencyContact && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="layer-card p-6"
          >
            <h2 className="text-sm font-semibold text-gray-800 mb-4">🆘 Emergency Contact</h2>
            <dl className="space-y-3">
              <InfoRow label="Name" value={(employee.emergencyContact as any).name} />
              <InfoRow label="Relationship" value={(employee.emergencyContact as any).relationship} />
              <InfoRow label="Phone" value={(employee.emergencyContact as any).phone} />
            </dl>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start">
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className={`text-sm text-gray-700 text-right ${mono ? 'font-mono' : ''}`} data-mono={mono || undefined}>
        {value}
      </dd>
    </div>
  );
}
