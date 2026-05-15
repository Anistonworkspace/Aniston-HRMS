import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, LogOut, ShieldCheck, ChevronRight } from 'lucide-react';
import { useAppSelector, useAppDispatch } from '../../app/store';
import { setUser, logout } from './authSlice';
import { useGetMeQuery } from './authApi';
import { MFASetupModal } from './MFASetupModal';

export default function MfaRequiredPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { user } = useAppSelector((state) => state.auth);
  const [showSetup, setShowSetup] = useState(false);

  const { refetch: refetchMe } = useGetMeQuery(undefined, { skip: false });

  const handleMfaEnabled = async () => {
    setShowSetup(false);
    try {
      const result = await refetchMe();
      if (result.data?.data) {
        dispatch(setUser(result.data.data));
      } else if (user) {
        dispatch(setUser({ ...user, profileComplete: true }));
      }
    } catch {
      if (user) dispatch(setUser({ ...user, profileComplete: true }));
    }
    navigate('/dashboard', { replace: true });
  };

  const handleSkip = async () => {
    try {
      const result = await refetchMe();
      if (result.data?.data) {
        dispatch(setUser({ ...result.data.data, profileComplete: true }));
      } else if (user) {
        dispatch(setUser({ ...user, profileComplete: true }));
      }
    } catch {
      if (user) dispatch(setUser({ ...user, profileComplete: true }));
    }
    navigate('/dashboard', { replace: true });
  };

  const handleLogout = () => {
    dispatch(logout());
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-surface-1 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="w-16 h-16 bg-amber-50 border-2 border-amber-200 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Shield size={28} className="text-amber-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Secure Your Account</h1>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            Two-Factor Authentication adds an extra layer of security.<br />
            You can set it up now or later from your Profile settings.
          </p>
        </div>

        {/* Setup card */}
        <div className="layer-card p-5 space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm font-semibold text-blue-800">Recommended</p>
            <p className="text-xs text-blue-600 mt-1 leading-relaxed">
              Enable MFA using Google Authenticator, Authy, or any TOTP app — scan the QR code or enter the secret key manually.
            </p>
          </div>

          <div className="space-y-2">
            <p className="font-medium text-gray-700 text-xs uppercase tracking-wide">How to set up:</p>
            {[
              'Download Google Authenticator or Authy on your phone',
              'Click "Set Up MFA" — scan QR code, or copy the secret key manually',
              'Enter the 6-digit code from the app to verify',
              'You\'ll use this code at every login going forward',
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' }}>
                  {i + 1}
                </span>
                {step}
              </div>
            ))}
          </div>

          <div className="pt-1 grid grid-cols-3 gap-2 text-center text-[10px] text-gray-400">
            <div className="bg-gray-50 rounded-lg p-2">
              <p className="font-medium text-gray-600 text-xs mb-0.5">QR Code</p>
              <p>Scan with camera</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <p className="font-medium text-gray-600 text-xs mb-0.5">Secret Key</p>
              <p>Enter manually</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <p className="font-medium text-gray-600 text-xs mb-0.5">Setup URL</p>
              <p>Microsoft Auth</p>
            </div>
          </div>

          <button
            onClick={() => setShowSetup(true)}
            className="btn-primary w-full flex items-center justify-center gap-2 mt-1"
          >
            <ShieldCheck size={16} /> Set Up Two-Factor Authentication
          </button>

          <button
            onClick={handleSkip}
            className="w-full flex items-center justify-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors py-1"
          >
            Skip for now — set up later from Profile <ChevronRight size={14} />
          </button>
        </div>

        <button
          onClick={handleLogout}
          className="flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors w-full py-1"
        >
          <LogOut size={14} /> Sign out
        </button>
      </div>

      {showSetup && (
        <MFASetupModal
          onClose={() => setShowSetup(false)}
          onEnabled={handleMfaEnabled}
        />
      )}
    </div>
  );
}
