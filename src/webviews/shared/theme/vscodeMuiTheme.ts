import { createTheme, type Theme } from '@mui/material/styles';
import type {} from '@mui/x-data-grid/themeAugmentation';

export type VSCodeThemeClass =
  | 'vscode-light'
  | 'vscode-dark'
  | 'vscode-high-contrast'
  | 'vscode-high-contrast-light';

const THEME_LIGHT: VSCodeThemeClass = 'vscode-light';
const THEME_DARK: VSCodeThemeClass = 'vscode-dark';
const THEME_HC: VSCodeThemeClass = 'vscode-high-contrast';
const THEME_HC_LIGHT: VSCodeThemeClass = 'vscode-high-contrast-light';

function getCssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function isDarkTheme(themeClass: VSCodeThemeClass): boolean {
  return themeClass === THEME_DARK || themeClass === THEME_HC;
}

function isHighContrast(themeClass: VSCodeThemeClass): boolean {
  return themeClass === THEME_HC || themeClass === THEME_HC_LIGHT;
}

export function detectVSCodeThemeClass(): VSCodeThemeClass {
  const { classList } = document.body;
  if (classList.contains(THEME_LIGHT)) return THEME_LIGHT;
  if (classList.contains(THEME_HC_LIGHT)) return THEME_HC_LIGHT;
  if (classList.contains(THEME_HC)) return THEME_HC;
  return THEME_DARK;
}

export function createVsCodeMuiTheme(themeClass: VSCodeThemeClass): Theme {
  const dark = isDarkTheme(themeClass);
  const highContrast = isHighContrast(themeClass);

  const editorBg = getCssVar('--vscode-editor-background', dark ? '#1e1e1e' : '#ffffff');
  const panelBg = getCssVar('--vscode-panel-background', dark ? '#252526' : '#f3f3f3');
  const widgetBg = getCssVar('--vscode-editorWidget-background', panelBg);
  const hoverBg = getCssVar('--vscode-list-hoverBackground', dark ? '#2a2d2e' : '#e8e8e8');

  const editorFg = getCssVar('--vscode-editor-foreground', dark ? '#cccccc' : '#333333');
  const descriptionFg = getCssVar('--vscode-descriptionForeground', dark ? '#9d9d9d' : '#666666');
  const border = getCssVar('--vscode-panel-border', dark ? '#3e3e42' : '#d4d4d4');

  const primary = getCssVar('--vscode-button-background', dark ? '#0e639c' : '#0078d4');
  const primaryContrast = getCssVar('--vscode-button-foreground', '#ffffff');
  const secondary = getCssVar('--vscode-button-secondaryBackground', dark ? '#3a3d41' : '#f3f3f3');
  const secondaryContrast = getCssVar('--vscode-button-secondaryForeground', editorFg);

  const error = getCssVar('--vscode-errorForeground', '#f48771');
  const warning = getCssVar('--vscode-editorWarning-foreground', '#cca700');
  const info = getCssVar('--vscode-notificationsInfoIcon-foreground', '#3794ff');
  const success = getCssVar('--vscode-testing-iconPassed', '#73c991');

  const inputBg = getCssVar('--vscode-input-background', widgetBg);
  const inputFg = getCssVar('--vscode-input-foreground', editorFg);
  const inputBorder = getCssVar('--vscode-input-border', border);
  const focusBorder = getCssVar('--vscode-focusBorder', primary);
  const listActiveBg = getCssVar('--vscode-list-activeSelectionBackground', hoverBg);
  const listActiveFg = getCssVar('--vscode-list-activeSelectionForeground', editorFg);

  return createTheme({
    palette: {
      mode: dark ? 'dark' : 'light',
      primary: { main: primary, contrastText: primaryContrast },
      secondary: { main: secondary, contrastText: secondaryContrast },
      background: {
        default: editorBg,
        paper: panelBg
      },
      text: {
        primary: editorFg,
        secondary: descriptionFg
      },
      divider: border,
      error: { main: error },
      warning: { main: warning },
      info: { main: info },
      success: { main: success }
    },
    shape: {
      borderRadius: 4
    },
    typography: {
      fontFamily: 'var(--vscode-font-family, sans-serif)',
      fontSize: Number.parseInt(getCssVar('--vscode-font-size', '13'), 10) || 13,
      button: {
        textTransform: 'none',
        fontWeight: 500
      }
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            margin: 0,
            padding: 0,
            backgroundColor: editorBg,
            color: editorFg
          },
          '#root': {
            minHeight: '100vh'
          },
          code: {
            fontFamily: 'var(--vscode-editor-font-family, monospace)'
          },
          pre: {
            fontFamily: 'var(--vscode-editor-font-family, monospace)'
          }
        }
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            borderColor: border,
            borderWidth: 1,
            borderStyle: 'solid'
          }
        }
      },
      MuiButton: {
        defaultProps: {
          size: 'small'
        },
        styleOverrides: {
          root: {
            borderRadius: 4
          }
        }
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: inputBg,
            color: inputFg,
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: inputBorder
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: focusBorder
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: focusBorder
            }
          },
          input: {
            color: inputFg
          }
        }
      },
      MuiInputLabel: {
        styleOverrides: {
          root: {
            color: descriptionFg
          }
        }
      },
      MuiDataGrid: {
        styleOverrides: {
          root: {
            borderColor: border,
            backgroundColor: panelBg,
            '--DataGrid-containerBackground': panelBg,
            '--DataGrid-pinnedBackground': panelBg,
            '--DataGrid-rowBorderColor': border,
            '--DataGrid-cellOffsetMultiplier': 2
          },
          columnHeaders: {
            backgroundColor: panelBg,
            borderBottomColor: border
          },
          cell: {
            borderBottomColor: border,
            '&:focus, &:focus-within': {
              outline: `1px solid ${focusBorder}`,
              outlineOffset: -1
            }
          },
          row: {
            '&:hover': {
              backgroundColor: hoverBg
            },
            '&.Mui-selected': {
              backgroundColor: listActiveBg,
              color: listActiveFg
            },
            '&.Mui-selected:hover': {
              backgroundColor: listActiveBg
            }
          },
          footerContainer: {
            borderTopColor: border
          }
        }
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            border: `1px solid ${border}`
          }
        }
      }
    }
  }, highContrast ? {
    components: {
      MuiDataGrid: {
        styleOverrides: {
          cell: {
            '&:focus, &:focus-within': {
              outline: `2px solid ${focusBorder}`,
              outlineOffset: -2
            }
          }
        }
      }
    }
  } : {});
}
