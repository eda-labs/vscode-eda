import * as vscode from 'vscode';
import { BasePanel } from '../../basePanel';
import { serviceManager } from '../../../services/serviceManager';
import { EdaClient } from '../../../clients/edaClient';
import { KubernetesClient } from '../../../clients/kubernetesClient';
import { parseUpdateKey } from '../../../utils/parseUpdateKey';
import { getUpdates } from '../../../utils/streamMessageUtils';

export class ToponodesDashboardPanel extends BasePanel {
  private edaClient: EdaClient;
  private rowMap: Map<string, Map<string, Record<string, any>>> = new Map();
  private columns: string[] = [];
  private columnSet: Set<string> = new Set();
  private selectedNamespace = 'All Namespaces';

  constructor(context: vscode.ExtensionContext, title: string) {
    super(context, 'toponodesDashboard', title, undefined, {
      light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-black.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-white.svg')
    });

    this.edaClient = serviceManager.getClient<EdaClient>('eda');

    this.edaClient.onStreamMessage((stream, msg) => {
      if (stream === 'toponodes') {
        this.handleTopoNodeStream(msg);
      }
    });
    void this.edaClient.streamTopoNodes();

    this.panel.onDidDispose(() => {
      this.edaClient.closeTopoNodeStream();
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
          'toponodes'
        );
        await vscode.commands.executeCommand('vscode-eda.expandAllNamespaces');
      } else if (msg.command === 'viewNodeConfig') {
        await vscode.commands.executeCommand('vscode-eda.viewNodeConfig', {
          name: msg.name,
          namespace: msg.namespace,
        });
      } else if (msg.command === 'sshTopoNode') {
        await vscode.commands.executeCommand('vscode-eda.sshTopoNode', {
          name: msg.name,
          namespace: msg.namespace,
          nodeDetails: msg.nodeDetails,
        });
      }
    });

    this.panel.webview.html = this.buildHtml();
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'toponodesDashboard.js');
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

  private flatten(item: any): Record<string, any> {
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

  private async loadInitial(ns: string): Promise<void> {
    this.selectedNamespace = ns;
    const targetNamespaces =
      ns === 'All Namespaces'
        ? this.edaClient
            .getCachedNamespaces()
            .filter(n => n !== this.edaClient.getCoreNamespace())
        : [ns];
    for (const n of targetNamespaces) {
      try {
        const list = await this.edaClient.listTopoNodes(n);
        let map = this.rowMap.get(n);
        if (!map) {
          map = new Map();
          this.rowMap.set(n, map);
        }
        map.clear();
        for (const item of list) {
          const name = item.metadata?.name as string | undefined;
          if (!name) continue;
          const flat = this.flatten(item);
          this.ensureColumns(flat);
          map.set(name, flat);
        }
      } catch {
        /* ignore */
      }
    }
    this.postResults();
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

  private handleTopoNodeStream(msg: any): void {
    const updates = getUpdates(msg.msg);
    if (updates.length === 0) {
      return;
    }
    let changed = false;
    for (const up of updates) {
      let name: string | undefined = up.data?.metadata?.name;
      let namespace: string | undefined = up.data?.metadata?.namespace;
      if ((!name || !namespace) && up.key) {
        const parsed = parseUpdateKey(String(up.key));
        if (!name) name = parsed.name;
        if (!namespace) namespace = parsed.namespace;
      }
      if (!namespace || !name) {
        continue;
      }
      if (namespace === this.edaClient.getCoreNamespace()) {
        continue;
      }
      let map = this.rowMap.get(namespace);
      if (!map) {
        map = new Map();
        this.rowMap.set(namespace, map);
      }
      if (up.data === null) {
        changed = map.delete(name) || changed;
      } else {
        const flat = this.flatten(up.data);
        this.ensureColumns(flat);
        map.set(name, flat);
        changed = true;
      }
    }

    if (changed) {
      this.postResults();
    }
  }

  static show(context: vscode.ExtensionContext, title: string): void {
    new ToponodesDashboardPanel(context, title);
  }
}
