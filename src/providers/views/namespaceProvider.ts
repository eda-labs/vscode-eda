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
  private k8sStreams: string[] = [];

  constructor() {
    try {
      this.k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');
    } catch {
      this.k8sClient = undefined;
    }
    if (this.k8sClient) {
      this.k8sStreams = this.k8sClient.getWatchedResourceTypes();
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
    void this.loadStreams();

    void this.edactlClient.streamEdaNamespaces(ns => {
      log(`Namespace stream provided ${ns.length} namespaces`, LogLevel.DEBUG);
      const all = Array.from(new Set([...ns, 'eda-system']));
      if (!arraysEqual(this.cachedNamespaces, all)) {
        this.cachedNamespaces = all;
        this.k8sClient?.setWatchedNamespaces(all);
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
      this.k8sClient.onResourceChanged(() => {
        this.refresh();
      });
    }
  }

  private async loadStreams(): Promise<void> {
    try {
      this.cachedStreamGroups = await this.edactlClient.getStreamGroups();
      const groupList = Object.keys(this.cachedStreamGroups).join(', ');
      log(`Discovered stream groups: ${groupList}`, LogLevel.DEBUG);
      if (this.k8sStreams.length > 0) {
        this.cachedStreamGroups['kubernetes'] = this.k8sStreams;
      }
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
   * Determine if a stream should be shown based on the current filter.
   * Matches on the stream name or any of its items.
   */
  private streamMatches(namespace: string, stream: string): boolean {
    if (!this.treeFilter) {
      return true;
    }
    if (stream.toLowerCase().includes(this.treeFilter)) {
      return true;
    }
    if (this.k8sStreams.includes(stream)) {
      const items = this.k8sClient?.getCachedResource(stream, this.k8sClient?.isNamespacedResource(stream) ? namespace : undefined) || [];
      return items.some(r => (r.metadata?.name || '').toLowerCase().includes(this.treeFilter));
    }
    const key = `${stream}:${namespace}`;
    const map = this.streamData.get(key);
    if (!map) {
      return false;
    }
    for (const name of map.keys()) {
      if (name.toLowerCase().includes(this.treeFilter)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Determine if a stream group should be shown based on the current filter.
   * Matches on the group name or any streams/items within it.
   */
  private groupMatches(namespace: string, group: string): boolean {
    if (!this.treeFilter) {
      return true;
    }
    if (group.toLowerCase().includes(this.treeFilter)) {
      return true;
    }
    if (group === 'kubernetes') {
      for (const s of this.k8sStreams) {
        if (this.streamMatches(namespace, s)) {
          return true;
        }
      }
      return false;
    }
    const streams = this.cachedStreamGroups[group] || [];
    for (const stream of streams) {
      if (this.streamMatches(namespace, stream)) {
        return true;
      }
    }
    return false;
  }

  /** Check if a stream currently has any child items */
  private streamHasData(namespace: string, stream: string): boolean {
    if (this.k8sStreams.includes(stream)) {
      const items = this.k8sClient?.getCachedResource(stream, this.k8sClient?.isNamespacedResource(stream) ? namespace : undefined) || [];
      return items.length > 0;
    }
    const map = this.streamData.get(`${stream}:${namespace}`);
    return !!map && map.size > 0;
  }

  /** Determine if a group should be flattened because it only repeats a stream */
  private isGroupRedundant(group: string): boolean {
    const streams = this.cachedStreamGroups[group] || [];
    return streams.length === 1 && streams[0] === group;
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
      const group = element.streamGroup ?? '';
      if (this.isGroupRedundant(group)) {
        const namespaces = this.getNamespaces();
        return namespaces.find(ns => ns.label === element.namespace);
      }
      const groups = this.getStreamGroups(element.namespace!);
      return groups.find(g => g.streamGroup === element.streamGroup);
    } else if (element.contextValue === 'stream-item') {
      const group = element.streamGroup ?? '';
      if (this.isGroupRedundant(group)) {
        const flattened = this.getStreamGroups(element.namespace!);
        return flattened.find(s => s.label === element.resourceType);
      }
      const streamItems = this.getStreamsForGroup(element.namespace!, element.streamGroup!);
      return streamItems.find(s => s.label === element.resourceType);
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

    const items: TreeItemBase[] = [];
    for (const g of groups) {
      if (!this.groupMatches(namespace, g)) {
        continue;
      }

      const streams = this.cachedStreamGroups[g] || [];
      const visible = streams.filter(s => this.streamMatches(namespace, s));
      const withData = visible.filter(s => this.streamHasData(namespace, s));

      if (withData.length === 0) {
        continue;
      }

      if (this.isGroupRedundant(g)) {
        const s = streams[0];
        if (!this.streamHasData(namespace, s)) {
          continue;
        }
        const ti = new TreeItemBase(
          s,
          vscode.TreeItemCollapsibleState.Collapsed,
          'stream'
        );
        ti.iconPath = new vscode.ThemeIcon('symbol-event');
        ti.namespace = namespace;
        ti.streamGroup = g;
        items.push(ti);
      } else {
        const ti = new TreeItemBase(
          g,
          vscode.TreeItemCollapsibleState.Collapsed,
          'stream-group'
        );
        ti.iconPath = new vscode.ThemeIcon('folder-library');
        ti.namespace = namespace;
        ti.streamGroup = g;
        items.push(ti);
      }
    }

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
    const items: TreeItemBase[] = [];
    for (const s of streams) {
      if (!this.streamMatches(namespace, s)) {
        continue;
      }
      if (group === 'kubernetes') {
        if (!this.streamHasData(namespace, s)) {
          continue;
        }
        const ti = new TreeItemBase(
          s,
          vscode.TreeItemCollapsibleState.Collapsed,
          'stream'
        );
        ti.iconPath = new vscode.ThemeIcon('symbol-event');
        ti.namespace = namespace;
        ti.streamGroup = group;
        items.push(ti);
        continue;
      }
      const map = this.streamData.get(`${s}:${namespace}`);
      if (!map || map.size === 0) {
        continue;
      }
      const ti = new TreeItemBase(
        s,
        vscode.TreeItemCollapsibleState.Collapsed,
        'stream'
      );
      ti.iconPath = new vscode.ThemeIcon('symbol-event');
      ti.namespace = namespace;
      ti.streamGroup = group;
      items.push(ti);
    }

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
    if (streamGroup === 'kubernetes') {
      const items = this.k8sClient?.getCachedResource(stream, this.k8sClient?.isNamespacedResource(stream) ? namespace : undefined) || [];
      if (items.length === 0) {
        const it = new TreeItemBase('No Items', vscode.TreeItemCollapsibleState.None, 'message');
        it.iconPath = new vscode.ThemeIcon('info');
        return [it];
      }
      const out: TreeItemBase[] = [];
      for (const resource of items) {
        const name = resource.metadata?.name || 'unknown';
        if (this.treeFilter && !name.toLowerCase().includes(this.treeFilter)) {
          continue;
        }
        const ti = new TreeItemBase(name, vscode.TreeItemCollapsibleState.None, 'stream-item', resource);
        ti.namespace = namespace;
        ti.resourceType = stream;
        ti.streamGroup = streamGroup;
        ti.command = {
          command: 'vscode-eda.viewStreamItem',
          title: 'View Stream Item',
          arguments: [ti.getCommandArguments()]
        };
        if (this.statusService) {
          const indicator = this.statusService.getResourceStatusIndicator(resource);
          const desc = this.statusService.getStatusDescription(resource);
          ti.iconPath = this.statusService.getStatusIcon(indicator);
          ti.description = desc;
          ti.tooltip = this.statusService.getResourceTooltip(resource);
          ti.status = { indicator, description: desc };
        }
        out.push(ti);
      }
      if (out.length === 0 && this.treeFilter) {
        const ni = new TreeItemBase(`No items match "${this.treeFilter}"`, vscode.TreeItemCollapsibleState.None, 'message');
        ni.iconPath = new vscode.ThemeIcon('info');
        return [ni];
      }
      return out;
    }

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
      if (this.treeFilter && !name.toLowerCase().includes(this.treeFilter)) {
        continue;
      }
      const ti = new TreeItemBase(
        name,
        vscode.TreeItemCollapsibleState.None,
        'stream-item',
        resource
      );
      ti.namespace = namespace;
      ti.resourceType = stream;
      ti.streamGroup = streamGroup;
      ti.command = {
        command: 'vscode-eda.viewStreamItem',
        title: 'View Stream Item',
        arguments: [ti.getCommandArguments()]
      };
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

    if (items.length === 0 && this.treeFilter) {
      const noItem = new TreeItemBase(
        `No items match "${this.treeFilter}"`,
        vscode.TreeItemCollapsibleState.None,
        'message'
      );
      noItem.iconPath = new vscode.ThemeIcon('info');
      return [noItem];
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
