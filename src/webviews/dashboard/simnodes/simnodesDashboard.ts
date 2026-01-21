import * as vscode from 'vscode';
import { BasePanel } from '../../basePanel';
import { serviceManager } from '../../../services/serviceManager';
import { KubernetesClient } from '../../../clients/kubernetesClient';
import { EdaClient } from '../../../clients/edaClient';

export class SimnodesDashboardPanel extends BasePanel {
  private kubernetesClient: KubernetesClient;
  private edaClient: EdaClient;
  private rowMap: Map<string, Map<string, Record<string, any>>> = new Map();
  private columns: string[] = [];
  private columnSet: Set<string> = new Set();
  private selectedNamespace = 'All Namespaces';
  private disposables: vscode.Disposable[] = [];

  constructor(context: vscode.ExtensionContext, title: string) {
    super(context, 'simnodesDashboard', title, undefined, {
      light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-black.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-white.svg')
    });

    this.kubernetesClient = serviceManager.getClient<KubernetesClient>('kubernetes');
    this.edaClient = serviceManager.getClient<EdaClient>('eda');

    // Listen for resource changes to refresh data
    this.disposables.push(
      this.kubernetesClient.onResourceChanged(() => {
        void this.refreshData();
      })
    );

    this.panel.onDidDispose(() => {
      for (const d of this.disposables) {
        d.dispose();
      }
    });

    this.panel.webview.onDidReceiveMessage(async msg => {
      if (msg.command === 'ready') {
        await this.sendNamespaces();
        await this.loadInitial('All Namespaces');
      } else if (msg.command === 'setNamespace') {
        await this.loadInitial(msg.namespace as string);
      } else if (msg.command === 'showInTree') {
        await vscode.commands.executeCommand(
          'vscode-eda.filterTree',
          'simnodes'
        );
        await vscode.commands.executeCommand('vscode-eda.expandAllNamespaces');
      } else if (msg.command === 'viewSimnodeYaml') {
        await this.viewSimnodeYaml(msg.name, msg.namespace);
      } else if (msg.command === 'sshSimnode') {
        await this.sshSimnode(msg.name, msg.namespace, msg.operatingSystem);
      }
    });

    this.panel.webview.html = this.buildHtml();
  }

  protected getHtml(): string {
    return '<div id="root"></div>';
  }

  protected getCustomStyles(): string {
    return this.readWebviewFile('dashboard', 'simnodes', 'simnodesDashboard.css');
  }

  protected getScripts(): string {
    return '';
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'simnodesDashboard.js');
    return `<script nonce="${nonce}" src="${scriptUri}"></script>`;
  }

  private async sendNamespaces(): Promise<void> {
    const coreNs = this.edaClient.getCoreNamespace();
    const namespaces = this.edaClient
      .getCachedNamespaces()
      .filter(ns => ns !== coreNs);
    namespaces.unshift('All Namespaces');
    this.panel.webview.postMessage({
      command: 'init',
      namespaces,
      selected: this.selectedNamespace,
      hasKubernetesContext: this.hasKubernetesContext()
    });
  }

  private flattenObject(obj: any, prefix = ''): Record<string, any> {
    const result: Record<string, any> = {};
    if (!obj || typeof obj !== 'object') {
      return result;
    }
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        Object.assign(result, this.flattenObject(v, key));
      } else {
        result[key] = v;
      }
    }
    return result;
  }

  private flatten(item: any, podStatus?: string): Record<string, any> {
    const result: Record<string, any> = {};
    if (!item || typeof item !== 'object') {
      return result;
    }
    const meta = item.metadata || {};
    if (meta.name) result.name = meta.name;
    if (meta.namespace) result.namespace = meta.namespace;
    if (meta.labels && typeof meta.labels === 'object') {
      const labels = Object.entries(meta.labels)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
      result.labels = labels;
    }
    if (item.spec) {
      Object.assign(result, this.flattenObject(item.spec));
    }
    if (item.status) {
      Object.assign(result, this.flattenObject(item.status));
    }
    // Add pod status if available
    if (podStatus) {
      result['pod-status'] = podStatus;
    }
    return result;
  }

  private ensureColumns(data: Record<string, any>): boolean {
    let added = false;
    for (const key of Object.keys(data)) {
      if (!this.columnSet.has(key)) {
        this.columnSet.add(key);
        added = true;
      }
    }
    if (added) {
      this.columns = Array.from(this.columnSet);
    }
    return added;
  }

  private getPodStatusForSimnode(name: string, namespace: string): string {
    // Pods are in eda-system with naming pattern: cx-{namespace}--{name}-sim-*
    const coreNs = this.edaClient.getCoreNamespace();
    const pods = this.kubernetesClient.getCachedPods(coreNs);

    // Find pod matching this simnode
    const matchingPod = pods.find((pod: any) => {
      const labels = pod.metadata?.labels || {};
      return labels['cx-pod-name'] === name && labels['cx-node-namespace'] === namespace;
    });

    if (!matchingPod) {
      return 'No Pod';
    }

    const phase = matchingPod.status?.phase || 'Unknown';
    const containerStatuses = matchingPod.status?.containerStatuses || [];
    const ready = containerStatuses.every((c: any) => c.ready);

    if (phase === 'Running' && ready) {
      return 'Running';
    } else if (phase === 'Running') {
      return 'Starting';
    }
    return phase;
  }

  private async loadInitial(ns: string): Promise<void> {
    this.selectedNamespace = ns;
    const coreNs = this.edaClient.getCoreNamespace();
    const targetNamespaces =
      ns === 'All Namespaces'
        ? this.edaClient
            .getCachedNamespaces()
            .filter(n => n !== coreNs)
        : [ns];

    // Clear existing data
    this.rowMap.clear();
    this.columnSet.clear();
    this.columns = [];

    for (const n of targetNamespaces) {
      try {
        const simnodes = this.kubernetesClient.getCachedSimnodes(n);
        let map = this.rowMap.get(n);
        if (!map) {
          map = new Map();
          this.rowMap.set(n, map);
        }
        map.clear();
        for (const item of simnodes) {
          const name = item.metadata?.name as string | undefined;
          if (!name) continue;
          const podStatus = this.getPodStatusForSimnode(name, n);
          const flat = this.flatten(item, podStatus);
          this.ensureColumns(flat);
          map.set(name, flat);
        }
      } catch {
        /* ignore */
      }
    }
    this.postResults();
  }

  private async refreshData(): Promise<void> {
    // Only refresh if panel is visible
    if (!this.panel.visible) {
      return;
    }
    await this.loadInitial(this.selectedNamespace);
  }

  private postResults(): void {
    const coreNs = this.edaClient.getCoreNamespace();
    const namespaces =
      this.selectedNamespace === 'All Namespaces'
        ? Array.from(this.rowMap.keys()).filter(n => n !== coreNs)
        : [this.selectedNamespace];

    const rows: any[][] = [];
    for (const ns of namespaces) {
      const map = this.rowMap.get(ns);
      if (!map) continue;
      for (const data of map.values()) {
        const row = this.columns.map(c => data[c]);
        rows.push(row);
      }
    }

    this.panel.webview.postMessage({
      command: 'results',
      columns: this.columns,
      rows,
      status: `Count: ${rows.length}`,
      hasKubernetesContext: this.hasKubernetesContext()
    });
  }

  private hasKubernetesContext(): boolean {
    if (!serviceManager.getClientNames().includes('kubernetes')) {
      return false;
    }
    try {
      const client = serviceManager.getClient<KubernetesClient>('kubernetes');
      const ctx = client.getCurrentContext();
      return Boolean(ctx && ctx !== 'none');
    } catch {
      return false;
    }
  }

  private async viewSimnodeYaml(name: string, namespace: string): Promise<void> {
    try {
      const yaml = await this.kubernetesClient.getCustomResourceYaml(
        'core.eda.nokia.com',
        'v1',
        'simnodes',
        name,
        namespace
      );
      const doc = await vscode.workspace.openTextDocument({
        content: yaml,
        language: 'yaml'
      });
      await vscode.window.showTextDocument(doc);
    } catch (err) {
      void vscode.window.showErrorMessage(`Failed to get simnode YAML: ${err}`);
    }
  }

  private async sshSimnode(name: string, namespace: string, operatingSystem?: string): Promise<void> {
    // Find the pod for this simnode
    const coreNs = this.edaClient.getCoreNamespace();
    const pods = this.kubernetesClient.getCachedPods(coreNs);

    const matchingPod = pods.find((pod: any) => {
      const labels = pod.metadata?.labels || {};
      return labels['cx-pod-name'] === name && labels['cx-node-namespace'] === namespace;
    });

    if (!matchingPod) {
      void vscode.window.showErrorMessage(`No pod found for simnode ${name}`);
      return;
    }

    const podName = matchingPod.metadata?.name;
    const containerName = name; // Container name matches simnode name

    // Determine shell command based on operating system
    // SRL nodes use sr_cli, Linux nodes use bash
    const shellCmd = operatingSystem === 'srl' ? 'sudo sr_cli' : 'bash';

    const terminal = vscode.window.createTerminal(`SSH: ${name}`);
    terminal.show();
    terminal.sendText(`kubectl exec -it -n ${coreNs} ${podName} -c ${containerName} -- ${shellCmd}`);
  }

  static show(context: vscode.ExtensionContext, title: string): void {
    new SimnodesDashboardPanel(context, title);
  }
}
