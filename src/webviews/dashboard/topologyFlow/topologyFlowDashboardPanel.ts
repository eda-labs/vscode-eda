import * as vscode from 'vscode';

import { BasePanel } from '../../basePanel';
import { ALL_NAMESPACES, RESOURCES_DIR } from '../../constants';
import { serviceManager } from '../../../services/serviceManager';
import type { EdaClient } from '../../../clients/edaClient';
import { parseUpdateKey } from '../../../utils/parseUpdateKey';
import { getUpdates, type StreamMessageWithUpdates } from '../../../utils/streamMessageUtils';

// --- K8s Resource Types ---

/** Standard Kubernetes object metadata */
interface K8sMetadata {
  name?: string;
  namespace?: string;
  labels?: Record<string, string>;
  [key: string]: unknown;
}

/** Generic Kubernetes resource structure */
interface K8sResource {
  apiVersion?: string;
  kind?: string;
  metadata?: K8sMetadata;
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
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
interface Topology {
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
  sourceState?: string;
  targetState?: string;
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

interface WebviewSetNamespaceMessage {
  command: 'setNamespace';
  namespace: string;
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

type WebviewMessage =
  | WebviewReadyMessage
  | WebviewSetNamespaceMessage
  | WebviewSshTopoNodeMessage
  | WebviewOpenResourceMessage;

// --- Stream Message Types ---

interface StreamUpdate {
  key?: string;
  data?: K8sResource | null;
}

interface StreamMessagePayload {
  msg: StreamMessageWithUpdates | null | undefined;
}

export class TopologyFlowDashboardPanel extends BasePanel {
  private edaClient: EdaClient;
  private nodeMap: Map<string, Map<string, TopoNode>> = new Map();
  private linkMap: Map<string, TopoLink[]> = new Map();
  private groupings: TierSelector[] = [];
  private selectedNamespace = ALL_NAMESPACES;

  constructor(context: vscode.ExtensionContext, title: string) {
    super(context, 'topologyFlowDashboard', title, undefined, BasePanel.getEdaIconPath(context));

    this.edaClient = serviceManager.getClient<EdaClient>('eda');

    this.edaClient.onStreamMessage((stream, msg: unknown) => {
      const payload = msg as StreamMessagePayload;
      if (stream === 'toponodes') {
        this.handleTopoNodeStream(payload);
      } else if (stream === 'topolinks') {
        this.handleTopoLinkStream(payload);
      }
    });

    this.panel.onDidDispose(() => {
      this.edaClient.closeTopoNodeStream();
      this.edaClient.closeTopoLinkStream();
    });

    this.panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      if (msg.command === 'ready') {
        this.sendNamespaces();
        await this.loadGroupings();
        await this.loadInitial(ALL_NAMESPACES);
      } else if (msg.command === 'setNamespace') {
        await this.loadInitial(msg.namespace);
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
    return `<script nonce="${nonce}" src="${scriptUri}"></script>`;
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

  private sendNamespaces(): void {
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

  private async loadInitial(ns: string): Promise<void> {
    this.selectedNamespace = ns;
    const target =
      ns === ALL_NAMESPACES
        ? this.edaClient
            .getCachedNamespaces()
            .filter(n => n !== this.edaClient.getCoreNamespace())
        : [ns];
    for (const n of target) {
      try {
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

    this.populateInterfaceData(edgeData, linkSpec, members);
    return edgeData;
  }

  private populateInterfaceData(
    edgeData: EdgeData,
    linkSpec: TopoLinkSpecEntry,
    members: TopoLinkStatusMember[]
  ): void {
    if (linkSpec.local?.interface) {
      edgeData.sourceInterface = this.shortenInterfaceName(linkSpec.local.interface);
      const ms = members.find(
        (m: TopoLinkStatusMember) =>
          m.node === linkSpec.local?.node && m.interface === linkSpec.local?.interface
      );
      if (ms) edgeData.sourceState = ms.operationalState;
    }
    if (linkSpec.remote?.interface) {
      edgeData.targetInterface = this.shortenInterfaceName(linkSpec.remote.interface);
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

  private postGraph(): void {
    const namespaces = this.getTargetNamespaces();
    const nodes: NodeData[] = [];
    const edges: EdgeData[] = [];

    for (const ns of namespaces) {
      nodes.push(...this.buildNodesForNamespace(ns));
      edges.push(...this.buildEdgesForNamespace(ns));
    }

    void this.panel.webview.postMessage({ command: 'data', nodes, edges });
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
    this.postGraph();
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
    this.postGraph();
  }

  static show(context: vscode.ExtensionContext, title: string): TopologyFlowDashboardPanel {
    return new TopologyFlowDashboardPanel(context, title);
  }
}
