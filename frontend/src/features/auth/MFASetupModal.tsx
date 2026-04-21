import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShieldCheck, Copy, Check, Loader2, AlertCircle } from 'lucide-react';
import { useSetupMfaMutation, useVerifyMfaSetupMutation, useDisableMfaMutation } from './authApi';
import toast from 'react-hot-toast';

// ── MFA Setup Wizard (3 steps: QR → Verify → Backup codes) ──────────────────
export function MFASetupModal({ onClose, onEnabled }: { onClose: () => void; onEnabled: () => void }) {
  const [step, setStep] = useState<'qr' | 'verify' | 'backup'>('qr');
  const [qrCode, setQrCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verifyCode, setVerifyCode] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const [setupMfa, { isLoading: setupLoading }] = useSetupMfaMutation();
  const [verifyMfaSetup, { isLoading: verifyLoading }] = useVerifyMfaSetupMutation();

  const handleStart = async () => {
    try {
      const result = await setupMfa().unwrap();
      if (result.success && result.data) {
        setQrCode(result.data.qrCode);
        setBackupCodes(result.data.backupCodes);
        setStep('qr');
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

  const copyBackupCodes = async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy to clipboard.');
    }
  };

  const handleDone = () => {
    onEnabled();
    onClose();
    toast.success('Two-factor authentication is now active!');
  };

  // Auto-start setup on mount — setupMfa is stable (RTK Query mutation ref)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { handleStart(); }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} className="text-brand-600" />
            <h3 className="text-base font-semibold text-gray-800">Set Up Two-Factor Authentication</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-6">
            {(['qr', 'verify', 'backup'] as const).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  step === s ? 'bg-brand-600 text-white' :
                  ['qr', 'verify', 'backup'].indexOf(step) > i ? 'bg-emerald-500 text-white' :
                  'bg-gray-100 text-gray-400'
                }`}>
                  {['qr', 'verify', 'backup'].indexOf(step) > i ? <Check size={12} /> : i + 1}
                </div>
                {i < 2 && <div className={`flex-1 h-0.5 w-8 transition-colors ${['qr', 'verify', 'backup'].indexOf(step) > i ? 'bg-emerald-500' : 'bg-gray-100'}`} />}
              </div>
            ))}
            <span className="ml-2 text-xs text-gray-400">
              {step === 'qr' ? 'Scan QR Code' : step === 'verify' ? 'Verify Code' : 'Save Backup Codes'}
            </span>
          </div>

          <AnimatePresence mode="wait">
            {/* Step 1: QR Code */}
            {step === 'qr' && (
              <motion.div key="qr" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <p className="text-sm text-gray-600 mb-4">
                  Open <strong>Google Authenticator</strong>, <strong>Authy</strong>, or any TOTP app, then scan this QR code.
                </p>

                {setupLoading ? (
                  <div className="flex items-center justify-center h-48">
                    <Loader2 size={32} className="animate-spin text-brand-500" />
                  </div>
                ) : qrCode ? (
                  <div className="flex justify-center mb-4">
                    <div className="border-4 border-white shadow-md rounded-xl overflow-hidden">
                      <img src={qrCode} alt="MFA QR Code" className="w-48 h-48 object-contain" />
                    </div>
                  </div>
                ) : null}

                <p className="text-xs text-gray-400 text-center mb-5">
                  Can't scan? You can enter the key manually in your authenticator app.
                </p>

                <button
                  onClick={() => setStep('verify')}
                  disabled={!qrCode}
                  className="w-full bg-brand-600 hover:bg-brand-700 text-white py-2.5 rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
                >
                  I've Scanned the Code →
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

                  <button type="button" onClick={() => setStep('qr')} className="w-full text-sm text-gray-400 hover:text-gray-600 py-1 transition-colors">
                    ← Back to QR Code
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
                    onClick={copyBackupCodes}
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
