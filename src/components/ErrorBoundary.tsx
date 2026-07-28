import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: 24,
          background: '#1a1a2e',
          color: '#e0e0e0',
          fontFamily: 'system-ui, sans-serif',
        }}>
          <div style={{ fontSize: 18, marginBottom: 12, color: '#ff6b6b' }}>
            Something went wrong
          </div>
          <div style={{
            fontSize: 13,
            color: '#a0a0a0',
            marginBottom: 16,
            maxWidth: 400,
            textAlign: 'center',
            wordBreak: 'break-word',
          }}>
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </div>
          <button
            onClick={this.handleRetry}
            style={{
              padding: '8px 20px',
              background: '#4a9eff',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
