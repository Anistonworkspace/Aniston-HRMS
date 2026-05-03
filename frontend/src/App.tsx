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
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 16px',
              borderRadius: '12px',
              background: t.type === 'error' ? '#fef2f2' : t.type === 'success' ? '#f0fdf4' : '#fff',
              color: t.type === 'error' ? '#991b1b' : t.type === 'success' ? '#166534' : '#1e293b',
              fontSize: '14px',
              boxShadow: '0 4px 6px -1px rgba(0,0,0,0.08), 0 2px 4px -1px rgba(0,0,0,0.04)',
              border: `1px solid ${t.type === 'error' ? '#fecaca' : t.type === 'success' ? '#bbf7d0' : '#f1f5f9'}`,
              cursor: 'pointer',
              maxWidth: '360px',
              opacity: t.visible ? 1 : 0,
              transition: 'opacity 0.2s',
            }}
          >
            <span style={{ flex: 1 }}>{resolveValue(t.message, t)}</span>
            <span style={{ fontSize: '16px', opacity: 0.5, lineHeight: 1, flexShrink: 0 }}>✕</span>
          </div>
        )}
      </Toaster>
    </Provider>
  );
}
