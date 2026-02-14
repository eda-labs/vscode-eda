import { alpha, createTheme, type Theme } from '@mui/material/styles';
import type {} from '@mui/x-data-grid/themeAugmentation';

export interface VSCodeThemeTokens {
  fonts: {
    uiFamily: string;
    uiSize: number;
    editorFamily: string;
    editorSize: number;
  };
  charts: {
    purple: string;
    blue: string;
    green: string;
    yellow: string;
    red: string;
    orange: string;
  };
  diff: {
    addedBackground: string;
    removedBackground: string;
    blankBackground: string;
  };
  topology: {
    panelBorder: string;
    widgetBackground: string;
    editorBackground: string;
    foreground: string;
    descriptionForeground: string;
    linkForeground: string;
    inputBackground: string;
    inputForeground: string;
    inputBorder: string;
    buttonSecondaryBackground: string;
    buttonSecondaryForeground: string;
    buttonSecondaryHoverBackground: string;
    buttonBorder: string;
    badgeBackground: string;
    editorLineForeground: string;
    linkStroke: string;
    linkStrokeSelected: string;
    linkUp: string;
    linkDown: string;
    nodeBorder: string;
    nodeBorderSelected: string;
    nodeBackground: string;
    nodeText: string;
    handleBackground: string;
    handleBorder: string;
    iconBackground: string;
    iconForeground: string;
  };
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown> ? DeepPartial<T[K]> : T[K];
};

declare module '@mui/material/styles' {
  interface Theme {
    vscode: VSCodeThemeTokens;
  }
  interface ThemeOptions {
    vscode?: DeepPartial<VSCodeThemeTokens>;
  }
}

export type VSCodeThemeClass =
  | 'vscode-light'
  | 'vscode-dark'
  | 'vscode-high-contrast'
  | 'vscode-high-contrast-light';

const THEME_LIGHT: VSCodeThemeClass = 'vscode-light';
const THEME_DARK: VSCodeThemeClass = 'vscode-dark';
const THEME_HC: VSCodeThemeClass = 'vscode-high-contrast';
const THEME_HC_LIGHT: VSCodeThemeClass = 'vscode-high-contrast-light';

interface VSCodeThemeFallbacks {
  editorBg: string;
  panelBg: string;
  hoverBg: string;
  editorFg: string;
  descriptionFg: string;
  border: string;
  primary: string;
  secondary: string;
  chartPurple: string;
  chartBlue: string;
  chartGreen: string;
  chartYellow: string;
  chartRed: string;
  chartOrange: string;
}

const DARK_FALLBACKS: VSCodeThemeFallbacks = {
  editorBg: '#1e1e1e',
  panelBg: '#252526',
  hoverBg: '#2a2d2e',
  editorFg: '#cccccc',
  descriptionFg: '#9d9d9d',
  border: '#3e3e42',
  primary: '#0e639c',
  secondary: '#3a3d41',
  chartPurple: '#b180d7',
  chartBlue: '#3794ff',
  chartGreen: '#89d185',
  chartYellow: '#dcdcaa',
  chartRed: '#f48771',
  chartOrange: '#d19a66'
};

const LIGHT_FALLBACKS: VSCodeThemeFallbacks = {
  editorBg: '#ffffff',
  panelBg: '#f3f3f3',
  hoverBg: '#e8e8e8',
  editorFg: '#333333',
  descriptionFg: '#666666',
  border: '#d4d4d4',
  primary: '#0078d4',
  secondary: '#f3f3f3',
  chartPurple: '#9b59b6',
  chartBlue: '#007acc',
  chartGreen: '#388a34',
  chartYellow: '#b89500',
  chartRed: '#c72e0f',
  chartOrange: '#b26900'
};

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
  const fallbacks = dark ? DARK_FALLBACKS : LIGHT_FALLBACKS;

  const editorBg = getCssVar('--vscode-editor-background', fallbacks.editorBg);
  const panelBg = getCssVar('--vscode-panel-background', fallbacks.panelBg);
  const widgetBg = getCssVar('--vscode-editorWidget-background', panelBg);
  const hoverBg = getCssVar('--vscode-list-hoverBackground', fallbacks.hoverBg);

  const editorFg = getCssVar('--vscode-editor-foreground', fallbacks.editorFg);
  const descriptionFg = getCssVar('--vscode-descriptionForeground', fallbacks.descriptionFg);
  const border = getCssVar('--vscode-panel-border', fallbacks.border);

  const primary = getCssVar('--vscode-button-background', fallbacks.primary);
  const primaryContrast = getCssVar('--vscode-button-foreground', '#ffffff');
  const secondary = getCssVar('--vscode-button-secondaryBackground', fallbacks.secondary);
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
  const sideBarBg = getCssVar('--vscode-sideBar-background', widgetBg);
  const textLinkFg = getCssVar('--vscode-textLink-foreground', primary);
  const buttonSecondaryHoverBg = getCssVar('--vscode-button-secondaryHoverBackground', hoverBg);
  const buttonBorder = getCssVar('--vscode-button-border', border);
  const badgeBg = getCssVar('--vscode-badge-background', listActiveBg);
  const editorLineFg = getCssVar('--vscode-editorLineNumber-foreground', descriptionFg);
  const iconFg = getCssVar('--vscode-icon-foreground', editorFg);
  let topologyIconAlpha = 0.14;
  if (highContrast) {
    topologyIconAlpha = 0.28;
  } else if (dark) {
    topologyIconAlpha = 0.2;
  }
  const topologyIconBg = alpha(iconFg, topologyIconAlpha);

  const chartPurple = getCssVar('--vscode-charts-purple', fallbacks.chartPurple);
  const chartBlue = getCssVar('--vscode-charts-blue', fallbacks.chartBlue);
  const chartGreen = getCssVar('--vscode-charts-green', fallbacks.chartGreen);
  const chartYellow = getCssVar('--vscode-charts-yellow', fallbacks.chartYellow);
  const chartRed = getCssVar('--vscode-charts-red', fallbacks.chartRed);
  const chartOrange = getCssVar('--vscode-charts-orange', fallbacks.chartOrange);

  const uiFontFamily = getCssVar('--vscode-font-family', 'sans-serif');
  const uiFontSize = Number.parseInt(getCssVar('--vscode-font-size', '13'), 10) || 13;
  const editorFontFamily = getCssVar('--vscode-editor-font-family', 'monospace');
  const editorFontSize = Number.parseInt(getCssVar('--vscode-editor-font-size', String(uiFontSize)), 10) || uiFontSize;

  const diffAddedBg = alpha(success, 0.2);
  const diffRemovedBg = alpha(error, 0.2);
  const diffBlankBg = alpha(descriptionFg, 0.15);

  const topologyLinkStroke = alpha(editorFg, 0.35);
  const topologyNodeBorder = alpha(editorFg, 0.3);
  const topologyNodeBg = widgetBg;

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
      fontFamily: uiFontFamily,
      fontSize: uiFontSize,
      button: {
        textTransform: 'none',
        fontWeight: 500
      }
    },
    vscode: {
      fonts: {
        uiFamily: uiFontFamily,
        uiSize: uiFontSize,
        editorFamily: editorFontFamily,
        editorSize: editorFontSize
      },
      charts: {
        purple: chartPurple,
        blue: chartBlue,
        green: chartGreen,
        yellow: chartYellow,
        red: chartRed,
        orange: chartOrange
      },
      diff: {
        addedBackground: diffAddedBg,
        removedBackground: diffRemovedBg,
        blankBackground: diffBlankBg
      },
      topology: {
        panelBorder: border,
        widgetBackground: sideBarBg,
        editorBackground: editorBg,
        foreground: editorFg,
        descriptionForeground: descriptionFg,
        linkForeground: textLinkFg,
        inputBackground: inputBg,
        inputForeground: inputFg,
        inputBorder,
        buttonSecondaryBackground: secondary,
        buttonSecondaryForeground: secondaryContrast,
        buttonSecondaryHoverBackground: buttonSecondaryHoverBg,
        buttonBorder,
        badgeBackground: badgeBg,
        editorLineForeground: editorLineFg,
        linkStroke: topologyLinkStroke,
        linkStrokeSelected: primary,
        linkUp: success,
        linkDown: error,
        nodeBorder: topologyNodeBorder,
        nodeBorderSelected: primary,
        nodeBackground: topologyNodeBg,
        nodeText: editorFg,
        handleBackground: topologyNodeBg,
        handleBorder: topologyNodeBorder,
        iconBackground: topologyIconBg,
        iconForeground: iconFg
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
            fontFamily: editorFontFamily
          },
          pre: {
            fontFamily: editorFontFamily
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
