import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { CssBaseline, GlobalStyles } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';

import { createVsCodeMuiTheme, detectVSCodeThemeClass, type VSCodeThemeClass } from './vscodeMuiTheme';

interface WebviewThemeProviderProps {
  children: ReactNode;
}

const TRACKED_THEME_VARS = [
  '--vscode-editor-background',
  '--vscode-panel-background',
  '--vscode-editor-foreground',
  '--vscode-descriptionForeground',
  '--vscode-panel-border',
  '--vscode-button-background',
  '--vscode-input-background',
  '--vscode-font-family',
  '--vscode-font-size',
  '--vscode-charts-blue'
] as const;

interface ThemeSnapshot {
  themeClass: VSCodeThemeClass;
  signature: string;
}

function createThemeFromSnapshot(snapshot: ThemeSnapshot) {
  return createVsCodeMuiTheme(snapshot.themeClass);
}

function getThemeSnapshot(): ThemeSnapshot {
  const themeClass = detectVSCodeThemeClass();
  const computed = getComputedStyle(document.documentElement);
  const vars = TRACKED_THEME_VARS
    .map(name => `${name}:${computed.getPropertyValue(name).trim()}`)
    .join('|');

  return {
    themeClass,
    signature: `${themeClass}|${vars}`
  };
}

export function WebviewThemeProvider({ children }: Readonly<WebviewThemeProviderProps>) {
  const [themeSnapshot, setThemeSnapshot] = useState<ThemeSnapshot>(() => getThemeSnapshot());

  useEffect(() => {
    const refreshTheme = () => {
      const next = getThemeSnapshot();
      setThemeSnapshot(prev => (prev.signature === next.signature ? prev : next));
    };

    refreshTheme();

    const bodyObserver = new MutationObserver(refreshTheme);
    const rootObserver = new MutationObserver(refreshTheme);
    const headObserver = new MutationObserver(refreshTheme);

    bodyObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });

    rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style']
    });

    headObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true
    });

    window.addEventListener('focus', refreshTheme);
    document.addEventListener('visibilitychange', refreshTheme);

    return () => {
      bodyObserver.disconnect();
      rootObserver.disconnect();
      headObserver.disconnect();
      window.removeEventListener('focus', refreshTheme);
      document.removeEventListener('visibilitychange', refreshTheme);
    };
  }, []);

  const theme = useMemo(() => createThemeFromSnapshot(themeSnapshot), [themeSnapshot]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles
        styles={{
          'html, body, #root': {
            height: '100%',
            margin: 0,
            padding: 0
          }
        }}
      />
      {children}
    </ThemeProvider>
  );
}
