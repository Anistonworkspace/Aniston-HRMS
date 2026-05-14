import { Provider } from 'react-redux';
import { Toaster, toast as hotToast, resolveValue } from 'react-hot-toast';
import { store } from './app/store';
import AppRouter from './router/AppRouter';
import ErrorBoundary from './components/ErrorBoundary';
import PWAUpdatePrompt from './components/pwa/PWAUpdatePrompt';

export default function App() {
  return (
    <Provider store={store}>
      <ErrorBoundary>
        <AppRouter />
      </ErrorBoundary>
      <PWAUpdatePrompt />
      <Toaster
        position="top-right"
        containerStyle={{ top: 16, right: 16 }}
        toastOptions={{ duration: 4000 }}
      >
        {(t) => (
          <div
            onClick={() => hotToast.dismiss(t.id)}
            className={[
              'flex items-center gap-2 px-4 py-3 rounded-xl shadow-layer text-sm cursor-pointer max-w-[360px] border transition-opacity',
              t.type === 'error'
                ? 'bg-red-50 text-red-800 border-red-200'
                : t.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-white text-slate-800 border-gray-100',
            ].join(' ')}
            style={{ opacity: t.visible ? 1 : 0 }}
          >
            <span className="flex-1">{resolveValue(t.message, t)}</span>
            <span className="text-base opacity-50 leading-none flex-shrink-0">✕</span>
          </div>
        )}
      </Toaster>
    </Provider>
  );
}
