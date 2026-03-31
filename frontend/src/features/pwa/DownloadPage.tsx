import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Download, Smartphone, Shield, MapPin, Bell, ChevronRight } from 'lucide-react';

export default function DownloadPage() {
  const navigate = useNavigate();
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

  // Redirect if already installed (standalone mode)
  useEffect(() => {
    if (isStandalone) {
      navigate('/login', { replace: true });
    }
  }, [isStandalone, navigate]);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => setInstalled(true));
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Auto-trigger install prompt after 1 second delay
  useEffect(() => {
    if (deferredPrompt) {
      const timer = setTimeout(() => {
        handleInstall();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [deferredPrompt]);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') setInstalled(true);
      setDeferredPrompt(null);
    }
  };

  // After install, redirect to login
  useEffect(() => {
    if (installed) {
      const timer = setTimeout(() => navigate('/login', { replace: true }), 1500);
      return () => clearTimeout(timer);
    }
  }, [installed, navigate]);

  if (installed) {
    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-br from-emerald-50 via-white to-emerald-50 flex items-center justify-center p-6">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center">
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Shield size={40} className="text-emerald-600" />
          </div>
          <h1 className="text-2xl font-display font-bold text-gray-900 mb-2">App Installed!</h1>
          <p className="text-gray-500 mb-4">Redirecting to login...</p>
          <a href="/login" className="btn-primary inline-flex items-center gap-2">
            Open App <ChevronRight size={16} />
          </a>
        </motion.div>
      </div>
    );
  }

  // If standalone, we redirect above — but render nothing in the meantime
  if (isStandalone) return null;

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-br from-brand-50 via-white to-indigo-50 flex flex-col overflow-y-auto">
      {/* Full-screen overlay — no way to bypass */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        {/* Logo & Branding */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 mb-10"
        >
          <div className="w-12 h-12 bg-gradient-to-br from-brand-600 to-brand-700 rounded-2xl flex items-center justify-center shadow-lg">
            <span className="text-white font-bold text-xl font-display">A</span>
          </div>
          <div>
            <h1 className="text-xl font-display font-bold text-gray-900">Aniston HRMS</h1>
            <p className="text-xs text-gray-500">Employee Self-Service App</p>
          </div>
        </motion.div>

        {/* Main install prompt */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="w-full max-w-md"
        >
          <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl border border-white/50 p-8 text-center">
            <div className="w-20 h-20 bg-brand-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <Smartphone size={40} className="text-brand-600" />
            </div>
            <h2 className="text-2xl font-display font-bold text-gray-900 mb-2">
              Install Aniston HRMS to continue
            </h2>
            <p className="text-gray-500 text-sm mb-8">
              You must install this app on your device to access attendance, leave, payroll, and other features.
            </p>

            {/* Install Button (non-iOS) */}
            {deferredPrompt ? (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleInstall}
                className="w-full bg-brand-600 hover:bg-brand-700 text-white py-4 rounded-2xl font-semibold text-lg flex items-center justify-center gap-3 shadow-lg shadow-brand-200 transition-colors"
              >
                <Download size={22} /> Install App
              </motion.button>
            ) : isIOS ? (
              /* iOS instructions */
              <div className="bg-gray-50 rounded-2xl p-5 text-left space-y-3">
                <p className="text-sm font-semibold text-gray-800">Install on iPhone / iPad:</p>
                <ol className="text-sm text-gray-600 space-y-2.5 list-decimal list-inside">
                  <li>Tap the <span className="font-semibold">Share</span> button <span className="inline-block px-1.5 py-0.5 bg-gray-200 rounded text-xs">⬆</span> at the bottom of Safari</li>
                  <li>Scroll down and tap <span className="font-semibold">"Add to Home Screen"</span></li>
                  <li>Tap <span className="font-semibold">"Add"</span> in the top right</li>
                  <li>Open the app from your Home Screen</li>
                </ol>
              </div>
            ) : (
              /* Fallback: manual install instructions */
              <div className="bg-gray-50 rounded-2xl p-5 text-left space-y-3">
                <p className="text-sm font-semibold text-gray-800">Install this app:</p>
                <ol className="text-sm text-gray-600 space-y-2.5 list-decimal list-inside">
                  <li>Click the <span className="font-semibold">install icon</span> in the address bar (or menu &gt; "Install app")</li>
                  <li>Click <span className="font-semibold">"Install"</span></li>
                  <li>Open the installed app</li>
                </ol>
              </div>
            )}
          </div>

          {/* Required Permissions Section */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-6 bg-white/60 backdrop-blur-lg rounded-2xl border border-white/50 p-6"
          >
            <h3 className="text-sm font-display font-bold text-gray-800 mb-4 text-center">
              After installing, open the app and allow:
            </h3>
            <div className="space-y-3">
              <div className="flex items-start gap-3 bg-white/80 rounded-xl p-4 border border-gray-100">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <MapPin size={20} className="text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Location Permission</p>
                  <p className="text-xs text-gray-500 mt-0.5">Required for GPS-based attendance check-in and geofencing</p>
                </div>
                <span className="ml-auto text-xs font-semibold text-red-500 bg-red-50 px-2 py-1 rounded-lg flex-shrink-0">Required</span>
              </div>
              <div className="flex items-start gap-3 bg-white/80 rounded-xl p-4 border border-gray-100">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                  <Bell size={20} className="text-amber-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Notification Permission</p>
                  <p className="text-xs text-gray-500 mt-0.5">Required for real-time alerts on leave approvals, announcements, and reminders</p>
                </div>
                <span className="ml-auto text-xs font-semibold text-red-500 bg-red-50 px-2 py-1 rounded-lg flex-shrink-0">Required</span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>

      <footer className="text-center text-xs text-gray-400 py-4">
        Aniston Technologies LLP
      </footer>
    </div>
  );
}
