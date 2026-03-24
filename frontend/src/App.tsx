import { Provider } from 'react-redux';
import { Toaster } from 'react-hot-toast';
import { store } from './app/store';
import AppRouter from './router/AppRouter';
import ErrorBoundary from './components/ErrorBoundary';

export default function App() {
  return (
    <Provider store={store}>
      <ErrorBoundary>
        <AppRouter />
      </ErrorBoundary>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            borderRadius: '12px',
            background: '#fff',
            color: '#1e293b',
            fontSize: '14px',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)',
            border: '1px solid #f1f5f9',
          },
        }}
      />
    </Provider>
  );
}
