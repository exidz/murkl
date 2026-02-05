import { Component, type ReactNode, type ErrorInfo } from 'react';
import { ErrorState } from './ErrorState';
import './ErrorBoundary.css';

interface Props {
  /** Fallback UI when an error occurs (overrides default) */
  fallback?: ReactNode;
  /** Children to render */
  children: ReactNode;
  /** Scope label for error identification (e.g., 'SendTab', 'ClaimTab') */
  scope?: string;
  /** Compact mode - for wrapping individual sections vs full app */
  compact?: boolean;
  /** Called when an error is caught */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  retryCount: number;
}

/**
 * Production-grade Error Boundary for Murkl.
 *
 * Financial apps cannot show blank white screens — that's an instant trust-killer.
 * This catches render crashes and shows a friendly recovery UI using the existing
 * ErrorState component.
 *
 * Features:
 * - Graceful crash recovery with retry mechanism
 * - Scope labeling for error identification
 * - Collapsible technical details for debugging
 * - Max retry limit to prevent infinite crash loops
 * - Full-app and section-level boundary modes
 *
 * Usage:
 *   <ErrorBoundary scope="SendTab">
 *     <SendTab ... />
 *   </ErrorBoundary>
 *
 *   // Or wrap the entire app:
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  static readonly MAX_RETRIES = 3;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });

    // Log with scope for easier debugging
    const scope = this.props.scope || 'App';
    console.error(`[ErrorBoundary:${scope}] Caught render error:`, error);
    console.error(`[ErrorBoundary:${scope}] Component stack:`, errorInfo.componentStack);

    // Notify parent if callback provided
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    const { retryCount } = this.state;

    if (retryCount >= ErrorBoundary.MAX_RETRIES) {
      // Too many retries — suggest hard refresh
      return;
    }

    this.setState(prev => ({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: prev.retryCount + 1,
    }));
  };

  handleHardRefresh = () => {
    window.location.reload();
  };

  formatErrorDetails(): string {
    const { error, errorInfo, retryCount } = this.state;
    const scope = this.props.scope || 'App';

    const parts = [
      `Scope: ${scope}`,
      `Error: ${error?.message || 'Unknown'}`,
      `Retries: ${retryCount}/${ErrorBoundary.MAX_RETRIES}`,
      `Time: ${new Date().toISOString()}`,
      `URL: ${window.location.href}`,
    ];

    if (error?.stack) {
      parts.push('', '--- Stack Trace ---', error.stack);
    }

    if (errorInfo?.componentStack) {
      parts.push('', '--- Component Stack ---', errorInfo.componentStack);
    }

    return parts.join('\n');
  }

  render() {
    const { hasError, retryCount } = this.state;
    const { children, fallback, compact = false } = this.props;

    if (!hasError) {
      return children;
    }

    // Custom fallback overrides default UI
    if (fallback) {
      return fallback;
    }

    const canRetry = retryCount < ErrorBoundary.MAX_RETRIES;
    const isExhausted = !canRetry;

    return (
      <div className={`error-boundary ${compact ? 'compact' : 'fullscreen'}`}>
        <div className="error-boundary-inner">
          <ErrorState
            variant="generic"
            title={isExhausted ? 'Something keeps going wrong' : 'Something went wrong'}
            message={
              isExhausted
                ? "We've tried recovering but the issue persists. Refreshing the page should fix it. Your funds are safe."
                : 'An unexpected error occurred. Your funds are safe — nothing was sent or lost.'
            }
            compact={compact}
            onRetry={canRetry ? this.handleRetry : this.handleHardRefresh}
            retryLabel={canRetry ? `Try again (${retryCount + 1}/${ErrorBoundary.MAX_RETRIES})` : 'Refresh page'}
            secondaryAction={
              canRetry
                ? { label: 'Refresh page instead', onClick: this.handleHardRefresh }
                : undefined
            }
            details={this.formatErrorDetails()}
          />

          {/* Safety assurance - critical for financial app trust */}
          <div className="error-boundary-safety">
            <span className="safety-icon">🔒</span>
            <span className="safety-text">
              No funds were affected. On-chain transactions are atomic — they either complete fully or not at all.
            </span>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
