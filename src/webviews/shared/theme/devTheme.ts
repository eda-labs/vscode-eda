export type DevThemeId = 'vscode-dark' | 'vscode-light';

interface DevThemeDefinition {
  id: DevThemeId;
  label: string;
  bodyClass: DevThemeId;
  variables: Readonly<Record<string, string>>;
}

const DEFAULT_FONT_FAMILY = 'Segoe WPC, Segoe UI, sans-serif';
const DEFAULT_EDITOR_FONT_FAMILY = 'Consolas, Menlo, Monaco, monospace';
const THEME_DARK: DevThemeId = 'vscode-dark';
const THEME_LIGHT: DevThemeId = 'vscode-light';

const DARK_THEME_VARS: Readonly<Record<string, string>> = {
  '--vscode-editor-background': '#1e1e1e',
  '--vscode-panel-background': '#252526',
  '--vscode-editorWidget-background': '#252526',
  '--vscode-list-hoverBackground': '#2a2d2e',
  '--vscode-editor-foreground': '#cccccc',
  '--vscode-descriptionForeground': '#9d9d9d',
  '--vscode-panel-border': '#3e3e42',
  '--vscode-button-background': '#0e639c',
  '--vscode-button-foreground': '#ffffff',
  '--vscode-button-hoverBackground': '#1177bb',
  '--vscode-button-secondaryBackground': '#3a3d41',
  '--vscode-button-secondaryForeground': '#cccccc',
  '--vscode-errorForeground': '#f48771',
  '--vscode-editorWarning-foreground': '#cca700',
  '--vscode-notificationsInfoIcon-foreground': '#3794ff',
  '--vscode-testing-iconPassed': '#73c991',
  '--vscode-input-background': '#3c3c3c',
  '--vscode-input-foreground': '#cccccc',
  '--vscode-input-border': '#3e3e42',
  '--vscode-focusBorder': '#0e639c',
  '--vscode-list-activeSelectionBackground': '#094771',
  '--vscode-list-activeSelectionForeground': '#ffffff',
  '--vscode-font-family': DEFAULT_FONT_FAMILY,
  '--vscode-font-size': '13',
  '--vscode-editor-font-family': DEFAULT_EDITOR_FONT_FAMILY,
  '--vscode-charts-purple': '#b180d7',
  '--vscode-charts-blue': '#3794ff',
  '--vscode-charts-green': '#89d185',
  '--vscode-charts-yellow': '#dcdcaa',
  '--vscode-charts-red': '#f48771',
  '--vscode-charts-orange': '#d19a66'
};

const LIGHT_THEME_VARS: Readonly<Record<string, string>> = {
  '--vscode-editor-background': '#ffffff',
  '--vscode-panel-background': '#f3f3f3',
  '--vscode-editorWidget-background': '#f6f6f6',
  '--vscode-list-hoverBackground': '#e8e8e8',
  '--vscode-editor-foreground': '#333333',
  '--vscode-descriptionForeground': '#666666',
  '--vscode-panel-border': '#d4d4d4',
  '--vscode-button-background': '#0078d4',
  '--vscode-button-foreground': '#ffffff',
  '--vscode-button-hoverBackground': '#005fb8',
  '--vscode-button-secondaryBackground': '#f3f3f3',
  '--vscode-button-secondaryForeground': '#333333',
  '--vscode-errorForeground': '#c72e0f',
  '--vscode-editorWarning-foreground': '#895503',
  '--vscode-notificationsInfoIcon-foreground': '#007acc',
  '--vscode-testing-iconPassed': '#2e7d32',
  '--vscode-input-background': '#ffffff',
  '--vscode-input-foreground': '#333333',
  '--vscode-input-border': '#c8c8c8',
  '--vscode-focusBorder': '#0078d4',
  '--vscode-list-activeSelectionBackground': '#cce6ff',
  '--vscode-list-activeSelectionForeground': '#1a1a1a',
  '--vscode-font-family': DEFAULT_FONT_FAMILY,
  '--vscode-font-size': '13',
  '--vscode-editor-font-family': DEFAULT_EDITOR_FONT_FAMILY,
  '--vscode-charts-purple': '#9b59b6',
  '--vscode-charts-blue': '#007acc',
  '--vscode-charts-green': '#388a34',
  '--vscode-charts-yellow': '#b89500',
  '--vscode-charts-red': '#c72e0f',
  '--vscode-charts-orange': '#b26900'
};

export const DEV_THEMES: readonly DevThemeDefinition[] = [
  {
    id: THEME_DARK,
    label: 'VS Code Dark',
    bodyClass: THEME_DARK,
    variables: DARK_THEME_VARS
  },
  {
    id: THEME_LIGHT,
    label: 'VS Code Light',
    bodyClass: THEME_LIGHT,
    variables: LIGHT_THEME_VARS
  }
] as const;

const themeIdSet: ReadonlySet<string> = new Set(DEV_THEMES.map(theme => theme.id));
const vscodeThemeClasses = [THEME_LIGHT, THEME_DARK, 'vscode-high-contrast', 'vscode-high-contrast-light'];

export function isDevThemeId(value: string): value is DevThemeId {
  return themeIdSet.has(value);
}

export function getDevTheme(themeId: DevThemeId): DevThemeDefinition {
  return DEV_THEMES.find(theme => theme.id === themeId) ?? DEV_THEMES[0];
}

export function applyDevTheme(themeId: DevThemeId, targetDocument: Document = document): void {
  const theme = getDevTheme(themeId);
  targetDocument.body.classList.remove(...vscodeThemeClasses);
  targetDocument.body.classList.add(theme.bodyClass);

  for (const [key, value] of Object.entries(theme.variables)) {
    targetDocument.documentElement.style.setProperty(key, value);
  }

  targetDocument.documentElement.style.setProperty('color-scheme', themeId === 'vscode-dark' ? 'dark' : 'light');
}
