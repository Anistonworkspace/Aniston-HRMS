import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShieldCheck, Copy, Check, Loader2, AlertCircle, QrCode, Key, Link2 } from 'lucide-react';
import { useSetupMfaMutation, useVerifyMfaSetupMutation, useDisableMfaMutation } from './authApi';
import toast from 'react-hot-toast';

type SetupMethod = 'qr' | 'key' | 'url';

// ── MFA Setup Wizard (3 steps: Setup → Verify → Backup codes) ────────────────
export function MFASetupModal({ onClose, onEnabled }: { onClose: () => void; onEnabled: () => void }) {
  const [step, setStep] = useState<'setup' | 'verify' | 'backup'>('setup');
  const [method, setMethod] = useState<SetupMethod>('qr');
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verifyCode, setVerifyCode] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const [setupMfa, { isLoading: setupLoading }] = useSetupMfaMutation();
  const [verifyMfaSetup, { isLoading: verifyLoading }] = useVerifyMfaSetupMutation();

  const handleStart = async () => {
    try {
      const result = await setupMfa().unwrap();
      if (result.success && result.data) {
        setQrCode(result.data.qrCode);
        setSecret(result.data.secret ?? '');
        setOtpauthUrl(result.data.otpauthUrl ?? '');
        setBackupCodes(result.data.backupCodes);
      }
    } catch (err: unknown) {
      const apiErr = err as { data?: { error?: { message?: string } } };
      toast.error(apiErr?.data?.error?.message || 'Failed to initialize MFA setup.');
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (verifyCode.replace(/\D/g, '').length !== 6) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setError('');
    try {
      await verifyMfaSetup({ code: verifyCode.replace(/\D/g, '') }).unwrap();
      setStep('backup');
    } catch (err: unknown) {
      const apiErr = err as { data?: { error?: { message?: string } } };
      setError(apiErr?.data?.error?.message || 'Invalid code. Check your authenticator app.');
    }
  };

  const copyText = async (text: string, which: 'backup' | 'secret' | 'url') => {
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'backup') { setCopied(true); setTimeout(() => setCopied(false), 2000); }
      if (which === 'secret') { setCopiedSecret(true); setTimeout(() => setCopiedSecret(false), 2000); }
      if (which === 'url') { setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 2000); }
    } catch {
      toast.error('Could not copy to clipboard.');
    }
  };

  const handleDone = () => {
    onEnabled();
    onClose();
    toast.success('Two-factor authentication is now active!');
  };

  // Auto-start on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { handleStart(); }, []);

  const handleBackdropClose = () => { if (step === 'backup') onEnabled(); onClose(); };
  const stepIndex = (s: typeof step) => ['setup', 'verify', 'backup'].indexOf(s);

  // Format secret in groups of 4 for readability
  const formattedSecret = secret ? secret.replace(/(.{4})/g, '$1 ').trim() : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={handleBackdropClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} className="text-brand-600" />
            <h3 className="text-base font-semibold text-gray-800">Set Up Two-Factor Authentication</h3>
          </div>
          <button
            onClick={() => { if (step === 'backup') onEnabled(); onClose(); }}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-6">
            {(['setup', 'verify', 'backup'] as const).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  step === s ? 'bg-brand-600 text-white' :
                  stepIndex(step) > i ? 'bg-emerald-500 text-white' :
                  'bg-gray-100 text-gray-400'
                }`}>
                  {stepIndex(step) > i ? <Check size={12} /> : i + 1}
                </div>
                {i < 2 && <div className={`flex-1 h-0.5 w-8 transition-colors ${stepIndex(step) > i ? 'bg-emerald-500' : 'bg-gray-100'}`} />}
              </div>
            ))}
            <span className="ml-2 text-xs text-gray-400">
              {step === 'setup' ? 'Add to Authenticator' : step === 'verify' ? 'Verify Code' : 'Save Backup Codes'}
            </span>
          </div>

          <AnimatePresence mode="wait">
            {/* Step 1: Setup — choose method */}
            {step === 'setup' && (
              <motion.div key="setup" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <p className="text-sm text-gray-600">
                  Open your authenticator app and add your account using one of the methods below.
                  On <strong>mobile</strong>, use the <strong>Secret Key</strong> or <strong>URL</strong> method.
                </p>

                {/* Method tabs */}
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { id: 'qr' as SetupMethod, icon: <QrCode size={16} />, label: 'QR Code', sub: 'Scan with camera' },
                    { id: 'key' as SetupMethod, icon: <Key size={16} />, label: 'Secret Key', sub: 'Google / any TOTP' },
                    { id: 'url' as SetupMethod, icon: <Link2 size={16} />, label: 'Setup URL', sub: 'Microsoft Auth' },
                  ]).map(m => (
                    <button
                      key={m.id}
                      onClick={() => setMethod(m.id)}
                      className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 text-center transition-all ${
                        method === m.id
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      {m.icon}
                      <span className="text-xs font-semibold">{m.label}</span>
                      <span className="text-[10px] text-gray-400 leading-tight">{m.sub}</span>
                    </button>
                  ))}
                </div>

                {setupLoading && (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 size={28} className="animate-spin text-brand-500" />
                  </div>
                )}

                {!setupLoading && (
                  <AnimatePresence mode="wait">
                    {/* QR Code method */}
                    {method === 'qr' && qrCode && (
                      <motion.div key="qr-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
                        <div className="flex justify-center">
                          <div className="border-4 border-white shadow-md rounded-xl overflow-hidden">
                            <img src={qrCode} alt="MFA QR Code" className="w-52 h-52 object-contain" />
                          </div>
                        </div>
                        <p className="text-xs text-gray-400 text-center">
                          In your authenticator app, tap <strong>"+"</strong> or <strong>"Add account"</strong>, then choose <strong>"Scan QR code"</strong>.
                        </p>
                      </motion.div>
                    )}

                    {/* Secret Key method */}
                    {method === 'key' && secret && (
                      <motion.div key="key-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                          <p className="text-[11px] font-medium text-gray-500 mb-1">Account Name</p>
                          <p className="text-sm font-mono text-gray-700 mb-3">Aniston HRMS</p>
                          <p className="text-[11px] font-medium text-gray-500 mb-1">Secret Key</p>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-mono text-gray-900 tracking-widest break-all flex-1">{formattedSecret}</p>
                            <button
                              onClick={() => copyText(secret, 'secret')}
                              className="shrink-0 p-1.5 rounded-lg bg-white border border-gray-200 text-gray-500 hover:text-brand-600 transition-colors"
                            >
                              {copiedSecret ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                            </button>
                          </div>
                        </div>
                        <p className="text-xs text-gray-400">
                          In <strong>Google Authenticator</strong>: tap <strong>"+"</strong> → <strong>"Enter a setup key"</strong> → paste the key above and set type to <strong>Time-based</strong>.
                        </p>
                        <p className="text-xs text-gray-400">
                          In <strong>Microsoft Authenticator</strong>: tap <strong>"+"</strong> → <strong>"Other account"</strong> → <strong>"Or enter code manually"</strong>.
                        </p>
                      </motion.div>
                    )}

                    {/* URL method */}
                    {method === 'url' && otpauthUrl && (
                      <motion.div key="url-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                          <p className="text-[11px] font-medium text-gray-500 mb-1">Setup URL (otpauth://)</p>
                          <div className="flex items-start gap-2">
                            <p className="text-xs font-mono text-gray-700 break-all flex-1 leading-relaxed">{otpauthUrl}</p>
                            <button
                              onClick={() => copyText(otpauthUrl, 'url')}
                              className="shrink-0 p-1.5 rounded-lg bg-white border border-gray-200 text-gray-500 hover:text-brand-600 transition-colors mt-0.5"
                            >
                              {copiedUrl ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                            </button>
                          </div>
                        </div>
                        <p className="text-xs text-gray-400">
                          In <strong>Microsoft Authenticator</strong>: tap <strong>"+"</strong> → <strong>"Other account"</strong> → tap the <strong>link icon</strong> → paste this URL. Works with Authy and most TOTP apps too.
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                )}

                <button
                  onClick={() => setStep('verify')}
                  disabled={!secret}
                  className="w-full bg-brand-600 hover:bg-brand-700 text-white py-2.5 rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
                >
                  I've Added the Account →
                </button>
              </motion.div>
            )}

            {/* Step 2: Verify */}
            {step === 'verify' && (
              <motion.div key="verify" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <p className="text-sm text-gray-600 mb-5">
                  Enter the 6-digit code now showing in your authenticator app to confirm setup.
                </p>

                <form onSubmit={handleVerify} className="space-y-4">
                  <div>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={verifyCode}
                      onChange={e => { setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }}
                      placeholder="000000"
                      maxLength={6}
                      autoFocus
                      className={`w-full text-center text-2xl font-mono tracking-[0.5em] border-2 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-all ${
                        error ? 'border-red-400 bg-red-50' : 'border-gray-300'
                      }`}
                    />
                    {error && (
                      <p className="text-xs text-red-600 mt-2 flex items-center gap-1">
                        <AlertCircle size={12} /> {error}
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={verifyLoading || verifyCode.length !== 6}
                    className="w-full bg-brand-600 hover:bg-brand-700 text-white py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    {verifyLoading && <Loader2 size={16} className="animate-spin" />}
                    {verifyLoading ? 'Verifying…' : 'Confirm & Enable MFA'}
                  </button>

                  <button type="button" onClick={() => setStep('setup')} className="w-full text-sm text-gray-400 hover:text-gray-600 py-1 transition-colors">
                    ← Back
                  </button>
                </form>
              </motion.div>
            )}

            {/* Step 3: Backup Codes */}
            {step === 'backup' && (
              <motion.div key="backup" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                    <Check size={16} className="text-emerald-600" />
                  </div>
                  <p className="text-sm font-semibold text-emerald-700">MFA enabled successfully!</p>
                </div>

                <p className="text-sm text-gray-600 mb-4">
                  Save these backup codes somewhere safe. Each code can be used once if you lose access to your authenticator.
                </p>

                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4">
                  <div className="grid grid-cols-2 gap-2">
                    {backupCodes.map((code, i) => (
                      <span key={i} className="font-mono text-sm text-gray-700 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-center">
                        {code}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => copyText(backupCodes.join('\n'), 'backup')}
                    className="flex-1 flex items-center justify-center gap-2 border border-gray-300 rounded-lg py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    {copied ? <><Check size={15} className="text-emerald-500" /> Copied!</> : <><Copy size={15} /> Copy All</>}
                  </button>
                  <button
                    onClick={handleDone}
                    className="flex-1 bg-brand-600 hover:bg-brand-700 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
                  >
                    Done
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

// ── MFA Disable Confirmation ─────────────────────────────────────────────────
export function MFADisableModal({ onClose, onDisabled }: { onClose: () => void; onDisabled: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [disableMfa, { isLoading }] = useDisableMfaMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.replace(/\D/g, '').length !== 6) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setError('');
    try {
      await disableMfa({ code: code.replace(/\D/g, '') }).unwrap();
      onDisabled();
      onClose();
      toast.success('Two-factor authentication has been disabled.');
    } catch (err: unknown) {
      const apiErr = err as { data?: { error?: { message?: string } } };
      setError(apiErr?.data?.error?.message || 'Invalid code. MFA was NOT disabled.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm"
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-800">Disable Two-Factor Authentication</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="px-6 py-5">
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 mb-5">
            <AlertCircle size={18} className="text-red-500 mt-0.5 shrink-0" />
            <p className="text-sm text-red-700">
              Disabling MFA will make your account less secure. You'll need your current authenticator code to confirm.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Authenticator Code</label>
              <input
                type="text"
                inputMode="numeric"
                value={code}
                onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }}
                placeholder="000000"
                maxLength={6}
                autoFocus
                className={`w-full text-center text-xl font-mono tracking-[0.4em] border-2 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-red-400 transition-all ${
                  error ? 'border-red-400 bg-red-50' : 'border-gray-300'
                }`}
              />
              {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="flex-1 border border-gray-300 rounded-lg py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || code.length !== 6}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-lg py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                {isLoading && <Loader2 size={15} className="animate-spin" />}
                {isLoading ? 'Disabling…' : 'Disable MFA'}
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
