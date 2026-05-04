import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Building2, Shield, Server, Save, Loader2, Plus, Pencil, Trash2, X, Mail, CheckCircle2, AlertTriangle, Send, Cloud, Eye, EyeOff, Users, Lock, DollarSign, MessageCircle, QrCode, Wifi, WifiOff, Cpu, Zap, ExternalLink, BookOpen, Monitor, Copy, Download, RefreshCw, Search, Database, UserMinus, Terminal, FileText, Bug } from 'lucide-react';
import { useGetOrgSettingsQuery, useUpdateOrgMutation, useGetAuditLogsQuery, useGetSystemInfoQuery, useGetEmailConfigQuery, useSaveEmailConfigMutation, useTestEmailConnectionMutation, useGetTeamsConfigQuery, useSaveTeamsConfigMutation, useTestTeamsConnectionMutation, useSyncTeamsEmployeesMutation, useGetSalaryVisibilityRulesQuery, useUpdateSalaryVisibilityRuleMutation, useGetAiConfigQuery, useSaveAiConfigMutation, useTestAiConnectionMutation, useTestAdminNotificationEmailMutation, useGetAgentSetupListQuery, useGenerateAgentCodeMutation, useRegenerateAgentCodeMutation, useBulkGenerateAgentCodesMutation, useGetAiServiceHealthQuery, useGetDocumentTemplatesQuery, useUpsertDocumentTemplateMutation, useDeleteDocumentTemplateMutation } from './settingsApi';
import { useGetAgentDownloadStatusQuery } from '../attendance/attendanceApi';
import { useGetEmployeesQuery, useChangeEmployeeRoleMutation } from '../employee/employeeApi';
import { useInitializeWhatsAppMutation, useGetWhatsAppStatusQuery, useGetWhatsAppQrQuery, useRefreshWhatsAppQrMutation, useLogoutWhatsAppMutation, useSendWhatsAppMessageMutation, useGetWhatsAppContactsQuery, useGetWhatsAppMessagesQuery } from '../whatsapp/whatsappApi';
import { cn, getInitials, getUploadUrl } from '../../lib/utils';
import { onSocketEvent, offSocketEvent } from '../../lib/socket';
import toast from 'react-hot-toast';
import { useAppSelector } from '../../app/store';
import AiAssistantFab from '../ai-assistant/AiAssistantPanel';
import { useGetKnowledgeBaseQuery, useAddKnowledgeDocMutation, useDeleteKnowledgeDocMutation } from '../ai-assistant/aiAssistantApi';
import { useGetTaskConfigQuery, useUpsertTaskConfigMutation, useTestTaskConnectionMutation } from '../task-integration/taskIntegrationApi';

import DatabaseBackupTab from './DatabaseBackupTab';
import DeletionRequestsTab from './DeletionRequestsTab';
import SystemLogsTab from './SystemLogsTab';
import PasswordResetTab from './PasswordResetTab';
import CrashReportsTab from './CrashReportsTab';
// LeaveSettingsTab removed — leave type management is now in Leave Management page

type Tab = 'organization' | 'email' | 'whatsapp' | 'roles' | 'salary-privacy' | 'api-integration' | 'ai-config' | 'agent-setup' | 'audit' | 'system' | 'database-backup' | 'deletion-requests' | 'system-logs' | 'password-reset' | 'document-templates' | 'crash-reports';

export default function SettingsPage() {
  const { t } = useTranslation();
  const user = useAppSelector(s => s.auth.user);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const isAdmin = user?.role === 'ADMIN';
  const isHR = user?.role === 'HR';

  // Tabs visible to ADMIN system account only
  const ADMIN_VISIBLE_TABS: Tab[] = ['organization', 'email', 'roles', 'api-integration', 'ai-config', 'agent-setup', 'audit', 'system', 'database-backup', 'system-logs', 'crash-reports'];
  // Tabs visible to HR users only
  const HR_VISIBLE_TABS: Tab[] = ['organization', 'email', 'whatsapp', 'password-reset'];

  const getDefaultTab = (): Tab => {
    const saved = sessionStorage.getItem('settings_active_tab') as Tab | null;
    if (saved) {
      if (isSuperAdmin) return saved;
      if (isAdmin && ADMIN_VISIBLE_TABS.includes(saved)) return saved;
      if (isHR && HR_VISIBLE_TABS.includes(saved)) return saved;
    }
    return 'organization';
  };

  const [activeTab, setActiveTab] = useState<Tab>(getDefaultTab);

  useEffect(() => {
    sessionStorage.setItem('settings_active_tab', activeTab);
  }, [activeTab]);

  // Guard: reset tab if current tab not accessible for role
  useEffect(() => {
    if (isAdmin && !ADMIN_VISIBLE_TABS.includes(activeTab)) setActiveTab('organization');
    if (isHR && !HR_VISIBLE_TABS.includes(activeTab)) setActiveTab('organization');
  }, [isAdmin, isHR, activeTab]);

  const allTabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'organization', label: t('settings.organization'), icon: Building2 },
    { key: 'email', label: t('settings.emailConfig'), icon: Mail },
    { key: 'whatsapp', label: t('settings.whatsapp'), icon: MessageCircle },
    { key: 'password-reset', label: 'Password Reset', icon: Lock },
    { key: 'roles', label: t('settings.userRoles'), icon: Users },
    { key: 'salary-privacy', label: t('settings.salaryPrivacy'), icon: Lock },
    { key: 'api-integration', label: t('settings.apiIntegration'), icon: ExternalLink },
    { key: 'document-templates', label: 'Document Templates', icon: FileText },
    { key: 'ai-config', label: t('settings.aiApiConfig'), icon: Cpu },
    { key: 'agent-setup', label: t('settings.agentSetup'), icon: Monitor },
    { key: 'audit', label: t('settings.auditLogs'), icon: Shield },
    { key: 'system', label: t('settings.system'), icon: Server },
    { key: 'database-backup', label: 'Database Backup', icon: Database },
    { key: 'deletion-requests', label: 'Deletion Requests', icon: UserMinus },
    { key: 'system-logs', label: 'System Logs', icon: Terminal },
    { key: 'crash-reports', label: 'Crash Reports', icon: Bug },
  ];

  const tabs = isSuperAdmin
    ? allTabs
    : isAdmin
      ? allTabs.filter(tab => ADMIN_VISIBLE_TABS.includes(tab.key))
      : allTabs.filter(tab => HR_VISIBLE_TABS.includes(tab.key));

  return (
    <>
      <div className="page-container">
        <h1 className="text-2xl font-display font-bold text-gray-900 mb-6">{t('settings.title')}</h1>

        {/* Mobile: horizontal scrollable tab strip */}
        <div className="md:hidden mb-5 -mx-4 px-4 overflow-x-auto">
          <div className="flex gap-1 pb-1 w-max">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0',
                  activeTab === tab.key ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                )}
              >
                <tab.icon size={14} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-6">
          {/* Desktop: Sidebar tabs */}
          <div className="w-56 flex-shrink-0 hidden md:block">
            <div className="space-y-1">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left',
                    activeTab === tab.key ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-500 hover:bg-gray-50'
                  )}
                >
                  <tab.icon size={18} />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {activeTab === 'organization' && <OrgSettings />}
            {activeTab === 'email' && <EmailConfig />}
            {activeTab === 'whatsapp' && <WhatsAppConfig />}
            {activeTab === 'password-reset' && <PasswordResetTab />}
            {activeTab === 'roles' && <UserRolesTab />}
            {activeTab === 'salary-privacy' && <SalaryPrivacyTab />}
            {activeTab === 'api-integration' && <ExternalApiIntegrationTab />}
            {activeTab === 'document-templates' && <DocumentTemplatesTab />}
            {activeTab === 'ai-config' && <ApiIntegrationsTab />}
            {activeTab === 'agent-setup' && <AgentSetupTab />}
            {activeTab === 'audit' && <AuditLogs />}
            {activeTab === 'system' && <SystemInfo />}
            {activeTab === 'database-backup' && <DatabaseBackupTab />}
            {activeTab === 'deletion-requests' && isSuperAdmin && <DeletionRequestsTab />}
            {activeTab === 'system-logs'       && isSuperAdmin && <SystemLogsTab />}
            {activeTab === 'crash-reports'     && (isSuperAdmin || isAdmin) && <CrashReportsTab />}
          </div>
        </div>
      </div>
      <AiAssistantFab context="admin" label="Admin Assistant" />
    </>
  );
}

function OrgSettings() {
  const { t } = useTranslation();
  const { data: res } = useGetOrgSettingsQuery();
  const [updateOrg, { isLoading }] = useUpdateOrgMutation();
  const org = res?.data;
  const [form, setForm] = useState({ name: '', timezone: '', currency: '', fiscalYear: '' });

  useEffect(() => {
    if (org) setForm({ name: org.name, timezone: org.timezone, currency: org.currency, fiscalYear: org.fiscalYear });
  }, [org]);

  const handleSave = async () => {
    try {
      await updateOrg(form).unwrap();
      toast.success(t('settings.saved'));
    } catch { toast.error(t('settings.failedToSave')); }
  };

  return (
    <div className="layer-card p-6">
      <h2 className="text-lg font-display font-semibold text-gray-800 mb-6">{t('settings.orgSettings')}</h2>
      <div className="space-y-4 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">{t('settings.companyName')}</label>
          <input value={form.name || org?.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="input-glass w-full" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">{t('settings.timezone')}</label>
            <select value={form.timezone || org?.timezone || ''} onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              className="input-glass w-full">
              <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
              <option value="America/New_York">America/New_York (EST)</option>
              <option value="Europe/London">Europe/London (GMT)</option>
              <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">{t('settings.currency')}</label>
            <select value={form.currency || org?.currency || ''} onChange={(e) => setForm({ ...form, currency: e.target.value })}
              className="input-glass w-full">
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">{t('settings.fiscalYear')}</label>
          <select value={form.fiscalYear || org?.fiscalYear || ''} onChange={(e) => setForm({ ...form, fiscalYear: e.target.value })}
            className="input-glass w-full">
            <option value="APRIL_MARCH">{t('settings.aprilMarch')}</option>
            <option value="JANUARY_DECEMBER">{t('settings.januaryDecember')}</option>
          </select>
        </div>
        {org && (
          <div className="pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-400">
              Employees: <strong>{org._count?.employees || 0}</strong> ·
              Departments: <strong>{org._count?.departments || 0}</strong> ·
              Designations: <strong>{org._count?.designations || 0}</strong>
            </p>
          </div>
        )}

        <button onClick={handleSave} disabled={isLoading}
          className="btn-primary flex items-center gap-2">
          {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {t('profile.saveChanges')}
        </button>
      </div>
    </div>
  );
}

function EmailConfig() {
  const { data: res, refetch } = useGetEmailConfigQuery();
  const { data: orgRes } = useGetOrgSettingsQuery();
  const [saveConfig, { isLoading: saving }] = useSaveEmailConfigMutation();
  const [testConnection, { isLoading: testing }] = useTestEmailConnectionMutation();
  const [updateOrg, { isLoading: savingAdminEmail }] = useUpdateOrgMutation();
  const [testAdminEmail, { isLoading: isTestingAdminEmail }] = useTestAdminNotificationEmailMutation();
  const config = res?.data;
  const org = orgRes?.data;
  const [form, setForm] = useState({
    host: '', port: 587, user: '', pass: '', fromAddress: '', fromName: '', emailDomain: '', payrollEmail: '',
  });
  const [adminNotificationEmail, setAdminNotificationEmail] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (config) {
      setForm({
        host: config.host || '',
        port: config.port || 587,
        user: config.user || '',
        pass: '',
        fromAddress: config.fromAddress || '',
        fromName: config.fromName || '',
        emailDomain: config.emailDomain || '',
        payrollEmail: config.payrollEmail || '',
      });
    }
  }, [config]);

  useEffect(() => {
    if (org) setAdminNotificationEmail(org.adminNotificationEmail || '');
  }, [org]);

  const handleSave = async () => {
    if (!form.host || !form.user) { toast.error('SMTP host and username are required'); return; }
    try {
      const payload: any = { ...form, authMethod: 'smtp' };
      if (!payload.pass && config?.hasPassword) {
        delete payload.pass;
      }
      await saveConfig(payload).unwrap();
      // Clear password field immediately after save — never leave a secret in form state
      setForm(f => ({ ...f, pass: '' }));
      setTestResult(null);
      await refetch();
      toast.success('Email configuration saved');
    } catch { toast.error('Failed to save'); }
  };

  const handleTest = async () => {
    try {
      const result = await testConnection().unwrap();
      setTestResult(result.data);
      if (result.data?.success) toast.success('Connection successful!');
      else toast.error(result.data?.message || 'Connection failed');
    } catch { setTestResult({ success: false, message: 'Test failed — check your settings' }); }
  };

  return (
    <div className="layer-card p-6">
      <h2 className="text-lg font-display font-semibold text-gray-800 mb-2">Email Configuration</h2>
      <p className="text-sm text-gray-400 mb-6">Configure SMTP email for sending invitation links, notifications, and password resets.</p>

      {/* Status indicator */}
      {config && (
        <div className={cn('flex items-center gap-2 p-3 rounded-lg mb-6 text-sm',
          config.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
        )}>
          {config.configured ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {config.configured
            ? 'Email configured via SMTP. Emails will be sent.'
            : 'Email not configured. Invitations will be logged to console only.'}
        </div>
      )}

      <div className="space-y-4 max-w-lg">
        {/* SMTP Fields */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-600 mb-1">SMTP Host *</label>
            <input value={form.host} onChange={e => setForm({...form, host: e.target.value})}
              className="input-glass w-full text-sm" placeholder="smtp.office365.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Port</label>
            <input type="number" value={form.port} onChange={e => setForm({...form, port: Number(e.target.value)})}
              className="input-glass w-full text-sm" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Username (Email) *</label>
            <input value={form.user} onChange={e => setForm({...form, user: e.target.value})}
              className="input-glass w-full text-sm" placeholder="hr@anistonav.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              Password {config?.hasPassword && <span className="text-xs text-emerald-600 font-medium">✓ saved</span>}
            </label>
            <div className="relative">
              <input type={showPass ? 'text' : 'password'} value={form.pass} onChange={e => setForm({...form, pass: e.target.value})}
                className="input-glass w-full text-sm pr-10" placeholder={config?.hasPassword ? '(leave blank to keep saved password)' : 'Email password or App Password'} />
              <button type="button" onClick={() => setShowPass(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {config?.hasPassword && !form.pass && (
              <p className="text-xs text-gray-400 mt-1">Password already saved. Enter a new password only if you want to change it.</p>
            )}
          </div>
        </div>

        {/* From fields */}
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Send As (From Email) *</label>
          <input value={form.fromAddress} onChange={e => setForm({...form, fromAddress: e.target.value})}
            className="input-glass w-full text-sm" placeholder="hr@anistonav.com" />
          <p className="text-xs text-gray-400 mt-1">The email address that appears in the "From" field. Can be a shared mailbox if "Send As" permission is granted to the SMTP login user.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">From Name</label>
            <input value={form.fromName} onChange={e => setForm({...form, fromName: e.target.value})}
              className="input-glass w-full text-sm" placeholder="Aniston HRMS" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Email Domain</label>
            <input value={form.emailDomain} onChange={e => setForm({...form, emailDomain: e.target.value})}
              className="input-glass w-full text-sm" placeholder="@anistonav.com" />
          </div>
        </div>

        {/* Payroll Email Recipients */}
        <div className="border-t border-gray-200 pt-4 mt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
            <DollarSign size={14} className="text-brand-500" /> Payroll Email Recipients
          </h3>
          <p className="text-xs text-gray-400 mb-3">When HR sends payroll reports, the password-protected Excel will be emailed to these addresses.</p>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Accounts / Finance Email</label>
            <input value={form.payrollEmail || ''} onChange={e => setForm({...form, payrollEmail: e.target.value})}
              className="input-glass w-full text-sm" placeholder="accounts@anistonav.com" />
            <p className="text-xs text-gray-400 mt-1">Payroll Excel reports will be sent to this email when HR clicks "Send to Accounts" after processing.</p>
          </div>
        </div>

        {/* Onboarding & Admin Notifications */}
        <div className="border-t border-gray-200 pt-4 mt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
            <Mail size={14} className="text-brand-500" /> Onboarding &amp; Admin Notifications
          </h3>
          <p className="text-xs text-gray-400 mb-3">When an employee completes onboarding, a notification email with their details will be sent here so admin can prepare their laptop and access.</p>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Admin Notification Email</label>
            <div className="flex gap-2">
              <input
                value={adminNotificationEmail}
                onChange={e => setAdminNotificationEmail(e.target.value)}
                type="email"
                placeholder="admin@company.com"
                className="input-glass flex-1 text-sm"
              />
              <button
                onClick={async () => {
                  if (adminNotificationEmail !== (org?.adminNotificationEmail || '')) {
                    toast('Save admin email first, then test.', { icon: '⚠️' });
                    return;
                  }
                  try {
                    const result = await testAdminEmail().unwrap();
                    if (result?.data?.success) toast.success(result.data.message || 'Test email sent!');
                    else toast.error(result?.data?.message || 'Failed to send test email');
                  } catch { toast.error('Failed to send test email — check SMTP configuration'); }
                }}
                disabled={isTestingAdminEmail || !adminNotificationEmail}
                className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-2 whitespace-nowrap"
              >
                {isTestingAdminEmail ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Test
              </button>
              <button
                onClick={async () => {
                  try {
                    await updateOrg({ adminNotificationEmail } as any).unwrap();
                    toast.success('Admin notification email saved');
                  } catch { toast.error('Failed to save admin email'); }
                }}
                disabled={savingAdminEmail}
                className="btn-primary flex items-center gap-1.5 text-sm px-3 py-2 whitespace-nowrap"
              >
                {savingAdminEmail ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Used for: onboarding completion alerts, system notifications, backup alerts, payroll errors, and HR activity reports.
            </p>
          </div>
        </div>

        {/* Info box */}
        <div className="p-3 bg-blue-50 rounded-lg text-xs text-blue-700 space-y-1">
          <p className="font-semibold">Microsoft 365 SMTP Setup</p>
          <p>1. Go to <strong>admin.microsoft.com</strong> → Users → Active users → hr@anistonav.com</p>
          <p>2. Click <strong>Mail</strong> tab → <strong>Manage email apps</strong></p>
          <p>3. Enable <strong>Authenticated SMTP</strong> → Save</p>
          <p>4. Use the mailbox password (or App Password if MFA is on) as the password above</p>
        </div>

        {/* Test result */}
        {testResult && (
          <div className={cn('flex items-center gap-2 p-3 rounded-lg text-sm',
            testResult.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          )}>
            {testResult.success ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            {testResult.message}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2 text-sm">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save Configuration
          </button>
          <button onClick={handleTest} disabled={testing || !config?.configured} className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-50">
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Test Connection
          </button>
        </div>
      </div>
    </div>
  );
}

function TeamsConfig() {
  const { data: res, refetch } = useGetTeamsConfigQuery();
  const [saveConfig, { isLoading: saving }] = useSaveTeamsConfigMutation();
  const [testConnection, { isLoading: testing }] = useTestTeamsConnectionMutation();
  const [syncEmployees, { isLoading: syncing }] = useSyncTeamsEmployeesMutation();
  const [syncResult, setSyncResult] = useState<any>(null);
  const config = res?.data;
  const [form, setForm] = useState({ tenantId: '', clientId: '', clientSecret: '', redirectUri: '', ssoEnabled: false });
  const [isEditing, setIsEditing] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [fieldDraft, setFieldDraft] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  const isViewMode = config?.configured && !isEditing && !editingField;

  useEffect(() => {
    if (config) {
      setForm({
        tenantId: config.tenantId || '',
        clientId: config.clientId || '',
        clientSecret: '',
        redirectUri: config.redirectUri || '',
        ssoEnabled: config.ssoEnabled || false,
      });
    }
  }, [config]);

  const handleSave = async () => {
    if (!form.tenantId || !form.clientId) { toast.error('Tenant ID and Client ID are required'); return; }
    if (!form.clientSecret && !config?.hasClientSecret) { toast.error('Client Secret is required'); return; }
    try {
      const payload: any = { tenantId: form.tenantId, clientId: form.clientId, ssoEnabled: form.ssoEnabled, redirectUri: form.redirectUri };
      if (form.clientSecret) payload.clientSecret = form.clientSecret;
      await saveConfig(payload).unwrap();
      // Clear secret field immediately — never leave a secret in form state
      setForm(f => ({ ...f, clientSecret: '' }));
      setIsEditing(false);
      await refetch();
      toast.success('Microsoft Teams configuration saved');
    } catch { toast.error('Failed to save'); }
  };

  const handleFieldSave = async (field: string) => {
    try {
      const payload: any = { tenantId: form.tenantId, clientId: form.clientId, ssoEnabled: form.ssoEnabled, redirectUri: form.redirectUri };
      if (field === 'clientSecret' && fieldDraft) {
        payload.clientSecret = fieldDraft;
      } else if (field === 'ssoEnabled') {
        payload.ssoEnabled = !form.ssoEnabled;
      } else {
        (payload as any)[field] = fieldDraft;
        setForm(f => ({ ...f, [field]: fieldDraft }));
      }
      await saveConfig(payload).unwrap();
      toast.success('Updated successfully');
      refetch();
      setEditingField(null);
      setFieldDraft('');
    } catch { toast.error('Failed to save'); }
  };

  const startFieldEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setFieldDraft(currentValue);
  };

  const cancelFieldEdit = () => {
    setEditingField(null);
    setFieldDraft('');
  };

  const handleTest = async () => {
    try {
      const result = await testConnection().unwrap();
      if (result.data?.success) toast.success('Connection established!');
      else toast.error(result.data?.message || 'Connection failed');
      refetch();
    } catch { toast.error('Test failed — check your Azure AD settings'); }
  };

  const startEditAll = () => {
    setIsEditing(true);
    setEditingField(null);
    if (config) {
      setForm({
        tenantId: config.tenantId || '',
        clientId: config.clientId || '',
        clientSecret: '',
        redirectUri: config.redirectUri || '',
        ssoEnabled: config.ssoEnabled || false,
      });
    }
  };

  const cancelEditAll = () => {
    setIsEditing(false);
    if (config) {
      setForm({
        tenantId: config.tenantId || '',
        clientId: config.clientId || '',
        clientSecret: '',
        redirectUri: config.redirectUri || '',
        ssoEnabled: config.ssoEnabled || false,
      });
    }
  };

  // ---- Status Banner ----
  const renderStatus = () => {
    if (!config) return null;
    if (config.connectionVerified) {
      const verifiedDate = config.connectionVerifiedAt ? new Date(config.connectionVerifiedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      return (
        <div className="flex items-center gap-2 p-3 rounded-lg mb-6 text-sm bg-emerald-50 text-emerald-700">
          <CheckCircle2 size={16} />
          <span>Connection Established{verifiedDate ? ` — verified ${verifiedDate}` : ''}</span>
        </div>
      );
    }
    if (config.configured) {
      return (
        <div className="flex items-center gap-2 p-3 rounded-lg mb-6 text-sm bg-amber-50 text-amber-700">
          <AlertTriangle size={16} />
          Configuration saved. Click Test Connection to verify.
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg mb-6 text-sm bg-amber-50 text-amber-700">
        <AlertTriangle size={16} />
        Microsoft Teams is not configured. Enter your Azure AD credentials below.
      </div>
    );
  };

  // ---- View Mode Field Row ----
  const renderViewRow = (label: string, field: string, value: string, isMasked?: boolean) => {
    const isFieldEditing = editingField === field;
    return (
      <div key={field} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-400 mb-0.5">{label}</p>
          {isFieldEditing ? (
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type={field === 'clientSecret' && !showSecret ? 'password' : 'text'}
                  value={fieldDraft}
                  onChange={e => setFieldDraft(e.target.value)}
                  className="input-glass w-full text-sm pr-8"
                  placeholder={isMasked && config?.hasClientSecret ? 'Leave blank to keep existing' : `Enter ${label.toLowerCase()}`}
                  autoFocus
                />
                {field === 'clientSecret' && (
                  <button type="button" onClick={() => setShowSecret(!showSecret)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                )}
              </div>
              <button onClick={() => handleFieldSave(field)} disabled={saving}
                className="text-emerald-600 hover:text-emerald-700 p-1.5 rounded-lg hover:bg-emerald-50">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              </button>
              <button onClick={cancelFieldEdit}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-50">
                <X size={14} />
              </button>
            </div>
          ) : (
            <p className="text-sm font-medium text-gray-800 font-mono truncate" data-mono>
              {isMasked ? (value ? '••••••••••••••••' : '—') : (value || '—')}
            </p>
          )}
        </div>
        {!isFieldEditing && (
          <button onClick={() => startFieldEdit(field, isMasked ? '' : value)}
            className="ml-3 text-gray-400 hover:text-brand-600 p-1.5 rounded-lg hover:bg-brand-50 flex-shrink-0">
            <Pencil size={14} />
          </button>
        )}
      </div>
    );
  };

  // ---- VIEW MODE ----
  if (isViewMode) {
    return (
      <div className="layer-card p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-display font-semibold text-gray-800">Microsoft Teams Integration</h2>
        </div>
        <p className="text-sm text-gray-400 mb-6">Connect your Azure AD / Microsoft 365 tenant to enable SSO login and Teams data sync.</p>

        {renderStatus()}

        <div className="max-w-lg">
          <div className="bg-surface-2 rounded-xl p-4">
            {renderViewRow('Tenant ID', 'tenantId', config.tenantId)}
            {renderViewRow('Client ID (Application ID)', 'clientId', config.clientId)}
            {renderViewRow('Client Secret', 'clientSecret', config.hasClientSecret ? 'configured' : '', true)}
            {renderViewRow('Redirect URI', 'redirectUri', config.redirectUri)}

            {/* SSO toggle row */}
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Microsoft SSO</p>
                <p className={cn('text-sm font-medium', config.ssoEnabled ? 'text-emerald-600' : 'text-gray-500')}>
                  {config.ssoEnabled ? 'Enabled' : 'Disabled'}
                </p>
              </div>
              <button onClick={() => handleFieldSave('ssoEnabled')} disabled={saving}
                className="ml-3 text-gray-400 hover:text-brand-600 p-1.5 rounded-lg hover:bg-brand-50 flex-shrink-0">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Pencil size={14} />}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-4">
            <button onClick={handleTest} disabled={testing} className="btn-primary flex items-center gap-2 text-sm">
              {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Test Connection
            </button>
            <button onClick={async () => {
              try {
                const res = await syncEmployees().unwrap();
                setSyncResult(res.data);
                toast.success(res.message || `Imported ${res.data?.imported || 0} employees`);
              } catch (err: any) { toast.error(err?.data?.error?.message || 'Sync failed'); }
            }} disabled={syncing || !config?.connectionVerified}
              className="flex items-center gap-2 text-sm px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50">
              {syncing ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
              Sync Employees from Teams
            </button>
            <button onClick={startEditAll} className="btn-secondary flex items-center gap-2 text-sm">
              <Pencil size={14} />
              Edit All
            </button>
          </div>
          {syncResult && (
            <div className="mt-3 p-3 bg-emerald-50 text-emerald-700 rounded-lg text-sm">
              Sync complete: <strong>{syncResult.imported}</strong> imported, <strong>{syncResult.skipped}</strong> skipped
              {syncResult.errors?.length > 0 && (
                <p className="text-xs text-amber-600 mt-1">{syncResult.errors.length} errors occurred</p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- EDIT MODE (full form) ----
  return (
    <div className="layer-card p-6">
      <h2 className="text-lg font-display font-semibold text-gray-800 mb-2">Microsoft Teams Integration</h2>
      <p className="text-sm text-gray-400 mb-6">Connect your Azure AD / Microsoft 365 tenant to enable SSO login and Teams data sync.</p>

      {renderStatus()}

      <div className="space-y-4 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Tenant ID *</label>
          <input value={form.tenantId} onChange={e => setForm({...form, tenantId: e.target.value})}
            className="input-glass w-full text-sm" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
          <p className="text-xs text-gray-400 mt-1">Azure AD Directory (tenant) ID from your app registration</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Client ID (Application ID) *</label>
          <input value={form.clientId} onChange={e => setForm({...form, clientId: e.target.value})}
            className="input-glass w-full text-sm" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
          <p className="text-xs text-gray-400 mt-1">Application (client) ID from Azure AD app registration</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">
            Client Secret {config?.hasClientSecret && <span className="text-xs text-gray-400">(saved securely, leave blank to keep)</span>}
          </label>
          <div className="relative">
            <input
              type={showSecret ? 'text' : 'password'}
              value={form.clientSecret}
              onChange={e => setForm({...form, clientSecret: e.target.value})}
              className="input-glass w-full text-sm pr-10"
              placeholder={config?.hasClientSecret ? '••••••••••••••••' : 'Enter client secret from Azure AD'} />
            <button type="button" onClick={() => setShowSecret(!showSecret)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">Client secret value from Certificates & secrets section</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Redirect URI</label>
          <input value={form.redirectUri} onChange={e => setForm({...form, redirectUri: e.target.value})}
            className="input-glass w-full text-sm" placeholder="http://localhost:4000/api/auth/microsoft/callback" />
          <p className="text-xs text-gray-400 mt-1">Add this URI to your Azure AD app's redirect URIs</p>
        </div>

        {/* SSO Toggle */}
        <div className="pt-2 border-t border-gray-100">
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                checked={form.ssoEnabled}
                onChange={e => setForm({...form, ssoEnabled: e.target.checked})}
                className="sr-only"
              />
              <div className={cn('w-10 h-6 rounded-full transition-colors', form.ssoEnabled ? 'bg-brand-500' : 'bg-gray-300')} />
              <div className={cn('absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform', form.ssoEnabled && 'translate-x-4')} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">Enable Microsoft SSO for Login</p>
              <p className="text-xs text-gray-400">Allow employees to sign in with their Microsoft account</p>
            </div>
          </label>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2 text-sm">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save Configuration
          </button>
          {config?.configured && (
            <button onClick={cancelEditAll} className="btn-secondary flex items-center gap-2 text-sm">
              <X size={14} />
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AuditLogs() {
  const { data: res } = useGetAuditLogsQuery({ page: 1 });
  const logs = res?.data || [];

  return (
    <div className="layer-card p-6">
      <h2 className="text-lg font-display font-semibold text-gray-800 mb-4">Audit Logs</h2>
      {logs.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">No audit logs yet</p>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-y-auto custom-scrollbar">
          {logs.map((log: any) => (
            <div key={log.id} className="flex items-start gap-3 py-2.5 px-3 hover:bg-surface-2 rounded-lg text-sm">
              <div className="w-2 h-2 rounded-full bg-brand-400 mt-1.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-gray-700">
                  <span className="font-medium">{log.user?.email}</span> {log.action.toLowerCase()} {log.entity}
                </p>
                <p className="text-xs text-gray-400 font-mono mt-0.5" data-mono>
                  {new Date(log.createdAt).toLocaleString('en-IN')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SystemInfo() {
  const { data: res } = useGetSystemInfoQuery();
  const sys = res?.data;

  return (
    <div className="layer-card p-6">
      <h2 className="text-lg font-display font-semibold text-gray-800 mb-4">System Information</h2>
      {sys ? (
        <div className="grid grid-cols-2 gap-4">
          <InfoBox label="Version" value={sys.version} />
          <InfoBox label="Node.js" value={sys.nodeVersion} />
          <InfoBox label="Uptime" value={`${Math.floor(sys.uptime / 3600)}h ${Math.floor((sys.uptime % 3600) / 60)}m`} />
          <InfoBox label="Platform" value={sys.platform} />
          <InfoBox label="Memory (RSS)" value={`${Math.round(sys.memoryUsage.rss / 1024 / 1024)} MB`} />
          <InfoBox label="Heap Used" value={`${Math.round(sys.memoryUsage.heapUsed / 1024 / 1024)} MB`} />
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 animate-pulse">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-surface-2 rounded-lg p-3">
              <div className="h-3 bg-gray-100 rounded w-14 mb-2" />
              <div className="h-4 bg-gray-200 rounded w-20" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-2 rounded-lg p-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm font-mono font-medium text-gray-800 mt-0.5" data-mono>{value}</p>
    </div>
  );
}

// ==================
// USER ROLES TAB
// ==================

const ROLE_OPTIONS = [
  { value: 'SUPER_ADMIN', label: 'Super Admin', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  { value: 'ADMIN', label: 'Admin', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { value: 'HR', label: 'HR', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { value: 'MANAGER', label: 'Manager', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'EMPLOYEE', label: 'Employee', color: 'bg-gray-50 text-gray-600 border-gray-200' },
];

function UserRolesTab() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data: res, isLoading } = useGetEmployeesQuery({ page, limit: 50, search: search || undefined });
  const [changeRole] = useChangeEmployeeRoleMutation();

  const employees = res?.data || [];
  const meta = res?.meta;

  const handleRoleChange = async (employeeId: string, newRole: string, currentRole: string) => {
    if (newRole === currentRole) return;
    try {
      await changeRole({ employeeId, role: newRole }).unwrap();
      toast.success(`Role changed to ${ROLE_OPTIONS.find(r => r.value === newRole)?.label || newRole}`);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to change role');
    }
  };

  return (
    <div className="layer-card p-6">
      <h2 className="text-lg font-display font-semibold text-gray-800 mb-2">User Roles Management</h2>
      <p className="text-sm text-gray-400 mb-6">Assign roles to employees to control their access level in the portal.</p>

      {/* Role Legend */}
      <div className="flex flex-wrap gap-2 mb-6">
        {ROLE_OPTIONS.map(r => (
          <div key={r.value} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${r.color}`}>
            <span className="w-2 h-2 rounded-full bg-current" />
            {r.label}
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm mb-4">
        <Settings size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search employees..." className="input-glass w-full pl-9 text-sm" />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin text-brand-600 mx-auto" /></div>
      ) : employees.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          No employees found. Invite employees from the Manage Employees page first.
        </div>
      ) : (
        <>
          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50/50 border-b border-gray-100">
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Employee</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 hidden md:table-cell">Department</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Current Role</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Change Role</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp: any) => {
                  const role = emp.user?.role || 'EMPLOYEE';
                  const roleConfig = ROLE_OPTIONS.find(r => r.value === role) || ROLE_OPTIONS[4];
                  return (
                    <tr key={emp.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 font-semibold text-sm">
                            {getInitials(emp.firstName, emp.lastName)}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-800">{emp.firstName} {emp.lastName}</p>
                            <p className="text-xs text-gray-400">{emp.employeeCode} · {emp.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        <span className="text-sm text-gray-600">{emp.department?.name || '—'}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${roleConfig.color}`}>
                          {roleConfig.label}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <select
                          value={role}
                          onChange={e => handleRoleChange(emp.id, e.target.value, role)}
                          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white hover:border-brand-300 focus:ring-2 focus:ring-brand-100 focus:border-brand-500 transition-all cursor-pointer"
                        >
                          {ROLE_OPTIONS.map(r => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-gray-400">Page {meta.page} of {meta.totalPages}</p>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1 text-xs border rounded-lg disabled:opacity-30">Prev</button>
                <button disabled={page >= meta.totalPages} onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1 text-xs border rounded-lg disabled:opacity-30">Next</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// =================== Salary Privacy Tab ===================
function SalaryPrivacyTab() {
  const { data: res, isLoading } = useGetSalaryVisibilityRulesQuery();
  const [updateRule] = useUpdateSalaryVisibilityRuleMutation();
  const rules = res?.data || [];

  const handleToggle = async (employeeId: string, field: 'visibleToHR' | 'visibleToManager', current: boolean) => {
    try {
      const rule = rules.find((r: any) => r.employee.id === employeeId);
      await updateRule({
        employeeId,
        visibleToHR: field === 'visibleToHR' ? !current : (rule?.visibleToHR ?? true),
        visibleToManager: field === 'visibleToManager' ? !current : (rule?.visibleToManager ?? false),
      }).unwrap();
      toast.success('Visibility updated');
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  return (
    <div className="layer-card p-6">
      <div className="flex items-center gap-3 mb-2">
        <Lock size={20} className="text-brand-600" />
        <h2 className="text-lg font-display font-semibold text-gray-800">Salary Privacy</h2>
      </div>
      <p className="text-sm text-gray-500 mb-4">Control which employees' salaries are visible to HR and Managers</p>

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6">
        <p className="text-xs text-amber-700">Only Super Admin can modify salary visibility. HR will see masked values for hidden employees.</p>
      </div>

      {isLoading ? (
        <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin text-brand-600 mx-auto" /></div>
      ) : rules.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">No employees found</p>
      ) : (
        <div className="border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left py-3 px-4 font-medium text-gray-500">Employee</th>
                <th className="text-left py-3 px-4 font-medium text-gray-500 hidden md:table-cell">Department</th>
                <th className="text-center py-3 px-4 font-medium text-gray-500">Visible to HR</th>
                <th className="text-center py-3 px-4 font-medium text-gray-500">Visible to Manager</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule: any) => (
                <tr key={rule.employee.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="py-3 px-4">
                    <p className="font-medium text-gray-800">{rule.employee.firstName} {rule.employee.lastName}</p>
                    <p className="text-xs font-mono text-gray-400" data-mono>{rule.employee.employeeCode}</p>
                  </td>
                  <td className="py-3 px-4 hidden md:table-cell text-gray-500">{rule.employee.department?.name || '—'}</td>
                  <td className="py-3 px-4 text-center">
                    <button
                      onClick={() => handleToggle(rule.employee.id, 'visibleToHR', rule.visibleToHR)}
                      className={cn('w-10 h-5 rounded-full transition-colors relative',
                        rule.visibleToHR ? 'bg-emerald-500' : 'bg-gray-300')}>
                      <div className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                        rule.visibleToHR ? 'translate-x-5' : 'translate-x-0.5')} />
                    </button>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <button
                      onClick={() => handleToggle(rule.employee.id, 'visibleToManager', rule.visibleToManager)}
                      className={cn('w-10 h-5 rounded-full transition-colors relative',
                        rule.visibleToManager ? 'bg-emerald-500' : 'bg-gray-300')}>
                      <div className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                        rule.visibleToManager ? 'translate-x-5' : 'translate-x-0.5')} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// =================== WhatsApp Configuration ===================
function WhatsAppConfig() {
  const { data: statusRes, refetch: refetchStatus } = useGetWhatsAppStatusQuery(undefined, { pollingInterval: 10000 });
  const { data: qrRes, refetch: refetchQr } = useGetWhatsAppQrQuery(undefined, { pollingInterval: 10000 });
  const [initializeWA, { isLoading: initializing }] = useInitializeWhatsAppMutation();
  const [refreshQrMutation, { isLoading: refreshingQr }] = useRefreshWhatsAppQrMutation();
  const [logoutWA, { isLoading: disconnecting }] = useLogoutWhatsAppMutation();
  const [sendMessage] = useSendWhatsAppMessageMutation();
  const [testPhone, setTestPhone] = useState('');
  const [testMsg, setTestMsg] = useState('Hello from Aniston HRMS!');
  const [connecting, setConnecting] = useState(false);
  const [linking, setLinking] = useState(false); // QR scanned, waiting for full connection
  const [liveSyncing, setLiveSyncing] = useState(false); // Chat preload in progress after connect
  const [liveQr, setLiveQr] = useState<string | null>(null);
  const [liveConnected, setLiveConnected] = useState(false); // instant connected state via socket
  const [livePhone, setLivePhone] = useState<string | null>(null);
  const [waError, setWaError] = useState<string | null>(null);
  const connectingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const status = statusRes?.data;
  const isConnected = liveConnected || status?.isConnected || false;
  const serverInitializing = status?.isInitializing || false;
  const qrCode = liveQr || qrRes?.data?.qrCode;

  // Sync connecting state with server's isInitializing.
  // Also reset when server goes idle (isInitializing: false) without connecting — prevents stuck spinner.
  const prevServerInitializing = useRef(false);
  useEffect(() => {
    if (serverInitializing && !connecting) setConnecting(true);
    if (isConnected) { setConnecting(false); setLinking(false); }
    // Server finished initializing without connecting — clear stuck state
    if (prevServerInitializing.current && !serverInitializing && !isConnected && !qrCode) {
      setConnecting(false);
    }
    prevServerInitializing.current = serverInitializing;
  }, [serverInitializing, isConnected, qrCode]);

  // 95-second client-side timeout: if connecting for too long without QR, show actionable error
  useEffect(() => {
    if (connecting && !qrCode && !isConnected) {
      connectingTimerRef.current = setTimeout(() => {
        setConnecting(false);
        setWaError('WhatsApp took too long to generate a QR code. Chrome may have failed to load WhatsApp Web. Click "Try Again" to retry.');
      }, 95000);
    } else {
      if (connectingTimerRef.current) { clearTimeout(connectingTimerRef.current); connectingTimerRef.current = null; }
    }
    return () => { if (connectingTimerRef.current) { clearTimeout(connectingTimerRef.current); connectingTimerRef.current = null; } };
  }, [connecting, qrCode, isConnected]);

  // Listen for real-time socket events for instant QR + connection updates
  useEffect(() => {
    const handleQr = (data: any) => {
      setLiveQr(data.qrCode);
      setConnecting(false);
      setLinking(false);
      setWaError(null);
    };
    const handleAuthenticated = () => {
      // QR was scanned — immediately hide QR and show linking spinner
      setLiveQr(null);
      setLinking(true);
      setConnecting(false);
    };
    const handleReady = (data: any) => {
      setLiveQr(null);
      setLinking(false);
      setConnecting(false);
      setLiveConnected(true);
      setLivePhone(data.phoneNumber || null);
      setLiveSyncing(true);
      setWaError(null);
      toast.success(`WhatsApp connected${data.phoneNumber ? ` (+${data.phoneNumber})` : ''}! Syncing chats...`);
      refetchStatus();
    };
    const handleSyncStart = () => setLiveSyncing(true);
    const handleSyncComplete = () => {
      setLiveSyncing(false);
      toast.success('WhatsApp chats synced!', { duration: 2000 });
    };
    const handleAuthFailure = (data: any) => {
      setLiveQr(null);
      setLinking(false);
      setConnecting(false);
      setWaError(data?.message || 'Authentication failed. Please try again.');
      toast.error('WhatsApp authentication failed');
      refetchStatus();
    };
    const handleDisconnected = () => {
      setLiveQr(null);
      setLinking(false);
      setConnecting(false);
      setLiveConnected(false);
      setLivePhone(null);
      refetchStatus();
    };
    const handleInitTimeout = (data: any) => {
      setConnecting(false);
      setLinking(false);
      setLiveQr(null);
      setWaError(data?.message || 'WhatsApp failed to generate a QR code. Please click "Try Again".');
      toast.error('WhatsApp initialization timed out');
      refetchStatus();
    };

    onSocketEvent('whatsapp:qr', handleQr);
    onSocketEvent('whatsapp:authenticated', handleAuthenticated);
    onSocketEvent('whatsapp:ready', handleReady);
    onSocketEvent('whatsapp:auth_failure', handleAuthFailure);
    onSocketEvent('whatsapp:disconnected', handleDisconnected);
    onSocketEvent('whatsapp:sync:start', handleSyncStart);
    onSocketEvent('whatsapp:sync:complete', handleSyncComplete);
    onSocketEvent('whatsapp:init_timeout', handleInitTimeout);

    return () => {
      offSocketEvent('whatsapp:qr', handleQr);
      offSocketEvent('whatsapp:authenticated', handleAuthenticated);
      offSocketEvent('whatsapp:ready', handleReady);
      offSocketEvent('whatsapp:auth_failure', handleAuthFailure);
      offSocketEvent('whatsapp:disconnected', handleDisconnected);
      offSocketEvent('whatsapp:sync:start', handleSyncStart);
      offSocketEvent('whatsapp:sync:complete', handleSyncComplete);
      offSocketEvent('whatsapp:init_timeout', handleInitTimeout);
    };
  }, [refetchStatus]);

  const handleInitialize = async () => {
    try {
      setConnecting(true);
      setLiveQr(null);
      setWaError(null);
      await initializeWA().unwrap();
      toast.success('WhatsApp initializing... QR code will appear shortly');
    } catch (err: any) {
      setConnecting(false);
      const errorMsg = err?.data?.error?.message || 'Failed to initialize WhatsApp';
      setWaError(errorMsg);
      toast.error(errorMsg);
    }
  };

  const handleDisconnect = async () => {
    try {
      await logoutWA().unwrap();
      toast.success('WhatsApp disconnected');
      refetchStatus();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to disconnect');
    }
  };

  const handleTestMessage = async () => {
    if (!testPhone || !testMsg) return toast.error('Enter phone number and message');
    try {
      await sendMessage({ to: testPhone, message: testMsg }).unwrap();
      toast.success('Test message sent!');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to send message');
    }
  };

  return (
    <div className="layer-card p-6">
      <div className="flex items-center gap-3 mb-2">
        <MessageCircle size={20} className="text-emerald-500" />
        <h2 className="text-lg font-display font-semibold text-gray-800">WhatsApp Integration</h2>
      </div>
      <p className="text-sm text-gray-500 mb-6">Connect WhatsApp Web to send messages to candidates and employees</p>

      <div className={cn('rounded-xl px-4 py-3 mb-6 flex items-center gap-3',
        isConnected ? 'bg-emerald-50 border border-emerald-200'
        : linking ? 'bg-blue-50 border border-blue-200'
        : (connecting || qrCode) ? 'bg-amber-50 border border-amber-200'
        : 'bg-gray-50 border border-gray-200')}>
        {isConnected ? (
          <>
            {liveSyncing ? (
              <Loader2 size={18} className="text-emerald-600 animate-spin" />
            ) : (
              <Wifi size={18} className="text-emerald-600" />
            )}
            <div>
              <p className="text-sm font-medium text-emerald-700">
                {liveSyncing ? 'Connected — Syncing chats...' : 'Connected'}
              </p>
              {(livePhone || status?.phoneNumber) && (
                <p className="text-xs text-emerald-500">Phone: +{livePhone || status?.phoneNumber}</p>
              )}
              {liveSyncing && (
                <p className="text-xs text-emerald-400">Loading your WhatsApp conversations...</p>
              )}
            </div>
          </>
        ) : linking ? (
          <>
            <Loader2 size={18} className="text-blue-600 animate-spin" />
            <div>
              <p className="text-sm font-medium text-blue-700">Linking device...</p>
              <p className="text-xs text-blue-500">QR scanned successfully! Connecting to WhatsApp...</p>
            </div>
          </>
        ) : connecting && !qrCode ? (
          <>
            <Loader2 size={18} className="text-amber-600 animate-spin" />
            <p className="text-sm font-medium text-amber-600">Generating QR code...</p>
          </>
        ) : qrCode ? (
          <>
            <QrCode size={18} className="text-amber-600" />
            <p className="text-sm font-medium text-amber-600">Waiting for scan...</p>
          </>
        ) : (
          <>
            <WifiOff size={18} className="text-gray-400" />
            <p className="text-sm font-medium text-gray-500">Not Connected</p>
          </>
        )}
      </div>

      {isConnected && <WhatsAppStats />}

      {waError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
          <p className="text-sm font-medium text-red-700">Connection Error</p>
          <p className="text-xs text-red-600 mt-1">{waError}</p>
          <button onClick={() => setWaError(null)} className="text-xs text-red-500 underline mt-2">Dismiss</button>
        </div>
      )}

      {!isConnected ? (
        <div className="space-y-6">
          {linking ? (
            <div className="text-center py-12">
              <Loader2 size={48} className="mx-auto text-blue-500 animate-spin mb-4" />
              <p className="text-sm font-medium text-gray-700">Linking your WhatsApp device...</p>
              <p className="text-xs text-gray-400 mt-1">QR code scanned! Please wait while we establish the connection.</p>
            </div>
          ) : qrCode ? (
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-4">Scan this QR code with WhatsApp on your phone</p>
              <div className="inline-block p-4 bg-white rounded-2xl shadow-lg border border-gray-100">
                <img src={qrCode} alt="WhatsApp QR Code" className="w-64 h-64" />
              </div>
              <p className="text-xs text-gray-400 mt-3">Open WhatsApp → Settings → Linked Devices → Link a Device</p>
              <div className="flex items-center justify-center gap-3 mt-4">
                <button
                  onClick={async () => {
                    try {
                      setLiveQr(null);
                      setConnecting(true);
                      await refreshQrMutation().unwrap();
                      toast.success('Refreshing QR code...');
                    } catch (err: any) {
                      setConnecting(false);
                      toast.error(err?.data?.error?.message || 'Failed to refresh QR');
                    }
                  }}
                  disabled={refreshingQr}
                  className="btn-secondary text-xs flex items-center gap-1.5"
                >
                  {refreshingQr && <Loader2 size={12} className="animate-spin" />}
                  Refresh QR
                </button>
                <span className="text-xs text-gray-400">QR updates automatically via real-time connection</span>
              </div>
            </div>
          ) : connecting ? (
            <div className="text-center py-10">
              <Loader2 size={48} className="mx-auto text-indigo-400 animate-spin mb-4" />
              <p className="text-sm font-medium text-gray-700">Initializing WhatsApp...</p>
              <p className="text-xs text-gray-400 mt-1">QR code will appear automatically in a few seconds</p>
              <p className="text-xs text-gray-400 mt-0.5">This can take up to 30–60 seconds on first launch</p>
              <div className="flex items-center justify-center gap-3 mt-6">
                <button
                  onClick={async () => {
                    setConnecting(false);
                    setWaError(null);
                    try { await logoutWA().unwrap(); } catch { /* ignore */ }
                    setTimeout(() => handleInitialize(), 500);
                  }}
                  className="btn-secondary text-xs flex items-center gap-1.5"
                >
                  <Loader2 size={12} /> Try Again
                </button>
                <button
                  onClick={async () => {
                    setConnecting(false);
                    setWaError(null);
                    try { await logoutWA().unwrap(); } catch { /* ignore */ }
                  }}
                  className="text-xs text-gray-500 hover:text-red-600 transition-colors underline"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <MessageCircle size={48} className="mx-auto text-gray-200 mb-4" />
              <p className="text-sm text-gray-500 mb-4">Click below to generate a QR code for WhatsApp Web connection</p>
              <button onClick={handleInitialize} disabled={initializing}
                className="btn-primary flex items-center gap-2 mx-auto">
                {initializing && <Loader2 size={16} className="animate-spin" />}
                <MessageCircle size={16} /> Connect WhatsApp
              </button>
            </div>
          )}

          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
            <h4 className="text-sm font-medium text-blue-700 mb-2">How it works</h4>
            <ol className="text-xs text-blue-600 space-y-1 list-decimal list-inside">
              <li>Click "Connect WhatsApp" to generate a QR code</li>
              <li>Open WhatsApp on your phone → Settings → Linked Devices</li>
              <li>Scan the QR code displayed here</li>
              <li>Connection is detected automatically — no refresh needed</li>
            </ol>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="layer-card p-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Send Test Message</h4>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Phone Number (with country code)</label>
                <input value={testPhone} onChange={e => setTestPhone(e.target.value)}
                  placeholder="919876543210" className="input-glass w-full text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Message</label>
                <textarea value={testMsg} onChange={e => setTestMsg(e.target.value)}
                  className="input-glass w-full text-sm h-20 resize-none" />
              </div>
              <button onClick={handleTestMessage} className="btn-primary text-xs flex items-center gap-2">
                <Send size={14} /> Send Test
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-red-50 rounded-xl border border-red-200">
            <div>
              <p className="text-sm font-medium text-red-700">Disconnect WhatsApp</p>
              <p className="text-xs text-red-500">This will end the current WhatsApp Web session</p>
            </div>
            <button onClick={handleDisconnect} disabled={disconnecting}
              className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2">
              {disconnecting && <Loader2 size={14} className="animate-spin" />}
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WhatsAppStats() {
  const { data: contactsRes, isLoading: loadingContacts } = useGetWhatsAppContactsQuery();
  const { data: messagesRes, isLoading: loadingMessages } = useGetWhatsAppMessagesQuery({ page: 1, limit: 1 });

  const totalContacts = (contactsRes?.data || []).length;
  // Messages total from the meta — represents all-time messages stored in DB
  const totalMessages = messagesRes?.meta?.total || 0;

  return (
    <div className="grid grid-cols-2 gap-4 mb-6">
      <div className="layer-card p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
          <Send size={18} className="text-emerald-600" />
        </div>
        <div>
          <p className="text-xs text-gray-400">Total Messages</p>
          <p className="text-lg font-semibold text-gray-800" data-mono>
            {loadingMessages ? '...' : totalMessages}
          </p>
        </div>
      </div>
      <div className="layer-card p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
          <Users size={18} className="text-blue-600" />
        </div>
        <div>
          <p className="text-xs text-gray-400">Total Contacts</p>
          <p className="text-lg font-semibold text-gray-800" data-mono>
            {loadingContacts ? '...' : totalContacts}
          </p>
        </div>
      </div>
    </div>
  );
}

const PROVIDER_DEFAULTS: Record<string, { modelName: string; placeholder: string }> = {
  DEEPSEEK: { modelName: 'deepseek-chat', placeholder: 'sk-...' },
  OPENAI: { modelName: 'gpt-4o', placeholder: 'sk-...' },
  ANTHROPIC: { modelName: 'claude-sonnet-4-20250514', placeholder: 'sk-ant-...' },
  GEMINI: { modelName: 'gemini-2.0-flash', placeholder: 'AIza...' },
  CUSTOM: { modelName: '', placeholder: 'API key' },
};

function ExternalApiIntegrationTab() {
  const { data: taskConfigRes } = useGetTaskConfigQuery();
  const [upsertTaskConfig, { isLoading: savingTask }] = useUpsertTaskConfigMutation();
  const [testTaskConnection, { isLoading: testingTask }] = useTestTaskConnectionMutation();

  const [integrations, setIntegrations] = useState<{ name: string; provider: string; baseUrl: string; apiKey: string; description: string; enabled: boolean }[]>([
    { name: 'Task Manager', provider: 'CUSTOM', baseUrl: '', apiKey: '', description: 'Connect your task management tool (Jira, ClickUp, Asana, Monday.com, or custom API) to sync employee tasks with performance reviews.', enabled: false },
    { name: 'Naukri / Job Board', provider: 'CUSTOM', baseUrl: '', apiKey: '', description: 'Connect job board APIs to auto-post job openings and receive applications.', enabled: false },
    { name: 'Slack / Teams Webhook', provider: 'CUSTOM', baseUrl: '', apiKey: '', description: 'Send HRMS notifications to your team chat channels via webhook URL.', enabled: false },
  ]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // Pre-fill Task Manager config from backend
  useEffect(() => {
    if (taskConfigRes?.data) {
      const cfg = taskConfigRes.data;
      setIntegrations(prev => {
        const updated = [...prev];
        updated[0] = {
          ...updated[0],
          provider: cfg.provider || 'CUSTOM',
          baseUrl: cfg.baseUrl || '',
          apiKey: '', // Never pre-fill encrypted key — show placeholder
          enabled: cfg.isActive || false,
        };
        return updated;
      });
    }
  }, [taskConfigRes]);

  const handleSaveIntegration = async (index: number) => {
    const intg = integrations[index];
    if (index === 0) {
      // Task Manager — persist to backend
      if (!intg.baseUrl) {
        toast.error('Please enter a Base URL');
        return;
      }
      try {
        await upsertTaskConfig({
          provider: intg.provider || 'CUSTOM',
          // Only send apiKey when user typed a new one — blank = keep existing encrypted key
          apiKey: intg.apiKey || '',
          baseUrl: intg.baseUrl,
        }).unwrap();
        // Clear the typed key from state (never leave secrets in form state)
        setIntegrations(prev => {
          const n = [...prev];
          n[0] = { ...n[0], apiKey: '' };
          return n;
        });
        toast.success('Task Manager configuration saved');
        setEditingIndex(null);
      } catch (err: any) {
        toast.error(err.data?.error?.message || 'Failed to save configuration');
      }
    } else {
      toast.success(`${intg.name} configuration saved`);
      setEditingIndex(null);
    }
  };

  const handleTestIntegration = async (index: number) => {
    const intg = integrations[index];
    if (index === 0) {
      // Task Manager — use backend test endpoint
      try {
        const res = await testTaskConnection().unwrap();
        toast.success(`Task Manager connection successful! (${res.data?.responseTimeMs}ms)`);
      } catch (err: any) {
        toast.error(err.data?.error?.message || 'Connection test failed');
      }
      return;
    }
    if (!intg.baseUrl) {
      toast.error('Please enter a Base URL first');
      return;
    }
    try {
      const res = await fetch(intg.baseUrl, {
        method: 'GET',
        headers: intg.apiKey ? { 'Authorization': `Bearer ${intg.apiKey}` } : {},
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        toast.success(`${intg.name} connection successful!`);
      } else {
        toast.error(`${intg.name} returned status ${res.status}`);
      }
    } catch {
      toast.error(`Cannot reach ${intg.name} — check URL and network`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="layer-card p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <ExternalLink size={20} className="text-brand-600" /> External API Integrations
        </h3>
        <p className="text-sm text-gray-500 mb-5">Connect third-party services to extend HRMS functionality. API keys are optional — leave blank if the service doesn't require authentication.</p>

        <div className="space-y-4">
          {integrations.map((intg, i) => {
            const isSaved = i === 0 && !!taskConfigRes?.data;
            const isEditing = editingIndex === i;
            return (
            <div key={intg.name} className={cn('border rounded-xl p-4 transition-all', isSaved ? 'border-brand-200 bg-brand-50/30' : 'border-gray-200')}>
              {/* Header row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0', isSaved ? 'bg-brand-100' : 'bg-gray-100')}>
                    <ExternalLink size={18} className={isSaved ? 'text-brand-600' : 'text-gray-400'} />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-gray-800">{intg.name}</h4>
                    <p className="text-xs text-gray-400">{intg.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {isSaved && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Connected</span>
                  )}
                  <button
                    onClick={() => setEditingIndex(isEditing ? null : i)}
                    className={cn('text-xs font-medium px-3 py-1 rounded-lg border transition-colors',
                      isEditing
                        ? 'border-gray-300 text-gray-600 hover:bg-gray-50'
                        : 'border-brand-200 text-brand-600 hover:bg-brand-50'
                    )}>
                    {isEditing ? 'Close' : (isSaved ? 'Edit' : 'Configure')}
                  </button>
                </div>
              </div>

              {/* Read-only summary — shown when NOT editing and config exists */}
              {isSaved && !isEditing && (
                <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">Provider</p>
                    <p className="text-xs text-gray-700 font-medium">{taskConfigRes!.data.provider || 'Custom'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">Base URL</p>
                    <p className="text-xs text-gray-700 font-mono truncate">{taskConfigRes!.data.baseUrl || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">API Key</p>
                    <p className="text-xs text-gray-500 font-mono flex items-center gap-1.5">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-500"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      ••••••••••••  <span className="text-green-600 font-medium">Saved</span>
                    </p>
                  </div>
                </div>
              )}

              {/* Edit form — shown only when editing */}
              <AnimatePresence>
                {isEditing && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="pt-3 mt-3 border-t border-gray-100 space-y-3">
                      {i === 0 && (
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Provider</label>
                          <select
                            value={(intg as any).provider || 'CUSTOM'}
                            onChange={e => { const n = [...integrations]; (n[i] as any).provider = e.target.value; setIntegrations(n); }}
                            className="input-glass w-full text-sm"
                          >
                            <option value="CUSTOM">Custom API / Monday.com</option>
                            <option value="JIRA">Jira (Base URL required)</option>
                            <option value="ASANA">Asana</option>
                            <option value="CLICKUP">ClickUp</option>
                          </select>
                          {(intg as any).provider === 'JIRA' && (
                            <p className="text-[10px] text-amber-600 mt-1">Jira: enter Base URL (e.g. https://yourcompany.atlassian.net) and API Key as <span className="font-mono">base64(email:api_token)</span></p>
                          )}
                          {(intg as any).provider === 'ASANA' && (
                            <p className="text-[10px] text-gray-400 mt-1">Asana: no Base URL needed — paste your Personal Access Token as the API Key. Employee ID must match Asana user GID.</p>
                          )}
                          {(intg as any).provider === 'CLICKUP' && (
                            <p className="text-[10px] text-gray-400 mt-1">ClickUp: no Base URL needed — paste your API Key. Employee ID must match the ClickUp user ID.</p>
                          )}
                          {(intg as any).provider === 'CUSTOM' && (
                            <p className="text-[10px] text-gray-400 mt-1">Custom API must implement <span className="font-mono">GET /api/external/employees?search=</span> and <span className="font-mono">GET /api/external/employees/:id</span></p>
                          )}
                        </div>
                      )}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Base URL</label>
                        <input value={intg.baseUrl}
                          onChange={e => { const n = [...integrations]; n[i].baseUrl = e.target.value; setIntegrations(n); }}
                          placeholder="https://api.example.com" className="input-glass w-full text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-2">
                          API Key
                          {isSaved && (
                            <span className="text-[10px] text-green-600 font-normal bg-green-50 px-1.5 py-0.5 rounded">✓ encrypted &amp; saved</span>
                          )}
                        </label>
                        <div className="relative">
                          <input type="password" value={intg.apiKey}
                            onChange={e => { const n = [...integrations]; n[i].apiKey = e.target.value; setIntegrations(n); }}
                            placeholder={isSaved ? 'Leave blank to keep existing key, or paste new key to replace' : 'Enter API key'}
                            className="input-glass w-full text-sm pr-8" />
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        </div>
                        {isSaved && (
                          <p className="text-[10px] text-gray-400 mt-1">Your key is stored encrypted on the server. Leave blank to keep it unchanged.</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleSaveIntegration(i)} disabled={i === 0 && savingTask} className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50">
                          {i === 0 && savingTask ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                        </button>
                        <button onClick={() => handleTestIntegration(i)} disabled={i === 0 && testingTask} className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-50">
                          {i === 0 && testingTask ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Test Connection
                        </button>
                        <button onClick={() => setEditingIndex(null)} className="text-xs text-gray-400 hover:text-gray-600 ml-auto">
                          Cancel
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            );
          })}
        </div>
      </div>

      {/* Quick links to other integrations */}
      <div className="layer-card p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Other Integrations</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors">
            <Mail size={18} className="text-blue-500" />
            <div>
              <p className="text-xs font-medium text-gray-700">Email (SMTP)</p>
              <p className="text-[10px] text-gray-400">Configure in Email tab</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors">
            <MessageCircle size={18} className="text-green-500" />
            <div>
              <p className="text-xs font-medium text-gray-700">WhatsApp</p>
              <p className="text-[10px] text-gray-400">Configure in WhatsApp tab</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors">
            <Cloud size={18} className="text-blue-600" />
            <div>
              <p className="text-xs font-medium text-gray-700">Microsoft Teams SSO</p>
              <p className="text-[10px] text-gray-400">Configure in Teams tab</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors">
            <Cpu size={18} className="text-purple-500" />
            <div>
              <p className="text-xs font-medium text-gray-700">AI API (DeepSeek/OpenAI)</p>
              <p className="text-[10px] text-gray-400">Configure in AI API Config tab</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApiIntegrationsTab() {
  const { data: res, isLoading } = useGetAiConfigQuery();
  const [testConnection, { isLoading: testing }] = useTestAiConnectionMutation();
  const { data: aiHealth, refetch: refetchHealth } = useGetAiServiceHealthQuery(undefined, { pollingInterval: 30000 });

  const config = res?.data;
  const isEnvManaged = config?.isEnvManaged === true;
  const [testResult, setTestResult] = useState<any>(null);

  const handleTest = async () => {
    try {
      const result = await testConnection({ provider: 'OPENAI', modelName: config?.modelName || 'gpt-4.1-mini' }).unwrap();
      setTestResult(result.data);
      if (result.data?.success) {
        toast.success(`Connection successful! (${result.data.latencyMs}ms)`);
      } else {
        toast.error(result.data?.message || 'Connection test failed');
      }
    } catch {
      toast.error('Connection test failed');
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-brand-600" size={32} /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Python OCR Service Health Card */}
      <div className="layer-card p-4 flex items-start gap-4">
        <div className={cn(
          'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
          aiHealth?.data?.status === 'online' ? 'bg-emerald-100' :
          aiHealth?.data?.status === 'degraded' ? 'bg-amber-100' :
          aiHealth?.data?.status === 'offline' ? 'bg-red-100' : 'bg-slate-100'
        )}>
          <Server size={18} className={cn(
            aiHealth?.data?.status === 'online' ? 'text-emerald-600' :
            aiHealth?.data?.status === 'degraded' ? 'text-amber-600' :
            aiHealth?.data?.status === 'offline' ? 'text-red-600' : 'text-slate-500'
          )} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-800">Python OCR Service (KYC Document Scanner)</p>
            <span className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold',
              aiHealth?.data?.status === 'online'   ? 'bg-emerald-100 text-emerald-700' :
              aiHealth?.data?.status === 'degraded' ? 'bg-amber-100 text-amber-700' :
              aiHealth?.data?.status === 'offline'  ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'
            )}>
              <span className={cn(
                'w-1.5 h-1.5 rounded-full',
                aiHealth?.data?.status === 'online' ? 'bg-emerald-500 animate-pulse' :
                aiHealth?.data?.status === 'degraded' ? 'bg-amber-500' :
                aiHealth?.data?.status === 'offline' ? 'bg-red-500' : 'bg-slate-400'
              )} />
              {aiHealth?.data?.status === 'online'
                ? `Online · ${aiHealth.data.latencyMs}ms`
                : aiHealth?.data?.status === 'degraded'
                  ? `Degraded (HTTP ${aiHealth.data.httpStatus})`
                  : aiHealth?.data?.status === 'offline'
                    ? 'Offline — KYC uses Node.js fallback'
                    : 'Checking…'}
            </span>
            <button onClick={() => refetchHealth()} className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
              <RefreshCw size={11} /> Refresh
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Python Tesseract OCR service for KYC document classification. Separate from the AI Provider below.
            If offline, KYC falls back to Node.js OCR automatically — no action needed.
          </p>
          {aiHealth?.data?.status === 'offline' && (
            <p className="text-xs text-red-600 mt-1 font-medium">
              Offline reason: {aiHealth.data.error || 'Connection refused'}.
              Check Docker: <code className="bg-red-50 px-1 rounded">docker ps | grep ai-service</code>
            </p>
          )}
        </div>
      </div>

      {/* AI Provider — read-only when env-managed */}
      <div className="layer-card p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <Cpu size={20} className="text-brand-600" /> AI Provider
        </h3>
        <p className="text-sm text-gray-500 mb-5">
          Powers resume scoring, interview questions, AI assistant, and KYC vision scanning.
        </p>

        {/* Server-managed banner */}
        {isEnvManaged && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-start gap-3 mb-5">
            <CheckCircle2 size={18} className="text-emerald-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-emerald-800">API key is securely managed via server environment</p>
              <p className="text-xs text-emerald-700 mt-0.5">
                The OpenAI API key is injected at deploy time via a GitHub Secret. It is never stored in the database
                or exposed to the frontend. KYC vision uses <span className="font-mono font-semibold">gpt-4.1-mini</span> with
                automatic escalation to <span className="font-mono font-semibold">gpt-4.1</span> on low-confidence documents.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 mb-5">
          <div className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
            <p className="text-xs text-gray-500 mb-1">Provider</p>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-800">{config?.provider || 'OpenAI'}</span>
              {isEnvManaged && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                  <CheckCircle2 size={11} /> Active
                </span>
              )}
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
            <p className="text-xs text-gray-500 mb-1">Model</p>
            <p className="text-sm font-semibold text-gray-800 font-mono">{config?.modelName || 'gpt-4.1-mini'}</p>
          </div>
        </div>

        {/* Test Connection */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleTest}
            disabled={testing}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            {testing ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
            Test Connection
          </button>
          {config?.updatedAt && (
            <p className="text-xs text-gray-400">
              Last updated: {new Date(config.updatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          )}
        </div>

        {/* Test Result */}
        {testResult && (
          <div className={cn(
            'rounded-xl px-4 py-3 border mt-4',
            testResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
          )}>
            <div className="flex items-center gap-2 mb-1">
              {testResult.success ? <CheckCircle2 size={16} className="text-green-600" /> : <AlertTriangle size={16} className="text-red-600" />}
              <span className={cn('text-sm font-medium', testResult.success ? 'text-green-700' : 'text-red-700')}>
                {testResult.success ? 'Connection Successful' : 'Connection Failed'}
              </span>
            </div>
            {testResult.success ? (
              <div className="text-xs text-green-600 space-y-0.5">
                <p>Provider: {testResult.provider} | Model: {testResult.model}</p>
                <p>Latency: {testResult.latencyMs}ms</p>
                <p className="text-gray-500 italic mt-1">"{testResult.response}"</p>
              </div>
            ) : (
              <p className="text-xs text-red-600">{testResult.message}</p>
            )}
          </div>
        )}
      </div>

      {/* Knowledge Base */}
      <KnowledgeBaseSection />
    </div>
  );
}

function KnowledgeBaseSection() {
  const { data: res, isLoading } = useGetKnowledgeBaseQuery();
  const [addDoc, { isLoading: adding }] = useAddKnowledgeDocMutation();
  const [deleteDoc] = useDeleteKnowledgeDocMutation();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const docs = res?.data || [];

  const handleAdd = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error('Title and content are required');
      return;
    }
    try {
      await addDoc({ title: title.trim(), content: content.trim() }).unwrap();
      toast.success('Knowledge document added');
      setTitle('');
      setContent('');
    } catch {
      toast.error('Failed to add knowledge document');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(id).unwrap();
      toast.success('Knowledge document deleted');
    } catch {
      toast.error('Failed to delete knowledge document');
    }
  };

  return (
    <div className="layer-card p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-1 flex items-center gap-2">
        <BookOpen size={20} className="text-brand-600" /> Knowledge Base
      </h3>
      <p className="text-sm text-gray-500 mb-5">Upload documents to train the AI assistant on company policies.</p>

      {/* Add Document Form */}
      <div className="space-y-3 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g., Leave Policy, Work from Home Guidelines"
            className="input-glass w-full text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Content</label>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Paste the full document content here..."
            rows={5}
            className="input-glass w-full text-sm resize-y"
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={adding || !title.trim() || !content.trim()}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          {adding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          Add Document
        </button>
      </div>

      {/* Document List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-brand-600" size={24} />
        </div>
      ) : docs.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">No knowledge documents added yet.</p>
      ) : (
        <div className="space-y-2">
          {docs.map((doc: any) => (
            <div key={doc.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3 border border-gray-100">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800 truncate">{doc.title}</p>
                <p className="text-xs text-gray-400">
                  Added {new Date(doc.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                </p>
              </div>
              <button
                onClick={() => handleDelete(doc.id)}
                className="ml-3 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                title="Delete document"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ===== AGENT SETUP TAB ===== */
const AGENT_HEARTBEAT_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes — agent considered disconnected after this

function AgentSetupTab() {
  const { data: res, isLoading } = useGetAgentSetupListQuery();
  const { data: downloadRes, isLoading: checkingDownload } = useGetAgentDownloadStatusQuery();
  const [generateCode, { isLoading: generating }] = useGenerateAgentCodeMutation();
  const [regenerateCode, { isLoading: regenerating }] = useRegenerateAgentCodeMutation();
  const [bulkGenerate, { isLoading: bulkGenerating }] = useBulkGenerateAgentCodesMutation();
  const [search, setSearch] = useState('');
  const [liveStatuses, setLiveStatuses] = useState<Record<string, { isActive: boolean; lastHeartbeat: string }>>({});

  const employees: any[] = res?.data || [];

  const downloadAvailable = downloadRes?.data?.available ?? false;
  // Use nginx-served path — direct file serve, bypasses Express entirely
  const downloadUrl = '/downloads/aniston-agent-setup.exe';

  // Real-time socket updates
  useEffect(() => {
    const handler = (data: any) => {
      if (data?.employeeId) {
        setLiveStatuses(prev => ({
          ...prev,
          [data.employeeId]: { isActive: true, lastHeartbeat: data.timestamp || new Date().toISOString() },
        }));
      }
    };
    onSocketEvent('agent:heartbeat', handler);
    return () => { offSocketEvent('agent:heartbeat', handler); };
  }, []);

  // Auto-fade: mark as disconnected if no heartbeat in 2 min
  useEffect(() => {
    const interval = setInterval(() => {
      const twoMinAgo = Date.now() - AGENT_HEARTBEAT_TIMEOUT_MS;
      setLiveStatuses(prev => {
        const next = { ...prev };
        for (const [id, status] of Object.entries(next)) {
          if (status.isActive && new Date(status.lastHeartbeat).getTime() < twoMinAgo) {
            next[id] = { ...status, isActive: false };
          }
        }
        return next;
      });
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const getStatus = (emp: any) => {
    const live = liveStatuses[emp.id];
    if (live) return live;
    return emp.agentStatus || { isActive: false, lastHeartbeat: null };
  };

  const filtered = employees.filter((e: any) => {
    if (!search) return true;
    return `${e.firstName} ${e.lastName} ${e.employeeCode} ${e.email || ''}`.toLowerCase().includes(search.toLowerCase());
  });

  const connectedCount = employees.filter(e => getStatus(e).isActive).length;
  const withCodeCount = employees.filter(e => !!e.agentPairingCode).length;

  const handleGenerate = async (employeeId: string) => {
    try {
      const result = await generateCode({ employeeId }).unwrap();
      const code = result?.data?.code;
      if (code) {
        navigator.clipboard.writeText(code)
          .then(() => toast.success(`Code generated: ${code} (copied to clipboard)`))
          .catch(() => toast.success(`Code generated: ${code} — copy it manually`));
      }
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const handleRegenerate = async (employeeId: string) => {
    if (!confirm('This will invalidate the old code. The agent on this employee\'s machine will need to be reconfigured. Continue?')) return;
    try {
      const result = await regenerateCode({ employeeId }).unwrap();
      const code = result?.data?.code;
      if (code) {
        navigator.clipboard.writeText(code)
          .then(() => toast.success(`New code: ${code} (copied to clipboard)`))
          .catch(() => toast.success(`New code: ${code} — copy it manually`));
      }
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const handleBulkGenerate = async () => {
    if (!confirm(`Generate codes for all ${employees.length - withCodeCount} employees without a code?`)) return;
    try {
      const result = await bulkGenerate().unwrap();
      toast.success(`Generated ${result?.data?.generated || 0} codes`);
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code)
      .then(() => toast.success('Code copied to clipboard'))
      .catch(() => toast.error('Failed to copy — please copy manually'));
  };

  const relativeTime = (dateStr: string | null) => {
    if (!dateStr) return '—';
    const diff = Date.now() - new Date(dateStr).getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-brand-600" size={32} /></div>;
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="layer-card p-5">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2"><Monitor size={20} className="text-brand-600" /> Agent Setup</h3>
            <p className="text-sm text-gray-500 mt-0.5">Generate permanent pairing codes and deploy the desktop agent to employee machines.</p>
          </div>
          {checkingDownload ? (
            <button disabled className="btn-primary text-sm flex items-center gap-1.5 opacity-60 cursor-not-allowed">
              <Loader2 size={14} className="animate-spin" /> Checking...
            </button>
          ) : downloadAvailable ? (
            <a href={downloadUrl} download="aniston-agent-setup.exe" className="btn-primary text-sm flex items-center gap-1.5">
              <Download size={14} /> Download Agent (.exe)
            </a>
          ) : (
            <div className="flex flex-col items-end gap-1">
              <button
                disabled
                title="Agent installer not yet built. Push to main to trigger CI/CD build."
                className="text-sm flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-400 rounded-lg cursor-not-allowed">
                <Download size={14} /> Download Agent (.exe)
              </button>
              <p className="text-[10px] text-amber-600 flex items-center gap-1">
                <AlertTriangle size={10} /> Not yet built — push to main to generate
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Summary + Search + Bulk */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="relative flex-1 min-w-[260px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employees..."
              className="input-glass w-full pl-10 text-sm" />
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500 whitespace-nowrap">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> {connectedCount} connected</span>
            <span>{withCodeCount} with code</span>
            <span>{employees.length} total</span>
          </div>
        </div>
        {employees.length - withCodeCount > 0 && (
          <button onClick={handleBulkGenerate} disabled={bulkGenerating}
            className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap">
            {bulkGenerating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Generate All Codes ({employees.length - withCodeCount})
          </button>
        )}
      </div>

      {/* Employee Table */}
      <div className="layer-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Employee</th>
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Department</th>
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Agent Code</th>
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Status</th>
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Last Seen</th>
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((emp: any) => {
              const status = getStatus(emp);
              return (
                <tr key={emp.id} className="border-b border-gray-50 hover:bg-surface-2">
                  <td className="p-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                        {emp.avatar ? <img src={getUploadUrl(emp.avatar)} alt="" className="w-full h-full rounded-full object-cover" /> : getInitials(`${emp.firstName} ${emp.lastName}`)}
                      </div>
                      <div>
                        <p className="font-medium text-gray-800 text-sm">{emp.firstName} {emp.lastName}</p>
                        <p className="text-[11px] text-gray-400">{emp.employeeCode} · {emp.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-xs text-gray-500">{emp.department || '—'}</td>
                  <td className="p-3">
                    {emp.agentPairingCode ? (
                      <div className="flex items-center gap-1.5">
                        <code className="text-xs font-mono bg-gray-100 px-2 py-1 rounded text-gray-700 select-all" data-mono>{emp.agentPairingCode}</code>
                        <span className="text-[9px] bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded font-medium">Permanent</span>
                        <button onClick={() => copyCode(emp.agentPairingCode)} className="text-gray-400 hover:text-brand-600 p-0.5" title="Copy code">
                          <Copy size={12} />
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">No code</span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1.5">
                      <span className={cn('w-2 h-2 rounded-full', status.isActive ? 'bg-green-500 animate-pulse' : emp.agentPairedAt ? 'bg-red-400' : 'bg-gray-300')} />
                      <span className={cn('text-xs font-medium', status.isActive ? 'text-green-600' : emp.agentPairedAt ? 'text-red-500' : 'text-gray-400')}>
                        {status.isActive ? 'Connected' : emp.agentPairedAt ? 'Disconnected' : 'Not paired'}
                      </span>
                    </div>
                  </td>
                  <td className="p-3 text-xs text-gray-400">{relativeTime(status.lastHeartbeat)}</td>
                  <td className="p-3">
                    <div className="flex gap-1.5">
                      {!emp.agentPairingCode ? (
                        <button onClick={() => handleGenerate(emp.id)} disabled={generating}
                          className="btn-primary text-[11px] py-1 px-2.5 flex items-center gap-1">
                          {generating ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />} Generate Code
                        </button>
                      ) : (
                        <button onClick={() => handleRegenerate(emp.id)} disabled={regenerating}
                          className="text-[11px] py-1 px-2.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 flex items-center gap-1"
                          title="Generate new code (invalidates old)">
                          <RefreshCw size={10} /> Regenerate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-sm text-gray-400">No employees found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Setup instructions */}
      <div className="layer-card p-4 bg-blue-50/50 border border-blue-100">
        <p className="text-sm text-blue-800 font-medium mb-1">How to set up an agent:</p>
        <ol className="text-xs text-blue-700 space-y-0.5 list-decimal list-inside">
          <li>Click "Generate Code" for the employee to get a permanent pairing code.</li>
          <li>Download and install the agent (.exe) on the employee's computer.</li>
          <li>Open the agent and paste the pairing code when prompted.</li>
          <li>Once connected, the status will turn green and activity tracking begins automatically.</li>
        </ol>
      </div>
    </div>
  );
}

function DocumentTemplatesTab() {
  const { data: res, isLoading } = useGetDocumentTemplatesQuery();
  const [upsert, { isLoading: isSaving }] = useUpsertDocumentTemplateMutation();
  const [deleteTemplate, { isLoading: isDeleting }] = useDeleteDocumentTemplateMutation();

  const templates = res?.data || [];

  const [newLabel, setNewLabel] = useState('');
  const [newRequired, setNewRequired] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleAdd = async () => {
    const label = newLabel.trim();
    if (!label) return;
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    try {
      await upsert({ key, label, required: newRequired, isDefault: true }).unwrap();
      toast.success('Template added');
      setNewLabel('');
      setNewRequired(true);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to add template');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this document template? Existing invitations already sent will not be affected.')) return;
    setDeletingId(id);
    try {
      await deleteTemplate(id).unwrap();
      toast.success('Template removed');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to remove');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="layer-card p-6">
        <div className="flex items-start gap-3 mb-6">
          <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
            <FileText size={18} className="text-amber-600" />
          </div>
          <div>
            <h2 className="text-lg font-display font-semibold text-gray-800">Document Templates</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Define the default document fields required from <strong>Experienced</strong> employees during KYC.
              These auto-populate when HR sends an invitation with Experience Level = Experienced, but can be customised per invitation.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-24">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : (
          <>
            {templates.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <FileText size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">No templates yet. Add your first required document below.</p>
              </div>
            ) : (
              <div className="space-y-2 mb-6">
                {templates.map((t: any) => (
                  <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 bg-gray-50/50 hover:bg-gray-50 transition-colors">
                    <FileText size={14} className="text-gray-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700">{t.label}</p>
                      <p className="text-xs text-gray-400 font-mono" data-mono>{t.key}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.required ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                      {t.required ? 'Required' : 'Optional'}
                    </span>
                    <button
                      onClick={() => handleDelete(t.id)}
                      disabled={isDeleting && deletingId === t.id}
                      className="p-1.5 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-500 transition-colors"
                    >
                      {isDeleting && deletingId === t.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add new template */}
            <div className="border-t border-gray-100 pt-5">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Add Document Field</h3>
              <div className="flex gap-3 items-center">
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAdd())}
                  className="input-glass flex-1 text-sm"
                  placeholder="e.g. Relieving Letter, Payslips (last 3 months)"
                />
                <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={newRequired}
                    onChange={(e) => setNewRequired(e.target.checked)}
                    className="w-3.5 h-3.5 accent-indigo-600"
                  />
                  Required
                </label>
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={isSaving || !newLabel.trim()}
                  className="btn-primary flex items-center gap-1.5 flex-shrink-0"
                >
                  {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Add
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                The <span className="font-mono" data-mono>key</span> is auto-generated from the label (e.g. "Relieving Letter" → <span className="font-mono" data-mono>relieving_letter</span>).
              </p>
            </div>
          </>
        )}
      </div>

      <div className="layer-card p-4 bg-blue-50/50 border border-blue-100">
        <p className="text-sm text-blue-800 font-medium mb-1">How document templates work:</p>
        <ol className="text-xs text-blue-700 space-y-0.5 list-decimal list-inside">
          <li>Add document fields here (e.g. "Experience Letter", "Relieving Letter").</li>
          <li>When HR invites an employee with Experience Level = Experienced, these fields auto-populate.</li>
          <li>HR can customise the list per invitation — adding or removing fields as needed.</li>
          <li>During KYC, the employee sees and uploads exactly the documents configured for their invitation.</li>
        </ol>
      </div>
    </div>
  );
}
