import type { ReactNode } from 'react';
import React, { Component } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary component that catches JavaScript errors in child components.
 * Prevents the entire webview from crashing when a runtime error occurs.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="p-6 text-center">
          <div className="mb-4">
            <span className="text-4xl">⚠️</span>
          </div>
          <h2 className="text-lg font-semibold mb-2 text-status-error">
            Something went wrong
          </h2>
          <p className="text-sm text-vscode-text-secondary mb-4">
            An error occurred while rendering this view.
          </p>
          {this.state.error && (
            <details className="text-left bg-vscode-code-bg p-3 rounded-sm text-xs">
              <summary className="cursor-pointer mb-2 font-medium">Error details</summary>
              <pre className="overflow-auto whitespace-pre-wrap text-status-error">
                {this.state.error.message}
              </pre>
              {this.state.error.stack && (
                <pre className="overflow-auto whitespace-pre-wrap mt-2 text-vscode-text-secondary">
                  {this.state.error.stack}
                </pre>
              )}
            </details>
          )}
          <button
            className="mt-4 px-4 py-2 bg-vscode-accent text-vscode-button-fg rounded-sm hover:bg-vscode-accent-hover"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
