import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

function isChunkLoadError(error: Error | null): boolean {
  if (!error) return false;
  const msg = error.message || '';
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Loading chunk') ||
    msg.includes('Loading CSS chunk') ||
    msg.includes('Importing a module script failed')
  );
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);

    // Auto-reload once for stale chunk errors (happens after deployment)
    if (isChunkLoadError(error)) {
      const reloadKey = 'chunk-reload-attempted';
      if (!sessionStorage.getItem(reloadKey)) {
        sessionStorage.setItem(reloadKey, 'true');
        window.location.reload();
        return;
      }
      // Clear the flag so next session can auto-reload again
      sessionStorage.removeItem(reloadKey);
    }
  }

  handleRetry = () => {
    // For chunk errors, always hard reload to get fresh assets
    if (isChunkLoadError(this.state.error)) {
      sessionStorage.removeItem('chunk-reload-attempted');
      window.location.reload();
      return;
    }
    this.setState({ hasError: false, error: null });
  };

  handleGoBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = '/dashboard';
    }
  };

  render() {
    if (this.state.hasError) {
      const isChunk = isChunkLoadError(this.state.error);

      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-500">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              {isChunk ? 'App Updated' : 'Something went wrong'}
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              {isChunk
                ? 'A new version of the app has been deployed. Please reload to continue.'
                : 'An unexpected error occurred. Please try again.'}
            </p>
            {this.state.error && !isChunk && (
              <p className="text-xs text-gray-400 bg-gray-50 rounded-lg p-3 mb-4 font-mono text-left overflow-auto max-h-32">
                {this.state.error.message}
              </p>
            )}
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleRetry}
                className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-500 transition-colors"
              >
                {isChunk ? 'Reload Page' : 'Try Again'}
              </button>
              <button
                onClick={this.handleGoBack}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                Go Back
              </button>
              <button
                onClick={() => window.location.href = '/dashboard'}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
