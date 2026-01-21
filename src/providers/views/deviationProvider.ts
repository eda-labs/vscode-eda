import * as vscode from 'vscode';

import { serviceManager } from '../../services/serviceManager';
import type { EdaClient } from '../../clients/edaClient';
import type { ResourceStatusService } from '../../services/resourceStatusService';
import { log, LogLevel } from '../../extension';
import { parseUpdateKey } from '../../utils/parseUpdateKey';
import { getUpdates } from '../../utils/streamMessageUtils';

import { FilteredTreeProvider } from './filteredTreeProvider';
import { TreeItemBase } from './treeItem';

export interface EdaDeviation {
  name?: string;
  namespace?: string;
  "namespace.name"?: string;
  metadata?: { name?: string; namespace?: string };
  kind?: string;
  apiVersion?: string;
  [key: string]: any;
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
  private _onDeviationCountChanged = new vscode.EventEmitter<number>();
  readonly onDeviationCountChanged = this._onDeviationCountChanged.event;

  public get count(): number {
    return this.deviations.size;
  }

  constructor() {
    super();
    this.edaClient = serviceManager.getClient<EdaClient>('eda');
    this.statusService = serviceManager.getService<ResourceStatusService>('resource-status');
    this.edaClient.onStreamMessage((stream, msg) => {
      if (stream === 'deviations') {
        this.processDeviationMessage(msg);
      }
    });

    // Emit initial count
    this._onDeviationCountChanged.fire(this.count);
  }

  /**
   * Initialize the deviation stream. Call this after construction.
   */
  public async initialize(): Promise<void> {
    await this.edaClient.streamEdaDeviations();
  }

  public dispose(): void {
    this.edaClient.closeDeviationStream();
  }


  updateDeviation(name: string, namespace: string, status: string): void {
    log(`Updating deviation ${name} in namespace ${namespace} with status: ${status}`, LogLevel.DEBUG);
    const key = `${namespace}/${name}`;
    const dev = this.deviations.get(key);
    if (dev) {
      (dev as any).status = status;
      this._onDidChangeTreeData.fire();
    }
  }

  removeDeviation(name: string, namespace: string): void {
    log(`Removing deviation ${name} from namespace ${namespace} from the tree view`, LogLevel.DEBUG);
    const key = `${namespace}/${name}`;
    if (this.deviations.delete(key)) {
      this._onDidChangeTreeData.fire();
      this._onDeviationCountChanged.fire(this.count);
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
    if ((deviation as any).status) {
      item.description += ` (${(deviation as any).status})`;
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
  private handleFullDeviationList(items: any[]): void {
    const entries: [string, EdaDeviation][] = [];
    for (const d of items) {
      const ns = getDeviationNamespace(d);
      const name = getDeviationName(d);
      if (ns && name) {
        entries.push([`${ns}/${name}`, d]);
      }
    }
    this.deviations = new Map(entries);
    this.refresh();
    this._onDeviationCountChanged.fire(this.count);
  }

  /** Extract name and namespace from an update object */
  private extractDeviationIdentifiers(up: any): { name?: string; ns?: string } {
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
  private processSingleUpdate(up: any): boolean {
    const { name, ns } = this.extractDeviationIdentifiers(up);
    if (!name || !ns) {
      return false;
    }
    const key = `${ns}/${name}`;
    if (up.data === null) {
      return this.deviations.delete(key);
    }
    this.deviations.set(key, up.data);
    return true;
  }

  /** Process deviation stream updates */
  private processDeviationMessage(msg: any): void {
    if ('items' in msg && Array.isArray(msg.items)) {
      this.handleFullDeviationList(msg.items);
      return;
    }

    const updates = getUpdates(msg.msg);
    if (msg.stream !== 'deviations' || updates.length === 0) {
      return;
    }

    let changed = false;
    for (const up of updates) {
      if (this.processSingleUpdate(up)) {
        changed = true;
      }
    }
    if (changed) {
      this.refresh();
      this._onDeviationCountChanged.fire(this.count);
    }
  }
}

export class DeviationTreeItem extends TreeItemBase {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    contextValue: string,
    public deviation?: EdaDeviation,
  ) {
    super(label, collapsibleState, contextValue, deviation);
  }
}
