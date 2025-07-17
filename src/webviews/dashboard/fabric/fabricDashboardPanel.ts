import * as vscode from 'vscode';
import { BasePanel } from '../../basePanel';
import { serviceManager } from '../../../services/serviceManager';
import { EdaClient } from '../../../clients/edaClient';
import { EdaStreamClient, StreamEndpoint } from '../../../clients/edaStreamClient';
import { randomUUID } from 'crypto';
import { parseUpdateKey } from '../../../utils/parseUpdateKey';

interface NodeGroupStats {
  nodes: Map<number, string>;
  health: number;
}

interface FabricStats {
  leafs: NodeGroupStats;
  borderleafs: NodeGroupStats;
  spines: NodeGroupStats;
  superspines: NodeGroupStats;
  health: number;
}

export class FabricDashboardPanel extends BasePanel {
  private edaClient: EdaClient;
  private streamClient: EdaStreamClient;
  private nodeMap: Map<string, Map<string, string>> = new Map();
  private interfaceMap: Map<string, Map<string, string>> = new Map();
  private trafficMap: Map<string, { in: number; out: number }> = new Map();
  private fabricMap: Map<string, FabricStats> = new Map();
  private selectedNamespace = 'All Namespaces';
  private trafficStreamName = '';
  private leafStreamName = '';
  private borderLeafStreamName = '';
  private spineStreamName = '';
  private superSpineStreamName = '';
  private fabricStatusStreamName = '';
  private initialized = false;

  private get fabricQueryBase(): string {
    return '.namespace.resources.cr-status.fabrics_eda_nokia_com.v1alpha1.fabric.status';
  }

  constructor(context: vscode.ExtensionContext, title: string) {
    super(context, 'edaDashboard', title, undefined, {
      light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-black.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-white.svg')
    });

    this.edaClient = serviceManager.getClient<EdaClient>('eda');

    this.streamClient = this.createStreamClient();
    void this.streamClient.connect();

    this.panel.onDidDispose(() => {
      this.streamClient.dispose();
    });

    this.panel.webview.onDidReceiveMessage(async msg => {
      if (msg.command === 'ready') {
        await this.sendNamespaces();
        await this.sendTopoNodeStats('All Namespaces');
        await this.sendInterfaceStats('All Namespaces');
        await this.sendTrafficStats('All Namespaces');
        await this.sendSpineStats('All Namespaces');
        await this.sendLeafStats('All Namespaces');
        await this.sendBorderLeafStats('All Namespaces');
        await this.sendSuperSpineStats('All Namespaces');
        await this.sendFabricHealth('All Namespaces');
      } else if (msg.command === 'getTopoNodeStats') {
        await this.sendTopoNodeStats(msg.namespace as string);
        await this.sendInterfaceStats(msg.namespace as string);
        await this.sendTrafficStats(msg.namespace as string);
        await this.sendSpineStats(msg.namespace as string);
        await this.sendLeafStats(msg.namespace as string);
        await this.sendBorderLeafStats(msg.namespace as string);
        await this.sendSuperSpineStats(msg.namespace as string);
        await this.sendFabricHealth(msg.namespace as string);
      }
    });

    this.panel.webview.html = this.buildHtml();
  }

  private createStreamClient(): EdaStreamClient {
    const authClient = (this.edaClient as any)['authClient'];
    const specManager = (this.edaClient as any)['specManager'];
    const client = new EdaStreamClient();
    client.setAuthClient(authClient);
    const endpoints = specManager
      .getStreamEndpoints()
      .filter((ep: StreamEndpoint) => ep.stream === 'toponodes' || ep.stream === 'interfaces');
    client.setStreamEndpoints(endpoints);
    client.onStreamMessage(event => {
      const { stream, message: msg } = event;
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
    client.subscribeToStream('toponodes');
    client.subscribeToStream('interfaces');
    return client;
  }

  protected getHtml(): string {
    return this.readWebviewFile('dashboard', 'fabric', 'fabricDashboardPanel.html');
  }

  protected getCustomStyles(): string {
    return this.readWebviewFile('dashboard', 'fabric', 'fabricDashboardPanel.css');
  }

  protected getScripts(): string {
    return '';
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'fabricDashboard.js');
    const echartsUri = this.getResourceUri('resources', 'echarts.min.js');
    return `<script nonce="${nonce}" data-echarts-uri="${echartsUri}" src="${scriptUri}"></script>`;
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
    const changed = ns !== this.selectedNamespace;
    this.selectedNamespace = ns;
    if (changed) {
      // Dispose existing client and create a new one with a fresh eventclient
      this.streamClient.dispose();
      this.streamClient = this.createStreamClient();
      void this.streamClient.connect();
    }
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

    // Recalculate fabric group health when node states change
    for (const ns of changed) {
      const stats = this.fabricMap.get(ns);
      if (!stats) continue;
      const groups: Array<'leafs' | 'borderleafs' | 'spines' | 'superspines'> = [
        'leafs',
        'borderleafs',
        'spines',
        'superspines'
      ];
      for (const key of groups) {
        const nodes = Array.from(stats[key].nodes.values());
        stats[key].health = this.calculateGroupHealth(ns, nodes);
        this.postFabricGroupStatsIfNeeded(ns, key);
      }
      this.postFabricHealthIfNeeded(ns);
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
        leafs: { nodes: new Map(), health: 0 },
        borderleafs: { nodes: new Map(), health: 0 },
        spines: { nodes: new Map(), health: 0 },
        superspines: { nodes: new Map(), health: 0 },
        health: 0
      });
    }
  }

  private computeFabricGroupStats(
    ns: string,
    key: 'leafs' | 'borderleafs' | 'spines' | 'superspines'
  ): { count: number; health: number } {
    const coreNs = this.edaClient.getCoreNamespace();
    const namespaces = ns === 'All Namespaces'
      ? Array.from(this.fabricMap.keys()).filter(n => n !== coreNs)
      : [ns];
    let count = 0;
    let health = 0;
    for (const n of namespaces) {
      const stats = this.fabricMap.get(n);
      if (!stats) continue;
      count += stats[key].nodes.size;
      health = this.calcHealth(health, stats[key].health);
    }
    return { count, health };
  }

  private computeFabricHealth(ns: string): number {
    const coreNs = this.edaClient.getCoreNamespace();
    const namespaces = ns === 'All Namespaces'
      ? Array.from(this.fabricMap.keys()).filter(n => n !== coreNs)
      : [ns];
    let healthSum = 0;
    let healthCount = 0;
    for (const n of namespaces) {
      const stats = this.fabricMap.get(n);
      if (!stats) continue;
      if (stats.health > 0) {
        healthSum += stats.health;
        healthCount += 1;
      }
    }
    return healthCount ? Math.round(healthSum / healthCount) : 0;
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
    await this.streamClient.closeEqlStream(this.trafficStreamName);

    // Clear previous fabric streams
    await this.closeFabricStreams();

    // Clear traffic data when switching namespaces
    this.trafficMap.clear();

    // Send initial empty data to clear the chart
    this.panel.webview.postMessage({
      command: 'clearTrafficData'
    });

    const query =
      '.namespace.node.srl.interface.traffic-rate fields [sum(in-bps), sum(out-bps)]';
    const namespaces = ns === 'All Namespaces' ? undefined : ns;
    this.trafficStreamName = `traffic-${namespaces ?? 'all'}-${randomUUID()}`;
    this.streamClient.setEqlQuery(query, namespaces, this.trafficStreamName);
    this.streamClient.subscribeToStream(this.trafficStreamName);
    await this.streamClient.connect();
  }

  private async sendSpineStats(ns: string): Promise<void> {
    await this.streamClient.closeEqlStream(this.spineStreamName);
    const namespaces = ns === 'All Namespaces' ? undefined : ns;
    this.spineStreamName = `spine-${namespaces ?? 'all'}-${randomUUID()}`;
    this.streamClient.setEqlQuery(`${this.fabricQueryBase}.spineNodes`, namespaces, this.spineStreamName);
    this.streamClient.subscribeToStream(this.spineStreamName);
    await this.streamClient.connect();
    const stats = this.computeFabricGroupStats(ns, 'spines');
    this.panel.webview.postMessage({ command: 'fabricSpineStats', namespace: ns, stats });
  }

  private async sendLeafStats(ns: string): Promise<void> {
    await this.streamClient.closeEqlStream(this.leafStreamName);
    const namespaces = ns === 'All Namespaces' ? undefined : ns;
    this.leafStreamName = `leaf-${namespaces ?? 'all'}-${randomUUID()}`;
    this.streamClient.setEqlQuery(`${this.fabricQueryBase}.leafNodes`, namespaces, this.leafStreamName);
    this.streamClient.subscribeToStream(this.leafStreamName);
    await this.streamClient.connect();
    const stats = this.computeFabricGroupStats(ns, 'leafs');
    this.panel.webview.postMessage({ command: 'fabricLeafStats', namespace: ns, stats });
  }

  private async sendBorderLeafStats(ns: string): Promise<void> {
    await this.streamClient.closeEqlStream(this.borderLeafStreamName);
    const namespaces = ns === 'All Namespaces' ? undefined : ns;
    this.borderLeafStreamName = `borderleaf-${namespaces ?? 'all'}-${randomUUID()}`;
    this.streamClient.setEqlQuery(`${this.fabricQueryBase}.borderLeafNodes`, namespaces, this.borderLeafStreamName);
    this.streamClient.subscribeToStream(this.borderLeafStreamName);
    await this.streamClient.connect();
    const stats = this.computeFabricGroupStats(ns, 'borderleafs');
    this.panel.webview.postMessage({ command: 'fabricBorderLeafStats', namespace: ns, stats });
  }

  private async sendSuperSpineStats(ns: string): Promise<void> {
    await this.streamClient.closeEqlStream(this.superSpineStreamName);
    const namespaces = ns === 'All Namespaces' ? undefined : ns;
    this.superSpineStreamName = `superspine-${namespaces ?? 'all'}-${randomUUID()}`;
    this.streamClient.setEqlQuery(`${this.fabricQueryBase}.superSpineNodes`, namespaces, this.superSpineStreamName);
    this.streamClient.subscribeToStream(this.superSpineStreamName);
    await this.streamClient.connect();
    const stats = this.computeFabricGroupStats(ns, 'superspines');
    this.panel.webview.postMessage({ command: 'fabricSuperSpineStats', namespace: ns, stats });
  }

  private async sendFabricHealth(ns: string): Promise<void> {
    await this.streamClient.closeEqlStream(this.fabricStatusStreamName);
    const namespaces = ns === 'All Namespaces' ? undefined : ns;
    this.fabricStatusStreamName = `fabricstatus-${namespaces ?? 'all'}-${randomUUID()}`;
    this.streamClient.setEqlQuery(this.fabricQueryBase, namespaces, this.fabricStatusStreamName);
    this.streamClient.subscribeToStream(this.fabricStatusStreamName);
    await this.streamClient.connect();
    const health = this.computeFabricHealth(ns);
    this.panel.webview.postMessage({ command: 'fabricHealth', namespace: ns, health });
  }

  private async closeFabricStreams(): Promise<void> {
    await this.streamClient.closeEqlStream(this.leafStreamName);
    await this.streamClient.closeEqlStream(this.borderLeafStreamName);
    await this.streamClient.closeEqlStream(this.spineStreamName);
    await this.streamClient.closeEqlStream(this.superSpineStreamName);
    await this.streamClient.closeEqlStream(this.fabricStatusStreamName);
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
    const changed = new Set<string>();
    for (const op of ops) {
      const rows = op?.insert_or_modify?.rows;
      if (Array.isArray(rows)) {
        for (const r of rows) {
          const ns = r.data?.['.namespace.name'] as string | undefined;
          const name = r.data?.node as string | undefined;
          const id = r.id as number | undefined;
          if (!ns || !name || id === undefined) continue;
          let stats = this.fabricMap.get(ns);
          if (!stats) {
            stats = {
              leafs: { nodes: new Map(), health: 0 },
              borderleafs: { nodes: new Map(), health: 0 },
              spines: { nodes: new Map(), health: 0 },
              superspines: { nodes: new Map(), health: 0 },
              health: 0
            };
            this.fabricMap.set(ns, stats);
          }
          stats[key].nodes.set(id, name);
          changed.add(ns);
        }
      }
      const delIds = op?.delete?.ids;
      if (Array.isArray(delIds)) {
        for (const delId of delIds) {
          for (const [ns, stats] of this.fabricMap) {
            if (stats[key].nodes.delete(delId)) {
              changed.add(ns);
            }
          }
        }
      }
    }

    for (const ns of changed) {
      const stats = this.fabricMap.get(ns);
      if (!stats) continue;
      const nodes = Array.from(stats[key].nodes.values());
      stats[key].health = this.calculateGroupHealth(ns, nodes);
      this.postFabricGroupStatsIfNeeded(ns, key);
    }
  }

  private handleFabricStatusStream(msg: any): void {
    const ops = msg.msg?.op;
    if (!Array.isArray(ops) || ops.length === 0) return;

    const changed = new Set<string>();

    for (const op of ops) {
      const rows = op?.insert_or_modify?.rows;
      if (!Array.isArray(rows)) continue;

      for (const r of rows) {
        const data = r.data;
        const ns = data?.['.namespace.name'] as string | undefined;
        if (!ns) continue;

        let stats = this.fabricMap.get(ns);
        if (!stats) {
          stats = {
            leafs: { nodes: new Map(), health: 0 },
            borderleafs: { nodes: new Map(), health: 0 },
            spines: { nodes: new Map(), health: 0 },
            superspines: { nodes: new Map(), health: 0 },
            health: 0
          };
          this.fabricMap.set(ns, stats);
        }

        const newHealth = Number(data?.health ?? 0);
        if (stats.health !== newHealth) {
          stats.health = newHealth;
          changed.add(ns);
        }
      }
    }

    for (const ns of changed) {
      this.postFabricHealthIfNeeded(ns);
    }
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

  private postFabricGroupStatsIfNeeded(
    ns: string,
    key: 'leafs' | 'borderleafs' | 'spines' | 'superspines'
  ): void {
    if (this.selectedNamespace === 'All Namespaces' || this.selectedNamespace === ns) {
      const stats = this.computeFabricGroupStats(this.selectedNamespace, key);
      const command =
        key === 'spines'
          ? 'fabricSpineStats'
          : key === 'leafs'
            ? 'fabricLeafStats'
            : key === 'borderleafs'
              ? 'fabricBorderLeafStats'
              : 'fabricSuperSpineStats';
      this.panel.webview.postMessage({ command, namespace: this.selectedNamespace, stats });
    }
  }

  private postFabricHealthIfNeeded(ns: string): void {
    if (this.selectedNamespace === 'All Namespaces' || this.selectedNamespace === ns) {
      const health = this.computeFabricHealth(this.selectedNamespace);
      this.panel.webview.postMessage({ command: 'fabricHealth', namespace: this.selectedNamespace, health });
    }
  }

  static show(context: vscode.ExtensionContext, title: string): void {
    new FabricDashboardPanel(context, title);
  }
}