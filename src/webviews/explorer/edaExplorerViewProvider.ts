import { randomBytes } from 'crypto';

import * as vscode from 'vscode';

import type { TreeItemBase } from '../../providers/views/treeItem';
import type {
  ExplorerInvokeCommandMessage,
  ExplorerOutgoingMessage,
  ExplorerSetFilterMessage
} from '../shared/explorer/types';

import { buildExplorerSnapshot, type ExplorerSnapshotProviders } from './explorerSnapshotAdapter';

const REFRESH_DEBOUNCE_MS = 120;

interface FilterableTreeProvider {
  setTreeFilter(filterText: string): void;
  clearTreeFilter(): void;
  onDidChangeTreeData: vscode.Event<TreeItemBase | undefined | null | void>;
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
  private readonly disposables: vscode.Disposable[] = [];
  private readonly visibilityEmitter = new vscode.EventEmitter<boolean>();

  private webviewView?: vscode.WebviewView;
  private isReady = false;
  private filterText = '';
  private refreshTimer?: ReturnType<typeof setTimeout>;

  public readonly onDidChangeVisibility = this.visibilityEmitter.event;

  constructor(context: vscode.ExtensionContext, providers: ExplorerSnapshotProviders) {
    this.context = context;
    this.providers = providers;
    this.filterableProviders = [
      providers.dashboardProvider,
      providers.namespaceProvider,
      providers.alarmProvider,
      providers.deviationProvider,
      providers.basketProvider,
      providers.transactionProvider,
      providers.helpProvider
    ];

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
          this.scheduleSnapshot(0);
        }
      })
    );

    this.disposables.push(
      webviewView.onDidDispose(() => {
        this.isReady = false;
        this.webviewView = undefined;
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
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.postSnapshot();
    }, delay);
  }

  private postSnapshot(): void {
    if (!this.webviewView || !this.isReady) {
      return;
    }

    const snapshot = buildExplorerSnapshot(this.providers, this.filterText);
    void this.webviewView.webview.postMessage(snapshot);
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

    this.visibilityEmitter.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }
}
