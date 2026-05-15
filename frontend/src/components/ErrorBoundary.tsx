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
        <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--grey-background-color)' }}>
          <div className="p-8 max-w-md w-full text-center" style={{ background: 'var(--primary-background-color)', borderRadius: 'var(--border-radius-big)', boxShadow: 'var(--box-shadow-large)', border: '1px solid var(--layout-border-color)' }}>
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--negative-color-selected)' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--negative-color)' }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 className="font-semibold mb-2" style={{ font: 'var(--font-text1-bold)', color: 'var(--primary-text-color)' }}>
              {isChunk ? 'App Updated' : 'Something went wrong'}
            </h2>
            <p className="mb-4" style={{ font: 'var(--font-text2-normal)', color: 'var(--secondary-text-color)' }}>
              {isChunk
                ? 'A new version of the app has been deployed. Please reload to continue.'
                : 'An unexpected error occurred. Please try again.'}
            </p>
            {this.state.error && !isChunk && (
              <p className="text-xs mb-4 font-mono text-left overflow-auto max-h-32 p-3" style={{ color: 'var(--secondary-text-color)', background: 'var(--allgrey-background-color)', borderRadius: 'var(--border-radius-small)' }}>
                {this.state.error.message}
              </p>
            )}
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleRetry}
                className="btn-primary text-sm"
              >
                {isChunk ? 'Reload Page' : 'Try Again'}
              </button>
              <button
                onClick={this.handleGoBack}
                className="btn-secondary text-sm"
              >
                Go Back
              </button>
              <button
                onClick={() => window.location.href = '/dashboard'}
                className="btn-secondary text-sm"
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
