import * as vscode from 'vscode';

import { serviceManager } from '../../services/serviceManager';
import type { EdaClient } from '../../clients/edaClient';
import type { ResourceStatusService } from '../../services/resourceStatusService';
import { log, LogLevel } from '../../extension';
import { parseUpdateKey } from '../../utils/parseUpdateKey';
import { getUpdates, type StreamMessageWithUpdates } from '../../utils/streamMessageUtils';

import { FilteredTreeProvider } from './filteredTreeProvider';
import { TreeItemBase } from './treeItem';

export interface EdaDeviation {
  name?: string;
  namespace?: string;
  "namespace.name"?: string;
  metadata?: { name?: string; namespace?: string; resourceVersion?: string };
  kind?: string;
  apiVersion?: string;
  status?: string;
  [key: string]: unknown;
}

/** Stream message structure for deviation updates */
interface DeviationStreamMessage {
  msg: StreamMessageWithUpdates | null | undefined;
  stream?: string;
  items?: EdaDeviation[];
}

/** Structure for deviation updates from stream */
interface DeviationUpdate {
  key?: string;
  data?: EdaDeviation | null;
}

function getDeviationName(d: EdaDeviation): string | undefined {
  return d.name || d.metadata?.name;
}

function getDeviationNamespace(d: EdaDeviation): string | undefined {
  return d['namespace.name'] || d.namespace || d.metadata?.namespace;
}

export class EdaDeviationProvider extends FilteredTreeProvider<DeviationTreeItem> {
  private deviations: Map<string, EdaDeviation> = new Map();
  private edaClient: EdaClient;
  private statusService: ResourceStatusService;
  private refreshHandle: ReturnType<typeof setTimeout> | undefined;
  private pendingCountRefresh = false;
  private refreshIntervalMs = 120;
  private _onDeviationCountChanged = new vscode.EventEmitter<number>();
  readonly onDeviationCountChanged = this._onDeviationCountChanged.event;

  public get count(): number {
    return this.deviations.size;
  }

  constructor() {
    super();
    this.edaClient = serviceManager.getClient<EdaClient>('eda');
    this.statusService = serviceManager.getService<ResourceStatusService>('resource-status');
    const configuredInterval = Number(process.env.EDA_DEVIATION_TREE_REFRESH_MS);
    if (!Number.isNaN(configuredInterval) && configuredInterval >= 0) {
      this.refreshIntervalMs = configuredInterval;
    }
    this.edaClient.onStreamMessage((stream, msg) => {
      if (stream === 'deviations') {
        this.processDeviationMessage(msg as DeviationStreamMessage);
      }
    });

    // Emit initial count
    this._onDeviationCountChanged.fire(this.count);
  }

  /**
   * Initialize the deviation stream. Call this after construction.
   */
  public async initialize(): Promise<void> {
    this.edaClient.streamEdaDeviations().catch(() => {
      // startup path is best-effort; stream errors are surfaced via stream logs/events
    });
  }

  public dispose(): void {
    if (this.refreshHandle) {
      clearTimeout(this.refreshHandle);
      this.refreshHandle = undefined;
    }
    this.pendingCountRefresh = false;
    this.edaClient.closeDeviationStream();
    this._onDeviationCountChanged.dispose();
  }


  private scheduleRefresh(countChanged: boolean): void {
    if (countChanged) {
      this.pendingCountRefresh = true;
    }
    if (this.refreshHandle) {
      return;
    }
    this.refreshHandle = setTimeout(() => {
      this.refreshHandle = undefined;
      this.refresh();
      if (this.pendingCountRefresh) {
        this.pendingCountRefresh = false;
        this._onDeviationCountChanged.fire(this.count);
      }
    }, this.refreshIntervalMs);
  }


  updateDeviation(name: string, namespace: string, status: string): void {
    log(`Updating deviation ${name} in namespace ${namespace} with status: ${status}`, LogLevel.DEBUG);
    const key = `${namespace}/${name}`;
    const dev = this.deviations.get(key);
    if (dev) {
      if (dev.status === status) {
        return;
      }
      this.deviations.set(key, { ...dev, status });
      this.scheduleRefresh(false);
    }
  }

  removeDeviation(name: string, namespace: string): void {
    log(`Removing deviation ${name} from namespace ${namespace} from the tree view`, LogLevel.DEBUG);
    const key = `${namespace}/${name}`;
    if (this.deviations.delete(key)) {
      this.scheduleRefresh(true);
    }
  }

  /** Return all currently cached deviations */
  public getAllDeviations(): EdaDeviation[] {
    return Array.from(this.deviations.values());
  }


  getTreeItem(element: DeviationTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: DeviationTreeItem): DeviationTreeItem[] {
    if (element) {
      return [];
    }
    if (!this.treeFilter) {
      return this.getAllDeviationItems();
    } else {
      return this.getFilteredDeviationItems(this.treeFilter);
    }
  }

  private getAllDeviationItems(): DeviationTreeItem[] {
    if (this.deviations.size === 0) {
      return [this.noDeviationsItem()];
    }
    return Array.from(this.deviations.values()).map(d => this.createDeviationItem(d));
  }

  private getFilteredDeviationItems(filter: string): DeviationTreeItem[] {
    if (this.matchesFilter('deviations')) {
      return this.getAllDeviationItems();
    }
    const matches = Array.from(this.deviations.values()).filter(d => {
      const name = getDeviationName(d) || '';
      const ns = getDeviationNamespace(d) || '';
      const kind = d.kind || '';
      return (
        this.matchesFilter(name) ||
        this.matchesFilter(ns) ||
        this.matchesFilter(kind)
      );
    });
    if (!matches.length) {
      return [this.noDeviationsItem(`(no matches for "${filter}")`)];
    }
    return matches.map(d => this.createDeviationItem(d));
  }

  private createDeviationItem(deviation: EdaDeviation): DeviationTreeItem {
    const label = getDeviationName(deviation) || '(unknown)';
    const ns = getDeviationNamespace(deviation) || 'unknown';
    const item = new DeviationTreeItem(label, vscode.TreeItemCollapsibleState.None, 'eda-deviation', deviation);
    item.description = `ns: ${ns}`;
    if (deviation.status) {
      item.description += ` (${deviation.status})`;
    }
    item.tooltip = [
      `Name: ${label}`,
      `Namespace: ${ns}`,
      `Kind: ${deviation.kind || 'Deviation'}`,
      `API Version: ${deviation.apiVersion || 'v1'}`,
    ].join('\n');
    item.iconPath = this.statusService.getThemeStatusIcon('blue');
    item.command = {
      command: 'vscode-eda.showDeviationDetails',
      title: 'Show Deviation Details',
      arguments: [deviation],
    };
    return item;
  }

  private noDeviationsItem(extraText = ''): DeviationTreeItem {
    const label = extraText ? `No Deviations Found ${extraText}` : 'No Deviations Found';
    const item = new DeviationTreeItem(label, vscode.TreeItemCollapsibleState.None, 'info');
    item.iconPath = this.statusService.getThemeStatusIcon('gray');
    return item;
  }

  /** Handle full list of deviations from initial load */
  private handleFullDeviationList(items: EdaDeviation[]): void {
    const entries: [string, EdaDeviation][] = [];
    for (const d of items) {
      const ns = getDeviationNamespace(d);
      const name = getDeviationName(d);
      if (ns && name) {
        entries.push([`${ns}/${name}`, d]);
      }
    }
    const next = new Map(entries);
    if (!this.didDeviationMapChange(this.deviations, next)) {
      return;
    }
    this.deviations = next;
    this.scheduleRefresh(true);
  }

  /** Extract name and namespace from an update object */
  private extractDeviationIdentifiers(up: DeviationUpdate): { name?: string; ns?: string } {
    let name: string | undefined = up.data?.metadata?.name || up.data?.name;
    let ns: string | undefined = up.data?.metadata?.namespace;
    if ((!name || !ns) && up.key) {
      const parsed = parseUpdateKey(String(up.key));
      if (!name) name = parsed.name;
      if (!ns) ns = parsed.namespace;
    }
    return { name, ns };
  }

  /** Process a single deviation update */
  private processSingleUpdate(up: DeviationUpdate): boolean {
    const { name, ns } = this.extractDeviationIdentifiers(up);
    if (!name || !ns) {
      return false;
    }
    const key = `${ns}/${name}`;
    if (up.data === null) {
      return this.deviations.delete(key);
    }
    if (up.data) {
      const existing = this.deviations.get(key);
      if (!this.hasDeviationChanged(existing, up.data)) {
        return false;
      }
      this.deviations.set(key, up.data);
      return true;
    }
    return false;
  }

  /** Process deviation stream updates */
  private processDeviationMessage(msg: DeviationStreamMessage): void {
    if ('items' in msg && Array.isArray(msg.items)) {
      this.handleFullDeviationList(msg.items as EdaDeviation[]);
      return;
    }

    const updates = getUpdates(msg.msg);
    if (msg.stream !== 'deviations' || updates.length === 0) {
      return;
    }

    let changed = false;
    for (const up of updates) {
      if (this.processSingleUpdate(up as DeviationUpdate)) {
        changed = true;
      }
    }
    if (changed) {
      this.scheduleRefresh(true);
    }
  }

  private didDeviationMapChange(
    current: Map<string, EdaDeviation>,
    next: Map<string, EdaDeviation>
  ): boolean {
    if (current.size !== next.size) {
      return true;
    }
    for (const [key, nextDeviation] of next.entries()) {
      const currentDeviation = current.get(key);
      if (this.hasDeviationChanged(currentDeviation, nextDeviation)) {
        return true;
      }
    }
    return false;
  }

  private hasDeviationChanged(existing: EdaDeviation | undefined, incoming: EdaDeviation): boolean {
    if (!existing) {
      return true;
    }
    if (existing === incoming) {
      return false;
    }

    const existingVersion = existing.metadata?.resourceVersion;
    const incomingVersion = incoming.metadata?.resourceVersion;
    if (existingVersion && incomingVersion) {
      return existingVersion !== incomingVersion;
    }
    if (existingVersion || incomingVersion) {
      return true;
    }

    return (
      existing.status !== incoming.status
      || existing.kind !== incoming.kind
      || existing.apiVersion !== incoming.apiVersion
    );
  }
}

/** Convert EdaDeviation to a format compatible with TreeItemBase's K8sResource parameter */
function toTreeItemResource(deviation?: EdaDeviation): { metadata?: { name?: string; namespace?: string }; kind?: string; apiVersion?: string; [key: string]: unknown } | undefined {
  if (!deviation) return undefined;
  // Create a copy excluding the string status field which is incompatible with K8sResource's status type
  const result: { [key: string]: unknown } = {};
  for (const [key, value] of Object.entries(deviation)) {
    if (key !== 'status') {
      result[key] = value;
    }
  }
  return result;
}

export class DeviationTreeItem extends TreeItemBase {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    contextValue: string,
    public deviation?: EdaDeviation,
  ) {
    super(label, collapsibleState, contextValue, toTreeItemResource(deviation));
  }
}
