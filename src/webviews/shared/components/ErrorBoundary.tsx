import type { ReactNode } from 'react';
import React, { Component } from 'react';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { Alert, AlertTitle, Box, Button, Stack, Typography } from '@mui/material';

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

  render(): React.JSX.Element {
    if (!this.state.hasError) {
      return <>{this.props.children}</>;
    }

    if (this.props.fallback) {
      return <>{this.props.fallback}</>;
    }

    return (
      <Stack spacing={2} sx={{ p: 3 }}>
        <Alert severity="error" icon={<ErrorOutlineIcon />}>
          <AlertTitle>Something went wrong</AlertTitle>
          An error occurred while rendering this view.
        </Alert>
        {this.state.error && (
          <Box component="details" sx={{ fontSize: 12, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <Box component="summary" sx={{ cursor: 'pointer', mb: 1, fontWeight: 600 }}>Error details</Box>
            <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', overflow: 'auto', m: 0, color: 'error.main' }}>
              {this.state.error.message}
            </Typography>
            {this.state.error.stack && (
              <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', overflow: 'auto', mt: 1, color: 'text.secondary' }}>
                {this.state.error.stack}
              </Typography>
            )}
          </Box>
        )}
        <Box>
          <Button variant="contained" onClick={() => this.setState({ hasError: false, error: null })}>
            Try again
          </Button>
        </Box>
      </Stack>
    );
  }
}
