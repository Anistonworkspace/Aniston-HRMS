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
            className="flex items-center gap-2 px-4 py-3 text-sm cursor-pointer max-w-[360px] transition-opacity"
            style={{
              opacity: t.visible ? 1 : 0,
              borderRadius: 'var(--border-radius-medium)',
              boxShadow: 'var(--box-shadow-medium)',
              border: '1px solid',
              background: t.type === 'error'
                ? 'var(--negative-color-selected)'
                : t.type === 'success'
                  ? 'var(--positive-color-selected)'
                  : 'var(--primary-background-color)',
              color: t.type === 'error'
                ? 'var(--negative-color)'
                : t.type === 'success'
                  ? 'var(--positive-color)'
                  : 'var(--primary-text-color)',
              borderColor: t.type === 'error'
                ? 'var(--negative-color-selected)'
                : t.type === 'success'
                  ? 'var(--positive-color-selected)'
                  : 'var(--layout-border-color)',
            }}
          >
            <span className="flex-1" style={{ font: 'var(--font-text2-normal)' }}>{resolveValue(t.message, t)}</span>
            <span className="text-base leading-none flex-shrink-0" style={{ opacity: 0.5 }}>✕</span>
          </div>
        )}
      </Toaster>
    </Provider>
  );
}
