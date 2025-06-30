import * as vscode from 'vscode';
import { BasePanel } from '../basePanel';
import { dashboardStyles } from './dashboardPanel.styles';
import { dashboardHtml } from './dashboardPanel.html';
import { dashboardScripts } from './dashboardPanel.scripts';
import { serviceManager } from '../../services/serviceManager';
import { EdaClient } from '../../clients/edaClient';
import { parseUpdateKey } from '../../utils/parseUpdateKey';

interface NodeGroupStats {
  nodes: Set<string>;
  health: number;
}

interface FabricStats {
  leafs: NodeGroupStats;
  borderleafs: NodeGroupStats;
  spines: NodeGroupStats;
  superspines: NodeGroupStats;
  health: number;
}

export class DashboardPanel extends BasePanel {
  private edaClient: EdaClient;
  private nodeMap: Map<string, Map<string, string>> = new Map();
  private interfaceMap: Map<string, Map<string, string>> = new Map();
  private trafficMap: Map<string, { in: number; out: number }> = new Map();
  private fabricMap: Map<string, FabricStats> = new Map();
  private selectedNamespace = 'All Namespaces';
  private trafficStreamName = 'traffic-all';
  private leafStreamName = 'leaf-all';
  private borderLeafStreamName = 'borderleaf-all';
  private spineStreamName = 'spine-all';
  private superSpineStreamName = 'superspine-all';
  private fabricStatusStreamName = 'fabricstatus-all';
  private initialized = false;

  private get fabricQueryBase(): string {
    return '.namespace.resources.cr-status.fabrics_eda_nokia_com.v1alpha1.fabric.status';
  }

  constructor(context: vscode.ExtensionContext, title: string) {
    super(context, 'edaDashboard', title);

    this.edaClient = serviceManager.getClient<EdaClient>('eda');

    this.edaClient.onStreamMessage((stream, msg) => {
      if (stream === 'toponodes') {
        this.handleTopoNodeStream(msg);
      } else if (stream === 'interfaces') {
        this.handleInterfaceStream(msg);
      } else if (stream === this.trafficStreamName) {
        this.handleTrafficStream(msg);
      } else if (stream === this.leafStreamName) {
        this.handleLeafStream(msg);
      } else if (stream === this.spineStreamName) {
        this.handleSpineStream(msg);
      } else if (stream === this.borderLeafStreamName) {
        this.handleBorderLeafStream(msg);
      } else if (stream === this.superSpineStreamName) {
        this.handleSuperSpineStream(msg);
      } else if (stream === this.fabricStatusStreamName) {
        this.handleFabricStatusStream(msg);
      }
    });
    void this.edaClient.streamTopoNodes();
    void this.edaClient.streamInterfaces();

    this.panel.onDidDispose(() => {
      this.edaClient.closeTopoNodeStream();
      this.edaClient.closeInterfaceStream?.();
      this.edaClient.closeEqlStream(this.trafficStreamName);
      this.closeFabricStreams();
    });

    this.panel.webview.onDidReceiveMessage(async msg => {
      if (msg.command === 'ready') {
        await this.sendNamespaces();
        await this.sendTopoNodeStats('All Namespaces');
        await this.sendInterfaceStats('All Namespaces');
        await this.sendTrafficStats('All Namespaces');
        await this.sendFabricStats('All Namespaces');
      } else if (msg.command === 'getTopoNodeStats') {
        await this.sendTopoNodeStats(msg.namespace as string);
        await this.sendInterfaceStats(msg.namespace as string);
        await this.sendTrafficStats(msg.namespace as string);
        await this.sendFabricStats(msg.namespace as string);
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
      await this.initializeFabricData(namespaces);
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
      await this.initializeInterfaceData(all);
      await this.initializeFabricData(all);
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

  private async initializeFabricData(namespaces: string[]): Promise<void> {
    for (const ns of namespaces) {
      this.fabricMap.set(ns, {
        leafs: { nodes: new Set(), health: 0 },
        borderleafs: { nodes: new Set(), health: 0 },
        spines: { nodes: new Set(), health: 0 },
        superspines: { nodes: new Set(), health: 0 },
        health: 0
      });
    }
  }

  private computeFabricStats(ns: string): {
    spines: { count: number; health: number };
    leafs: { count: number; health: number };
    borderleafs: { count: number; health: number };
    superspines: { count: number; health: number };
    fabricHealth: number;
  } {
    const coreNs = this.edaClient.getCoreNamespace();
    const namespaces = ns === 'All Namespaces'
      ? Array.from(this.fabricMap.keys()).filter(n => n !== coreNs)
      : [ns];
    const result = {
      spines: { count: 0, health: 0 },
      leafs: { count: 0, health: 0 },
      borderleafs: { count: 0, health: 0 },
      superspines: { count: 0, health: 0 },
      fabricHealth: 0
    };
    let healthSum = 0;
    let healthCount = 0;
    for (const n of namespaces) {
      const stats = this.fabricMap.get(n);
      if (!stats) continue;
      result.spines.count += stats.spines.nodes.size;
      result.leafs.count += stats.leafs.nodes.size;
      result.borderleafs.count += stats.borderleafs.nodes.size;
      result.superspines.count += stats.superspines.nodes.size;
      result.spines.health = this.calcHealth(result.spines.health, stats.spines.health);
      result.leafs.health = this.calcHealth(result.leafs.health, stats.leafs.health);
      result.borderleafs.health = this.calcHealth(result.borderleafs.health, stats.borderleafs.health);
      result.superspines.health = this.calcHealth(result.superspines.health, stats.superspines.health);
      if (stats.health > 0) {
        healthSum += stats.health;
        healthCount += 1;
      }
    }
    result.fabricHealth = healthCount ? Math.round(healthSum / healthCount) : 0;
    return result;
  }

  private calcHealth(current: number, value: number): number {
    if (current === 0) return value;
    if (value === 0) return current;
    return Math.round((current + value) / 2);
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
    this.edaClient.closeEqlStream(this.trafficStreamName);

    // Clear previous fabric streams
    this.closeFabricStreams();

    // Clear traffic data when switching namespaces
    this.trafficMap.clear();

    // Send initial empty data to clear the chart
    this.panel.webview.postMessage({
      command: 'clearTrafficData'
    });

    const query =
      '.namespace.node.srl.interface.traffic-rate fields [sum(in-bps), sum(out-bps)]';
    const namespaces = ns === 'All Namespaces' ? undefined : ns;
    this.trafficStreamName = `traffic-${namespaces ?? 'all'}`;
    await this.edaClient.streamEql(query, namespaces, this.trafficStreamName);
  }

  private async sendFabricStats(ns: string): Promise<void> {
    this.closeFabricStreams();
    const namespaces = ns === 'All Namespaces' ? undefined : ns;
    this.leafStreamName = `leaf-${namespaces ?? 'all'}`;
    this.borderLeafStreamName = `borderleaf-${namespaces ?? 'all'}`;
    this.spineStreamName = `spine-${namespaces ?? 'all'}`;
    this.superSpineStreamName = `superspine-${namespaces ?? 'all'}`;
    this.fabricStatusStreamName = `fabricstatus-${namespaces ?? 'all'}`;
    await this.edaClient.streamEql(`${this.fabricQueryBase}.leafNodes`, namespaces, this.leafStreamName);
    await this.edaClient.streamEql(`${this.fabricQueryBase}.borderLeafNodes`, namespaces, this.borderLeafStreamName);
    await this.edaClient.streamEql(`${this.fabricQueryBase}.spineNodes`, namespaces, this.spineStreamName);
    await this.edaClient.streamEql(`${this.fabricQueryBase}.superSpineNodes`, namespaces, this.superSpineStreamName);
    await this.edaClient.streamEql(this.fabricQueryBase, namespaces, this.fabricStatusStreamName);
    const stats = this.computeFabricStats(ns);
    this.panel.webview.postMessage({ command: 'fabricStats', namespace: ns, stats });
  }

  private closeFabricStreams(): void {
    this.edaClient.closeEqlStream(this.leafStreamName);
    this.edaClient.closeEqlStream(this.borderLeafStreamName);
    this.edaClient.closeEqlStream(this.spineStreamName);
    this.edaClient.closeEqlStream(this.superSpineStreamName);
    this.edaClient.closeEqlStream(this.fabricStatusStreamName);
  }

  private handleLeafStream(msg: any): void {
    this.updateNodeGroup(msg, 'leafs');
  }

  private handleSpineStream(msg: any): void {
    this.updateNodeGroup(msg, 'spines');
  }

  private handleBorderLeafStream(msg: any): void {
    this.updateNodeGroup(msg, 'borderleafs');
  }

  private handleSuperSpineStream(msg: any): void {
    this.updateNodeGroup(msg, 'superspines');
  }

  private updateNodeGroup(
    msg: any,
    key: 'leafs' | 'borderleafs' | 'spines' | 'superspines'
  ): void {
    const ops = msg.msg?.op;
    if (!Array.isArray(ops) || ops.length === 0) return;
    let ns: string | undefined;
    const nodes: string[] = [];
    for (const op of ops) {
      const rows = op?.insert_or_modify?.rows;
      if (!Array.isArray(rows)) continue;
      for (const r of rows) {
        if (ns === undefined) {
          ns = r.data?.['.namespace.name'] as string | undefined;
        }
        const name = r.data?.node as string | undefined;
        if (name) nodes.push(name);
      }
    }
    if (!ns) return;
    let stats = this.fabricMap.get(ns);
    if (!stats) {
      stats = {
        leafs: { nodes: new Set(), health: 0 },
        borderleafs: { nodes: new Set(), health: 0 },
        spines: { nodes: new Set(), health: 0 },
        superspines: { nodes: new Set(), health: 0 },
        health: 0
      };
      this.fabricMap.set(ns, stats);
    }
    const set = stats[key].nodes;
    set.clear();
    for (const n of nodes) {
      set.add(n);
    }
    stats[key].health = this.calculateGroupHealth(ns, Array.from(set));
    this.postFabricStatsIfNeeded(ns);
  }

  private handleFabricStatusStream(msg: any): void {
    const rows = msg.msg?.op?.[0]?.insert_or_modify?.rows;
    if (!Array.isArray(rows) || rows.length === 0) return;
    const data = rows[0].data;
    const ns = data?.['.namespace.name'] as string | undefined;
    if (!ns) return;
    let stats = this.fabricMap.get(ns);
    if (!stats) {
      stats = {
        leafs: { nodes: new Set(), health: 0 },
        borderleafs: { nodes: new Set(), health: 0 },
        spines: { nodes: new Set(), health: 0 },
        superspines: { nodes: new Set(), health: 0 },
        health: 0
      };
      this.fabricMap.set(ns, stats);
    }
    stats.health = Number(data?.health ?? 0);
    this.postFabricStatsIfNeeded(ns);
  }

  private calculateGroupHealth(ns: string, nodes: string[]): number {
    const nodeMap = this.nodeMap.get(ns);
    if (!nodeMap || nodes.length === 0) return 0;
    let healthy = 0;
    for (const n of nodes) {
      const st = nodeMap.get(n) ?? '';
      if (st.toLowerCase() === 'synced') healthy += 1;
    }
    return Math.round((healthy / nodes.length) * 100);
  }

  private postFabricStatsIfNeeded(ns: string): void {
    if (this.selectedNamespace === 'All Namespaces' || this.selectedNamespace === ns) {
      const stats = this.computeFabricStats(this.selectedNamespace);
      this.panel.webview.postMessage({ command: 'fabricStats', namespace: this.selectedNamespace, stats });
    }
  }

  static show(context: vscode.ExtensionContext, title: string): void {
    new DashboardPanel(context, title);
  }
}