import * as vscode from 'vscode';

import { BasePanel } from '../../basePanel';
import { ALL_NAMESPACES, RESOURCES_DIR } from '../../constants';
import { serviceManager } from '../../../services/serviceManager';
import { namespaceSelectionService } from '../../../services/namespaceSelectionService';
import type { EdaClient } from '../../../clients/edaClient';
import { parseUpdateKey } from '../../../utils/parseUpdateKey';
import {
  getUpdates,
  getOps,
  getInsertOrModify,
  getRows,
  getDelete,
  getDeleteIds,
  type StreamMessageWithUpdates
} from '../../../utils/streamMessageUtils';
import {
  type NodePositionMap,
  normalizeNodePositionMap,
  parseNodePositionAnnotation,
  serializeNodePositionAnnotation
} from './topologyPositionUtils';

// --- K8s Resource Types ---

/** Standard Kubernetes object metadata */
interface K8sMetadata {
  name?: string;
  namespace?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  [key: string]: unknown;
}

/** Generic Kubernetes resource structure */
interface K8sResource {
  apiVersion?: string;
  kind?: string;
  metadata?: K8sMetadata;
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  [key: string]: unknown;
}

/** TopoNode resource returned from EDA API */
interface TopoNode extends K8sResource {
  metadata?: K8sMetadata;
}

/** TopoLink spec link entry */
interface TopoLinkSpecEntry {
  local?: {
    node?: string;
    interface?: string;
  };
  remote?: {
    node?: string;
    interface?: string;
  };
}

/** TopoLink status member entry */
interface TopoLinkStatusMember {
  node?: string;
  interface?: string;
  operationalState?: string;
}

/** TopoLink resource returned from EDA API */
interface TopoLink extends K8sResource {
  metadata?: K8sMetadata & {
    labels?: Record<string, string> & {
      'eda.nokia.com/role'?: string;
    };
  };
  spec?: {
    links?: TopoLinkSpecEntry[];
    [key: string]: unknown;
  };
  status?: {
    operationalState?: string;
    operationalstate?: string;
    members?: TopoLinkStatusMember[];
    [key: string]: unknown;
  };
}

/** Topology resource */
interface Topology extends K8sResource {
  name?: string;
  metadata?: K8sMetadata;
}

/** TopologyGrouping tier selector */
interface TierSelectorSpec {
  tier?: number;
  nodeSelector?: string[];
}

/** TopologyGrouping resource */
interface TopologyGrouping {
  metadata?: K8sMetadata;
  spec?: {
    tierSelectors?: TierSelectorSpec[];
    [key: string]: unknown;
  };
}

// --- Internal Types ---

interface TierSelector {
  tier: number;
  nodeSelector?: string[];
}

interface EdgeData {
  source: string;
  target: string;
  sourceInterface?: string;
  targetInterface?: string;
  sourceEndpoint?: string;
  targetEndpoint?: string;
  sourceState?: string;
  targetState?: string;
  sourceOutBps?: number;
  targetOutBps?: number;
  state?: string;
  label?: string;
  raw?: TopoLinkSpecEntry;
  rawResource?: TopoLink;
}

interface NodeData {
  id: string;
  label: string;
  tier: number;
  role?: string;
  raw: TopoNode;
}

// --- Webview Message Types ---

interface WebviewReadyMessage {
  command: 'ready';
}

interface WebviewSshTopoNodeMessage {
  command: 'sshTopoNode';
  name: string;
  namespace: string;
  nodeDetails: string;
}

interface WebviewOpenResourceMessage {
  command: 'openResource';
  raw: unknown;
  streamGroup: string;
}

interface WebviewSaveTopologyPositionsMessage {
  command: 'saveTopologyPositions';
  namespace: string;
  positions: NodePositionMap;
}

interface WebviewExportSvgGrafanaBundleMessage {
  command: 'exportSvgGrafanaBundle';
  requestId: string;
  baseName: string;
  svgContent: string;
  dashboardJson: string;
  panelYaml: string;
}

interface GrafanaBundleExportPayload {
  requestId: string;
  baseName: string;
  svgContent: string;
  dashboardJson: string;
  panelYaml: string;
}

type WebviewMessage =
  | WebviewReadyMessage
  | WebviewSshTopoNodeMessage
  | WebviewOpenResourceMessage
  | WebviewSaveTopologyPositionsMessage
  | WebviewExportSvgGrafanaBundleMessage;

// --- Stream Message Types ---

interface StreamUpdate {
  key?: string;
  data?: K8sResource | null;
}

interface StreamMessagePayload {
  msg: StreamMessageWithUpdates | null | undefined;
}

interface StreamRowLike {
  id?: string | number;
  data?: unknown;
  [key: string]: unknown;
}

const TOPOLOGY_GROUP = 'topologies.eda.nokia.com';
const TOPOLOGY_VERSION = 'v1alpha1';
const TOPOLOGY_KIND = 'Topology';
const TOPOLOGY_PLURAL = 'topologies';
const TOPOLOGY_BOOTSTRAP_LABEL = 'eda.nokia.com/bootstrap';
const TOPOLOGY_NODE_POSITIONS_ANNOTATION = 'eda.nokia.com/topology-node-positions';
const TOPOLOGY_INTERFACE_TRAFFIC_RATE_EQL_QUERY = '.namespace.node.srl.interface.traffic-rate';

export class TopologyFlowDashboardPanel extends BasePanel {
  private static currentPanel: TopologyFlowDashboardPanel | undefined;
  private edaClient: EdaClient;
  private nodeMap: Map<string, Map<string, TopoNode>> = new Map();
  private linkMap: Map<string, TopoLink[]> = new Map();
  private interfaceOutBpsByEndpoint: Map<string, number> = new Map();
  private interfaceRateRowKeyById: Map<string, string> = new Map();
  private interfaceTrafficRateStreamName = '';
  private interfaceTrafficRateNamespaceFilter: string | undefined;
  private groupings: TierSelector[] = [];
  private selectedNamespace = ALL_NAMESPACES;
  private savedPositionsByNamespace: Map<string, NodePositionMap> = new Map();
  private postGraphTimer: ReturnType<typeof setTimeout> | undefined;
  private loadingEpoch = 0;
  private namespaceSelectionDisposable: vscode.Disposable;

  constructor(context: vscode.ExtensionContext, title: string) {
    super(context, 'topologyFlowDashboard', title, undefined, BasePanel.getEdaIconPath(context));

    this.edaClient = serviceManager.getClient<EdaClient>('eda');
    this.selectedNamespace = namespaceSelectionService.getSelectedNamespace();

    const streamDisposable = this.edaClient.onStreamMessage((stream, msg: unknown) => {
      const payload = msg as StreamMessagePayload;
      if (stream === 'toponodes') {
        this.handleTopoNodeStream(payload);
      } else if (stream === 'topolinks') {
        this.handleTopoLinkStream(payload);
      } else if (stream === this.interfaceTrafficRateStreamName) {
        this.handleInterfaceTrafficRateStream(payload);
      }
    });

    this.panel.onDidDispose(() => {
      streamDisposable.dispose();
      this.namespaceSelectionDisposable.dispose();
      if (this.postGraphTimer) clearTimeout(this.postGraphTimer);
      this.edaClient.closeTopoNodeStream();
      this.edaClient.closeTopoLinkStream();
      void this.edaClient.closeEqlStream(this.interfaceTrafficRateStreamName);
    });

    this.panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      if (msg.command === 'ready') {
        this.postNamespaceSelection();
        this.loadingEpoch += 1;
        if (this.postGraphTimer) { clearTimeout(this.postGraphTimer); this.postGraphTimer = undefined; }
        await this.loadGroupings();
        await this.loadInitial(this.selectedNamespace);
      } else if (msg.command === 'sshTopoNode') {
        await vscode.commands.executeCommand('vscode-eda.sshTopoNode', {
          name: msg.name,
          namespace: msg.namespace,
          nodeDetails: msg.nodeDetails
        });
      } else if (msg.command === 'openResource') {
        await vscode.commands.executeCommand('vscode-eda.viewResource', {
          raw: msg.raw,
          streamGroup: msg.streamGroup
        });
      } else if (msg.command === 'saveTopologyPositions') {
        await this.handleSaveTopologyPositions(msg.namespace, msg.positions);
      } else if (msg.command === 'exportSvgGrafanaBundle') {
        await this.handleGrafanaBundleExport(msg);
      }
    });

    this.namespaceSelectionDisposable = namespaceSelectionService.onDidChangeSelection((namespace) => {
      this.applyNamespaceSelection(namespace);
    });
    this.panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.visible) {
        this.postNamespaceSelection();
        void this.loadInitial(this.selectedNamespace);
      }
    });

    this.panel.webview.html = this.buildHtml();
    this.initializeStreams();
  }

  private initializeStreams(): void {
    void this.edaClient.streamTopoNodes();
    void this.edaClient.streamTopoLinks();
  }

  protected getCustomStyles(): string {
    return this.readWebviewFile('dashboard', 'topologyFlow', 'topologyFlowDashboard.css');
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'topologyFlowDashboard.js');
    return `<script type="module" nonce="${nonce}" src="${scriptUri}"></script>`;
  }

  protected buildHtml(): string {
    const nonce = this.getNonce();
    const csp = this.panel.webview.cspSource;
    const reactFlowUri = this.getResourceUri(RESOURCES_DIR, 'reactflow.css');
    const styles = this.getCustomStyles();

    const scriptTags = this.getScriptTags(nonce);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} https:; style-src ${csp} 'unsafe-inline'; font-src ${csp}; script-src 'nonce-${nonce}' ${csp};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${reactFlowUri}" rel="stylesheet">
  <style>${styles}</style>
</head>
<body>
  <div id="root"></div>
  ${scriptTags}
</body>
</html>`;
  }

  private sanitizeExportBaseName(baseName: string): string {
    const trimmed = baseName.trim();
    if (!trimmed) return 'topology';

    const withoutSvg = trimmed.replace(/\\.svg$/i, '');
    const invalidChars = new Set(['<', '>', ':', '"', '/', '\\\\', '|', '?', '*']);
    const sanitized = withoutSvg
      .split('')
      .map((char) => (char.charCodeAt(0) < 32 || invalidChars.has(char) ? '-' : char))
      .join('')
      .trim();

    return sanitized || 'topology';
  }

  private parseGrafanaBundlePayload(
    message: WebviewExportSvgGrafanaBundleMessage
  ): GrafanaBundleExportPayload | null {
    const requestId = typeof message.requestId === 'string' ? message.requestId.trim() : '';
    const svgContent = typeof message.svgContent === 'string' ? message.svgContent : '';
    const dashboardJson = typeof message.dashboardJson === 'string' ? message.dashboardJson : '';
    const panelYaml = typeof message.panelYaml === 'string' ? message.panelYaml : '';
    if (!requestId || !svgContent || !dashboardJson || !panelYaml) {
      return null;
    }

    return {
      requestId,
      baseName: this.sanitizeExportBaseName(typeof message.baseName === 'string' ? message.baseName : ''),
      svgContent,
      dashboardJson,
      panelYaml
    };
  }

  private postSvgExportResult(payload: {
    requestId: string;
    success: boolean;
    error?: string;
    files?: string[];
  }): void {
    void this.panel.webview.postMessage({
      command: 'svgExportResult',
      requestId: payload.requestId,
      success: payload.success,
      ...(payload.error != null && payload.error.length > 0 ? { error: payload.error } : {}),
      ...(Array.isArray(payload.files) && payload.files.length > 0 ? { files: payload.files } : {})
    });
  }

  private async writeTextFile(filePath: string, content: string): Promise<void> {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(content, 'utf8'));
  }

  private async handleGrafanaBundleExport(message: WebviewExportSvgGrafanaBundleMessage): Promise<void> {
    const payload = this.parseGrafanaBundlePayload(message);
    const requestId = payload?.requestId ?? (typeof message.requestId === 'string' ? message.requestId : '');

    if (!payload) {
      this.postSvgExportResult({
        requestId,
        success: false,
        error: 'Invalid SVG Grafana export payload'
      });
      return;
    }

    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    const defaultUri = workspaceUri != null
      ? vscode.Uri.joinPath(workspaceUri, `${payload.baseName}.svg`)
      : undefined;

    try {
      const selectedUri = await vscode.window.showSaveDialog({
        title: 'Export Grafana SVG Bundle',
        saveLabel: 'Export',
        defaultUri,
        filters: { SVG: ['svg'] }
      });

      if (!selectedUri) {
        this.postSvgExportResult({
          requestId: payload.requestId,
          success: false,
          error: 'Export cancelled'
        });
        return;
      }

      const selectedPath = selectedUri.fsPath;
      const basePath = selectedPath.toLowerCase().endsWith('.svg')
        ? selectedPath.slice(0, -4)
        : selectedPath;

      const svgPath = `${basePath}.svg`;
      const dashboardPath = `${basePath}.grafana.json`;
      const panelPath = `${basePath}.flow_panel.yaml`;

      await this.writeTextFile(svgPath, payload.svgContent);
      await this.writeTextFile(dashboardPath, payload.dashboardJson);
      await this.writeTextFile(panelPath, payload.panelYaml);

      this.postSvgExportResult({
        requestId: payload.requestId,
        success: true,
        files: [svgPath, dashboardPath, panelPath]
      });
    } catch (error: unknown) {
      this.postSvgExportResult({
        requestId: payload.requestId,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private postNamespaceSelection(): void {
    this.panel.webview.postMessage({
      command: 'init',
      selected: this.selectedNamespace
    });
  }

  private applyNamespaceSelection(namespace: string): void {
    this.selectedNamespace = namespace;
    this.panel.webview.postMessage({
      command: 'namespace',
      selected: namespace
    });
    if (this.panel.visible) {
      void this.loadInitial(namespace);
    }
  }

  private async loadGroupings(): Promise<void> {
    try {
      const topologies = (await this.edaClient.listTopologies()) as Topology[];
      if (!Array.isArray(topologies) || topologies.length === 0) {
        return;
      }
      const topologyName = topologies[0]?.name;
      if (!topologyName) {
        return;
      }
      const list = (await this.edaClient.listTopologyGroupings(topologyName)) as TopologyGrouping[];
      if (Array.isArray(list) && list.length) {
        const grp = list[0]?.spec?.tierSelectors;
        if (Array.isArray(grp)) {
          this.groupings = grp.map((g: TierSelectorSpec) => ({
            tier: Number(g.tier) || 1,
            nodeSelector: Array.isArray(g.nodeSelector) ? g.nodeSelector : []
          }));
        }
      }
    } catch {
      /* ignore */
    }
  }

  private async loadNamespaceData(n: string): Promise<void> {
    const nodes = (await this.edaClient.listTopoNodes(n)) as TopoNode[];
    const map = new Map<string, TopoNode>();
    for (const node of nodes) {
      const name = node.metadata?.name;
      if (!name) continue;
      map.set(name, node);
    }
    this.nodeMap.set(n, map);
    const links = (await this.edaClient.listTopoLinks(n)) as TopoLink[];
    const filtered = Array.isArray(links)
      ? links.filter(l => l.metadata?.labels?.['eda.nokia.com/role'] !== 'edge')
      : [];
    this.linkMap.set(n, filtered);
  }

  private async loadInitial(ns: string): Promise<void> {
    this.loadingEpoch += 1;
    const myEpoch = this.loadingEpoch;
    if (this.postGraphTimer) { clearTimeout(this.postGraphTimer); this.postGraphTimer = undefined; }

    try {
      this.selectedNamespace = ns;
      void this.ensureInterfaceTrafficRateStream(ns);
      const coreNs = this.edaClient.getCoreNamespace();
      const target =
        ns === ALL_NAMESPACES
          ? this.edaClient.getCachedNamespaces().filter(n => n !== coreNs)
          : [ns];
      const loaded = new Set<string>();
      for (const n of target) {
        try {
          await this.loadNamespaceData(n);
          loaded.add(n);
        } catch {
          /* ignore */
        }
      }

      // Streams may have discovered additional namespaces during the load above.
      // Load their data so links are not missing.
      if (ns === ALL_NAMESPACES) {
        for (const n of this.nodeMap.keys()) {
          if (n === coreNs || loaded.has(n)) continue;
          try {
            await this.loadNamespaceData(n);
            loaded.add(n);
          } catch {
            /* ignore */
          }
        }
      }

      if (ns === ALL_NAMESPACES) {
        this.savedPositionsByNamespace.clear();
        await this.loadSavedPositionsForNamespaces(Array.from(loaded));
      } else {
        await this.loadSavedPositionsForNamespace(ns);
      }
    } finally {
      if (myEpoch === this.loadingEpoch) {
        this.loadingEpoch = 0;
        this.postGraph();
      }
    }
  }

  private async getTopologyByName(topologyName: string): Promise<Topology | undefined> {
    const topologies = (await this.edaClient.listResources(
      TOPOLOGY_GROUP,
      TOPOLOGY_VERSION,
      TOPOLOGY_KIND
    )) as Topology[];

    return topologies.find((topology) => topology.metadata?.name === topologyName);
  }

  private parseSavedPositions(topology: Topology | undefined): NodePositionMap {
    const annotation = topology?.metadata?.annotations?.[TOPOLOGY_NODE_POSITIONS_ANNOTATION];
    return parseNodePositionAnnotation(annotation);
  }

  private async loadSavedPositionsForNamespace(namespace: string): Promise<void> {
    await this.loadSavedPositionsForNamespaces([namespace]);
  }

  private async loadSavedPositionsForNamespaces(namespaces: string[]): Promise<void> {
    const uniqueNamespaces = Array.from(new Set(namespaces.filter(Boolean)));
    if (uniqueNamespaces.length === 0) {
      return;
    }

    try {
      const topologies = (await this.edaClient.listResources(
        TOPOLOGY_GROUP,
        TOPOLOGY_VERSION,
        TOPOLOGY_KIND
      )) as Topology[];

      const topologyByName = new Map<string, Topology>();
      if (Array.isArray(topologies)) {
        for (const topology of topologies) {
          const topologyName = topology.metadata?.name;
          if (!topologyName) {
            continue;
          }
          topologyByName.set(topologyName, topology);
        }
      }

      for (const namespace of uniqueNamespaces) {
        this.savedPositionsByNamespace.set(
          namespace,
          this.parseSavedPositions(topologyByName.get(namespace))
        );
      }
    } catch {
      for (const namespace of uniqueNamespaces) {
        this.savedPositionsByNamespace.set(namespace, {});
      }
    }
  }

  private buildMergedSavedPositions(namespaces: string[]): NodePositionMap {
    const merged: NodePositionMap = {};

    for (const namespace of namespaces) {
      const savedForNamespace = this.savedPositionsByNamespace.get(namespace);
      if (!savedForNamespace) {
        continue;
      }

      for (const [nodeName, position] of Object.entries(savedForNamespace)) {
        const namespacedNodeId = nodeName.includes('/') ? nodeName : `${namespace}/${nodeName}`;
        merged[namespacedNodeId] = position;
      }
    }

    return normalizeNodePositionMap(merged);
  }

  private postSaveResult(ok: boolean, message: string, positions: NodePositionMap): void {
    void this.panel.webview.postMessage({
      command: 'saveTopologyPositionsResult',
      ok,
      message,
      positions
    });
  }

  private buildTopologyCreateBody(topologyName: string, positions: NodePositionMap): Topology {
    return {
      apiVersion: `${TOPOLOGY_GROUP}/${TOPOLOGY_VERSION}`,
      kind: TOPOLOGY_KIND,
      metadata: {
        name: topologyName,
        labels: {
          [TOPOLOGY_BOOTSTRAP_LABEL]: 'true'
        },
        annotations: {
          [TOPOLOGY_NODE_POSITIONS_ANNOTATION]: serializeNodePositionAnnotation(positions)
        }
      },
      spec: {
        enabled: false,
        overlays: [{ enabled: true, key: 'status' }]
      }
    };
  }

  private buildTopologyUpdateBody(
    topology: Topology,
    topologyName: string,
    positions: NodePositionMap
  ): Topology {
    const metadata = topology.metadata ?? {};
    const annotations = metadata.annotations ?? {};
    const { namespace: _discardNamespace, ...metadataWithoutNamespace } = metadata;

    return {
      ...topology,
      apiVersion: topology.apiVersion ?? `${TOPOLOGY_GROUP}/${TOPOLOGY_VERSION}`,
      kind: topology.kind ?? TOPOLOGY_KIND,
      metadata: {
        ...metadataWithoutNamespace,
        name: metadata.name ?? topologyName,
        annotations: {
          ...annotations,
          [TOPOLOGY_NODE_POSITIONS_ANNOTATION]: serializeNodePositionAnnotation(positions)
        }
      }
    };
  }

  private async handleSaveTopologyPositions(namespace: string, positions: NodePositionMap): Promise<void> {
    if (namespace === ALL_NAMESPACES) {
      this.postSaveResult(false, 'Select a single namespace to save layout.', {});
      return;
    }

    const normalizedPositions = normalizeNodePositionMap(positions);
    const topologyName = namespace;

    try {
      const existingTopology = await this.getTopologyByName(topologyName);

      if (existingTopology) {
        const topologyResourceName = existingTopology.metadata?.name ?? topologyName;
        const updateBody = this.buildTopologyUpdateBody(
          existingTopology,
          topologyResourceName,
          normalizedPositions
        );
        await this.edaClient.updateCustomResource(
          TOPOLOGY_GROUP,
          TOPOLOGY_VERSION,
          undefined,
          TOPOLOGY_PLURAL,
          topologyResourceName,
          updateBody,
          false
        );
      } else {
        const createBody = this.buildTopologyCreateBody(topologyName, normalizedPositions);
        await this.edaClient.createCustomResource(
          TOPOLOGY_GROUP,
          TOPOLOGY_VERSION,
          undefined,
          TOPOLOGY_PLURAL,
          createBody,
          false
        );
      }

      this.savedPositionsByNamespace.set(namespace, normalizedPositions);
      this.postSaveResult(true, `Saved layout for topology ${topologyName}.`, normalizedPositions);
      this.postGraph();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.postSaveResult(false, `Failed to save layout: ${message}`, normalizedPositions);
    }
  }

  private normalizeInterfaceRatePart(value: string | undefined): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    return trimmed.toLowerCase();
  }

  private normalizeInterfaceRateEndpoint(value: string | undefined): string | null {
    const normalized = this.normalizeInterfaceRatePart(value);
    if (normalized === null) {
      return null;
    }
    return normalized.replace(/\//g, '-');
  }

  private buildInterfaceRateKey(namespace: string | undefined, node: string | undefined, endpoint: string | undefined): string | null {
    const normalizedNamespace = this.normalizeInterfaceRatePart(namespace);
    const normalizedNode = this.normalizeInterfaceRatePart(node);
    const normalizedEndpoint = this.normalizeInterfaceRateEndpoint(endpoint);
    if (!normalizedNamespace || !normalizedNode || !normalizedEndpoint) {
      return null;
    }
    return `${normalizedNamespace}/${normalizedNode}:${normalizedEndpoint}`;
  }

  private getInterfaceOutBps(namespace: string, node: string | undefined, endpoint: string | undefined): number | undefined {
    const key = this.buildInterfaceRateKey(namespace, node, endpoint);
    if (key === null) {
      return undefined;
    }
    return this.interfaceOutBpsByEndpoint.get(key);
  }

  private asNonEmptyString(value: unknown): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return null;
  }

  private asFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value.trim());
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private flattenRecord(value: unknown, prefix = ''): Record<string, unknown> {
    const flattened: Record<string, unknown> = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return flattened;
    }

    const record = value as Record<string, unknown>;
    for (const [key, nestedValue] of Object.entries(record)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
        Object.assign(flattened, this.flattenRecord(nestedValue, fullKey));
      } else {
        flattened[fullKey] = nestedValue;
      }
    }
    return flattened;
  }

  private findFlattenedString(
    flattened: Record<string, unknown>,
    exactKeys: readonly string[],
    fallbackMatcher: RegExp
  ): string | null {
    const entries = Object.entries(flattened);

    for (const exactKey of exactKeys) {
      const lowerExactKey = exactKey.toLowerCase();
      for (const [key, value] of entries) {
        if (key.toLowerCase() !== lowerExactKey) continue;
        const parsed = this.asNonEmptyString(value);
        if (parsed !== null) {
          return parsed;
        }
      }
    }

    for (const [key, value] of entries) {
      if (!fallbackMatcher.test(key)) continue;
      const parsed = this.asNonEmptyString(value);
      if (parsed !== null) {
        return parsed;
      }
    }

    return null;
  }

  private findFlattenedNumber(
    flattened: Record<string, unknown>,
    exactKeys: readonly string[],
    fallbackMatcher: RegExp
  ): number | null {
    const entries = Object.entries(flattened);

    for (const exactKey of exactKeys) {
      const lowerExactKey = exactKey.toLowerCase();
      for (const [key, value] of entries) {
        if (key.toLowerCase() !== lowerExactKey) continue;
        const parsed = this.asFiniteNumber(value);
        if (parsed !== null) {
          return parsed;
        }
      }
    }

    for (const [key, value] of entries) {
      if (!fallbackMatcher.test(key)) continue;
      const parsed = this.asFiniteNumber(value);
      if (parsed !== null) {
        return parsed;
      }
    }

    return null;
  }

  private extractInterfaceOutBpsEntry(
    value: unknown
  ): { endpointKey: string; outBps: number } | null {
    const flattened = this.flattenRecord(value);
    if (Object.keys(flattened).length === 0) {
      return null;
    }

    const namespace = this.findFlattenedString(
      flattened,
      ['.namespace.name', 'namespace', 'namespace.name', 'metadata.namespace'],
      /(^|\.)(namespace(\.name)?|ns)$/i
    );
    let node = this.findFlattenedString(
      flattened,
      ['node', 'node.name', '.namespace.node.name', 'node-name', 'node_name', 'source'],
      /(^|\.)(node(\.name)?|node-name|node_name|source|src)$/i
    );
    let endpoint = this.findFlattenedString(
      flattened,
      [
        'interface',
        'interface.name',
        '.namespace.node.srl.interface.name',
        'interface-name',
        'interface_name',
        'if-name',
        'if_name',
        'ifname'
      ],
      /(^|\.)(interface(\.name)?|interface-name|interface_name|if-name|if_name|ifname)$/i
    );
    if (node === null) {
      node = this.findFlattenedString(flattened, ['source'], /(^|\.)(source|src)$/i);
    }
    if (endpoint === null) {
      const bareName = this.findFlattenedString(flattened, ['name'], /^name$/i);
      if (bareName !== null && bareName !== namespace && bareName !== node) {
        endpoint = bareName;
      }
    }
    const outBps = this.findFlattenedNumber(
      flattened,
      [
        'out-bps',
        'out_bps',
        'outbps',
        'sum(out-bps)',
        'sum(out_bps)',
        'traffic-rate.out-bps',
        'traffic-rate.out_bps'
      ],
      /(^|\.)(sum\()?out[^a-z0-9]*bps\)?$/i
    );

    if (namespace === null || node === null || endpoint === null || outBps === null) {
      return null;
    }

    const endpointKey = this.buildInterfaceRateKey(namespace, node, endpoint);
    if (endpointKey === null) {
      return null;
    }

    return { endpointKey, outBps };
  }

  private upsertInterfaceOutBpsFromRecord(
    record: unknown
  ): { endpointKey: string; changed: boolean } | null {
    const parsed = this.extractInterfaceOutBpsEntry(record);
    if (!parsed) {
      return null;
    }

    const previous = this.interfaceOutBpsByEndpoint.get(parsed.endpointKey);
    const changed = previous === undefined || previous !== parsed.outBps;
    this.interfaceOutBpsByEndpoint.set(parsed.endpointKey, parsed.outBps);
    return { endpointKey: parsed.endpointKey, changed };
  }

  private deleteInterfaceOutBpsByRowId(rowId: unknown): boolean {
    const key = String(rowId);
    const endpointKey = this.interfaceRateRowKeyById.get(key);
    if (!endpointKey) {
      return false;
    }
    this.interfaceRateRowKeyById.delete(key);
    return this.interfaceOutBpsByEndpoint.delete(endpointKey);
  }

  private applyInterfaceRateRow(row: unknown): boolean {
    if (!row || typeof row !== 'object') {
      return false;
    }

    const rowObject = row as StreamRowLike;
    const rowId = rowObject.id !== undefined ? String(rowObject.id) : undefined;
    let upserted = this.upsertInterfaceOutBpsFromRecord(rowObject.data);
    if (!upserted) {
      upserted = this.upsertInterfaceOutBpsFromRecord(row);
    }
    if (!upserted) {
      return false;
    }

    if (rowId) {
      this.interfaceRateRowKeyById.set(rowId, upserted.endpointKey);
    }
    return upserted.changed;
  }

  private applyInterfaceRateUpdate(update: unknown): boolean {
    if (!update || typeof update !== 'object') {
      return false;
    }

    const updateObject = update as Record<string, unknown>;
    const updateKey = updateObject.key;
    const rowId = updateKey !== undefined ? String(updateKey) : undefined;
    if (updateObject.data === null) {
      if (!rowId) {
        return false;
      }
      return this.deleteInterfaceOutBpsByRowId(rowId);
    }

    let upserted = this.upsertInterfaceOutBpsFromRecord(updateObject.data);
    if (!upserted) {
      upserted = this.upsertInterfaceOutBpsFromRecord(updateObject);
    }
    if (!upserted) {
      return false;
    }

    if (rowId) {
      this.interfaceRateRowKeyById.set(rowId, upserted.endpointKey);
    }
    return upserted.changed;
  }

  private handleInterfaceTrafficRateStream(message: StreamMessagePayload): void {
    const payload = message.msg;
    if (!payload || typeof payload !== 'object') {
      return;
    }

    let changed = false;
    const ops = getOps(payload as { op?: unknown[]; Op?: unknown[] });
    if (ops.length > 0) {
      for (const op of ops) {
        const deleteOperation = getDelete(op as Record<string, unknown> | undefined);
        const deleteIds = getDeleteIds(deleteOperation as Record<string, unknown> | undefined);
        for (const deleteId of deleteIds) {
          if (this.deleteInterfaceOutBpsByRowId(deleteId)) {
            changed = true;
          }
        }

        const insertOrModify = getInsertOrModify(op as Record<string, unknown> | undefined);
        const rows = getRows(insertOrModify as Record<string, unknown> | undefined);
        for (const row of rows) {
          if (this.applyInterfaceRateRow(row)) {
            changed = true;
          }
        }
      }
    } else {
      const updates = getUpdates(payload as StreamMessageWithUpdates);
      for (const update of updates) {
        if (this.applyInterfaceRateUpdate(update)) {
          changed = true;
        }
      }
    }

    if (changed) {
      this.schedulePostGraph();
    }
  }

  private async ensureInterfaceTrafficRateStream(namespace: string): Promise<void> {
    const namespaceFilter = namespace === ALL_NAMESPACES ? undefined : namespace;
    if (
      this.interfaceTrafficRateStreamName.length > 0
      && this.interfaceTrafficRateNamespaceFilter === namespaceFilter
    ) {
      return;
    }

    if (this.interfaceTrafficRateStreamName.length > 0) {
      await this.edaClient.closeEqlStream(this.interfaceTrafficRateStreamName);
    }

    this.interfaceOutBpsByEndpoint.clear();
    this.interfaceRateRowKeyById.clear();
    this.interfaceTrafficRateNamespaceFilter = namespaceFilter;

    const nextStreamName = `topology-traffic-rate-${namespaceFilter ?? 'all'}-${Date.now()}`;
    this.interfaceTrafficRateStreamName = nextStreamName;

    try {
      await this.edaClient.streamEql(
        TOPOLOGY_INTERFACE_TRAFFIC_RATE_EQL_QUERY,
        namespaceFilter,
        nextStreamName
      );
    } catch {
      if (this.interfaceTrafficRateStreamName === nextStreamName) {
        this.interfaceTrafficRateStreamName = '';
      }
    }

    this.schedulePostGraph();
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

  private getRole(labels: Record<string, string>): string | undefined {
    return labels?.['eda.nokia.com/role'];
  }

  private shortenInterfaceName(name: string | undefined): string {
    if (!name) return '';
    return name.replace(/ethernet-/gi, 'e-');
  }

  private getTargetNamespaces(): string[] {
    const coreNs = this.edaClient.getCoreNamespace();
    return this.selectedNamespace === ALL_NAMESPACES
      ? Array.from(this.nodeMap.keys()).filter(n => n !== coreNs)
      : [this.selectedNamespace];
  }

  private buildNodesForNamespace(ns: string): NodeData[] {
    const nodes: NodeData[] = [];
    const nm = this.nodeMap.get(ns);
    if (!nm) return nodes;

    for (const node of nm.values()) {
      const name = node.metadata?.name;
      if (!name) continue;
      const labels = node.metadata?.labels ?? {};
      const tier = this.getTier(labels);
      const role = this.getRole(labels);
      nodes.push({ id: `${ns}/${name}`, label: name, tier, role, raw: node });
    }
    return nodes;
  }

  private buildEdgeData(
    ns: string,
    link: TopoLink,
    linkSpec: TopoLinkSpecEntry,
    members: TopoLinkStatusMember[]
  ): EdgeData | null {
    const src = linkSpec.local?.node;
    const dst = linkSpec.remote?.node;
    if (!src || !dst) return null;

    const edgeData: EdgeData = {
      source: `${ns}/${src}`,
      target: `${ns}/${dst}`,
      raw: linkSpec,
      rawResource: link,
      state: link.status?.operationalState ?? link.status?.operationalstate ?? ''
    };

    this.populateInterfaceData(ns, edgeData, linkSpec, members);
    return edgeData;
  }

  private populateInterfaceData(
    ns: string,
    edgeData: EdgeData,
    linkSpec: TopoLinkSpecEntry,
    members: TopoLinkStatusMember[]
  ): void {
    if (linkSpec.local?.interface) {
      edgeData.sourceEndpoint = linkSpec.local.interface;
      edgeData.sourceInterface = this.shortenInterfaceName(linkSpec.local.interface);
      edgeData.sourceOutBps = this.getInterfaceOutBps(
        ns,
        linkSpec.local?.node,
        linkSpec.local?.interface
      );
      const ms = members.find(
        (m: TopoLinkStatusMember) =>
          m.node === linkSpec.local?.node && m.interface === linkSpec.local?.interface
      );
      if (ms) edgeData.sourceState = ms.operationalState;
    }
    if (linkSpec.remote?.interface) {
      edgeData.targetEndpoint = linkSpec.remote.interface;
      edgeData.targetInterface = this.shortenInterfaceName(linkSpec.remote.interface);
      edgeData.targetOutBps = this.getInterfaceOutBps(
        ns,
        linkSpec.remote?.node,
        linkSpec.remote?.interface
      );
      const ms = members.find(
        (m: TopoLinkStatusMember) =>
          m.node === linkSpec.remote?.node && m.interface === linkSpec.remote?.interface
      );
      if (ms) edgeData.targetState = ms.operationalState;
    }
  }

  private buildEdgesForNamespace(ns: string): EdgeData[] {
    const edges: EdgeData[] = [];
    const lm = this.linkMap.get(ns);
    if (!lm) return edges;

    for (const link of lm) {
      const role = link.metadata?.labels?.['eda.nokia.com/role'];
      if (role === 'edge') continue;

      const arr: TopoLinkSpecEntry[] = Array.isArray(link.spec?.links) ? link.spec.links : [];
      const members: TopoLinkStatusMember[] = Array.isArray(link.status?.members)
        ? link.status.members
        : [];

      for (const l of arr) {
        const edgeData = this.buildEdgeData(ns, link, l, members);
        if (edgeData) edges.push(edgeData);
      }
    }
    return edges;
  }

  private schedulePostGraph(): void {
    if (this.postGraphTimer) clearTimeout(this.postGraphTimer);
    if (this.loadingEpoch > 0) return;
    this.postGraphTimer = setTimeout(() => this.postGraph(), 50);
  }

  private postGraph(): void {
    const namespaces = this.getTargetNamespaces();
    const nodes: NodeData[] = [];
    const edges: EdgeData[] = [];

    for (const ns of namespaces) {
      nodes.push(...this.buildNodesForNamespace(ns));
      edges.push(...this.buildEdgesForNamespace(ns));
    }

    const savedPositions =
      this.selectedNamespace === ALL_NAMESPACES
        ? this.buildMergedSavedPositions(namespaces)
        : this.savedPositionsByNamespace.get(this.selectedNamespace) ?? {};

    void this.panel.webview.postMessage({ command: 'data', nodes, edges, savedPositions });
  }

  private parseUpdateIdentifiers(up: StreamUpdate): { name: string; ns: string } | null {
    let name: string | undefined = up.data?.metadata?.name;
    let ns: string | undefined = up.data?.metadata?.namespace;
    if ((!name || !ns) && up.key) {
      const parsed = parseUpdateKey(String(up.key));
      if (!name) name = parsed.name;
      if (!ns) ns = parsed.namespace;
    }
    if (!name || !ns) return null;
    if (ns === this.edaClient.getCoreNamespace()) return null;
    return { name, ns };
  }

  private processNodeUpdate(up: StreamUpdate, name: string, ns: string): void {
    let map = this.nodeMap.get(ns);
    if (!map) {
      map = new Map();
      this.nodeMap.set(ns, map);
    }
    if (up.data === null) {
      map.delete(name);
    } else if (up.data) {
      map.set(name, up.data as TopoNode);
    }
  }

  private handleTopoNodeStream(msg: StreamMessagePayload): void {
    const updates = getUpdates(msg.msg) as StreamUpdate[];
    if (updates.length === 0) return;

    for (const up of updates) {
      const ids = this.parseUpdateIdentifiers(up);
      if (!ids) continue;
      this.processNodeUpdate(up, ids.name, ids.ns);
    }
    this.schedulePostGraph();
  }

  private processLinkUpdate(up: StreamUpdate, name: string, ns: string): void {
    let list = this.linkMap.get(ns);
    if (!list) {
      list = [];
      this.linkMap.set(ns, list);
    }
    const idx = list.findIndex(l => l.metadata?.name === name);

    if (up.data === null) {
      if (idx >= 0) list.splice(idx, 1);
      return;
    }

    const linkData = up.data as TopoLink | undefined;
    const role = linkData?.metadata?.labels?.['eda.nokia.com/role'];
    if (role === 'edge') {
      if (idx >= 0) list.splice(idx, 1);
      return;
    }

    if (linkData) {
      if (idx >= 0) {
        list[idx] = linkData;
      } else {
        list.push(linkData);
      }
    }
  }

  private handleTopoLinkStream(msg: StreamMessagePayload): void {
    const updates = getUpdates(msg.msg) as StreamUpdate[];
    if (updates.length === 0) return;

    for (const up of updates) {
      const ids = this.parseUpdateIdentifiers(up);
      if (!ids) continue;
      this.processLinkUpdate(up, ids.name, ids.ns);
    }
    this.schedulePostGraph();
  }

  static show(context: vscode.ExtensionContext, title: string): TopologyFlowDashboardPanel {
    if (TopologyFlowDashboardPanel.currentPanel) {
      TopologyFlowDashboardPanel.currentPanel.panel.title = title;
      TopologyFlowDashboardPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
      return TopologyFlowDashboardPanel.currentPanel;
    }

    const panel = new TopologyFlowDashboardPanel(context, title);
    TopologyFlowDashboardPanel.currentPanel = panel;
    panel.panel.onDidDispose(() => {
      if (TopologyFlowDashboardPanel.currentPanel === panel) {
        TopologyFlowDashboardPanel.currentPanel = undefined;
      }
    });
    return panel;
  }
}
