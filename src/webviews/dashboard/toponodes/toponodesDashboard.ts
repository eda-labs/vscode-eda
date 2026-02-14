import * as vscode from 'vscode';

import { BasePanel } from '../../basePanel';
import { ALL_NAMESPACES } from '../../constants';
import { serviceManager } from '../../../services/serviceManager';
import type { EdaClient } from '../../../clients/edaClient';
import type { KubernetesClient } from '../../../clients/kubernetesClient';
import { parseUpdateKey } from '../../../utils/parseUpdateKey';
import { getUpdates } from '../../../utils/streamMessageUtils';

/** Webview message received from the React frontend */
interface WebviewMessage {
  command: string;
  namespace?: string;
  name?: string;
  nodeDetails?: unknown;
}

/** Stream message wrapper from EDA client */
interface TopoNodeStreamMessage {
  msg: TopoNodeStreamPayload;
}

/** Stream message payload containing updates */
interface TopoNodeStreamPayload {
  updates?: TopoNodeStreamUpdate[];
  Updates?: TopoNodeStreamUpdate[];
}

/** Individual update in stream messages */
interface TopoNodeStreamUpdate {
  key?: string;
  data: K8sResourceData | null;
}

/** Kubernetes resource metadata */
interface K8sMetadata {
  name?: string;
  namespace?: string;
  labels?: Record<string, string>;
}

/** Kubernetes resource data structure */
interface K8sResourceData {
  metadata?: K8sMetadata;
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
}

/** Flattened row data for display */
type FlattenedRow = Record<string, unknown>;

export class ToponodesDashboardPanel extends BasePanel {
  private static currentPanel: ToponodesDashboardPanel | undefined;
  private edaClient: EdaClient;
  private streamDisposable: { dispose(): void } | undefined;
  private rowMap: Map<string, Map<string, FlattenedRow>> = new Map();
  private columns: string[] = [];
  private columnSet: Set<string> = new Set();
  private selectedNamespace = ALL_NAMESPACES;

  private constructor(context: vscode.ExtensionContext, title: string) {
    super(context, 'toponodesDashboard', title, undefined, BasePanel.getEdaIconPath(context));

    this.edaClient = serviceManager.getClient<EdaClient>('eda');

    this.streamDisposable = this.edaClient.onStreamMessage((stream, msg) => {
      if (stream === 'toponodes') {
        this.handleTopoNodeStream(msg as TopoNodeStreamMessage);
      }
    });

    this.panel.onDidDispose(() => {
      this.streamDisposable?.dispose();
      this.edaClient.closeTopoNodeStream();
    });

    this.panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      await this.handleWebviewMessage(msg);
    });

    this.panel.webview.html = this.buildHtml();
  }

  private async initialize(): Promise<void> {
    await this.edaClient.streamTopoNodes();
  }

  private async handleWebviewMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.command) {
      case 'ready':
        this.sendNamespaces();
        await this.loadInitial(ALL_NAMESPACES);
        break;
      case 'setNamespace':
        await this.loadInitial(msg.namespace ?? ALL_NAMESPACES);
        break;
      case 'showInTree':
        await vscode.commands.executeCommand('vscode-eda.filterTree', 'toponodes');
        await vscode.commands.executeCommand('vscode-eda.expandAllNamespaces');
        break;
      case 'viewNodeConfig':
        await vscode.commands.executeCommand('vscode-eda.viewNodeConfig', {
          name: msg.name,
          namespace: msg.namespace,
        });
        break;
      case 'sshTopoNode':
        await vscode.commands.executeCommand('vscode-eda.sshTopoNode', {
          name: msg.name,
          namespace: msg.namespace,
          nodeDetails: msg.nodeDetails,
        });
        break;
    }
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'toponodesDashboard.js');
    return `<script type="module" nonce="${nonce}" src="${scriptUri}"></script>`;
  }

  private sendNamespaces(): void {
    const coreNs = this.edaClient.getCoreNamespace();
    const namespaces = this.edaClient
      .getCachedNamespaces()
      .filter(ns => ns !== coreNs);
    namespaces.unshift(ALL_NAMESPACES);
    this.panel.webview.postMessage({
      command: 'init',
      namespaces,
      selected: this.selectedNamespace,
      hasKubernetesContext: this.hasKubernetesContext()
    });
  }

  private flattenObject(obj: Record<string, unknown>, prefix = ''): FlattenedRow {
    const result: FlattenedRow = {};
    if (!obj || typeof obj !== 'object') {
      return result;
    }
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        Object.assign(result, this.flattenObject(v as Record<string, unknown>, key));
      } else {
        result[key] = v;
      }
    }
    return result;
  }

  private flatten(item: K8sResourceData): FlattenedRow {
    const result: FlattenedRow = {};
    if (!item || typeof item !== 'object') {
      return result;
    }
    const meta = item.metadata ?? {};
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

  private ensureColumns(data: FlattenedRow): boolean {
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
      ns === ALL_NAMESPACES
        ? this.edaClient
            .getCachedNamespaces()
            .filter(n => n !== this.edaClient.getCoreNamespace())
        : [ns];
    for (const n of targetNamespaces) {
      try {
        const list = (await this.edaClient.listTopoNodes(n)) as K8sResourceData[];
        let map = this.rowMap.get(n);
        if (!map) {
          map = new Map();
          this.rowMap.set(n, map);
        }
        map.clear();
        for (const item of list) {
          const name = item.metadata?.name;
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
      this.selectedNamespace === ALL_NAMESPACES
        ? Array.from(this.rowMap.keys()).filter(n => n !== coreNs)
        : [this.selectedNamespace];

    const rows: unknown[][] = [];
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

  private extractUpdateIdentifiers(up: TopoNodeStreamUpdate): { name: string | undefined; namespace: string | undefined } {
    let name: string | undefined = up.data?.metadata?.name;
    let namespace: string | undefined = up.data?.metadata?.namespace;
    if ((!name || !namespace) && up.key) {
      const parsed = parseUpdateKey(String(up.key));
      if (!name) name = parsed.name;
      if (!namespace) namespace = parsed.namespace;
    }
    return { name, namespace };
  }

  private getOrCreateNamespaceMap(namespace: string): Map<string, FlattenedRow> {
    let map = this.rowMap.get(namespace);
    if (!map) {
      map = new Map();
      this.rowMap.set(namespace, map);
    }
    return map;
  }

  private processUpdate(up: TopoNodeStreamUpdate, map: Map<string, FlattenedRow>, name: string): boolean {
    if (up.data === null) {
      return map.delete(name);
    }
    const flat = this.flatten(up.data);
    this.ensureColumns(flat);
    map.set(name, flat);
    return true;
  }

  private handleTopoNodeStream(msg: TopoNodeStreamMessage): void {
    const updates = getUpdates(msg.msg) as TopoNodeStreamUpdate[];
    if (updates.length === 0) {
      return;
    }

    let changed = false;
    const coreNs = this.edaClient.getCoreNamespace();

    for (const up of updates) {
      const { name, namespace } = this.extractUpdateIdentifiers(up);
      if (!namespace || !name || namespace === coreNs) {
        continue;
      }
      const map = this.getOrCreateNamespaceMap(namespace);
      changed = this.processUpdate(up, map, name) || changed;
    }

    if (changed) {
      this.postResults();
    }
  }

  static show(context: vscode.ExtensionContext, title: string): ToponodesDashboardPanel {
    if (ToponodesDashboardPanel.currentPanel) {
      ToponodesDashboardPanel.currentPanel.panel.title = title;
      ToponodesDashboardPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
      return ToponodesDashboardPanel.currentPanel;
    }

    const panel = new ToponodesDashboardPanel(context, title);
    void panel.initialize();
    ToponodesDashboardPanel.currentPanel = panel;
    panel.panel.onDidDispose(() => {
      if (ToponodesDashboardPanel.currentPanel === panel) {
        ToponodesDashboardPanel.currentPanel = undefined;
      }
    });
    return panel;
  }
}
