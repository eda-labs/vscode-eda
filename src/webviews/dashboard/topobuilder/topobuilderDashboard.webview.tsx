import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import type { Theme, ThemeOptions } from '@mui/material/styles';
import { createTheme, useTheme } from '@mui/material/styles';
import { TopologyEditor, exportToYaml, useTopologyStore } from '@eda-labs/topo-builder';
import '@eda-labs/topo-builder/styles.css';
import './topobuilderDashboard.css';

import { useMessageListener, usePostMessage } from '../../shared/hooks';
import { mountWebview } from '../../shared/utils';

const TOPOBUILDER_LOGO_URL =
  (globalThis as { __TOPOBUILDER_LOGO_URI__?: string }).__TOPOBUILDER_LOGO_URI__ ?? '/eda.svg';

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

function VsCodeYamlPanel() {
  const topologyName = useTopologyStore(state => state.topologyName);
  const namespace = useTopologyStore(state => state.namespace);
  const operation = useTopologyStore(state => state.operation);
  const nodes = useTopologyStore(state => state.nodes);
  const edges = useTopologyStore(state => state.edges);
  const nodeTemplates = useTopologyStore(state => state.nodeTemplates);
  const linkTemplates = useTopologyStore(state => state.linkTemplates);
  const simulation = useTopologyStore(state => state.simulation);
  const annotations = useTopologyStore(state => state.annotations);
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

  const [draftYaml, setDraftYaml] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<TransactionStatus | null>(null);
  const [pendingAction, setPendingAction] = useState<TopoBuilderWorkflowAction | null>(null);
  const pendingRequestIdRef = useRef<string | null>(null);
  const applyTimeoutRef = useRef<number | null>(null);
  const postMessage = usePostMessage<TopoBuilderWorkflowRequest>();

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
    if (!manualMode) {
      setDraftYaml(generatedYaml);
    }
  }, [generatedYaml, manualMode]);

  const handleYamlChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setManualMode(true);
    setTransactionStatus(null);
    setDraftYaml(nextValue);
    if (error) {
      setError(null);
    }
    if (applyTimeoutRef.current !== null) {
      window.clearTimeout(applyTimeoutRef.current);
    }
    applyTimeoutRef.current = window.setTimeout(() => {
      const imported = importFromYaml(nextValue);
      if (imported) {
        setManualMode(false);
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
    };
  }, []);

  const handleWorkflowAction = useCallback(() => {
    if (!draftYaml.trim()) {
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
      yaml: draftYaml
    });
  }, [draftYaml, postMessage]);

  const isSubmitting = pendingAction !== null;

  return (
    <Box className="topobuilder-vscode-yaml-panel">
      <Stack direction="row" spacing={1} className="topobuilder-vscode-yaml-actions">
        <Button
          variant="contained"
          color="primary"
          size="small"
          onClick={() => { handleWorkflowAction(); }}
          disabled={isSubmitting}
        >
          {pendingAction === 'run' ? 'Submitting...' : 'Run Workflow'}
        </Button>
      </Stack>
      <Typography variant="caption" className="topobuilder-vscode-yaml-caption">
        YAML edits are applied automatically when valid. Run Workflow submits the current YAML.
      </Typography>
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
      <TextField
        multiline
        fullWidth
        minRows={18}
        value={draftYaml}
        onChange={handleYamlChange}
        className="topobuilder-vscode-yaml-editor"
      />
    </Box>
  );
}

function TopoBuilderDashboard() {
  const theme = useTheme();
  useEffect(() => {
    const root = document.querySelector('.topobuilder-dashboard-root');
    if (!root) {
      return;
    }

    const applyLogo = () => {
      const logos = root.querySelectorAll('img[alt="EDA"]');
      logos.forEach(logo => {
        if (logo.getAttribute('src') !== TOPOBUILDER_LOGO_URL) {
          logo.setAttribute('src', TOPOBUILDER_LOGO_URL);
        }
      });
    };

    applyLogo();
    const observer = new MutationObserver(applyLogo);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });

    return () => observer.disconnect();
  }, []);
  const renderYamlPanel = useCallback(() => <VsCodeYamlPanel />, []);
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
      <TopologyEditor
        renderYamlPanel={renderYamlPanel}
        theme={topologyTheme}
        styleVariables={styleVariables}
      />
    </Box>
  );
}

mountWebview(TopoBuilderDashboard);
