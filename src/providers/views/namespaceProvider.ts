// src/providers/views/namespaceProvider.ts

import * as vscode from 'vscode';
import { TreeItemBase } from './treeItem';
import { serviceManager } from '../../services/serviceManager';
import { KubernetesClient } from '../../clients/kubernetesClient';
import { EdaClient } from '../../clients/edaClient';
import { ResourceService } from '../../services/resourceService';
import { ResourceStatusService } from '../../services/resourceStatusService';
import { log, LogLevel } from '../../extension';

/**
 * TreeDataProvider for the EDA Namespaces view
 */
export class EdaNamespaceProvider implements vscode.TreeDataProvider<TreeItemBase> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItemBase | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private expandAll: boolean = false;

  private k8sClient?: KubernetesClient;
  private edactlClient: EdaClient;
  private resourceService?: ResourceService;
  private statusService?: ResourceStatusService;

  // The current filter text (if any).
  private treeFilter: string = '';

  private _refreshDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  private cachedNamespaces: string[] = [];
  private cachedStreamGroups: Record<string, string[]> = {};
  private streamData: Map<string, Map<string, any>> = new Map();

  constructor() {
    try {
      this.k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');
    } catch {
      this.k8sClient = undefined;
    }
    this.edactlClient = serviceManager.getClient<EdaClient>('edactl');
    try {
      this.resourceService = serviceManager.getService<ResourceService>('kubernetes-resources');
    } catch {
      this.resourceService = undefined;
    }
    try {
      this.statusService = serviceManager.getService<ResourceStatusService>('resource-status');
    } catch {
      this.statusService = undefined;
    }

    this.setupEventListeners();
    void this.updateNamespaces();
    void this.loadStreams();

    void this.edactlClient.streamEdaNamespaces(ns => {
      log(`Namespace stream provided ${ns.length} namespaces`, LogLevel.DEBUG);
      if (!arraysEqual(this.cachedNamespaces, ns)) {
        this.cachedNamespaces = ns;
        this.refresh();
      }
    });

    this.edactlClient.onStreamMessage((stream, msg) => {
      this.processStreamMessage(stream, msg);
    });
  }

  /**
   * Listen for changes in resources so we can refresh
   */
  private setupEventListeners(): void {
    if (this.resourceService) {
      this.resourceService.onDidChangeResources(async summary => {
        const msg = summary ? `Resource change detected (${summary}), refreshing tree view` :
          'Resource change detected, refreshing tree view';
        log(msg, LogLevel.DEBUG);
        this.refresh();
      });
    }
    if (this.k8sClient) {
      this.k8sClient.onNamespacesChanged(() => {
        void this.updateNamespaces();
        this.refresh();
      });
    }
  }

  /**
   * Update cached namespaces from the Kubernetes client
   */
  private async updateNamespaces(): Promise<void> {
    try {
      const namespaces = await this.edactlClient.getEdaNamespaces();
      if (!arraysEqual(this.cachedNamespaces, namespaces)) {
        log(
          `Namespaces changed from [${this.cachedNamespaces.join(', ')}] to [${namespaces.join(', ')}]`,
          LogLevel.DEBUG
        );
        this.cachedNamespaces = namespaces;
      }
    } catch (err) {
      log(`Failed to update namespaces: ${err}`, LogLevel.ERROR);
    }
  }

  private async loadStreams(): Promise<void> {
    try {
      this.cachedStreamGroups = await this.edactlClient.getStreamGroups();
      const groupList = Object.keys(this.cachedStreamGroups).join(', ');
      log(`Discovered stream groups: ${groupList}`, LogLevel.DEBUG);
    } catch (err) {
      log(`Failed to load streams: ${err}`, LogLevel.ERROR);
    }
  }

  /**
   * Trigger a debounced refresh
   */
  public refresh(): void {
    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer);
    }
    this._refreshDebounceTimer = setTimeout(() => {
      this._onDidChangeTreeData.fire(undefined);
      this._refreshDebounceTimer = undefined;
    }, 120);
  }

  /**
   * Set whether all tree items should be expanded
   */
  public setExpandAll(expand: boolean): void {
    this.expandAll = expand;
    this.refresh();
  }

  /**
   * Set filter text for searching categories/types/instances
   */
  public setTreeFilter(filterText: string): void {
    this.treeFilter = filterText.toLowerCase(); // <-- CHANGED
    log(`Tree filter set to: "${filterText}"`, LogLevel.INFO);
    this.refresh();
  }

  /**
   * Clear the filter text
   */
  public clearTreeFilter(): void {
    this.treeFilter = ''; // <-- CHANGED
    log(`Clearing tree filter`, LogLevel.INFO);
    this.refresh();
  }

  /**
   * Implementation of TreeDataProvider: get a tree item
   */
  getTreeItem(element: TreeItemBase): vscode.TreeItem {
    return element;
  }

  /**
   * Implementation of TreeDataProvider: get children
   */
  async getChildren(element?: TreeItemBase): Promise<TreeItemBase[]> {
    if (!element) {
      // Root level: list EDA namespaces (unfiltered)
      return this.getNamespaces();
    } else if (element.contextValue === 'namespace') {
      return this.getStreamGroups(element.label as string);
    } else if (element.contextValue === 'stream-group') {
      return this.getStreamsForGroup(element.namespace!, element.streamGroup!);
    } else if (element.contextValue === 'stream') {
      return this.getItemsForStream(element.namespace!, element.label as string, element.streamGroup);
    }
    return [];
  }

  /**
   * Implementation of TreeDataProvider: gets the parent of a tree item
   */
  getParent(element: TreeItemBase): vscode.ProviderResult<TreeItemBase> {
    if (element.contextValue === 'namespace' || element.contextValue === 'message') {
      return null;
    } else if (element.contextValue === 'stream-group') {
      const namespaces = this.getNamespaces();
      return namespaces.find(ns => ns.label === element.namespace);
    } else if (element.contextValue === 'stream') {
      const groups = this.getStreamGroups(element.namespace!);
      return groups.find(g => g.streamGroup === element.streamGroup);
    } else if (element.contextValue === 'stream-item') {
      const streams = this.getStreamsForGroup(element.namespace!, element.streamGroup!);
      return streams.find(s => s.label === element.resourceType);
    }
    return null;
  }

  public async expandAllNamespaces(treeView: vscode.TreeView<TreeItemBase>): Promise<void> {
    // Get namespaces
    const namespaces = await this.getChildren();

    // First reveal all namespaces
    for (const namespace of namespaces) {
      if (namespace.contextValue === 'namespace') {
        await treeView.reveal(namespace, { expand: 1 });

        const groups = await this.getChildren(namespace);
        for (const group of groups) {
          await treeView.reveal(group, { expand: 2 });
          const streams = await this.getChildren(group);
          for (const stream of streams) {
            await treeView.reveal(stream, { expand: 3 });
          }
        }
      }
    }
  }

  /**
   * Build the list of namespaces - never hidden by filter
   */
  private getNamespaces(): TreeItemBase[] {
    if (this.cachedNamespaces.length === 0) {
      const msgItem = new TreeItemBase(
        'No EDA namespaces found',
        this.expandAll ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
        'message'
      );
      msgItem.iconPath = new vscode.ThemeIcon('warning');
      return [msgItem];
    }

    return this.cachedNamespaces.map(ns => {
      const treeItem = new TreeItemBase(
        ns,
        this.expandAll ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
        'namespace'
      );
      treeItem.iconPath = new vscode.ThemeIcon('package');
      treeItem.namespace = ns;
      return treeItem;
    });
  }

  /** Get stream group items under a namespace */
  private getStreamGroups(namespace: string): TreeItemBase[] {
    const groups = Object.keys(this.cachedStreamGroups);
    if (groups.length === 0) {
      const item = new TreeItemBase(
        'No streams found',
        vscode.TreeItemCollapsibleState.None,
        'message'
      );
      item.iconPath = new vscode.ThemeIcon('info');
      return [item];
    }

    const items = groups
      .filter(g => !this.treeFilter || g.toLowerCase().includes(this.treeFilter))
      .map(g => {
        const ti = new TreeItemBase(
          g,
          vscode.TreeItemCollapsibleState.Collapsed,
          'stream-group'
        );
        ti.iconPath = new vscode.ThemeIcon('folder-library');
        ti.namespace = namespace;
        ti.streamGroup = g;
        return ti;
      });

    if (items.length === 0 && this.treeFilter) {
      const noMatch = new TreeItemBase(
        `No streams match "${this.treeFilter}"`,
        vscode.TreeItemCollapsibleState.None,
        'message'
      );
      noMatch.iconPath = new vscode.ThemeIcon('info');
      return [noMatch];
    }
    return items;
  }

  /** Get stream items under a group */
  private getStreamsForGroup(namespace: string, group: string): TreeItemBase[] {
    const streams = this.cachedStreamGroups[group] || [];
    const items = streams
      .filter(s => !this.treeFilter || s.toLowerCase().includes(this.treeFilter))
      .map(s => {
        const ti = new TreeItemBase(
          s,
          vscode.TreeItemCollapsibleState.Collapsed,
          'stream'
        );
        ti.iconPath = new vscode.ThemeIcon('symbol-event');
        ti.namespace = namespace;
        ti.streamGroup = group;
        return ti;
      });

    if (items.length === 0 && this.treeFilter) {
      const noMatch = new TreeItemBase(
        `No streams match "${this.treeFilter}"`,
        vscode.TreeItemCollapsibleState.None,
        'message'
      );
      noMatch.iconPath = new vscode.ThemeIcon('info');
      return [noMatch];
    }
    return items;
  }

  /**
   * Resource categories under each namespace: "EDA Resources" and "Kubernetes Resources"
   */
  // private getResourceCategories(namespace: string): TreeItemBase[] {
  //   return [];
  // }

  /**
   * EDA vs. k8s resource "types" under the category
   */
  // private getResourcesForCategory(namespace: string, category: string): TreeItemBase[] {
  //   return [];
  // }

  /**
   * Build EDA resource type nodes (CRD kinds)
   */
  // private getEdaResourceTypes(namespace: string): TreeItemBase[] {
  //   return [];
  // }

  /**
   * Build standard K8s resource type nodes
   */
  // private getK8sResourceTypes(namespace: string): TreeItemBase[] {
  //   return [];
  // }

  /**
   * Build resource instance items for the chosen resource-type
   */
  // private getResourceInstances(
  //   namespace: string,
  //   resourceType: string,
  //   category: string,
  //   crdInfo: any
  // ): TreeItemBase[] {
  //   return [];
  // }

  /** Handle incoming stream messages and cache items */
  private processStreamMessage(stream: string, msg: any): void {
    const updates = Array.isArray(msg.msg?.updates) ? msg.msg.updates : [];
    if (updates.length === 0) {
      return;
    }
    for (const up of updates) {
      const { name, namespace } = this.extractNames(up);
      if (!namespace || !name) {
        continue;
      }
      const key = `${stream}:${namespace}`;
      let map = this.streamData.get(key);
      if (!map) {
        map = new Map();
        this.streamData.set(key, map);
      }
      if (up.data === null) {
        map.delete(name);
      } else {
        map.set(name, up.data);
      }
    }
    this.refresh();
  }

  /** Extract name and namespace from a stream update */
  private extractNames(update: any): { name?: string; namespace?: string } {
    let name = update.data?.metadata?.name;
    let namespace = update.data?.metadata?.namespace;
    if (!name && update.key) {
      const matches = String(update.key).match(/\.name=="([^"]+)"/g);
      if (matches && matches.length > 0) {
        const last = matches[matches.length - 1].match(/\.name=="([^"]+)"/);
        if (last) {
          name = last[1];
        }
      }
    }
    if (!namespace && update.key) {
      const nsMatch = String(update.key).match(/namespace\{\.name=="([^"]+)"\}/);
      if (nsMatch) {
        namespace = nsMatch[1];
      }
    }
    return { name, namespace };
  }

  /** Build items for a specific stream */
  private getItemsForStream(namespace: string, stream: string, streamGroup?: string): TreeItemBase[] {
    const key = `${stream}:${namespace}`;
    const map = this.streamData.get(key);
    if (!map || map.size === 0) {
      const item = new TreeItemBase(
        'No Items',
        vscode.TreeItemCollapsibleState.None,
        'message'
      );
      item.iconPath = new vscode.ThemeIcon('info');
      return [item];
    }
    const items: TreeItemBase[] = [];
    for (const [name, resource] of Array.from(map.entries()).sort()) {
      const ti = new TreeItemBase(
        name,
        vscode.TreeItemCollapsibleState.None,
        'stream-item',
        resource
      );
      ti.namespace = namespace;
      ti.resourceType = stream;
      ti.streamGroup = streamGroup;
      if (resource && this.statusService) {
        const indicator = this.statusService.getResourceStatusIndicator(resource);
        const desc = this.statusService.getStatusDescription(resource);
        ti.iconPath = this.statusService.getStatusIcon(indicator);
        ti.description = desc;
        ti.tooltip = this.statusService.getResourceTooltip(resource);
        ti.status = { indicator, description: desc };
      }
      items.push(ti);
    }
    return items;
  }
}

/**
 * Simple helper for array equality (shallow).
 */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
