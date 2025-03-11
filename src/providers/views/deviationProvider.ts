import * as vscode from 'vscode';
import { EdaDeviation } from '../../services/types';
import { serviceManager } from '../../services/serviceManager';
import { EdaService } from '../../services/edaService';
import { StatusService } from '../../services/statusService';
import { log, LogLevel, globalTreeFilter } from '../../extension.js';
import { TreeItemBase } from './common/treeItem';
import { resourceStatusService } from '../../extension.js';

/**
 * EdaDeviationProvider displays the list of deviations from
 * "edactl query .namespace.resources.cr.core_eda_nokia_com.v1.deviation -f json".
 */
export class EdaDeviationProvider implements vscode.TreeDataProvider<DeviationTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<DeviationTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // Cache of currently displayed deviations
  private deviations: EdaDeviation[] = [];

  private k8sService: EdaService;

  constructor(
    private context: vscode.ExtensionContext
  ) {
    this.k8sService = serviceManager.getService<EdaService>('eda');
  }

  /**
   * Refresh method, to be called from our extension-level refresh
   */
  refresh(): void {
    log('EdaDeviationProvider: Refresh called', LogLevel.DEBUG);
    this._onDidChangeTreeData.fire();
  }

  /**
   * Update a specific deviation's status
   */
  updateDeviation(name: string, namespace: string, status: string): void {
    log(`Updating deviation ${name} in namespace ${namespace} with status: ${status}`, LogLevel.DEBUG);

    // Find the deviation in our cache
    const deviation = this.deviations.find(d =>
      d.name === name && d["namespace.name"] === namespace
    );

    if (deviation) {
      // Update the deviation's status
      (deviation as any).status = status;

      // Notify tree view of the change for this specific item
      this._onDidChangeTreeData.fire();
    }
  }

  /**
   * Remove a specific deviation from the tree view
   */
  removeDeviation(name: string, namespace: string): void {
    log(`Removing deviation ${name} from namespace ${namespace} from the tree view`, LogLevel.DEBUG);

    // Remove the deviation from our cache
    this.deviations = this.deviations.filter(d =>
      !(d.name === name && d["namespace.name"] === namespace)
    );

    // Notify tree view of the change
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DeviationTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: DeviationTreeItem): Promise<DeviationTreeItem[]> {
    // If there's an element, we've reached a leaf node
    if (element) {
      return [];
    }

    // If there's a global filter, do filtering. Otherwise, list all.
    if (!globalTreeFilter) {
      return this.getAllDeviationItems();
    } else {
      return this.getFilteredDeviationItems(globalTreeFilter);
    }
  }

  /**
   * Load all deviations (no filter).
   */
  private async getAllDeviationItems(): Promise<DeviationTreeItem[]> {
    const deviations = await this.k8sService.getEdaDeviations();

    // Update our cache
    this.deviations = deviations;

    if (!deviations.length) {
      return [this.noDeviationsItem()];
    }

    return deviations.map((d: EdaDeviation) => this.createDeviationItem(d));
  }

  /**
   * Filter deviations by name, namespace, etc.
   */
  private async getFilteredDeviationItems(filter: string): Promise<DeviationTreeItem[]> {
    // If the "Deviations" category itself matches the filter, show all deviations
    if ("deviations".includes(filter.toLowerCase())) {
      return this.getAllDeviationItems();
    }

    const lowerFilter = filter.toLowerCase();
    const all = await this.k8sService.getEdaDeviations();

    // Update our cache
    this.deviations = all;

    const matches = all.filter((d: EdaDeviation) =>
      d.name.toLowerCase().includes(lowerFilter) ||
      d["namespace.name"]?.toLowerCase().includes(lowerFilter) ||
      d.kind?.toLowerCase().includes(lowerFilter)
    );

    if (!matches.length) {
      return [this.noDeviationsItem(`(no matches for "${filter}")`)];
    }

    return matches.map((d: EdaDeviation) => this.createDeviationItem(d));
  }

  /**
   * Create a single Deviation tree item from EdaDeviation object
   */
  private createDeviationItem(deviation: EdaDeviation): DeviationTreeItem {
    const label = deviation.name;
    const item = new DeviationTreeItem(
      label,
      vscode.TreeItemCollapsibleState.None,
      'eda-deviation',
      deviation
    );
    // Show the namespace in 'description'
    item.description = `ns: ${deviation["namespace.name"]}`;

    // Add status if available
    if ((deviation as any).status) {
      item.description += ` (${(deviation as any).status})`;
    }

    item.tooltip = [
      `Name: ${deviation.name}`,
      `Namespace: ${deviation["namespace.name"]}`,
      `Kind: ${deviation.kind || 'Deviation'}`,
      `API Version: ${deviation.apiVersion || 'v1'}`
    ].join('\n');

    // Use theme icon from statusUtils
    item.iconPath = resourceStatusService.getStatusIcon('blue');

    item.command = {
      command: 'vscode-eda.showDeviationDetails',
      title: 'Show Deviation Details',
      arguments: [deviation]
    };

    return item;
  }

  private noDeviationsItem(extraText = ''): DeviationTreeItem {
    const label = extraText ? `No Deviations Found ${extraText}` : `No Deviations Found`;
    const item = new DeviationTreeItem(label, vscode.TreeItemCollapsibleState.None, 'info');

    // Use standard status icon from statusUtils
    item.iconPath = resourceStatusService.getStatusIcon('gray');

    return item;
  }
}

export class DeviationTreeItem extends TreeItemBase {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    contextValue: string,
    public deviation?: EdaDeviation
  ) {
    super(label, collapsibleState, contextValue, deviation);
  }
}