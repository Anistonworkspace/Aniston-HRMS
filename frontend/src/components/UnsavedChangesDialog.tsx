import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  isOpen: boolean;
  onDiscard: () => void;
  onCancel: () => void;
}

export default function UnsavedChangesDialog({ isOpen, onDiscard, onCancel }: Props) {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] flex items-center justify-center"
      >
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="relative bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4"
        >
          <div className="text-center">
            <div className="w-14 h-14 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.27 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h3 className="text-lg font-display font-semibold text-gray-900">Unsaved Changes</h3>
            <p className="text-sm text-gray-500 mt-2">
              You have unsaved changes. Are you sure you want to close?
            </p>
          </div>
          <div className="flex flex-col gap-2 mt-6">
            <button
              onClick={onDiscard}
              className="w-full bg-red-50 text-red-600 border border-red-200 py-2.5 rounded-xl font-medium hover:bg-red-100 transition-colors"
            >
              Discard Changes
            </button>
            <button
              onClick={onCancel}
              className="w-full text-gray-500 py-2 text-sm hover:text-gray-700 transition-colors"
            >
              Keep Editing
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
