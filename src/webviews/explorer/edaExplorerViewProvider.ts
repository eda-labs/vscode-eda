import { randomBytes } from 'crypto';

import * as vscode from 'vscode';

import type { TreeItemBase } from '../../providers/views/treeItem';
import { log, LogLevel } from '../../extension';
import type {
  ExplorerInvokeCommandMessage,
  ExplorerOutgoingMessage,
  ExplorerRenderMetricsMessage,
  ExplorerSetFilterMessage
} from '../shared/explorer/types';

import { buildExplorerSnapshot, type ExplorerSnapshotProviders } from './explorerSnapshotAdapter';

const REFRESH_DEBOUNCE_MS = 120;
const MIN_SNAPSHOT_INTERVAL_MS = 80;
const SNAPSHOT_IN_FLIGHT_TIMEOUT_MS = 350;

interface FilterableTreeProvider {
  setTreeFilter(filterText: string): void;
  clearTreeFilter(): void;
  onDidChangeTreeData: vscode.Event<TreeItemBase | undefined | null | void>;
}

interface ExplorerViewProviderOptions {
  activationStartMs?: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSetFilterMessage(message: ExplorerOutgoingMessage): message is ExplorerSetFilterMessage {
  return message.command === 'setFilter';
}

function isInvokeCommandMessage(message: ExplorerOutgoingMessage): message is ExplorerInvokeCommandMessage {
  return message.command === 'invokeCommand';
}

function isRenderMetricsMessage(message: ExplorerOutgoingMessage): message is ExplorerRenderMetricsMessage {
  return message.command === 'renderMetrics';
}

function countSnapshotNodes(nodes: Array<{ children?: unknown[] }>): number {
  let total = 0;
  for (const node of nodes) {
    total += 1;
    const children = Array.isArray(node.children) ? node.children : [];
    total += countSnapshotNodes(children as Array<{ children?: unknown[] }>);
  }
  return total;
}

function toCommandArgument(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => toCommandArgument(item));
  }

  if (!isObject(value)) {
    return value;
  }

  if (typeof value.__vscodeUri === 'string') {
    return vscode.Uri.parse(value.__vscodeUri);
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = toCommandArgument(nested);
  }
  return output;
}

export class EdaExplorerViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'edaExplorerWebview';

  private readonly context: vscode.ExtensionContext;
  private readonly providers: ExplorerSnapshotProviders;
  private readonly filterableProviders: FilterableTreeProvider[];
  private readonly activationStartMs?: number;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly visibilityEmitter = new vscode.EventEmitter<boolean>();

  private webviewView?: vscode.WebviewView;
  private isReady = false;
  private filterText = '';
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private snapshotInFlight = false;
  private pendingSnapshot = false;
  private snapshotReleaseTimer?: ReturnType<typeof setTimeout>;
  private lastSnapshotPostMs = 0;
  private minSnapshotIntervalMs = MIN_SNAPSHOT_INTERVAL_MS;
  private snapshotInFlightTimeoutMs = SNAPSHOT_IN_FLIGHT_TIMEOUT_MS;
  private startupReadyLogged = false;
  private panelVisibleSinceMs?: number;

  public readonly onDidChangeVisibility = this.visibilityEmitter.event;

  constructor(
    context: vscode.ExtensionContext,
    providers: ExplorerSnapshotProviders,
    options?: ExplorerViewProviderOptions
  ) {
    this.context = context;
    this.providers = providers;
    this.activationStartMs = options?.activationStartMs;
    this.filterableProviders = [
      providers.dashboardProvider,
      providers.namespaceProvider,
      providers.alarmProvider,
      providers.deviationProvider,
      providers.basketProvider,
      providers.transactionProvider,
      providers.helpProvider
    ];

    const configuredMinInterval = Number(process.env.EDA_EXPLORER_MIN_SNAPSHOT_INTERVAL_MS);
    if (!Number.isNaN(configuredMinInterval) && configuredMinInterval >= 0) {
      this.minSnapshotIntervalMs = configuredMinInterval;
    }
    const configuredInFlightTimeout = Number(process.env.EDA_EXPLORER_SNAPSHOT_IN_FLIGHT_TIMEOUT_MS);
    if (!Number.isNaN(configuredInFlightTimeout) && configuredInFlightTimeout >= 0) {
      this.snapshotInFlightTimeoutMs = configuredInFlightTimeout;
    }

    this.registerDataListeners();
  }

  private registerDataListeners(): void {
    for (const provider of this.filterableProviders) {
      const disposable = provider.onDidChangeTreeData(() => {
        this.scheduleSnapshot();
      });
      this.disposables.push(disposable);
    }
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;
    this.isReady = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.context.extensionUri, 'resources')
      ]
    };

    webviewView.webview.html = this.getWebviewHtml(webviewView.webview);

    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((message: ExplorerOutgoingMessage) => {
        void this.handleMessage(message);
      })
    );

    this.disposables.push(
      webviewView.onDidChangeVisibility(() => {
        this.visibilityEmitter.fire(webviewView.visible);
        if (webviewView.visible) {
          this.panelVisibleSinceMs = Date.now();
          this.scheduleSnapshot(0);
        } else {
          this.panelVisibleSinceMs = undefined;
          this.snapshotInFlight = false;
          this.clearSnapshotReleaseTimer();
        }
      })
    );

    this.disposables.push(
      webviewView.onDidDispose(() => {
        this.isReady = false;
        this.webviewView = undefined;
        this.snapshotInFlight = false;
        this.pendingSnapshot = false;
        this.panelVisibleSinceMs = undefined;
        this.clearSnapshotReleaseTimer();
        this.visibilityEmitter.fire(false);
      })
    );

    this.visibilityEmitter.fire(webviewView.visible);
  }

  public async setFilter(filterText: string): Promise<void> {
    const normalizedFilter = filterText.trim();
    this.filterText = normalizedFilter;

    for (const provider of this.filterableProviders) {
      if (normalizedFilter.length > 0) {
        provider.setTreeFilter(normalizedFilter);
      } else {
        provider.clearTreeFilter();
      }
    }

    await vscode.commands.executeCommand('setContext', 'edaTreeFilterActive', normalizedFilter.length > 0);
    this.postFilterState();
    this.scheduleSnapshot(0);
  }

  public async clearFilter(): Promise<void> {
    await this.setFilter('');
  }

  public getFilterText(): string {
    return this.filterText;
  }

  public requestRefresh(): void {
    this.scheduleSnapshot(0);
  }

  public expandAllResources(): void {
    if (!this.webviewView || !this.isReady) {
      return;
    }
    void this.webviewView.webview.postMessage({ command: 'expandAllResources' });
  }

  private async handleMessage(message: ExplorerOutgoingMessage): Promise<void> {
    if (!message || typeof message.command !== 'string') {
      return;
    }

    if (message.command === 'ready') {
      this.isReady = true;
      this.postFilterState();
      this.scheduleSnapshot(0);
      return;
    }

    if (isSetFilterMessage(message)) {
      await this.setFilter(message.value);
      return;
    }

    if (isInvokeCommandMessage(message)) {
      await this.executeCommand(message);
      return;
    }

    if (isRenderMetricsMessage(message)) {
      log(
        `Explorer webview rendered snapshot ${message.snapshotId} in ${message.renderMs}ms`
        + ` (nodes: ${message.totalNodes}, resources: ${message.resourceLeafCount})`,
        LogLevel.DEBUG
      );
      if (!this.startupReadyLogged && this.activationStartMs && message.resourceLeafCount > 0) {
        this.startupReadyLogged = true;
        const startupReadyMs = Date.now() - this.activationStartMs;
        const visibleToReadyMs = this.panelVisibleSinceMs ? (Date.now() - this.panelVisibleSinceMs) : undefined;
        const visibleTimingText = visibleToReadyMs !== undefined
          ? `, panel-visible-to-ready: ${visibleToReadyMs}ms`
          : '';
        log(
          `Explorer startup ready in ${startupReadyMs}ms `
          + `(first rendered snapshot with resources: ${message.resourceLeafCount}`
          + `${visibleTimingText})`,
          LogLevel.INFO,
          true
        );
      }
      this.markSnapshotSettled();
      return;
    }

    if (message.command === 'requestRefresh') {
      this.scheduleSnapshot(0);
    }
  }

  private async executeCommand(message: ExplorerInvokeCommandMessage): Promise<void> {
    if (!message.commandId) {
      return;
    }

    const args = Array.isArray(message.args)
      ? message.args.map(item => toCommandArgument(item))
      : [];

    try {
      await vscode.commands.executeCommand(message.commandId, ...args);
    } catch (error: unknown) {
      const messageText = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Failed to execute command: ${messageText}`);
      this.webviewView?.webview.postMessage({
        command: 'error',
        message: messageText
      });
    }
  }

  private scheduleSnapshot(delay: number = REFRESH_DEBOUNCE_MS): void {
    this.pendingSnapshot = true;

    if (delay <= 0) {
      if (this.refreshTimer) {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = undefined;
      }
      this.flushPendingSnapshot();
      return;
    }

    if (this.refreshTimer) {
      return;
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.flushPendingSnapshot();
    }, delay);
  }

  private clearSnapshotReleaseTimer(): void {
    if (this.snapshotReleaseTimer) {
      clearTimeout(this.snapshotReleaseTimer);
      this.snapshotReleaseTimer = undefined;
    }
  }

  private markSnapshotSettled(): void {
    this.clearSnapshotReleaseTimer();
    if (!this.snapshotInFlight) {
      return;
    }
    this.snapshotInFlight = false;
    if (this.pendingSnapshot) {
      this.scheduleSnapshot(0);
    }
  }

  private scheduleSnapshotReleaseFallback(): void {
    this.clearSnapshotReleaseTimer();
    this.snapshotReleaseTimer = setTimeout(() => {
      this.snapshotReleaseTimer = undefined;
      if (!this.snapshotInFlight) {
        return;
      }
      log('Explorer snapshot render confirmation timed out; continuing with latest pending snapshot', LogLevel.DEBUG);
      this.snapshotInFlight = false;
      if (this.pendingSnapshot) {
        this.scheduleSnapshot(0);
      }
    }, this.snapshotInFlightTimeoutMs);
  }

  private flushPendingSnapshot(): void {
    if (!this.webviewView || !this.isReady || !this.webviewView.visible) {
      return;
    }
    if (!this.pendingSnapshot || this.snapshotInFlight) {
      return;
    }

    const elapsedSinceLastPost = Date.now() - this.lastSnapshotPostMs;
    if (this.lastSnapshotPostMs > 0 && elapsedSinceLastPost < this.minSnapshotIntervalMs) {
      const remainingMs = this.minSnapshotIntervalMs - elapsedSinceLastPost;
      if (!this.refreshTimer) {
        this.refreshTimer = setTimeout(() => {
          this.refreshTimer = undefined;
          this.flushPendingSnapshot();
        }, remainingMs);
      }
      return;
    }

    const start = Date.now();
    const snapshot = buildExplorerSnapshot(this.providers, this.filterText);
    const elapsedMs = Date.now() - start;
    const resourcesSection = snapshot.sections.find(section => section.id === 'resources');
    const resourceNodes = resourcesSection ? countSnapshotNodes(resourcesSection.nodes as Array<{ children?: unknown[] }>) : 0;
    log(`Explorer snapshot posted in ${elapsedMs}ms (resources nodes: ${resourceNodes})`, LogLevel.DEBUG);
    this.pendingSnapshot = false;
    this.snapshotInFlight = true;
    this.lastSnapshotPostMs = Date.now();
    this.scheduleSnapshotReleaseFallback();
    void this.webviewView.webview.postMessage(snapshot).then((accepted) => {
      if (!accepted) {
        this.markSnapshotSettled();
      }
    }, () => {
      this.markSnapshotSettled();
    });
  }

  private postFilterState(): void {
    if (!this.webviewView || !this.isReady) {
      return;
    }

    void this.webviewView.webview.postMessage({
      command: 'filterState',
      filterText: this.filterText
    });
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const nonce = this.getNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'edaExplorerView.js'));
    const csp = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} https:; style-src ${csp} 'unsafe-inline'; font-src ${csp}; script-src 'nonce-${nonce}' ${csp};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private getNonce(): string {
    return randomBytes(16).toString('hex');
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.snapshotInFlight = false;
    this.pendingSnapshot = false;
    this.clearSnapshotReleaseTimer();

    this.visibilityEmitter.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }
}
