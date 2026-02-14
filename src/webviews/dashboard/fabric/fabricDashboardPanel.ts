import { randomUUID } from 'crypto';

import * as vscode from 'vscode';

import { BasePanel } from '../../basePanel';
import { ALL_NAMESPACES, RESOURCES_DIR } from '../../constants';
import { serviceManager } from '../../../services/serviceManager';
import type { EdaClient } from '../../../clients/edaClient';
import type { EdaAuthClient } from '../../../clients/edaAuthClient';
import type { EdaSpecManager } from '../../../clients/edaSpecManager';
import type { StreamEndpoint, StreamMessagePayload } from '../../../clients/edaStreamClient';
import { EdaStreamClient } from '../../../clients/edaStreamClient';
import { parseUpdateKey } from '../../../utils/parseUpdateKey';
import { getUpdates, getOps, getDelete, getDeleteIds, getInsertOrModify, getRows } from '../../../utils/streamMessageUtils';

/** Interface for EdaClient internal access (private members) */
interface EdaClientInternal {
  authClient: EdaAuthClient;
  specManager: EdaSpecManager;
}

/** Inner message payload containing updates or operations */
interface InnerMessagePayload {
  updates?: StreamUpdate[];
  Updates?: StreamUpdate[];
  op?: StreamOperation[];
  Op?: StreamOperation[];
}

/** Individual update entry in stream messages */
interface StreamUpdate {
  key?: string;
  data: StreamUpdateData | null;
}

/** Data payload in stream updates */
interface StreamUpdateData {
  metadata?: {
    name?: string;
    namespace?: string;
  };
  status?: {
    'node-state'?: string;
    nodeState?: string;
    operationalState?: string;
    operationalstate?: string;
    health?: number;
    spineNodes?: Array<{ node?: string }>;
    leafNodes?: Array<{ node?: string }>;
    borderLeafNodes?: Array<{ node?: string }>;
    superSpineNodes?: Array<{ node?: string }>;
  };
  node?: string;
  '.namespace.name'?: string;
  'SUM(in-bps)'?: number | string;
  'SUM(out-bps)'?: number | string;
  health?: number;
}

/** Stream operation entry */
interface StreamOperation {
  insert_or_modify?: InsertOrModifyOperation;
  Insert_or_modify?: InsertOrModifyOperation;
  insertOrModify?: InsertOrModifyOperation;
  InsertOrModify?: InsertOrModifyOperation;
  delete?: DeleteOperation;
  Delete?: DeleteOperation;
}

/** Insert or modify operation data */
interface InsertOrModifyOperation {
  rows?: StreamRow[];
  Rows?: StreamRow[];
}

/** Delete operation data */
interface DeleteOperation {
  ids?: number[];
  Ids?: number[];
}

/** Row entry in insert/modify operations */
interface StreamRow {
  id?: number;
  data?: StreamUpdateData;
}

/** Resource item from API (toponode, interface, etc.) */
interface ResourceItem {
  metadata?: {
    name?: string;
    namespace?: string;
  };
  status?: {
    'node-state'?: string;
    nodeState?: string;
    operationalState?: string;
    operationalstate?: string;
  };
}

interface NodeGroupStats {
  nodes: Map<number, string>;
  health: number;
}

type FabricGroupKey = 'leafs' | 'borderleafs' | 'spines' | 'superspines';

interface FabricStats {
  leafs: NodeGroupStats;
  borderleafs: NodeGroupStats;
  spines: NodeGroupStats;
  superspines: NodeGroupStats;
  health: number;
}

export class FabricDashboardPanel extends BasePanel {
  private static currentPanel: FabricDashboardPanel | undefined;
  private edaClient: EdaClient;
  private streamClient: EdaStreamClient;
  private nodeMap: Map<string, Map<string, string>> = new Map();
  private interfaceMap: Map<string, Map<string, string>> = new Map();
  private trafficMap: Map<string, { in: number; out: number }> = new Map();
  private fabricMap: Map<string, FabricStats> = new Map();
  private selectedNamespace = ALL_NAMESPACES;
  private trafficStreamName = '';
  private leafStreamName = '';
  private borderLeafStreamName = '';
  private spineStreamName = '';
  private superSpineStreamName = '';
  private fabricStatusStreamName = '';
  private initialized = false;
  private useFieldsQuery = false;

  private get fabricQueryBase(): string {
    return this.useFieldsQuery
      ? '.namespace.resources.cr.fabrics_eda_nokia_com.v1alpha1.fabric'
      : '.namespace.resources.cr-status.fabrics_eda_nokia_com.v1alpha1.fabric.status';
  }

  private constructor(context: vscode.ExtensionContext, title: string) {
    super(context, 'edaDashboard', title, undefined, BasePanel.getEdaIconPath(context));

    this.edaClient = serviceManager.getClient<EdaClient>('eda');
    const edaInternal = this.edaClient as unknown as EdaClientInternal;
    const specManager = edaInternal.specManager;
    const apiVersion = specManager.getApiVersion();
    this.useFieldsQuery = this.isVersionAtLeast(apiVersion, '25.8');

    this.streamClient = this.createStreamClient();

    this.panel.onDidDispose(() => {
      this.streamClient.dispose();
    });

    this.panel.webview.onDidReceiveMessage((msg: unknown) => {
      void this.handleWebviewMessage(msg);
    });

    this.panel.webview.html = this.buildHtml();
  }

  private async initialize(): Promise<void> {
    await this.streamClient.connect();
  }

  private async handleWebviewMessage(msg: unknown): Promise<void> {
    const message = msg as { command: string; namespace?: string };
    if (message.command === 'ready') {
      await this.sendNamespaces();
      await this.sendAllStats(ALL_NAMESPACES);
    } else if (message.command === 'getTopoNodeStats') {
      await this.sendAllStats(message.namespace ?? ALL_NAMESPACES);
    }
  }

  private async sendAllStats(namespace: string): Promise<void> {
    await this.sendTopoNodeStats(namespace);
    await this.sendInterfaceStats(namespace);
    await this.sendTrafficStats(namespace);
    await this.sendSpineStats(namespace);
    await this.sendLeafStats(namespace);
    await this.sendBorderLeafStats(namespace);
    await this.sendSuperSpineStats(namespace);
    await this.sendFabricHealth(namespace);
  }

  private createStreamClient(): EdaStreamClient {
    const edaInternal = this.edaClient as unknown as EdaClientInternal;
    const authClient = edaInternal.authClient;
    const specManager = edaInternal.specManager;
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

  private isVersionAtLeast(version: string, target: string): boolean {
    const parse = (v: string) =>
      v
        .replace(/^\D*/, '')
        .split('.')
        .map(n => {
          const num = parseInt(n, 10);
          return Number.isNaN(num) ? 0 : num;
        });
    const vParts = parse(version);
    const tParts = parse(target);
    const len = Math.max(vParts.length, tParts.length);
    for (let i = 0; i < len; i++) {
      const vVal = vParts[i] ?? 0;
      const tVal = tParts[i] ?? 0;
      if (vVal > tVal) return true;
      if (vVal < tVal) return false;
    }
    return true;
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'fabricDashboard.js');
    const echartsUri = this.getResourceUri(RESOURCES_DIR, 'echarts.min.js');
    const bootstrapData = JSON.stringify({ echartsUri: echartsUri.toString() });
    return `<script nonce="${nonce}">window.__EDA_BOOTSTRAP__=${bootstrapData};</script><script type="module" nonce="${nonce}" src="${scriptUri}"></script>`;
  }

  private async sendNamespaces(): Promise<void> {
    const coreNs = this.edaClient.getCoreNamespace();
    const namespaces = this.edaClient
      .getCachedNamespaces()
      .filter(ns => ns !== coreNs);
    namespaces.unshift(ALL_NAMESPACES);
    this.panel.webview.postMessage({
      command: 'init',
      namespaces,
      selected: this.selectedNamespace
    });
    if (!this.initialized) {
      await this.initializeNodeData(namespaces);
      await this.initializeInterfaceData(namespaces);
      this.initializeFabricData(namespaces);
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
      this.initializeFabricData(all);
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
        const nodes = await this.edaClient.listTopoNodes(ns) as ResourceItem[];
        const map = new Map<string, string>();
        for (const node of nodes) {
          const name = node.metadata?.name;
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

  private handleTopoNodeStream(payload: StreamMessagePayload): void {
    const innerMsg = payload.msg as InnerMessagePayload | undefined;
    const updates = getUpdates(innerMsg) as StreamUpdate[];
    if (updates.length === 0) {
      return;
    }

    const changed = this.processTopoNodeUpdates(updates);

    if (this.shouldPostTopoNodeStats(changed)) {
      const stats = this.computeStats(this.selectedNamespace);
      this.panel.webview.postMessage({
        command: 'topoNodeStats',
        namespace: this.selectedNamespace,
        stats
      });
    }

    this.recalculateFabricHealthForNamespaces(changed);
  }

  private processTopoNodeUpdates(updates: StreamUpdate[]): Set<string> {
    const changed = new Set<string>();
    const coreNs = this.edaClient.getCoreNamespace();

    for (const up of updates) {
      const { name, namespace } = this.extractNameAndNamespace(up);
      if (!namespace || !name || namespace === coreNs) {
        continue;
      }

      const map = this.getOrCreateNodeMap(namespace);
      this.applyTopoNodeUpdate(map, up, name);
      changed.add(namespace);
    }

    return changed;
  }

  private extractNameAndNamespace(up: StreamUpdate): { name: string | undefined; namespace: string | undefined } {
    let name: string | undefined = up.data?.metadata?.name;
    let namespace: string | undefined = up.data?.metadata?.namespace;

    if ((!name || !namespace) && up.key) {
      const parsed = parseUpdateKey(String(up.key));
      name = name ?? parsed.name;
      namespace = namespace ?? parsed.namespace;
    }

    return { name, namespace };
  }

  private getOrCreateNodeMap(namespace: string): Map<string, string> {
    let map = this.nodeMap.get(namespace);
    if (!map) {
      map = new Map();
      this.nodeMap.set(namespace, map);
    }
    return map;
  }

  private applyTopoNodeUpdate(map: Map<string, string>, up: StreamUpdate, name: string): void {
    if (up.data === null) {
      map.delete(name);
    } else {
      const state = up.data?.status?.['node-state'] ?? up.data?.status?.nodeState ?? '';
      map.set(name, state);
    }
  }

  private shouldPostTopoNodeStats(changed: Set<string>): boolean {
    return this.selectedNamespace === ALL_NAMESPACES || changed.has(this.selectedNamespace);
  }

  private recalculateFabricHealthForNamespaces(changed: Set<string>): void {
    const groups: Array<FabricGroupKey> = ['leafs', 'borderleafs', 'spines', 'superspines'];

    for (const ns of changed) {
      const stats = this.fabricMap.get(ns);
      if (!stats) continue;

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
    const namespaces = ns === ALL_NAMESPACES
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
        const ifaces = await this.edaClient.listInterfaces(ns) as ResourceItem[];
        const map = new Map<string, string>();
        for (const iface of ifaces) {
          const name = iface.metadata?.name;
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

  private initializeFabricData(namespaces: string[]): void {
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
    key: FabricGroupKey
  ): { count: number; health: number } {
    const coreNs = this.edaClient.getCoreNamespace();
    const namespaces = ns === ALL_NAMESPACES
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
    const namespaces = ns === ALL_NAMESPACES
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
    const namespaces = ns === ALL_NAMESPACES
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

  private handleInterfaceStream(payload: StreamMessagePayload): void {
    const innerMsg = payload.msg as InnerMessagePayload | undefined;
    const updates = getUpdates(innerMsg) as StreamUpdate[];
    if (updates.length === 0) {
      return;
    }

    const changed = this.processInterfaceUpdates(updates);

    if (this.shouldPostTopoNodeStats(changed)) {
      const stats = this.computeInterfaceStats(this.selectedNamespace);
      this.panel.webview.postMessage({
        command: 'interfaceStats',
        namespace: this.selectedNamespace,
        stats
      });
    }
  }

  private processInterfaceUpdates(updates: StreamUpdate[]): Set<string> {
    const changed = new Set<string>();
    const coreNs = this.edaClient.getCoreNamespace();

    for (const up of updates) {
      const { name, namespace } = this.extractNameAndNamespace(up);
      if (!namespace || !name || namespace === coreNs) {
        continue;
      }

      const map = this.getOrCreateInterfaceMap(namespace);
      this.applyInterfaceUpdate(map, up, name);
      changed.add(namespace);
    }

    return changed;
  }

  private getOrCreateInterfaceMap(namespace: string): Map<string, string> {
    let map = this.interfaceMap.get(namespace);
    if (!map) {
      map = new Map();
      this.interfaceMap.set(namespace, map);
    }
    return map;
  }

  private applyInterfaceUpdate(map: Map<string, string>, up: StreamUpdate, name: string): void {
    if (up.data === null) {
      map.delete(name);
    } else {
      const state =
        up.data?.status?.operationalState ?? up.data?.status?.operationalstate ?? '';
      map.set(name, state);
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

  private handleTrafficStream(payload: StreamMessagePayload): void {
    const innerMsg = payload.msg as InnerMessagePayload | undefined;
    let inboundTotal = 0;
    let outboundTotal = 0;
    let hasTrafficData = false;

    const accumulateTraffic = (data: StreamUpdateData | null | undefined): void => {
      const stats = this.extractTrafficStats(data);
      if (!stats) {
        return;
      }
      inboundTotal += stats.in;
      outboundTotal += stats.out;
      hasTrafficData = true;
    };

    const ops = getOps(innerMsg) as StreamOperation[];
    for (const op of ops) {
      const insertOrModify = getInsertOrModify(op) as InsertOrModifyOperation | undefined;
      const rows = getRows(insertOrModify) as StreamRow[];
      for (const row of rows) {
        accumulateTraffic(row.data);
      }
    }

    if (!hasTrafficData) {
      const updates = getUpdates(innerMsg) as StreamUpdate[];
      for (const update of updates) {
        accumulateTraffic(update.data);
      }
    }

    if (!hasTrafficData) {
      return;
    }

    const stats = {
      in: inboundTotal,
      out: outboundTotal
    };
    this.trafficMap.set(this.selectedNamespace, stats);
    this.panel.webview.postMessage({
      command: 'trafficStats',
      namespace: this.selectedNamespace,
      stats
    });
  }

  private extractTrafficStats(data: StreamUpdateData | null | undefined): { in: number; out: number } | null {
    if (!data || typeof data !== 'object') {
      return null;
    }

    const record = data as Record<string, unknown>;

    const getMetric = (matcher: RegExp): number | undefined => {
      for (const [key, value] of Object.entries(record)) {
        if (!matcher.test(key)) {
          continue;
        }
        const numeric = Number(value);
        if (!Number.isNaN(numeric)) {
          return numeric;
        }
      }
      return undefined;
    };

    const inbound = getMetric(/^sum\(in-bps\)$/i);
    const outbound = getMetric(/^sum\(out-bps\)$/i);

    if (inbound === undefined && outbound === undefined) {
      return null;
    }

    return {
      in: inbound ?? 0,
      out: outbound ?? 0
    };
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
    const namespaces = ns === ALL_NAMESPACES ? undefined : ns;
    this.trafficStreamName = `traffic-${namespaces ?? 'all'}-${randomUUID()}`;
    this.streamClient.setEqlQuery(query, namespaces, this.trafficStreamName);
    this.streamClient.subscribeToStream(this.trafficStreamName);
    await this.streamClient.connect();
  }

  private async sendSpineStats(ns: string): Promise<void> {
    await this.streamClient.closeEqlStream(this.spineStreamName);
    const namespaces = ns === ALL_NAMESPACES ? undefined : ns;
    this.spineStreamName = `spine-${namespaces ?? 'all'}-${randomUUID()}`;
    const query = this.useFieldsQuery
      ? `${this.fabricQueryBase} fields [ status.spineNodes[].node ]`
      : `${this.fabricQueryBase}.spineNodes`;
    this.streamClient.setEqlQuery(query, namespaces, this.spineStreamName);
    this.streamClient.subscribeToStream(this.spineStreamName);
    await this.streamClient.connect();
    const stats = this.computeFabricGroupStats(ns, 'spines');
    this.panel.webview.postMessage({ command: 'fabricSpineStats', namespace: ns, stats });
  }

  private async sendLeafStats(ns: string): Promise<void> {
    await this.streamClient.closeEqlStream(this.leafStreamName);
    const namespaces = ns === ALL_NAMESPACES ? undefined : ns;
    this.leafStreamName = `leaf-${namespaces ?? 'all'}-${randomUUID()}`;
    const query = this.useFieldsQuery
      ? `${this.fabricQueryBase} fields [ status.leafNodes[].node ]`
      : `${this.fabricQueryBase}.leafNodes`;
    this.streamClient.setEqlQuery(query, namespaces, this.leafStreamName);
    this.streamClient.subscribeToStream(this.leafStreamName);
    await this.streamClient.connect();
    const stats = this.computeFabricGroupStats(ns, 'leafs');
    this.panel.webview.postMessage({ command: 'fabricLeafStats', namespace: ns, stats });
  }

  private async sendBorderLeafStats(ns: string): Promise<void> {
    await this.streamClient.closeEqlStream(this.borderLeafStreamName);
    const namespaces = ns === ALL_NAMESPACES ? undefined : ns;
    this.borderLeafStreamName = `borderleaf-${namespaces ?? 'all'}-${randomUUID()}`;
    const query = this.useFieldsQuery
      ? `${this.fabricQueryBase} fields [ status.borderLeafNodes[].node ]`
      : `${this.fabricQueryBase}.borderLeafNodes`;
    this.streamClient.setEqlQuery(query, namespaces, this.borderLeafStreamName);
    this.streamClient.subscribeToStream(this.borderLeafStreamName);
    await this.streamClient.connect();
    const stats = this.computeFabricGroupStats(ns, 'borderleafs');
    this.panel.webview.postMessage({ command: 'fabricBorderLeafStats', namespace: ns, stats });
  }

  private async sendSuperSpineStats(ns: string): Promise<void> {
    await this.streamClient.closeEqlStream(this.superSpineStreamName);
    const namespaces = ns === ALL_NAMESPACES ? undefined : ns;
    this.superSpineStreamName = `superspine-${namespaces ?? 'all'}-${randomUUID()}`;
    const query = this.useFieldsQuery
      ? `${this.fabricQueryBase} fields [ status.superSpineNodes[].node ]`
      : `${this.fabricQueryBase}.superSpineNodes`;
    this.streamClient.setEqlQuery(query, namespaces, this.superSpineStreamName);
    this.streamClient.subscribeToStream(this.superSpineStreamName);
    await this.streamClient.connect();
    const stats = this.computeFabricGroupStats(ns, 'superspines');
    this.panel.webview.postMessage({ command: 'fabricSuperSpineStats', namespace: ns, stats });
  }

  private async sendFabricHealth(ns: string): Promise<void> {
    await this.streamClient.closeEqlStream(this.fabricStatusStreamName);
    const namespaces = ns === ALL_NAMESPACES ? undefined : ns;
    this.fabricStatusStreamName = `fabricstatus-${namespaces ?? 'all'}-${randomUUID()}`;
    const query = this.useFieldsQuery
      ? `${this.fabricQueryBase} fields [ status.health ]`
      : this.fabricQueryBase;
    this.streamClient.setEqlQuery(query, namespaces, this.fabricStatusStreamName);
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

  private handleLeafStream(payload: StreamMessagePayload): void {
    this.updateNodeGroup(payload, 'leafs');
  }

  private handleSpineStream(payload: StreamMessagePayload): void {
    this.updateNodeGroup(payload, 'spines');
  }

  private handleBorderLeafStream(payload: StreamMessagePayload): void {
    this.updateNodeGroup(payload, 'borderleafs');
  }

  private handleSuperSpineStream(payload: StreamMessagePayload): void {
    this.updateNodeGroup(payload, 'superspines');
  }

  private extractNodesFromRow(
    data: StreamUpdateData | undefined,
    key: FabricGroupKey
  ): string[] {
    const status = data?.status;
    if (!status) return [];
    let arr: Array<{ node?: string }> | undefined;
    switch (key) {
      case 'spines':
        arr = status.spineNodes;
        break;
      case 'leafs':
        arr = status.leafNodes;
        break;
      case 'borderleafs':
        arr = status.borderLeafNodes;
        break;
      case 'superspines':
        arr = status.superSpineNodes;
        break;
    }
    if (!Array.isArray(arr)) return [];
    return arr
      .map(n => n?.node)
      .filter((n): n is string => typeof n === 'string');
  }

  private updateNodeGroup(payload: StreamMessagePayload, key: FabricGroupKey): void {
    const innerMsg = payload.msg as InnerMessagePayload | undefined;
    const ops = getOps(innerMsg) as StreamOperation[];
    if (ops.length === 0) return;

    const changed = this.processNodeGroupOps(ops, key);
    this.updateNodeGroupHealth(changed, key);
  }

  private processNodeGroupOps(ops: StreamOperation[], key: FabricGroupKey): Set<string> {
    const changed = new Set<string>();

    for (const op of ops) {
      this.processNodeGroupInsertOrModify(op, key, changed);
      this.processNodeGroupDeletes(op, key, changed);
    }

    return changed;
  }

  private processNodeGroupInsertOrModify(op: StreamOperation, key: FabricGroupKey, changed: Set<string>): void {
    const insertOrModify = getInsertOrModify(op) as InsertOrModifyOperation | undefined;
    const rows = getRows(insertOrModify) as StreamRow[];

    for (const r of rows) {
      const ns = r.data?.['.namespace.name'];
      if (!ns) continue;

      const stats = this.getOrCreateFabricStats(ns);
      const updated = this.applyNodeGroupRowUpdate(stats, r, key);
      if (updated) {
        changed.add(ns);
      }
    }
  }

  private processNodeGroupDeletes(op: StreamOperation, key: FabricGroupKey, changed: Set<string>): void {
    if (this.useFieldsQuery) return;

    const deleteOp = getDelete(op) as DeleteOperation | undefined;
    const delIds = getDeleteIds(deleteOp) as number[];

    for (const delId of delIds) {
      for (const [ns, stats] of this.fabricMap) {
        if (stats[key].nodes.delete(delId)) {
          changed.add(ns);
        }
      }
    }
  }

  private getOrCreateFabricStats(ns: string): FabricStats {
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
    return stats;
  }

  private applyNodeGroupRowUpdate(stats: FabricStats, r: StreamRow, key: FabricGroupKey): boolean {
    if (this.useFieldsQuery) {
      const nodes = this.extractNodesFromRow(r.data, key);
      stats[key].nodes.clear();
      nodes.forEach((n, idx) => stats[key].nodes.set(idx, n));
      return true;
    }

    const name = r.data?.node;
    const id = r.id;
    if (!name || id === undefined) return false;

    stats[key].nodes.set(id, name);
    return true;
  }

  private updateNodeGroupHealth(changed: Set<string>, key: FabricGroupKey): void {
    for (const ns of changed) {
      const stats = this.fabricMap.get(ns);
      if (!stats) continue;

      const nodes = Array.from(stats[key].nodes.values());
      stats[key].health = this.calculateGroupHealth(ns, nodes);
      this.postFabricGroupStatsIfNeeded(ns, key);
    }
  }

  private handleFabricStatusStream(payload: StreamMessagePayload): void {
    const innerMsg = payload.msg as InnerMessagePayload | undefined;
    const ops = getOps(innerMsg) as StreamOperation[];
    if (ops.length === 0) return;

    const changed = new Set<string>();

    for (const op of ops) {
      const insertOrModify = getInsertOrModify(op) as InsertOrModifyOperation | undefined;
      const rows = getRows(insertOrModify) as StreamRow[];
      for (const r of rows) {
        const data = r.data;
        const ns = data?.['.namespace.name'];
        if (!ns) continue;

        const stats = this.getOrCreateFabricStats(ns);
        const newHealth = Number(data?.health ?? data?.status?.health ?? 0);
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
    key: FabricGroupKey
  ): void {
    if (this.selectedNamespace === ALL_NAMESPACES || this.selectedNamespace === ns) {
      const stats = this.computeFabricGroupStats(this.selectedNamespace, key);
      const commandMap = {
        spines: 'fabricSpineStats',
        leafs: 'fabricLeafStats',
        borderleafs: 'fabricBorderLeafStats',
        superspines: 'fabricSuperSpineStats'
      } as const;
      const command = commandMap[key];
      this.panel.webview.postMessage({ command, namespace: this.selectedNamespace, stats });
    }
  }

  private postFabricHealthIfNeeded(ns: string): void {
    if (this.selectedNamespace === ALL_NAMESPACES || this.selectedNamespace === ns) {
      const health = this.computeFabricHealth(this.selectedNamespace);
      this.panel.webview.postMessage({ command: 'fabricHealth', namespace: this.selectedNamespace, health });
    }
  }

  static async show(context: vscode.ExtensionContext, title: string): Promise<FabricDashboardPanel> {
    if (FabricDashboardPanel.currentPanel) {
      FabricDashboardPanel.currentPanel.panel.title = title;
      FabricDashboardPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
      return FabricDashboardPanel.currentPanel;
    }

    const panel = new FabricDashboardPanel(context, title);
    await panel.initialize();
    FabricDashboardPanel.currentPanel = panel;
    panel.panel.onDidDispose(() => {
      if (FabricDashboardPanel.currentPanel === panel) {
        FabricDashboardPanel.currentPanel = undefined;
      }
    });
    return panel;
  }
}
