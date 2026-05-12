import { useState } from 'react';
import {
  useGetTaskConfigQuery,
  useUpsertTaskConfigMutation,
  useTestTaskConnectionMutation,
} from './taskIntegrationApi';
import { Loader2, Settings, CheckCircle, XCircle, Edit2, Lock } from 'lucide-react';

const PROVIDERS = [
  { value: 'JIRA', label: 'Jira' },
  { value: 'ASANA', label: 'Asana' },
  { value: 'CLICKUP', label: 'ClickUp' },
  { value: 'CUSTOM', label: 'Custom' },
];

export default function TaskIntegrationPage() {
  const { data, isLoading } = useGetTaskConfigQuery();
  const [upsert, { isLoading: saving }] = useUpsertTaskConfigMutation();
  const [testConn, { isLoading: testing }] = useTestTaskConnectionMutation();

  const config = data?.data;

  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState('JIRA');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const startEdit = () => {
    setProvider(config?.provider ?? 'JIRA');
    setBaseUrl(config?.baseUrl ?? '');
    setWorkspaceId(config?.workspaceId ?? '');
    setApiKey('');
    setEditing(true);
    setTestResult(null);
  };

  const cancelEdit = () => {
    setEditing(false);
    setApiKey('');
    setTestResult(null);
  };

  const handleSave = async () => {
    if (!apiKey) return;
    await upsert({ provider, apiKey, baseUrl: baseUrl || undefined, workspaceId: workspaceId || undefined });
    setEditing(false);
    setApiKey('');
  };

  const handleTest = async () => {
    try {
      const res = await testConn().unwrap();
      setTestResult({ ok: true, message: res?.data?.message ?? 'Connection successful' });
    } catch (err: any) {
      setTestResult({ ok: false, message: err?.data?.error?.message ?? 'Connection failed' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900" style={{ fontFamily: 'Sora, sans-serif' }}>
          Task Integration
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Connect Jira, Asana, or ClickUp to assess leave impact on open tasks
        </p>
      </div>

      <div className="layer-card p-6 space-y-5">
        <div className="flex items-center gap-3">
          <Settings className="w-5 h-5 text-indigo-600" />
          <h2 className="font-semibold text-gray-900">Integration Config</h2>
        </div>

        {!editing ? (
          /* Read-only view */
          <div className="space-y-4">
            {config ? (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Provider</span>
                  <span className="font-medium text-gray-900">{config.provider}</span>
                </div>
                {config.baseUrl && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Base URL</span>
                    <span className="font-medium text-gray-900">{config.baseUrl}</span>
                  </div>
                )}
                {config.workspaceId && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Workspace ID</span>
                    <span className="font-medium text-gray-900">{config.workspaceId}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">API Key</span>
                  <span className="flex items-center gap-1.5 text-gray-400">
                    <Lock className="w-3.5 h-3.5" />
                    •••••••••••• Saved
                  </span>
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-500">No integration configured yet.</p>
            )}

            <div className="flex gap-3 pt-2">
              <button onClick={startEdit} className="btn-primary flex items-center gap-2 text-sm px-4 py-2">
                <Edit2 className="w-4 h-4" />
                {config ? 'Edit Config' : 'Configure'}
              </button>
              {config && (
                <button
                  onClick={handleTest}
                  disabled={testing}
                  className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2"
                >
                  {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Test Connection
                </button>
              )}
            </div>

            {testResult && (
              <div className={`flex items-center gap-2 text-sm p-3 rounded-lg ${testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {testResult.ok ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                {testResult.message}
              </div>
            )}
          </div>
        ) : (
          /* Edit form */
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="input-glass w-full"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                API Key <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter API key"
                className="input-glass w-full"
              />
            </div>

            {(provider === 'JIRA' || provider === 'CUSTOM') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Base URL</label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://yourcompany.atlassian.net"
                  className="input-glass w-full"
                />
              </div>
            )}

            {(provider === 'ASANA' || provider === 'CLICKUP') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Workspace / Team ID</label>
                <input
                  type="text"
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                  placeholder="Workspace or Team ID"
                  className="input-glass w-full"
                />
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={handleSave}
                disabled={saving || !apiKey}
                className="btn-primary flex items-center gap-2 text-sm px-4 py-2 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Save Config
              </button>
              <button
                onClick={cancelEdit}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Info box */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-sm text-indigo-700">
        <p className="font-medium mb-1">How it works</p>
        <ul className="list-disc list-inside space-y-1 text-indigo-600">
          <li>When an employee applies for leave, open tasks are fetched from your task manager</li>
          <li>AI assesses handover risk: Critical / High / Medium / Low</li>
          <li>Managers see risk scores in the leave approval panel</li>
          <li>Handover notes are auto-generated for high-risk leaves</li>
        </ul>
      </div>
    </div>
  );
}
