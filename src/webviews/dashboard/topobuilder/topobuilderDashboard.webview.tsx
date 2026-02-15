import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FactCheck as FactCheckIcon, PlayArrow as PlayArrowIcon } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Step,
  StepLabel,
  Stepper,
  Tooltip
} from '@mui/material';
import type { Theme, ThemeOptions } from '@mui/material/styles';
import { createTheme, useTheme } from '@mui/material/styles';
import Editor, { loader, type Monaco, type OnMount } from '@monaco-editor/react';
import * as monacoEditor from 'monaco-editor';
import type { editor } from 'monaco-editor';
import * as yaml from 'js-yaml';
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

type RiskyWorkflowOperation = 'replace' | 'replaceAll';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getWorkflowOperationForConfirmation(yamlText: string): RiskyWorkflowOperation | null {
  try {
    const parsed = yaml.load(yamlText);
    if (!isObject(parsed)) {
      return null;
    }

    const spec = parsed.spec;
    if (!isObject(spec)) {
      return null;
    }

    const operation = spec.operation;
    if (operation === 'replace' || operation === 'replaceAll') {
      return operation;
    }
  } catch {
    return null;
  }

  return null;
}

function injectDryRunCheck(yamlText: string): string {
  const parsed = yaml.load(yamlText);
  if (!isObject(parsed)) {
    throw new Error('YAML root must be an object.');
  }

  const spec = isObject(parsed.spec) ? parsed.spec : {};
  const checks = isObject(spec.checks) ? spec.checks : {};
  checks.dryRun = true;
  spec.checks = checks;
  parsed.spec = spec;

  return yaml.dump(parsed, { indent: 2, lineWidth: -1, noRefs: true });
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

interface WorkflowIdentifier {
  group: string;
  kind: string;
  name: string;
  namespace?: string;
  version: string;
}

interface WorkflowInputRequest extends WorkflowIdentifier {
  ackPrompt?: string;
}

interface TopoBuilderInputRequired {
  command: 'topobuilderInputRequired';
  requestId: string;
  inputs: WorkflowInputRequest[];
}

interface TopoBuilderConfirmInput {
  command: 'topobuilderConfirmInput';
  requestId: string;
  ack: boolean;
  subflows: WorkflowIdentifier[];
}

interface TopoBuilderWorkflowComplete {
  command: 'topobuilderWorkflowComplete';
  requestId: string;
  success: boolean;
  message: string;
}

type TopoBuilderOutgoingMessage = TopoBuilderWorkflowRequest | TopoBuilderConfirmInput;
type TopoBuilderIncomingMessage =
  | TopoBuilderWorkflowResult
  | TopoBuilderInputRequired
  | TopoBuilderWorkflowComplete;

type TransactionStatus = {
  severity: 'success' | 'error' | 'info';
  message: string;
};

type WorkflowProgressPhase = 'idle' | 'submitting' | 'running' | 'waitingInput' | 'success' | 'failed';

type WorkflowProgressState = {
  phase: WorkflowProgressPhase;
  requestId: string | null;
  message: string;
};

const WORKFLOW_DRY_RUN_SUBMIT_MESSAGE = 'Submitting workflow dry run...';
const WORKFLOW_CONFIRM_SUBMITTED_MESSAGE = 'Confirmation submitted. Waiting for the next workflow step...';
const WORKFLOW_REJECT_SUBMITTED_MESSAGE = 'Rejection submitted. Waiting for workflow completion...';

let transactionRequestCounter = 0;

function getActionLabel(): string {
  return 'workflow run';
}

function getWorkflowProgressSeverity(phase: WorkflowProgressPhase): 'info' | 'success' | 'error' {
  if (phase === 'failed') {
    return 'error';
  }
  if (phase === 'success') {
    return 'success';
  }
  return 'info';
}

function getWorkflowProgressTitle(phase: WorkflowProgressPhase): string {
  if (phase === 'success') {
    return 'Workflow Completed';
  }
  if (phase === 'failed') {
    return 'Workflow Failed';
  }
  if (phase === 'waitingInput') {
    return 'Workflow Confirmation Required';
  }
  return 'Workflow Running';
}

interface VsCodeYamlPanelProps {
  readonly onRunWorkflowActionChange: (action: ((dryRun: boolean) => void) | null) => void;
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
  const [confirmOperation, setConfirmOperation] = useState<RiskyWorkflowOperation | null>(null);
  const [pendingWorkflowInputs, setPendingWorkflowInputs] = useState<TopoBuilderInputRequired | null>(null);
  const [isSubmittingWorkflowInput, setIsSubmittingWorkflowInput] = useState(false);
  const [sawWorkflowInputStep, setSawWorkflowInputStep] = useState(false);
  const [workflowProgress, setWorkflowProgress] = useState<WorkflowProgressState>({
    phase: 'idle',
    requestId: null,
    message: ''
  });
  const pendingRequestIdRef = useRef<string | null>(null);
  const activeWorkflowRequestIdRef = useRef<string | null>(null);
  const pendingConfirmYamlRef = useRef<string | null>(null);
  const pendingConfirmDryRunRef = useRef(false);
  const applyTimeoutRef = useRef<number | null>(null);
  const statusDismissTimeoutRef = useRef<number | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const postMessage = usePostMessage<TopoBuilderOutgoingMessage>();

  const setWorkflowProgressForRequest = useCallback((
    requestId: string,
    phase: WorkflowProgressPhase,
    message: string
  ) => {
    setWorkflowProgress(current => {
      if (current.requestId && current.requestId !== requestId) {
        return current;
      }
      return { phase, requestId, message };
    });
  }, []);

  const closeWorkflowProgressDialog = useCallback(() => {
    setWorkflowProgress({
      phase: 'idle',
      requestId: null,
      message: ''
    });
  }, []);

  const applyMonacoTheme = useCallback((monaco: Monaco) => {
    const editorBackground = readCssVariable('--vscode-editor-background', theme.vscode.topology.editorBackground);
    const editorForeground = readCssVariable('--vscode-editor-foreground', theme.vscode.topology.foreground);
    const lineNumber = readCssVariable('--vscode-editorLineNumber-foreground', theme.vscode.topology.editorLineForeground);
    const activeLineNumber = readCssVariable('--vscode-editorLineNumber-activeForeground', editorForeground);
    const cursor = readCssVariable('--vscode-editorCursor-foreground', editorForeground);
    const selectionFallback = theme.palette.mode === 'light' ? '#ADD6FF' : '#264F78';
    const selection = readCssVariable('--vscode-editor-selectionBackground', selectionFallback);
    const inactiveSelection = readCssVariable('--vscode-editor-inactiveSelectionBackground', selection);
    const lineHighlightFallback = theme.palette.mode === 'light' ? '#0000000A' : '#FFFFFF0A';
    const lineHighlight = readCssVariable('--vscode-editor-lineHighlightBackground', lineHighlightFallback);
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

  useMessageListener<TopoBuilderIncomingMessage>(useCallback((message) => {
    if (message.command === 'topobuilderWorkflowResult') {
      if (pendingRequestIdRef.current !== message.requestId) {
        return;
      }

      pendingRequestIdRef.current = null;
      setPendingAction(null);
      if (!message.success && activeWorkflowRequestIdRef.current === message.requestId) {
        activeWorkflowRequestIdRef.current = null;
      }
      setWorkflowProgressForRequest(
        message.requestId,
        message.success ? 'running' : 'failed',
        message.success
          ? 'Workflow submitted. Waiting for workflow progress...'
          : message.message
      );
      setTransactionStatus({
        severity: message.success ? 'success' : 'error',
        message: message.message
      });
      return;
    }

    if (message.command === 'topobuilderInputRequired') {
      if (activeWorkflowRequestIdRef.current && activeWorkflowRequestIdRef.current !== message.requestId) {
        return;
      }
      if (message.inputs.length === 0) {
        return;
      }

      activeWorkflowRequestIdRef.current = message.requestId;
      setIsSubmittingWorkflowInput(false);
      setSawWorkflowInputStep(true);
      setPendingWorkflowInputs(message);
      setWorkflowProgressForRequest(
        message.requestId,
        'waitingInput',
        'Workflow is waiting for confirmation input.'
      );
      setTransactionStatus({
        severity: 'info',
        message: 'Workflow is waiting for confirmation input.'
      });
      return;
    }

    if (message.command === 'topobuilderWorkflowComplete') {
      if (activeWorkflowRequestIdRef.current && activeWorkflowRequestIdRef.current !== message.requestId) {
        return;
      }

      activeWorkflowRequestIdRef.current = null;
      pendingRequestIdRef.current = null;
      setPendingAction(null);
      setIsSubmittingWorkflowInput(false);
      setPendingWorkflowInputs(null);
      setWorkflowProgressForRequest(
        message.requestId,
        message.success ? 'success' : 'failed',
        message.message
      );
      setTransactionStatus({
        severity: message.success ? 'success' : 'error',
        message: message.message
      });
    }
  }, [setWorkflowProgressForRequest]));

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

  const submitWorkflowRun = useCallback((yamlToSubmit: string, dryRun: boolean) => {
    if (!yamlToSubmit.trim()) {
      setTransactionStatus({
        severity: 'error',
        message: 'Topology YAML is empty.'
      });
      return;
    }

    const requestId = `topobuilder-${Date.now()}-${transactionRequestCounter++}`;
    pendingRequestIdRef.current = requestId;
    activeWorkflowRequestIdRef.current = requestId;
    setPendingAction('run');
    setPendingWorkflowInputs(null);
    setIsSubmittingWorkflowInput(false);
    setSawWorkflowInputStep(false);
    setWorkflowProgress({
      phase: 'submitting',
      requestId,
      message: dryRun ? WORKFLOW_DRY_RUN_SUBMIT_MESSAGE : `Submitting ${getActionLabel()}...`
    });
    setTransactionStatus({
      severity: 'info',
      message: dryRun ? WORKFLOW_DRY_RUN_SUBMIT_MESSAGE : `Submitting ${getActionLabel()}...`
    });
    postMessage({
      command: 'topobuilderWorkflowAction',
      action: 'run',
      requestId,
      yaml: yamlToSubmit
    });
  }, [postMessage]);

  const closeConfirmationDialog = useCallback(() => {
    pendingConfirmYamlRef.current = null;
    pendingConfirmDryRunRef.current = false;
    setConfirmOperation(null);
  }, []);

  const confirmWorkflowRun = useCallback(() => {
    const yamlToSubmit = pendingConfirmYamlRef.current;
    const dryRun = pendingConfirmDryRunRef.current;
    closeConfirmationDialog();
    if (!yamlToSubmit) {
      return;
    }
    submitWorkflowRun(yamlToSubmit, dryRun);
  }, [closeConfirmationDialog, submitWorkflowRun]);

  const handleWorkflowAction = useCallback((dryRun: boolean) => {
    let yamlToSubmit = editorRef.current?.getValue() ?? latestYamlRef.current;
    if (dryRun) {
      try {
        yamlToSubmit = injectDryRunCheck(yamlToSubmit);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setTransactionStatus({
          severity: 'error',
          message: `Failed to enable dry run: ${message}`
        });
        return;
      }
    }

    const riskyOperation = getWorkflowOperationForConfirmation(yamlToSubmit);
    if (riskyOperation) {
      pendingConfirmYamlRef.current = yamlToSubmit;
      pendingConfirmDryRunRef.current = dryRun;
      setConfirmOperation(riskyOperation);
      return;
    }
    submitWorkflowRun(yamlToSubmit, dryRun);
  }, [submitWorkflowRun]);

  const submitWorkflowInputResponse = useCallback((ack: boolean) => {
    if (!pendingWorkflowInputs) {
      return;
    }
    const requestId = pendingWorkflowInputs.requestId;
    setIsSubmittingWorkflowInput(true);
    setPendingWorkflowInputs(null);
    postMessage({
      command: 'topobuilderConfirmInput',
      requestId,
      ack,
      subflows: pendingWorkflowInputs.inputs.map((input) => ({
        group: input.group,
        kind: input.kind,
        name: input.name,
        namespace: input.namespace,
        version: input.version
      }))
    });
    const submittedMessage = ack ? WORKFLOW_CONFIRM_SUBMITTED_MESSAGE : WORKFLOW_REJECT_SUBMITTED_MESSAGE;
    setWorkflowProgressForRequest(requestId, 'running', submittedMessage);
    setTransactionStatus({
      severity: 'info',
      message: submittedMessage
    });
  }, [pendingWorkflowInputs, postMessage, setWorkflowProgressForRequest]);

  const isWorkflowRunning = workflowProgress.phase === 'submitting'
    || workflowProgress.phase === 'running'
    || workflowProgress.phase === 'waitingInput';
  const isWorkflowFinished = workflowProgress.phase === 'success' || workflowProgress.phase === 'failed';
  const isSubmitting = pendingAction !== null || isSubmittingWorkflowInput || isWorkflowRunning;

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

  const workflowInputPrompts = pendingWorkflowInputs
    ? pendingWorkflowInputs.inputs
      .map((input) => (typeof input.ackPrompt === 'string' ? input.ackPrompt.trim() : ''))
      .filter((prompt) => prompt.length > 0)
    : [];
  const canCloseWorkflowProgress = pendingWorkflowInputs === null;
  const workflowProgressOpen = workflowProgress.phase !== 'idle';
  const outlinedActionButtonSx = { color: 'text.primary', borderColor: 'divider' } as const;
  const workflowProgressActiveStep = (() => {
    if (workflowProgress.phase === 'submitting') {
      return 0;
    }
    if (workflowProgress.phase === 'waitingInput') {
      return 1;
    }
    if (workflowProgress.phase === 'running') {
      return 2;
    }
    return 3;
  })();
  const workflowProgressSeverity = getWorkflowProgressSeverity(workflowProgress.phase);
  const workflowProgressTitle = getWorkflowProgressTitle(workflowProgress.phase);

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
            bracketPairColorization: { enabled: false },
            guides: {
              indentation: true,
              highlightActiveIndentation: false,
              bracketPairs: false,
              bracketPairsHorizontal: false,
              highlightActiveBracketPair: false
            },
            fontFamily: theme.vscode.fonts.editorFamily,
            fontSize: theme.vscode.fonts.editorSize,
            scrollbar: {
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10
            }
          }}
        />
      </Box>
      <Dialog
        open={workflowProgressOpen}
        onClose={() => {
          if (canCloseWorkflowProgress) {
            closeWorkflowProgressDialog();
          }
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{workflowProgressTitle}</DialogTitle>
        <DialogContent>
          <Stepper
            activeStep={workflowProgressActiveStep}
            alternativeLabel
            sx={{
              mb: 2,
              '& .MuiStepLabel-label': {
                color: 'text.secondary'
              },
              '& .MuiStepLabel-label.Mui-active, & .MuiStepLabel-label.Mui-completed': {
                color: 'text.primary'
              },
              '& .MuiStepIcon-root': {
                color: theme.palette.action.disabledBackground
              },
              '& .MuiStepIcon-root.Mui-active, & .MuiStepIcon-root.Mui-completed': {
                color: theme.palette.info.main
              },
              '& .MuiStepIcon-root.Mui-error': {
                color: theme.palette.error.main
              },
              '& .MuiStepConnector-line': {
                borderColor: 'divider'
              },
              '& .MuiStepConnector-root.Mui-active .MuiStepConnector-line, & .MuiStepConnector-root.Mui-completed .MuiStepConnector-line': {
                borderColor: theme.palette.info.main
              }
            }}
          >
            <Step completed={workflowProgress.phase !== 'idle'}>
              <StepLabel>Submitted</StepLabel>
            </Step>
            <Step completed={sawWorkflowInputStep}>
              <StepLabel optional="If required">Confirmation</StepLabel>
            </Step>
            <Step completed={isWorkflowFinished}>
              <StepLabel>Running</StepLabel>
            </Step>
            <Step completed={isWorkflowFinished}>
              <StepLabel error={workflowProgress.phase === 'failed'}>Completed</StepLabel>
            </Step>
          </Stepper>
          <Alert severity={workflowProgressSeverity} sx={{ mb: workflowInputPrompts.length > 0 ? 1 : 0 }}>
            {workflowProgress.message || 'Workflow is in progress.'}
          </Alert>
          {pendingWorkflowInputs && (
            workflowInputPrompts.length > 0 ? (
              workflowInputPrompts.map((prompt, index) => (
                <Alert severity="warning" key={`${prompt}-${index}`} sx={{ mb: index < workflowInputPrompts.length - 1 ? 1 : 0 }}>
                  {prompt}
                </Alert>
              ))
            ) : (
              <Alert severity="warning">
                The workflow is waiting for confirmation input.
              </Alert>
            )
          )}
        </DialogContent>
        <DialogActions>
          {pendingWorkflowInputs && (
            <>
              <Button
                variant="outlined"
                onClick={() => submitWorkflowInputResponse(false)}
                disabled={isSubmittingWorkflowInput}
                sx={outlinedActionButtonSx}
              >
                Reject
              </Button>
              <Button
                variant="contained"
                onClick={() => submitWorkflowInputResponse(true)}
                disabled={isSubmittingWorkflowInput}
              >
                Confirm
              </Button>
            </>
          )}
          {canCloseWorkflowProgress && (
            <Button
              variant={isWorkflowFinished ? 'contained' : 'outlined'}
              onClick={closeWorkflowProgressDialog}
              sx={isWorkflowFinished ? undefined : outlinedActionButtonSx}
            >
              Close
            </Button>
          )}
        </DialogActions>
      </Dialog>
      <Dialog
        open={confirmOperation !== null}
        onClose={closeConfirmationDialog}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Confirm Workflow Run</DialogTitle>
        <DialogContent>
          <Alert severity="warning">
            This workflow uses <code>spec.operation: {confirmOperation}</code>. Running it can replace existing
            resources.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button
            variant="outlined"
            onClick={closeConfirmationDialog}
            sx={outlinedActionButtonSx}
          >
            Cancel
          </Button>
          <Button variant="contained" color="warning" onClick={confirmWorkflowRun}>
            Run Workflow
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function TopoBuilderDashboard() {
  const theme = useTheme();
  const [runWorkflowAction, setRunWorkflowAction] = useState<((dryRun: boolean) => void) | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [navbarActionHost, setNavbarActionHost] = useState<HTMLElement | null>(null);

  const handleRunWorkflowActionChange = useCallback((action: ((dryRun: boolean) => void) | null) => {
    setRunWorkflowAction(() => action);
  }, []);

  const handleSubmittingChange = useCallback((submitting: boolean) => {
    setIsSubmitting(submitting);
  }, []);

  const handleRunWorkflow = useCallback(() => {
    if (runWorkflowAction) {
      runWorkflowAction(false);
    }
  }, [runWorkflowAction]);

  const handleDryRunWorkflow = useCallback(() => {
    if (runWorkflowAction) {
      runWorkflowAction(true);
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
          <Tooltip title={isSubmitting ? 'Submitting workflow dry run...' : 'Dry Run'}>
            <Box component="span" sx={{ display: 'inline-flex', order: -1 }}>
              <IconButton
                size="small"
                onClick={handleDryRunWorkflow}
                disabled={!runWorkflowAction || isSubmitting}
                sx={{
                  color: 'inherit',
                  ml: 0.5
                }}
              >
                <FactCheckIcon fontSize="small" />
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
