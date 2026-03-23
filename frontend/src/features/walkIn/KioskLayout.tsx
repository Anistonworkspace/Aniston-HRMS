import { Outlet } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function KioskLayout() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-lg border-b border-gray-100 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-brand-600 to-brand-700 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-lg font-display">A</span>
            </div>
            <div>
              <h1 className="text-lg font-display font-bold text-gray-900">Aniston HRMS</h1>
              <p className="text-xs text-gray-500">Walk-In Interview Registration</p>
            </div>
          </div>
          <div className="text-sm text-gray-400 font-mono" data-mono>
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
      </header>

      {/* Content */}
      <motion.main
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="max-w-4xl mx-auto px-4 sm:px-6 py-8"
      >
        <Outlet />
      </motion.main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white/60 backdrop-blur-sm border-t border-gray-100 px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between text-xs text-gray-400">
          <span>Need help? Call reception ext. 100</span>
          <span>Powered by Aniston HRMS</span>
        </div>
      </footer>
    </div>
  );
}
