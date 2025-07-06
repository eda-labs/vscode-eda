import * as vscode from 'vscode';
import { BasePanel } from '../../basePanel';
import { topologyDashboardHtml } from './topologyDashboardPanel.html';
import { topologyDashboardStyles } from './topologyDashboardPanel.styles';
import { topologyDashboardScripts } from './topologyDashboardPanel.scripts';
import { serviceManager } from '../../../services/serviceManager';
import { EdaClient } from '../../../clients/edaClient';
import { parseUpdateKey } from '../../../utils/parseUpdateKey';

interface TierSelector {
  tier: number;
  nodeSelector?: string[];
}

export class TopologyDashboardPanel extends BasePanel {
  private edaClient: EdaClient;
  private nodeMap: Map<string, Map<string, any>> = new Map();
  private linkMap: Map<string, any[]> = new Map();
  private groupings: TierSelector[] = [];
  private selectedNamespace = 'All Namespaces';

  constructor(context: vscode.ExtensionContext, title: string) {
    super(context, 'topologyDashboard', title, undefined, {
      light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-black.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-white.svg')
    });

    this.edaClient = serviceManager.getClient<EdaClient>('eda');

    this.edaClient.onStreamMessage((stream, msg) => {
      if (stream === 'toponodes') {
        this.handleTopoNodeStream(msg);
      } else if (stream === 'topolinks') {
        this.handleTopoLinkStream(msg);
      }
    });
    void this.edaClient.streamTopoNodes();
    void this.edaClient.streamTopoLinks();

    this.panel.onDidDispose(() => {
      this.edaClient.closeTopoNodeStream();
      this.edaClient.closeTopoLinkStream();
    });

    this.panel.webview.onDidReceiveMessage(async msg => {
      if (msg.command === 'ready') {
        await this.sendNamespaces();
        await this.loadGroupings();
        await this.loadInitial('All Namespaces');
      } else if (msg.command === 'setNamespace') {
        await this.loadInitial(msg.namespace as string);
      }
    });

    this.panel.webview.html = this.buildHtml();
  }

  protected getHtml(): string {
    return topologyDashboardHtml;
  }

  protected getCustomStyles(): string {
    return topologyDashboardStyles;
  }

  protected getScripts(): string {
    const cytoscapeUri = this.getResourceUri('resources', 'cytoscape.min.js');
    const nodeIcon = this.getResourceUri('resources', 'node.svg');
    return `
      const cytoscapeUri = "${cytoscapeUri}";
      const nodeIcon = "${nodeIcon}";
      ${topologyDashboardScripts}
    `;
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
      selected: this.selectedNamespace
    });
  }

  private async loadGroupings(): Promise<void> {
    try {
      const list = await this.edaClient.listTopologyGroupings();
      if (Array.isArray(list) && list.length) {
        const grp = list[0]?.spec?.tierSelectors;
        if (Array.isArray(grp)) {
          this.groupings = grp.map((g: any) => ({
            tier: Number(g.tier) || 1,
            nodeSelector: Array.isArray(g.nodeSelector) ? g.nodeSelector : []
          }));
        }
      }
    } catch {
      /* ignore */
    }
  }

  private async loadInitial(ns: string): Promise<void> {
    this.selectedNamespace = ns;
    const target =
      ns === 'All Namespaces'
        ? this.edaClient
            .getCachedNamespaces()
            .filter(n => n !== this.edaClient.getCoreNamespace())
        : [ns];
    for (const n of target) {
      try {
        const nodes = await this.edaClient.listTopoNodes(n);
        const map = new Map<string, any>();
        for (const node of nodes) {
          const name = node.metadata?.name as string | undefined;
          if (!name) continue;
          map.set(name, node);
        }
        this.nodeMap.set(n, map);
        const links = await this.edaClient.listTopoLinks(n);
        this.linkMap.set(n, Array.isArray(links) ? links : []);
      } catch {
        /* ignore */
      }
    }
    this.postGraph();
  }

  private getTier(labels: Record<string, string>): number {
    for (const sel of this.groupings) {
      const { tier, nodeSelector } = sel;
      if (!nodeSelector || nodeSelector.length === 0) {
        return tier;
      }
      const match = nodeSelector.every(expr => {
        const [k, v] = expr.split('=');
        return labels?.[k] === v;
      });
      if (match) return tier;
    }
    return 1;
  }

  private postGraph(): void {
    const coreNs = this.edaClient.getCoreNamespace();
    const namespaces =
      this.selectedNamespace === 'All Namespaces'
        ? Array.from(this.nodeMap.keys()).filter(n => n !== coreNs)
        : [this.selectedNamespace];
    const nodes: { id: string; label: string; tier: number }[] = [];
    const edges: { source: string; target: string }[] = [];
    for (const ns of namespaces) {
      const nm = this.nodeMap.get(ns);
      if (nm) {
        for (const node of nm.values()) {
          const name = node.metadata?.name as string | undefined;
          if (!name) continue;
          const labels = node.metadata?.labels || {};
          const tier = this.getTier(labels);
          nodes.push({ id: `${ns}/${name}`, label: name, tier });
        }
      }
      const lm = this.linkMap.get(ns);
      if (lm) {
        for (const link of lm) {
          const arr = Array.isArray(link.spec?.links) ? link.spec.links : [];
          for (const l of arr) {
            const src = l.local?.node;
            const dst = l.remote?.node;
            if (src && dst) {
              edges.push({ source: `${ns}/${src}`, target: `${ns}/${dst}` });
            }
          }
        }
      }
    }
    this.panel.webview.postMessage({ command: 'data', nodes, edges });
  }

  private handleTopoNodeStream(msg: any): void {
    const updates = Array.isArray(msg.msg?.updates) ? msg.msg.updates : [];
    if (updates.length === 0) return;
    for (const up of updates) {
      let name: string | undefined = up.data?.metadata?.name;
      let ns: string | undefined = up.data?.metadata?.namespace;
      if ((!name || !ns) && up.key) {
        const parsed = parseUpdateKey(String(up.key));
        if (!name) name = parsed.name;
        if (!ns) ns = parsed.namespace;
      }
      if (!name || !ns) continue;
      if (ns === this.edaClient.getCoreNamespace()) continue;
      let map = this.nodeMap.get(ns);
      if (!map) {
        map = new Map();
        this.nodeMap.set(ns, map);
      }
      if (up.data === null) {
        map.delete(name);
      } else {
        map.set(name, up.data);
      }
    }
    this.postGraph();
  }

  private handleTopoLinkStream(msg: any): void {
    const updates = Array.isArray(msg.msg?.updates) ? msg.msg.updates : [];
    if (updates.length === 0) return;
    for (const up of updates) {
      let name: string | undefined = up.data?.metadata?.name;
      let ns: string | undefined = up.data?.metadata?.namespace;
      if ((!name || !ns) && up.key) {
        const parsed = parseUpdateKey(String(up.key));
        if (!name) name = parsed.name;
        if (!ns) ns = parsed.namespace;
      }
      if (!name || !ns) continue;
      if (ns === this.edaClient.getCoreNamespace()) continue;
      let list = this.linkMap.get(ns);
      if (!list) {
        list = [];
        this.linkMap.set(ns, list);
      }
      if (up.data === null) {
        const idx = list.findIndex(l => l.metadata?.name === name);
        if (idx >= 0) list.splice(idx, 1);
      } else {
        const idx = list.findIndex(l => l.metadata?.name === name);
        if (idx >= 0) list[idx] = up.data;
        else list.push(up.data);
      }
    }
    this.postGraph();
  }

  static show(context: vscode.ExtensionContext, title: string): void {
    new TopologyDashboardPanel(context, title);
  }
}
