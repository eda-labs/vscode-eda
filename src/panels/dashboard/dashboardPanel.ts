import * as vscode from 'vscode';
import { BasePanel } from '../basePanel';
import { dashboardStyles } from './dashboardPanel.styles';
import { dashboardHtml } from './dashboardPanel.html';
import { dashboardScripts } from './dashboardPanel.scripts';
import { serviceManager } from '../../services/serviceManager';
import { EdaClient } from '../../clients/edaClient';
import { parseUpdateKey } from '../../utils/parseUpdateKey';

export class DashboardPanel extends BasePanel {
  private edaClient: EdaClient;
  private nodeMap: Map<string, Map<string, string>> = new Map();
  private interfaceMap: Map<string, Map<string, string>> = new Map();
  private trafficMap: Map<string, { in: number; out: number }> = new Map();
  private selectedNamespace = 'All Namespaces';
  private initialized = false;

  constructor(context: vscode.ExtensionContext, title: string) {
    super(context, 'edaDashboard', title);

    this.edaClient = serviceManager.getClient<EdaClient>('eda');

    this.edaClient.onStreamMessage((stream, msg) => {
      if (stream === 'toponodes') {
        this.handleTopoNodeStream(msg);
      } else if (stream === 'interfaces') {
        this.handleInterfaceStream(msg);
      } else if (stream === 'eql') {
        this.handleTrafficStream(msg);
      }
    });
    void this.edaClient.streamTopoNodes();
    void this.edaClient.streamInterfaces();

    this.panel.onDidDispose(() => {
      this.edaClient.closeTopoNodeStream();
      this.edaClient.closeInterfaceStream?.();
      this.edaClient.closeEqlStream();
    });

    this.panel.webview.onDidReceiveMessage(async msg => {
      if (msg.command === 'ready') {
        await this.sendNamespaces();
        await this.sendTopoNodeStats('All Namespaces');
        await this.sendInterfaceStats('All Namespaces');
        await this.sendTrafficStats('All Namespaces');
      } else if (msg.command === 'getTopoNodeStats') {
        await this.sendTopoNodeStats(msg.namespace as string);
        await this.sendInterfaceStats(msg.namespace as string);
        await this.sendTrafficStats(msg.namespace as string);
      }
    });

    this.panel.webview.html = this.buildHtml();
  }

  protected getHtml(): string {
    return dashboardHtml;
  }

  protected getCustomStyles(): string {
    return dashboardStyles;
  }

  protected getScripts(): string {
    const echartsJs = this.getResourceUri('resources', 'echarts.min.js');

    return `
      const echartsJsUri = "${echartsJs}";
      ${dashboardScripts}
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
    if (!this.initialized) {
      await this.initializeNodeData(namespaces);
      await this.initializeInterfaceData(namespaces);
      this.initialized = true;
    }
  }

  private async sendTopoNodeStats(ns: string): Promise<void> {
    this.selectedNamespace = ns;
    if (!this.initialized) {
      const coreNs = this.edaClient.getCoreNamespace();
      const all = this.edaClient
        .getCachedNamespaces()
        .filter(n => n !== coreNs);
      await this.initializeNodeData(all);
      this.initialized = true;
    }
    const stats = this.computeStats(ns);
    this.panel.webview.postMessage({
      command: 'topoNodeStats',
      namespace: ns,
      stats
    });
  }

  private async initializeNodeData(namespaces: string[]): Promise<void> {
    for (const ns of namespaces) {
      try {
        const nodes = await this.edaClient.listTopoNodes(ns);
        const map = new Map<string, string>();
        for (const node of nodes) {
          const name = node.metadata?.name as string | undefined;
          if (!name) continue;
          const state = node.status?.['node-state'] ?? node.status?.nodeState ?? '';
          map.set(name, state);
        }
        this.nodeMap.set(ns, map);
      } catch {
        /* ignore */
      }
    }
  }

  private handleTopoNodeStream(msg: any): void {
    const updates = Array.isArray(msg.msg?.updates) ? msg.msg.updates : [];
    if (updates.length === 0) {
      return;
    }
    const changed = new Set<string>();
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
      let map = this.nodeMap.get(namespace);
      if (!map) {
        map = new Map();
        this.nodeMap.set(namespace, map);
      }
      if (up.data === null) {
        map.delete(name);
      } else {
        const state = up.data?.status?.['node-state'] ?? up.data?.status?.nodeState ?? '';
        map.set(name, state);
      }
      changed.add(namespace);
    }
    if (
      this.selectedNamespace === 'All Namespaces' ||
      changed.has(this.selectedNamespace)
    ) {
      const stats = this.computeStats(this.selectedNamespace);
      this.panel.webview.postMessage({
        command: 'topoNodeStats',
        namespace: this.selectedNamespace,
        stats
      });
    }
  }

  private computeStats(ns: string): { total: number; synced: number; notSynced: number } {
    const coreNs = this.edaClient.getCoreNamespace();
    const namespaces = ns === 'All Namespaces'
      ? Array.from(this.nodeMap.keys()).filter(n => n !== coreNs)
      : [ns];
    let total = 0;
    let synced = 0;
    for (const n of namespaces) {
      const map = this.nodeMap.get(n);
      if (!map) continue;
      total += map.size;
      for (const state of map.values()) {
        if (state && state.toLowerCase() === 'synced') {
          synced += 1;
        }
      }
    }
    const notSynced = total - synced;
    return { total, synced, notSynced };
  }

  private async initializeInterfaceData(namespaces: string[]): Promise<void> {
    for (const ns of namespaces) {
      try {
        const ifaces = await this.edaClient.listInterfaces(ns);
        const map = new Map<string, string>();
        for (const iface of ifaces) {
          const name = iface.metadata?.name as string | undefined;
          if (!name) continue;
          const state =
            iface.status?.operationalState ?? iface.status?.operationalstate ?? '';
          map.set(name, state);
        }
        this.interfaceMap.set(ns, map);
      } catch {
        /* ignore */
      }
    }
  }

  private computeInterfaceStats(ns: string): { total: number; up: number; down: number } {
    const coreNs = this.edaClient.getCoreNamespace();
    const namespaces = ns === 'All Namespaces'
      ? Array.from(this.interfaceMap.keys()).filter(n => n !== coreNs)
      : [ns];
    let total = 0;
    let up = 0;
    for (const n of namespaces) {
      const map = this.interfaceMap.get(n);
      if (!map) continue;
      total += map.size;
      for (const state of map.values()) {
        if (state && state.toLowerCase() === 'up') {
          up += 1;
        }
      }
    }
    const down = total - up;
    return { total, up, down };
  }

  private handleInterfaceStream(msg: any): void {
    const updates = Array.isArray(msg.msg?.updates) ? msg.msg.updates : [];
    if (updates.length === 0) {
      return;
    }
    const changed = new Set<string>();
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
      let map = this.interfaceMap.get(namespace);
      if (!map) {
        map = new Map();
        this.interfaceMap.set(namespace, map);
      }
      if (up.data === null) {
        map.delete(name);
      } else {
        const state =
          up.data?.status?.operationalState ?? up.data?.status?.operationalstate ?? '';
        map.set(name, state);
      }
      changed.add(namespace);
    }
    if (
      this.selectedNamespace === 'All Namespaces' ||
      changed.has(this.selectedNamespace)
    ) {
      const stats = this.computeInterfaceStats(this.selectedNamespace);
      this.panel.webview.postMessage({
        command: 'interfaceStats',
        namespace: this.selectedNamespace,
        stats
      });
    }
  }

  private async sendInterfaceStats(ns: string): Promise<void> {
    if (!this.initialized) {
      const coreNs = this.edaClient.getCoreNamespace();
      const all = this.edaClient
        .getCachedNamespaces()
        .filter(n => n !== coreNs);
      await this.initializeInterfaceData(all);
      this.initialized = true;
    }
    const stats = this.computeInterfaceStats(ns);
    this.panel.webview.postMessage({
      command: 'interfaceStats',
      namespace: ns,
      stats
    });
  }

  private handleTrafficStream(msg: any): void {
    const rows = msg.msg?.op?.[0]?.insert_or_modify?.rows;
    if (!Array.isArray(rows) || rows.length === 0) return;
    const data = rows[0]?.data;
    if (!data) return;
    const stats = {
      in: Number(data['SUM(in-bps)'] ?? 0),
      out: Number(data['SUM(out-bps)'] ?? 0)
    };
    this.trafficMap.set(this.selectedNamespace, stats);
    this.panel.webview.postMessage({
      command: 'trafficStats',
      namespace: this.selectedNamespace,
      stats
    });
  }

  private async sendTrafficStats(ns: string): Promise<void> {
    // Close previous stream before starting a new one
    this.edaClient.closeEqlStream();

    // Clear traffic data when switching namespaces
    this.trafficMap.clear();

    // Send initial empty data to clear the chart
    this.panel.webview.postMessage({
      command: 'clearTrafficData'
    });

    const query =
      '.namespace.node.srl.interface.traffic-rate fields [sum(in-bps), sum(out-bps)]';
    const namespaces = ns === 'All Namespaces' ? undefined : ns;
    await this.edaClient.streamEql(query, namespaces);
  }

  static show(context: vscode.ExtensionContext, title: string): void {
    new DashboardPanel(context, title);
  }
}