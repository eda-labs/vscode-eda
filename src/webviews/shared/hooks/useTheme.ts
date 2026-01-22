import { useState, useEffect } from 'react';

const THEME_HIGH_CONTRAST = 'vscode-high-contrast' as const;

export type VSCodeTheme = 'vscode-light' | 'vscode-dark' | typeof THEME_HIGH_CONTRAST | 'vscode-high-contrast-light';

function getCurrentTheme(): VSCodeTheme {
  const body = document.body;
  if (body.classList.contains('vscode-light')) return 'vscode-light';
  if (body.classList.contains(THEME_HIGH_CONTRAST)) return THEME_HIGH_CONTRAST;
  if (body.classList.contains('vscode-high-contrast-light')) return 'vscode-high-contrast-light';
  return 'vscode-dark';
}

export function useTheme(): { theme: VSCodeTheme; isDark: boolean } {
  const [theme, setTheme] = useState<VSCodeTheme>(getCurrentTheme);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(getCurrentTheme());
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  const isDark = theme === 'vscode-dark' || theme === THEME_HIGH_CONTRAST;

  return { theme, isDark };
}
