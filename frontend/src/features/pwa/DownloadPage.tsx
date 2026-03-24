import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Download, Smartphone, Monitor, Check, ChevronRight, Shield, Clock, Users } from 'lucide-react';

export default function DownloadPage() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => setInstalled(true));
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') setInstalled(true);
      setDeferredPrompt(null);
    }
  };

  if (isStandalone || installed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-emerald-50 flex items-center justify-center p-6">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center">
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check size={40} className="text-emerald-600" />
          </div>
          <h1 className="text-2xl font-display font-bold text-gray-900 mb-2">App Installed!</h1>
          <p className="text-gray-500 mb-6">Aniston HRMS is ready to use.</p>
          <a href="/dashboard" className="btn-primary inline-flex items-center gap-2">
            Open App <ChevronRight size={16} />
          </a>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-indigo-50">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-lg border-b border-gray-100 px-6 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-brand-600 to-brand-700 rounded-xl flex items-center justify-center">
            <span className="text-white font-bold text-lg font-display">A</span>
          </div>
          <div>
            <h1 className="text-lg font-display font-bold text-gray-900">Aniston HRMS</h1>
            <p className="text-xs text-gray-500">Employee Self-Service App</p>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-6 py-10">
        {/* Hero */}
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
          <div className="w-24 h-24 bg-brand-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Smartphone size={48} className="text-brand-600" />
          </div>
          <h2 className="text-2xl font-display font-bold text-gray-900 mb-2">Download Aniston HRMS</h2>
          <p className="text-gray-500">Install the app on your device for quick access to attendance, leave, payroll and more.</p>
        </motion.div>

        {/* Install Button */}
        {deferredPrompt ? (
          <motion.button
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={handleInstall}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white py-4 rounded-2xl font-semibold text-lg flex items-center justify-center gap-3 shadow-lg mb-6 transition-colors"
          >
            <Download size={22} /> Install App
          </motion.button>
        ) : (
          <div className="bg-gray-50 rounded-2xl p-5 mb-6 space-y-4">
            {isIOS ? (
              <>
                <p className="text-sm font-semibold text-gray-800">Install on iPhone/iPad:</p>
                <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
                  <li>Tap the <span className="font-semibold">Share</span> button (bottom of Safari)</li>
                  <li>Scroll down and tap <span className="font-semibold">"Add to Home Screen"</span></li>
                  <li>Tap <span className="font-semibold">"Add"</span></li>
                </ol>
              </>
            ) : isAndroid ? (
              <>
                <p className="text-sm font-semibold text-gray-800">Install on Android:</p>
                <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
                  <li>Tap the <span className="font-semibold">menu (3 dots)</span> in Chrome</li>
                  <li>Tap <span className="font-semibold">"Install app"</span> or <span className="font-semibold">"Add to Home screen"</span></li>
                  <li>Tap <span className="font-semibold">"Install"</span></li>
                </ol>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-gray-800">Install on Desktop:</p>
                <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
                  <li>Click the <span className="font-semibold">install icon</span> in the address bar</li>
                  <li>Click <span className="font-semibold">"Install"</span></li>
                </ol>
              </>
            )}
          </div>
        )}

        {/* Features */}
        <div className="grid grid-cols-2 gap-3 mb-8">
          {[
            { icon: Clock, label: 'Check In/Out', desc: 'GPS-based attendance' },
            { icon: Users, label: 'Leave Management', desc: 'Apply & track leaves' },
            { icon: Shield, label: 'Documents', desc: 'Upload & manage' },
            { icon: Monitor, label: 'Payslips', desc: 'View & download' },
          ].map((f, i) => (
            <motion.div key={f.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              className="bg-white rounded-xl border border-gray-100 p-4 text-center">
              <f.icon size={24} className="text-brand-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-gray-800">{f.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{f.desc}</p>
            </motion.div>
          ))}
        </div>

        {/* Login link */}
        <div className="text-center">
          <a href="/login" className="text-sm text-brand-600 hover:text-brand-700 font-medium">
            Already have the app? Sign in here
          </a>
        </div>
      </div>

      <footer className="text-center text-xs text-gray-400 py-4">
        Aniston Technologies LLP
      </footer>
    </div>
  );
}
