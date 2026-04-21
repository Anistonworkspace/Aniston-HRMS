import { Component, type ComponentType, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  pageName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const page = this.props.pageName ?? 'Unknown Page';
    console.error(`[RouteErrorBoundary] Crash in "${page}":`, error, info.componentStack);
  }

  handleRetry = () => {
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
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { pageName, } = this.props;
    const { error } = this.state;
    const label = pageName ? `${pageName} page` : 'this page';

    return (
      <div className="flex items-center justify-center min-h-[60vh] p-6">
        <div className="layer-card p-8 max-w-md w-full text-center space-y-5">
          {/* Icon */}
          <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-7 h-7 text-amber-500" />
          </div>

          {/* Heading */}
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-gray-900 font-sora">
              Something went wrong
            </h2>
            <p className="text-sm text-gray-500">
              An unexpected error occurred in the{' '}
              <span className="font-medium text-gray-700">{label}</span>.
              {error?.name && error.name !== 'Error' && (
                <> ({error.name})</>
              )}
            </p>
          </div>

          {/* Error detail */}
          {error?.message && (
            <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2 font-mono text-left overflow-auto max-h-28 break-all">
              {error.message}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-3 justify-center pt-1">
            <button
              onClick={this.handleRetry}
              className="btn-primary text-sm px-4 py-2"
            >
              Try Again
            </button>
            <button
              onClick={this.handleGoBack}
              className="btn-secondary text-sm px-4 py-2"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }
}

/**
 * HOC convenience wrapper — wraps any component in a RouteErrorBoundary.
 *
 * Usage:
 *   const SafePayrollPage = withErrorBoundary(PayrollPage, 'Payroll');
 *   <Route path="/payroll" element={<SafePayrollPage />} />
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: ComponentType<P>,
  pageName?: string,
): ComponentType<P> {
  const displayName = pageName ?? WrappedComponent.displayName ?? WrappedComponent.name ?? 'Component';

  function WithErrorBoundaryWrapper(props: P) {
    return (
      <RouteErrorBoundary pageName={displayName}>
        <WrappedComponent {...props} />
      </RouteErrorBoundary>
    );
  }

  WithErrorBoundaryWrapper.displayName = `withErrorBoundary(${displayName})`;
  return WithErrorBoundaryWrapper;
}
