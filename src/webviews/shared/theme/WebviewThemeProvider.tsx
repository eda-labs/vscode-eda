import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { CssBaseline, GlobalStyles } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';

import { createVsCodeMuiTheme, detectVSCodeThemeClass, type VSCodeThemeClass } from './vscodeMuiTheme';

interface WebviewThemeProviderProps {
  children: ReactNode;
}

export function WebviewThemeProvider({ children }: Readonly<WebviewThemeProviderProps>) {
  const [themeClass, setThemeClass] = useState<VSCodeThemeClass>(() => detectVSCodeThemeClass());

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const nextThemeClass = detectVSCodeThemeClass();
      setThemeClass(prev => (prev === nextThemeClass ? prev : nextThemeClass));
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  const theme = useMemo(() => createVsCodeMuiTheme(themeClass), [themeClass]);

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
