/* eslint-disable import-x/max-dependencies */

import { applyDevTheme, isDevThemeId, type DevThemeId } from '../../../src/webviews/shared/theme';

import { createMockHost } from './mockHost';
import {
  DEV_PREVIEW_WEBVIEWS,
  getDevWebviewLabel,
  isDevWebviewId,
  type DevWebviewId
} from './webviewCatalog';

interface VsCodeApi {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
}

interface WebviewCommand {
  command: string;
  [key: string]: unknown;
}

const WEBVIEW_LOADERS: Readonly<Record<DevWebviewId, () => Promise<unknown>>> = {
  edaExplorer: () => import('../../../src/webviews/explorer/edaExplorerView.webview'),
  alarmDetails: () => import('../../../src/webviews/alarmDetails/alarmDetailsPanel.webview'),
  deviationDetails: () => import('../../../src/webviews/deviationDetails/deviationDetailsPanel.webview'),
  nodeConfig: () => import('../../../src/webviews/nodeConfig/nodeConfigPanel.webview'),
  targetWizard: () => import('../../../src/webviews/targetWizard/targetWizardPanel.webview'),
  transactionDetails: () => import('../../../src/webviews/transactionDetails/transactionDetailsPanel.webview'),
  transactionDiffs: () => import('../../../src/webviews/transactionDiffs/transactionDiffsPanel.webview'),
  fabricDashboard: () => import('../../../src/webviews/dashboard/fabric/fabricDashboard.webview'),
  queriesDashboard: () => import('../../../src/webviews/dashboard/queries/queriesDashboard.webview'),
  resourceBrowser: () => import('../../../src/webviews/dashboard/resource/resourceBrowserPanel.webview'),
  simnodesDashboard: () => import('../../../src/webviews/dashboard/simnodes/simnodesDashboard.webview'),
  topobuilderDashboard: () => import('../../../src/webviews/dashboard/topobuilder/topobuilderDashboard.webview'),
  topologyFlowDashboard: () => import('../../../src/webviews/dashboard/topologyFlow/topologyFlowDashboard.webview'),
  toponodesDashboard: () => import('../../../src/webviews/dashboard/toponodes/toponodesDashboard.webview'),
  workflowsDashboard: () => import('../../../src/webviews/dashboard/workflows/workflowsDashboard.webview')
};

function parseWebviewId(value: string | null): DevWebviewId {
  if (value && isDevWebviewId(value)) {
    return value;
  }

  return DEV_PREVIEW_WEBVIEWS[0].id;
}

function parseThemeId(value: string | null): DevThemeId {
  if (value && isDevThemeId(value)) {
    return value;
  }

  return 'vscode-dark';
}

function isWebviewCommand(value: unknown): value is WebviewCommand {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return typeof (value as Record<string, unknown>).command === 'string';
}

function dispatchToWebview(message: Record<string, unknown>): void {
  window.setTimeout(() => {
    window.dispatchEvent(new MessageEvent('message', { data: message }));
  }, 0);
}

function installVsCodeApiBridge(onWebviewMessage: (message: WebviewCommand) => void): void {
  let state: unknown;

  const api: VsCodeApi = {
    postMessage: (message: unknown) => {
      if (isWebviewCommand(message)) {
        onWebviewMessage(message);
      }
    },
    getState: () => state,
    setState: (nextState: unknown) => {
      state = nextState;
    }
  };

  (globalThis as { acquireVsCodeApi?: () => VsCodeApi }).acquireVsCodeApi = () => api;
}

async function loadExtraStyles(webviewId: DevWebviewId): Promise<void> {
  if (webviewId === 'topologyFlowDashboard') {
    await import('../../../src/webviews/dashboard/topologyFlow/topologyFlowDashboard.css');
    await import('@xyflow/react/dist/style.css');
  }
}

async function bootstrap(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const webviewId = parseWebviewId(params.get('webview'));
  const themeId = parseThemeId(params.get('theme'));

  applyDevTheme(themeId);
  document.title = `${getDevWebviewLabel(webviewId)} Preview`;

  const host = createMockHost(webviewId, dispatchToWebview, { previewParams: params });
  installVsCodeApiBridge(host.onMessage);

  window.addEventListener('beforeunload', () => {
    host.dispose();
  }, { once: true });

  await loadExtraStyles(webviewId);
  await WEBVIEW_LOADERS[webviewId]();
}

void bootstrap();
