import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlayArrow as PlayArrowIcon } from '@mui/icons-material';
import { Alert, Box, Divider, IconButton, Tooltip } from '@mui/material';
import type { Theme, ThemeOptions } from '@mui/material/styles';
import { createTheme, useTheme } from '@mui/material/styles';
import Editor, { loader, type Monaco, type OnMount } from '@monaco-editor/react';
import * as monacoEditor from 'monaco-editor';
import type { editor } from 'monaco-editor';
import { TopologyEditor, exportToYaml, useTopologyStore } from '@eda-labs/topo-builder';
import { createPortal } from 'react-dom';
import '@eda-labs/topo-builder/styles.css';
import './topobuilderDashboard.css';

import { useMessageListener, usePostMessage } from '../../shared/hooks';
import { mountWebview } from '../../shared/utils';

const TOPOBUILDER_LOGO_URL =
  (globalThis as { __TOPOBUILDER_LOGO_URI__?: string }).__TOPOBUILDER_LOGO_URI__ ?? '/eda.svg';

const MONACO_THEME_NAME = 'topobuilder-vscode-theme';

loader.config({ monaco: monacoEditor });

function readCssVariable(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

type TopoBuilderWorkflowAction = 'run';

interface TopoBuilderWorkflowRequest {
  command: 'topobuilderWorkflowAction';
  action: TopoBuilderWorkflowAction;
  requestId: string;
  yaml: string;
}

interface TopoBuilderWorkflowResult {
  command: 'topobuilderWorkflowResult';
  requestId: string;
  action: TopoBuilderWorkflowAction;
  success: boolean;
  message: string;
}

type TransactionStatus = {
  severity: 'success' | 'error' | 'info';
  message: string;
};

let transactionRequestCounter = 0;

function getActionLabel(): string {
  return 'workflow run';
}

interface VsCodeYamlPanelProps {
  readonly onRunWorkflowActionChange: (action: (() => void) | null) => void;
  readonly onSubmittingChange: (submitting: boolean) => void;
}

function VsCodeYamlPanel({
  onRunWorkflowActionChange,
  onSubmittingChange
}: VsCodeYamlPanelProps) {
  const theme = useTheme();
  const topologyName = useTopologyStore(state => state.topologyName);
  const namespace = useTopologyStore(state => state.namespace);
  const operation = useTopologyStore(state => state.operation);
  const nodes = useTopologyStore(state => state.nodes);
  const edges = useTopologyStore(state => state.edges);
  const nodeTemplates = useTopologyStore(state => state.nodeTemplates);
  const linkTemplates = useTopologyStore(state => state.linkTemplates);
  const simulation = useTopologyStore(state => state.simulation);
  const annotations = useTopologyStore(state => state.annotations);
  const yamlRefreshCounter = useTopologyStore(state => state.yamlRefreshCounter);
  const importFromYaml = useTopologyStore(state => state.importFromYaml);
  const error = useTopologyStore(state => state.error);
  const setError = useTopologyStore(state => state.setError);

  const generatedYaml = useMemo(
    () => exportToYaml({
      topologyName,
      namespace,
      operation,
      nodes,
      edges,
      nodeTemplates,
      linkTemplates,
      simulation,
      annotations,
    }),
    [
      annotations,
      edges,
      linkTemplates,
      namespace,
      nodeTemplates,
      nodes,
      operation,
      simulation,
      topologyName
    ]
  );

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const latestYamlRef = useRef(generatedYaml);
  const lastHandledRefreshCounterRef = useRef(yamlRefreshCounter);
  const isRefreshingRef = useRef(false);
  const refreshTimeoutRef = useRef<number | null>(null);
  const [transactionStatus, setTransactionStatus] = useState<TransactionStatus | null>(null);
  const [pendingAction, setPendingAction] = useState<TopoBuilderWorkflowAction | null>(null);
  const pendingRequestIdRef = useRef<string | null>(null);
  const applyTimeoutRef = useRef<number | null>(null);
  const statusDismissTimeoutRef = useRef<number | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const postMessage = usePostMessage<TopoBuilderWorkflowRequest>();

  const applyMonacoTheme = useCallback((monaco: Monaco) => {
    const editorBackground = readCssVariable('--vscode-editor-background', theme.vscode.topology.editorBackground);
    const editorForeground = readCssVariable('--vscode-editor-foreground', theme.vscode.topology.foreground);
    const editorBorder = readCssVariable('--vscode-panel-border', theme.vscode.topology.panelBorder);
    const lineNumber = readCssVariable('--vscode-editorLineNumber-foreground', theme.vscode.topology.editorLineForeground);
    const activeLineNumber = readCssVariable('--vscode-editorLineNumber-activeForeground', editorForeground);
    const cursor = readCssVariable('--vscode-editorCursor-foreground', editorForeground);
    const selectionFallback = theme.palette.mode === 'light' ? '#ADD6FF' : '#264F78';
    const selection = readCssVariable('--vscode-editor-selectionBackground', selectionFallback);
    const inactiveSelection = readCssVariable('--vscode-editor-inactiveSelectionBackground', selection);
    const lineHighlightFallback = theme.palette.mode === 'light' ? '#0000000A' : '#FFFFFF0A';
    const lineHighlight = readCssVariable('--vscode-editor-lineHighlightBackground', lineHighlightFallback);
    const indentGuide = readCssVariable('--vscode-editorIndentGuide-background1', editorBorder);
    const activeIndentGuide = readCssVariable('--vscode-editorIndentGuide-activeBackground1', theme.palette.text.secondary);
    const whitespace = readCssVariable('--vscode-editorWhitespace-foreground', theme.palette.text.secondary);

    monaco.editor.defineTheme(MONACO_THEME_NAME, {
      base: theme.palette.mode === 'light' ? 'vs' : 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': editorBackground,
        'editor.foreground': editorForeground,
        'editorGutter.background': editorBackground,
        'editorLineNumber.foreground': lineNumber,
        'editorLineNumber.activeForeground': activeLineNumber,
        'editorCursor.foreground': cursor,
        'editor.selectionBackground': selection,
        'editor.inactiveSelectionBackground': inactiveSelection,
        'editor.lineHighlightBackground': lineHighlight,
        'editorIndentGuide.background1': indentGuide,
        'editorIndentGuide.activeBackground1': activeIndentGuide,
        'editorWhitespace.foreground': whitespace,
      }
    });
    monaco.editor.setTheme(MONACO_THEME_NAME);
  }, [theme]);

  const handleEditorMount = useCallback<OnMount>((editorInstance, monaco) => {
    monacoRef.current = monaco;
    applyMonacoTheme(monaco);
    editorRef.current = editorInstance;
    latestYamlRef.current = editorInstance.getValue();
  }, [applyMonacoTheme]);

  useMessageListener<TopoBuilderWorkflowResult>(useCallback((message) => {
    if (message.command !== 'topobuilderWorkflowResult') {
      return;
    }
    if (pendingRequestIdRef.current !== message.requestId) {
      return;
    }

    pendingRequestIdRef.current = null;
    setPendingAction(null);
    setTransactionStatus({
      severity: message.success ? 'success' : 'error',
      message: message.message
    });
  }, []));

  useEffect(() => {
    if (!editorRef.current) {
      return;
    }
    if (yamlRefreshCounter === lastHandledRefreshCounterRef.current) {
      return;
    }
    lastHandledRefreshCounterRef.current = yamlRefreshCounter;
    if (editorRef.current.getValue() === generatedYaml) {
      latestYamlRef.current = generatedYaml;
      return;
    }

    isRefreshingRef.current = true;
    editorRef.current.setValue(generatedYaml);
    latestYamlRef.current = generatedYaml;

    if (refreshTimeoutRef.current !== null) {
      window.clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = window.setTimeout(() => {
      isRefreshingRef.current = false;
      refreshTimeoutRef.current = null;
    }, 0);
  }, [generatedYaml, yamlRefreshCounter]);

  useEffect(() => {
    if (monacoRef.current) {
      applyMonacoTheme(monacoRef.current);
    }
  }, [applyMonacoTheme]);

  const handleYamlChange = useCallback((value: string | undefined) => {
    const nextValue = value ?? '';
    if (isRefreshingRef.current) {
      latestYamlRef.current = nextValue;
      return;
    }

    setTransactionStatus(null);
    latestYamlRef.current = nextValue;
    if (error) {
      setError(null);
    }
    if (applyTimeoutRef.current !== null) {
      window.clearTimeout(applyTimeoutRef.current);
    }
    applyTimeoutRef.current = window.setTimeout(() => {
      const imported = importFromYaml(nextValue);
      if (imported) {
        setError(null);
      }
      applyTimeoutRef.current = null;
    }, 500);
  }, [error, importFromYaml, setError]);

  useEffect(() => {
    return () => {
      if (applyTimeoutRef.current !== null) {
        window.clearTimeout(applyTimeoutRef.current);
      }
      if (statusDismissTimeoutRef.current !== null) {
        window.clearTimeout(statusDismissTimeoutRef.current);
      }
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  const handleWorkflowAction = useCallback(() => {
    const yamlToSubmit = editorRef.current?.getValue() ?? latestYamlRef.current;
    if (!yamlToSubmit.trim()) {
      setTransactionStatus({
        severity: 'error',
        message: 'Topology YAML is empty.'
      });
      return;
    }

    const requestId = `topobuilder-${Date.now()}-${transactionRequestCounter++}`;
    pendingRequestIdRef.current = requestId;
    setPendingAction('run');
    setTransactionStatus({
      severity: 'info',
      message: `Submitting ${getActionLabel()}...`
    });
    postMessage({
      command: 'topobuilderWorkflowAction',
      action: 'run',
      requestId,
      yaml: yamlToSubmit
    });
  }, [postMessage]);

  const isSubmitting = pendingAction !== null;

  useEffect(() => {
    onRunWorkflowActionChange(handleWorkflowAction);
    return () => {
      onRunWorkflowActionChange(null);
    };
  }, [handleWorkflowAction, onRunWorkflowActionChange]);

  useEffect(() => {
    onSubmittingChange(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  useEffect(() => {
    if (statusDismissTimeoutRef.current !== null) {
      window.clearTimeout(statusDismissTimeoutRef.current);
      statusDismissTimeoutRef.current = null;
    }
    if (transactionStatus?.severity !== 'success') {
      return;
    }

    statusDismissTimeoutRef.current = window.setTimeout(() => {
      setTransactionStatus(current => {
        if (current?.severity !== 'success') {
          return current;
        }
        return null;
      });
      statusDismissTimeoutRef.current = null;
    }, 3000);
  }, [transactionStatus]);

  return (
    <Box className="topobuilder-vscode-yaml-panel">
      {transactionStatus && (
        <Alert severity={transactionStatus.severity} className="topobuilder-vscode-yaml-alert">
          {transactionStatus.message}
        </Alert>
      )}
      {error && (
        <Alert severity="error" className="topobuilder-vscode-yaml-alert">
          {error}
        </Alert>
      )}
      <Box className="topobuilder-vscode-yaml-editor">
        <Editor
          height="100%"
          language="yaml"
          theme={MONACO_THEME_NAME}
          defaultValue={generatedYaml}
          onMount={handleEditorMount}
          onChange={handleYamlChange}
          options={{
            minimap: { enabled: false },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            tabSize: 2,
            lineNumbers: 'on',
            renderLineHighlight: 'all',
            bracketPairColorization: { enabled: true },
            fontFamily: theme.vscode.fonts.editorFamily,
            fontSize: theme.vscode.fonts.editorSize,
            scrollbar: {
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10
            }
          }}
        />
      </Box>
    </Box>
  );
}

function TopoBuilderDashboard() {
  const theme = useTheme();
  const [runWorkflowAction, setRunWorkflowAction] = useState<(() => void) | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [navbarActionHost, setNavbarActionHost] = useState<HTMLElement | null>(null);

  const handleRunWorkflowActionChange = useCallback((action: (() => void) | null) => {
    setRunWorkflowAction(() => action);
  }, []);

  const handleSubmittingChange = useCallback((submitting: boolean) => {
    setIsSubmitting(submitting);
  }, []);

  const handleRunWorkflow = useCallback(() => {
    if (runWorkflowAction) {
      runWorkflowAction();
    }
  }, [runWorkflowAction]);

  useEffect(() => {
    const root = document.querySelector('.topobuilder-dashboard-root');
    if (!root) {
      return;
    }

    const syncNavbar = () => {
      const logos = root.querySelectorAll('img[alt="EDA"]');
      logos.forEach(logo => {
        if (logo.getAttribute('src') !== TOPOBUILDER_LOGO_URL) {
          logo.setAttribute('src', TOPOBUILDER_LOGO_URL);
        }
      });

      const nextHost = root.querySelector<HTMLElement>('.MuiAppBar-root .MuiToolbar-root > .MuiBox-root:last-child');
      setNavbarActionHost(currentHost => {
        if (currentHost === nextHost) {
          return currentHost;
        }
        return nextHost;
      });
    };

    syncNavbar();
    const observer = new MutationObserver(syncNavbar);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });

    return () => {
      observer.disconnect();
      setNavbarActionHost(null);
    };
  }, []);
  const renderYamlPanel = useCallback(() => (
    <VsCodeYamlPanel
      onRunWorkflowActionChange={handleRunWorkflowActionChange}
      onSubmittingChange={handleSubmittingChange}
    />
  ), [handleRunWorkflowActionChange, handleSubmittingChange]);
  const topologyThemeOptions = useMemo<ThemeOptions>(() => {
    const { topology, fonts } = theme.vscode;
    return {
      cssVariables: true,
      palette: {
        mode: theme.palette.mode,
        primary: {
          main: theme.palette.primary.main,
          contrastText: theme.palette.primary.contrastText,
        },
        error: { main: theme.palette.error.main },
        warning: { main: theme.palette.warning.main },
        success: { main: theme.palette.success.main },
        info: { main: theme.palette.info.main },
        background: {
          default: topology.editorBackground,
          paper: topology.widgetBackground,
        },
        text: {
          primary: topology.foreground,
          secondary: topology.descriptionForeground,
        },
        divider: topology.panelBorder,
        card: {
          bg: topology.widgetBackground,
          border: topology.panelBorder,
        },
      },
      typography: {
        fontFamily: fonts.uiFamily,
        fontSize: fonts.uiSize,
      },
      shape: {
        borderRadius: 4,
      },
      components: {
        MuiPaper: {
          styleOverrides: {
            outlined: {
              backgroundColor: 'var(--mui-palette-card-bg)',
              borderColor: 'var(--mui-palette-card-border)',
            },
          },
        },
      },
    };
  }, [theme]);
  const topologyTheme = useMemo<Theme>(() => createTheme(topologyThemeOptions), [topologyThemeOptions]);
  const styleVariables = useMemo(() => ({
    '--tb-flow-bg': theme.vscode.topology.editorBackground,
    '--color-link-stroke': theme.vscode.topology.linkStroke,
    '--color-link-stroke-selected': theme.vscode.topology.linkStrokeSelected,
    '--color-link-stroke-highlight': theme.vscode.topology.linkStrokeSelected,
    '--color-node-border': theme.vscode.topology.nodeBorder,
    '--color-node-border-selected': theme.vscode.topology.nodeBorderSelected,
    '--color-node-bg': theme.vscode.topology.nodeBackground,
    '--color-node-text': theme.vscode.topology.nodeText,
    '--color-handle-bg': theme.vscode.topology.handleBackground,
    '--color-icon-bg': theme.vscode.topology.iconBackground,
    '--color-icon-fg': theme.vscode.topology.iconForeground,
  }), [theme]);

  return (
    <Box className="topobuilder-dashboard-root">
      {navbarActionHost && createPortal(
        <>
          <Tooltip title={isSubmitting ? 'Submitting workflow run...' : 'Run Workflow'}>
            <Box component="span" sx={{ display: 'inline-flex', order: -1 }}>
              <IconButton
                size="small"
                onClick={handleRunWorkflow}
                disabled={!runWorkflowAction || isSubmitting}
                sx={{ color: 'inherit' }}
              >
                <PlayArrowIcon fontSize="small" />
              </IconButton>
            </Box>
          </Tooltip>
          <Divider orientation="vertical" flexItem sx={{ borderColor: 'divider', my: 0.5, order: -1 }} />
        </>,
        navbarActionHost
      )}
      <TopologyEditor
        renderYamlPanel={renderYamlPanel}
        theme={topologyTheme}
        styleVariables={styleVariables}
      />
    </Box>
  );
}

mountWebview(TopoBuilderDashboard);
