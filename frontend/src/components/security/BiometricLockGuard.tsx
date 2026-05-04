import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import { Fingerprint, Lock } from 'lucide-react';
import { isBiometricAvailable, authenticateBiometric } from '../../lib/capacitorBiometric';
import type { RootState } from '../../app/store';

const LOCK_AFTER_MS = 10 * 60 * 1000; // lock after 10 min in background
const BIOMETRIC_ENABLED_KEY = 'aniston_biometric_enabled';

export default function BiometricLockGuard({ children }: { children: React.ReactNode }) {
  const user = useSelector((state: RootState) => state.auth.user);
  const [locked, setLocked] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [checking, setChecking] = useState(false);
  const hiddenAtRef = useRef<number | null>(null);

  // Check biometric availability once on mount
  useEffect(() => {
    if (!user) return;
    isBiometricAvailable().then(available => {
      setBiometricAvailable(available);
    });
  }, [user]);

  // Watch visibility — start timer when backgrounded, lock if away too long
  useEffect(() => {
    if (!biometricAvailable || !user) return;
    const enabled = localStorage.getItem(BIOMETRIC_ENABLED_KEY) === '1';
    if (!enabled) return;

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
      } else if (document.visibilityState === 'visible') {
        if (hiddenAtRef.current !== null) {
          const away = Date.now() - hiddenAtRef.current;
          if (away >= LOCK_AFTER_MS) {
            setLocked(true);
          }
          hiddenAtRef.current = null;
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [biometricAvailable, user]);

  const handleUnlock = async () => {
    setChecking(true);
    setAuthFailed(false);
    const success = await authenticateBiometric('Verify identity to access Aniston HRMS');
    setChecking(false);
    if (success) {
      setLocked(false);
      hiddenAtRef.current = null;
    } else {
      setAuthFailed(true);
    }
  };

  return (
    <>
      {children}
      <AnimatePresence>
        {locked && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[99999] bg-gray-950 flex flex-col items-center justify-center gap-6 p-8"
          >
            <div className="w-20 h-20 rounded-full bg-indigo-900/60 flex items-center justify-center mb-2">
              <Lock className="w-10 h-10 text-indigo-300" />
            </div>
            <div className="text-center">
              <h2 className="text-xl font-display font-bold text-white mb-2">App Locked</h2>
              <p className="text-sm text-gray-400 max-w-xs">
                Aniston HRMS was in the background for over 10 minutes. Verify your identity to continue.
              </p>
            </div>
            {authFailed && (
              <p className="text-red-400 text-sm">Authentication failed. Please try again.</p>
            )}
            <button
              onClick={handleUnlock}
              disabled={checking}
              className="flex items-center gap-3 px-8 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-base transition-colors disabled:opacity-60"
            >
              {checking ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Fingerprint className="w-6 h-6" />
              )}
              {checking ? 'Verifying…' : 'Unlock with Biometrics'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
