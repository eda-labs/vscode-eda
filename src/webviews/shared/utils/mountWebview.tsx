import React from 'react';
import { createRoot } from 'react-dom/client';

import { VSCodeProvider } from '../context';
import { WebviewThemeProvider } from '../theme';

/**
 * Mounts a webview component with the VSCodeProvider wrapper.
 * Reduces boilerplate across all webview files.
 */
export function mountWebview(Component: React.ComponentType): void {
  const container = document.getElementById('root');
  if (container) {
    const root = createRoot(container);
    root.render(
      <VSCodeProvider>
        <WebviewThemeProvider>
          <Component />
        </WebviewThemeProvider>
      </VSCodeProvider>
    );
  }
}
