/* eslint-disable import-x/max-dependencies */

import { applyDevTheme, isDevThemeId, type DevThemeId } from './devTheme';
import { createMockHost } from './mockHost';
import { DEV_WEBVIEWS, getDevWebviewLabel, isDevWebviewId, type DevWebviewId } from './webviewCatalog';

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
  alarmDetails: () => import('../../alarmDetails/alarmDetailsPanel.webview'),
  nodeConfig: () => import('../../nodeConfig/nodeConfigPanel.webview'),
  targetWizard: () => import('../../targetWizard/targetWizardPanel.webview'),
  transactionDetails: () => import('../../transactionDetails/transactionDetailsPanel.webview'),
  transactionDiffs: () => import('../../transactionDiffs/transactionDiffsPanel.webview'),
  fabricDashboard: () => import('../../dashboard/fabric/fabricDashboard.webview'),
  queriesDashboard: () => import('../../dashboard/queries/queriesDashboard.webview'),
  resourceBrowser: () => import('../../dashboard/resource/resourceBrowserPanel.webview'),
  simnodesDashboard: () => import('../../dashboard/simnodes/simnodesDashboard.webview'),
  topologyFlowDashboard: () => import('../../dashboard/topologyFlow/topologyFlowDashboard.webview'),
  toponodesDashboard: () => import('../../dashboard/toponodes/toponodesDashboard.webview')
};

function parseWebviewId(value: string | null): DevWebviewId {
  if (value && isDevWebviewId(value)) {
    return value;
  }

  return DEV_WEBVIEWS[0].id;
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
  if (webviewId !== 'topologyFlowDashboard') {
    return;
  }

  await import('../../dashboard/topologyFlow/topologyFlowDashboard.css');
  await import('@xyflow/react/dist/style.css');
}

async function bootstrap(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const webviewId = parseWebviewId(params.get('webview'));
  const themeId = parseThemeId(params.get('theme'));

  applyDevTheme(themeId);
  document.title = `${getDevWebviewLabel(webviewId)} Preview`;

  const host = createMockHost(webviewId, dispatchToWebview);
  installVsCodeApiBridge(host.onMessage);

  window.addEventListener('beforeunload', () => {
    host.dispose();
  }, { once: true });

  await loadExtraStyles(webviewId);
  await WEBVIEW_LOADERS[webviewId]();
}

void bootstrap();
