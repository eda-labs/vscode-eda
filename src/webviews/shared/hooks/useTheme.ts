import { useState, useEffect } from 'react';

export type VSCodeTheme = 'vscode-light' | 'vscode-dark' | 'vscode-high-contrast' | 'vscode-high-contrast-light';

function getCurrentTheme(): VSCodeTheme {
  const body = document.body;
  if (body.classList.contains('vscode-light')) return 'vscode-light';
  if (body.classList.contains('vscode-high-contrast')) return 'vscode-high-contrast';
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

  const isDark = theme === 'vscode-dark' || theme === 'vscode-high-contrast';

  return { theme, isDark };
}
