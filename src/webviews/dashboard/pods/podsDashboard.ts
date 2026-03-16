import * as vscode from 'vscode';

import type { EdaClient } from '../../../clients/edaClient';
import type { KubernetesClient } from '../../../clients/kubernetesClient';
import { namespaceSelectionService } from '../../../services/namespaceSelectionService';
import { serviceManager } from '../../../services/serviceManager';
import { BasePanel } from '../../basePanel';
import { ALL_NAMESPACES } from '../../constants';

interface WebviewMessage {
  command: string;
  namespace?: string;
  name?: string;
}

interface PodResourceMetadata {
  name?: string;
  namespace?: string;
}

interface PodContainerStatus {
  restartCount?: number;
}

interface PodResourceStatus {
  phase?: string;
  podIP?: string;
  hostIP?: string;
  containerStatuses?: PodContainerStatus[];
}

interface PodResourceSpec {
  nodeName?: string;
}

interface PodResource {
  metadata?: PodResourceMetadata;
  spec?: PodResourceSpec;
  status?: PodResourceStatus;
}

interface PodRow {
  namespace: string;
  name: string;
  phase: string;
  podIP: string;
  node: string;
  restarts: number;
}

const POD_COLUMNS = ['namespace', 'name', 'phase', 'podIP', 'node', 'restarts'] as const;

export class PodsDashboardPanel extends BasePanel {
  private static currentPanel: PodsDashboardPanel | undefined;
  private kubernetesClient: KubernetesClient;
  private edaClient: EdaClient;
  private selectedNamespace = ALL_NAMESPACES;
  private disposables: vscode.Disposable[] = [];

  private constructor(context: vscode.ExtensionContext, title: string) {
    super(context, 'podsDashboard', title, undefined, BasePanel.getEdaIconPath(context));

    this.kubernetesClient = serviceManager.getClient<KubernetesClient>('kubernetes');
    this.edaClient = serviceManager.getClient<EdaClient>('eda');
    this.selectedNamespace = namespaceSelectionService.getSelectedNamespace();

    this.disposables.push(
      this.kubernetesClient.onResourceChanged(() => {
        this.refreshData();
      })
    );
    this.disposables.push(
      namespaceSelectionService.onDidChangeSelection((namespace) => {
        this.applyNamespaceSelection(namespace);
      })
    );

    this.panel.onDidDispose(() => {
      for (const disposable of this.disposables) {
        disposable.dispose();
      }
    });

    this.panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.visible) {
        this.reloadPanelData();
      }
    });

    this.panel.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      void this.handleWebviewMessage(msg);
    });

    this.panel.webview.html = this.buildHtml();
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'podsDashboard.js');
    return `<script type="module" nonce="${nonce}" src="${scriptUri}"></script>`;
  }

  private async handleWebviewMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.command) {
      case 'ready':
        this.postNamespaceSelection();
        this.loadInitial(this.selectedNamespace);
        break;
      case 'showInTree':
        await vscode.commands.executeCommand('vscode-eda.filterTree', 'pods');
        await vscode.commands.executeCommand('vscode-eda.expandAllNamespaces');
        break;
      case 'podLogs':
        await this.executePodCommand('vscode-eda.logsPod', msg);
        break;
      case 'describePod':
        await this.executePodCommand('vscode-eda.describePod', msg);
        break;
      case 'terminalPod':
        await this.executePodCommand('vscode-eda.terminalPod', msg);
        break;
      case 'deletePod':
        await this.executePodCommand('vscode-eda.deletePod', msg);
        break;
    }
  }

  private async executePodCommand(command: string, msg: WebviewMessage): Promise<void> {
    if (!msg.name || !msg.namespace) {
      return;
    }
    await vscode.commands.executeCommand(command, {
      name: msg.name,
      namespace: msg.namespace
    });
  }

  private postNamespaceSelection(): void {
    this.panel.webview.postMessage({
      command: 'init',
      selected: this.selectedNamespace,
      hasKubernetesContext: this.hasKubernetesContext()
    });
  }

  private applyNamespaceSelection(namespace: string): void {
    this.selectedNamespace = namespace;
    this.panel.webview.postMessage({
      command: 'namespace',
      selected: namespace
    });
    if (this.panel.visible) {
      this.loadInitial(namespace);
    }
  }

  private reloadPanelData(): void {
    this.postNamespaceSelection();
    this.loadInitial(this.selectedNamespace);
  }

  private refreshData(): void {
    if (!this.panel.visible) {
      return;
    }
    this.loadInitial(this.selectedNamespace);
  }

  private resolveTargetNamespaces(namespace: string): string[] {
    if (namespace !== ALL_NAMESPACES) {
      return [namespace];
    }

    const namespaces = new Set<string>();
    for (const cachedNamespace of this.kubernetesClient.getCachedNamespaces()) {
      if (cachedNamespace) {
        namespaces.add(cachedNamespace);
      }
    }
    for (const cachedNamespace of this.edaClient.getCachedNamespaces()) {
      if (cachedNamespace) {
        namespaces.add(cachedNamespace);
      }
    }
    const coreNamespace = this.edaClient.getCoreNamespace();
    if (coreNamespace) {
      namespaces.add(coreNamespace);
    }

    return Array.from(namespaces).sort((a, b) => a.localeCompare(b));
  }

  private extractPodRestartCount(pod: PodResource): number {
    const statuses = pod.status?.containerStatuses;
    if (!Array.isArray(statuses)) {
      return 0;
    }

    let restarts = 0;
    for (const status of statuses) {
      if (typeof status.restartCount === 'number') {
        restarts += status.restartCount;
      }
    }
    return restarts;
  }

  private toPodRow(pod: PodResource, namespace: string): PodRow | undefined {
    const name = pod.metadata?.name;
    if (!name) {
      return undefined;
    }

    return {
      namespace: pod.metadata?.namespace || namespace,
      name,
      phase: pod.status?.phase || 'Unknown',
      podIP: pod.status?.podIP || '',
      node: pod.spec?.nodeName || pod.status?.hostIP || '',
      restarts: this.extractPodRestartCount(pod)
    };
  }

  private loadInitial(namespace: string): void {
    this.selectedNamespace = namespace;

    const rows: PodRow[] = [];
    const seen = new Set<string>();
    const targetNamespaces = this.resolveTargetNamespaces(namespace);

    for (const targetNamespace of targetNamespaces) {
      const pods = this.kubernetesClient.getCachedPods(targetNamespace) as PodResource[];
      for (const pod of pods) {
        const row = this.toPodRow(pod, targetNamespace);
        if (!row) {
          continue;
        }
        const key = `${row.namespace}/${row.name}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        rows.push(row);
      }
    }

    this.postResults(rows);
  }

  private postResults(rows: PodRow[]): void {
    const sortedRows = [...rows].sort((a, b) =>
      a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name)
    );

    const rowValues = sortedRows.map(row => POD_COLUMNS.map(column => row[column]));
    this.panel.webview.postMessage({
      command: 'results',
      columns: [...POD_COLUMNS],
      rows: rowValues,
      status: `Count: ${rowValues.length}`,
      hasKubernetesContext: this.hasKubernetesContext()
    });
  }

  private hasKubernetesContext(): boolean {
    try {
      const context = this.kubernetesClient.getCurrentContext();
      return Boolean(context && context !== 'none');
    } catch {
      return false;
    }
  }

  static show(context: vscode.ExtensionContext, title: string): PodsDashboardPanel {
    if (!serviceManager.getClientNames().includes('kubernetes')) {
      void vscode.window.showWarningMessage('Pods dashboard requires a configured Kubernetes context for this target.');
      throw new Error('Kubernetes client is not configured. Configure a Kubernetes context for the target first.');
    }

    if (PodsDashboardPanel.currentPanel) {
      const wasVisible = PodsDashboardPanel.currentPanel.panel.visible;
      PodsDashboardPanel.currentPanel.panel.title = title;
      PodsDashboardPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
      if (wasVisible) {
        PodsDashboardPanel.currentPanel.reloadPanelData();
      }
      return PodsDashboardPanel.currentPanel;
    }

    const panel = new PodsDashboardPanel(context, title);
    PodsDashboardPanel.currentPanel = panel;
    panel.panel.onDidDispose(() => {
      if (PodsDashboardPanel.currentPanel === panel) {
        PodsDashboardPanel.currentPanel = undefined;
      }
    });
    return panel;
  }
}
