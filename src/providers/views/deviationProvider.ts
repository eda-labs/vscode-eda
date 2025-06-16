import * as vscode from 'vscode';
import { TreeItemBase } from './treeItem';
import { serviceManager } from '../../services/serviceManager';
import { EdaClient } from '../../clients/edaClient';
import { ResourceStatusService } from '../../services/resourceStatusService';
import { log, LogLevel } from '../../extension';

interface EdaDeviation {
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

export class EdaDeviationProvider implements vscode.TreeDataProvider<DeviationTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<DeviationTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private deviations: Map<string, EdaDeviation> = new Map();
  private edaClient: EdaClient;
  private statusService: ResourceStatusService;
  private treeFilter = '';
  private _refreshDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.edaClient = serviceManager.getClient<EdaClient>('edactl');
    this.statusService = serviceManager.getService<ResourceStatusService>('resource-status');
    void this.edaClient.streamEdaDeviations(devs => {
      log(`Deviation stream provided ${devs.length} deviations`, LogLevel.DEBUG);
      this.deviations = new Map(
        devs
          .map(d => {
            const ns = getDeviationNamespace(d);
            const name = getDeviationName(d);
            return ns && name ? [`${ns}/${name}`, d] : undefined;
          })
          .filter((v): v is [string, EdaDeviation] => v !== undefined),
      );
      this.refresh();
    });
  }

  public dispose(): void {
    this.edaClient.closeDeviationStream();
    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer);
      this._refreshDebounceTimer = undefined;
    }
  }

  refresh(): void {
    log('EdaDeviationProvider: Refresh called', LogLevel.DEBUG);
    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer);
    }
    this._refreshDebounceTimer = setTimeout(() => {
      this._onDidChangeTreeData.fire();
      this._refreshDebounceTimer = undefined;
    }, 100);
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
    }
  }

  setTreeFilter(filter: string): void {
    this.treeFilter = filter.toLowerCase();
    this.refresh();
  }

  clearTreeFilter(): void {
    this.treeFilter = '';
    this.refresh();
  }

  getTreeItem(element: DeviationTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: DeviationTreeItem): Promise<DeviationTreeItem[]> {
    if (element) {
      return [];
    }
    if (!this.treeFilter) {
      return this.getAllDeviationItems();
    } else {
      return this.getFilteredDeviationItems(this.treeFilter);
    }
  }

  private async getAllDeviationItems(): Promise<DeviationTreeItem[]> {
    if (this.deviations.size === 0) {
      return [this.noDeviationsItem()];
    }
    return Array.from(this.deviations.values()).map(d => this.createDeviationItem(d));
  }

  private async getFilteredDeviationItems(filter: string): Promise<DeviationTreeItem[]> {
    if ('deviations'.includes(filter.toLowerCase())) {
      return this.getAllDeviationItems();
    }
    const lower = filter.toLowerCase();
    const matches = Array.from(this.deviations.values()).filter(d => {
      const name = getDeviationName(d)?.toLowerCase() || '';
      const ns = getDeviationNamespace(d)?.toLowerCase() || '';
      return (
        name.includes(lower) ||
        ns.includes(lower) ||
        d.kind?.toLowerCase().includes(lower)
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
