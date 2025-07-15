// src/providers/views/namespaceProvider.ts

import * as vscode from 'vscode';
import { TreeItemBase } from './treeItem';
import { FilteredTreeProvider } from './filteredTreeProvider';
import { serviceManager } from '../../services/serviceManager';
import { KubernetesClient } from '../../clients/kubernetesClient';
import { EdaClient } from '../../clients/edaClient';
import { ResourceService } from '../../services/resourceService';
import { ResourceStatusService } from '../../services/resourceStatusService';
import { log, LogLevel } from '../../extension';
import { parseUpdateKey } from '../../utils/parseUpdateKey';

/**
 * TreeDataProvider for the EDA Namespaces view
 */
export class EdaNamespaceProvider extends FilteredTreeProvider<TreeItemBase> {
  private expandAll: boolean = false;

  private k8sClient?: KubernetesClient;
  private readonly kubernetesIcon: vscode.ThemeIcon;
  private edaClient: EdaClient;
  private resourceService?: ResourceService;
  private statusService?: ResourceStatusService;

  // The current filter text (if any) is managed by FilteredTreeProvider

  private cachedNamespaces: string[] = [];
  private cachedStreamGroups: Record<string, string[]> = {};
  private streamData: Map<string, Map<string, any>> = new Map();
  private k8sStreams: string[] = [];
  private disposables: vscode.Disposable[] = [];
  /** Throttled refresh timer */
  private refreshHandle?: ReturnType<typeof setTimeout>;
  private pendingSummary?: string;

constructor() {
    super();
    this.kubernetesIcon = new vscode.ThemeIcon('layers');
    // Debug log constructor start
    log('EdaNamespaceProvider constructor starting', LogLevel.DEBUG);

    // Add immediate check
    const hasK8sClient = serviceManager.getClientNames().includes('kubernetes');
    log(`Kubernetes client registered in serviceManager: ${hasK8sClient}`, LogLevel.DEBUG);

    try {
      this.k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');
      log(`Kubernetes client obtained: ${this.k8sClient ? 'YES' : 'NO'}`, LogLevel.DEBUG);

      // Add test to verify event emitter works
      if (this.k8sClient) {
        log('Testing k8s client event emitter...', LogLevel.DEBUG);
        const testDisp = this.k8sClient.onResourceChanged(() => {
          log('TEST: K8s resource change event received!', LogLevel.DEBUG);
        });
        // Immediately dispose the test listener
        testDisp.dispose();
        log('Test listener set up and disposed successfully', LogLevel.DEBUG);
      }
    } catch (err) {
      log(`Failed to get Kubernetes client: ${err}`, LogLevel.DEBUG);
      this.k8sClient = undefined;
    }
    if (this.k8sClient) {
      this.k8sStreams = this.k8sClient
        .getWatchedResourceTypes()
        .slice()
        .sort();
    }
    this.edaClient = serviceManager.getClient<EdaClient>('eda');
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
    if (this.k8sClient) {
      log('Kubernetes client event listeners should be set up', LogLevel.DEBUG);
    } else {
      log('No Kubernetes client - event listeners NOT set up', LogLevel.WARN);
    }
    void this.loadStreams();

    this.cachedNamespaces = this.edaClient.getCachedNamespaces();
    const coreNs = this.edaClient.getCoreNamespace();
    if (!this.cachedNamespaces.includes(coreNs)) {
      this.cachedNamespaces.push(coreNs);
    }
    void this.initializeKubernetesNamespaces();

    void this.edaClient.streamEdaNamespaces();

    this.edaClient.onStreamMessage((stream, msg) => {
      if (stream === 'namespaces') {
        this.handleNamespaceMessage(msg);
      } else {
        this.processStreamMessage(stream, msg);
      }
    });
  }

  /**
   * Listen for changes in resources so we can refresh
   */
  private setupEventListeners(): void {
    // initialize listeners for resource and kubernetes events

    if (this.resourceService) {
      const disp = this.resourceService.onDidChangeResources(async summary => {
        this.scheduleRefresh(summary);
      });
      this.disposables.push(disp);
      } else {
        log('No resource service available', LogLevel.DEBUG);
      }

      if (this.k8sClient) {
        try {
          const disp1 = this.k8sClient.onResourceChanged(() => {
            this.scheduleRefresh();
          });
          this.disposables.push(disp1);

          const disp2 = this.k8sClient.onNamespacesChanged(() => {
            this.scheduleRefresh();
          });
          this.disposables.push(disp2);
        } catch (err) {
          log(`Error setting up K8s listeners: ${err}`, LogLevel.ERROR);
        }
      } else {
        log('No Kubernetes client available for event listener', LogLevel.WARN);
      }
  }

  private async loadStreams(): Promise<void> {
    try {
      this.cachedStreamGroups = await this.edaClient.getStreamGroups();
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
   * Load all Kubernetes namespaces and start watchers for them
   */
  private async initializeKubernetesNamespaces(): Promise<void> {
    if (!this.k8sClient) {
      return;
    }
    try {
      const nsObjs = await this.k8sClient.listNamespaces();
      const ns = nsObjs
        .map(n => n?.metadata?.name)
        .filter((n): n is string => typeof n === 'string');
      const all = Array.from(new Set([...ns, ...this.cachedNamespaces]));
      await this.k8sClient.setWatchedNamespaces(all);
    } catch (err) {
      log(`Failed to initialize Kubernetes namespaces: ${err}`, LogLevel.WARN);
    }
  }

  /**
   * Schedule a refresh and collapse multiple events occurring in quick succession.
   */
  private scheduleRefresh(summary?: string): void {
    if (summary) {
      this.pendingSummary = summary;
    }
    if (this.refreshHandle) {
      clearTimeout(this.refreshHandle);
    }
    this.refreshHandle = setTimeout(() => {
      const msg = this.pendingSummary
        ? `Resource change detected (${this.pendingSummary}), refreshing tree view`
        : 'Resource change detected, refreshing tree view';
      log(msg, LogLevel.DEBUG);
      this.refresh();
      this.pendingSummary = undefined;
      this.refreshHandle = undefined;
    }, 500);
  }

  /**
   * Refresh the tree view immediately
   */
  public refresh(): void {
      super.refresh();
  }
  /**
   * Set whether all tree items should be expanded
  */
  public setExpandAll(expand: boolean): void {
    const changed = this.expandAll !== expand;
    this.expandAll = expand;
    if (changed) {
      this.refresh();
    }
  }

  /**
   * Set filter text for searching categories/types/instances
  */
  public setTreeFilter(filterText: string): void {
    log(`Tree filter set to: "${filterText}"`, LogLevel.INFO);
    super.setTreeFilter(filterText);
  }

  /**
   * Clear the filter text
   */
  public clearTreeFilter(): void {
    log(`Clearing tree filter`, LogLevel.INFO);
    super.clearTreeFilter();
  }

  /**
   * Determine if a stream should be shown based on the current filter.
   * Matches on the stream name or any of its items.
   */
  private streamMatches(namespace: string, stream: string): boolean {
    if (!this.treeFilter) {
      return true;
    }
    if (this.matchesFilter(stream)) {
      return true;
    }
    if (this.k8sStreams.includes(stream)) {
      const items = this.k8sClient?.getCachedResource(stream, this.k8sClient?.isNamespacedResource(stream) ? namespace : undefined) || [];
      return items.some(r => this.matchesFilter(r.metadata?.name || ''));
    }
    const key = `${stream}:${namespace}`;
    const map = this.streamData.get(key);
    if (!map) {
      return false;
    }
    for (const name of map.keys()) {
      if (this.matchesFilter(name)) {
        return true;
      }
    }
    return false;
  }

  /** Determine if an EDA namespace should be shown based on the current filter */
  private namespaceMatches(namespace: string): boolean {
    if (!this.treeFilter) {
      return true;
    }
    if (this.matchesFilter(namespace)) {
      return true;
    }
    const groups = Object.keys(this.cachedStreamGroups).filter(g => g !== 'kubernetes');
    for (const group of groups) {
      const streams = this.cachedStreamGroups[group] || [];
      for (const s of streams) {
        if (!this.streamHasData(namespace, s)) {
          continue;
        }
        if (this.streamMatches(namespace, s)) {
          return true;
        }
      }
    }
    return false;
  }

  /** Determine if a Kubernetes namespace should be shown based on the current filter */
  private kubernetesNamespaceMatches(namespace: string): boolean {
    if (!this.k8sClient) {
      return false;
    }
    if (!this.treeFilter) {
      return true;
    }
    if (this.matchesFilter(namespace)) {
      return true;
    }
    for (const stream of this.k8sStreams) {
      if (!this.streamHasData(namespace, stream)) {
        continue;
      }
      if (this.streamMatches(namespace, stream)) {
        return true;
      }
    }
    return false;
  }

  private kubernetesRootMatches(): boolean {
    if (!this.k8sClient) {
      return false;
    }
    for (const ns of this.k8sClient.getCachedNamespaces()) {
      if (this.kubernetesNamespaceMatches(ns)) {
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
    if (this.matchesFilter(group)) {
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
    const streams = (this.cachedStreamGroups[group] || []).slice().sort();
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
    const streams = (this.cachedStreamGroups[group] || []).slice().sort();
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
      const items = this.getNamespaces();
      const kRoot = this.getKubernetesRoot();
      if (kRoot) {
        items.push(kRoot);
      }
      return items;
    } else if (element.contextValue === 'namespace') {
      return this.getStreamGroups(element.label as string);
    } else if (element.contextValue === 'k8s-root') {
      return this.getKubernetesNamespaces();
    } else if (element.contextValue === 'k8s-namespace') {
      return this.getKubernetesStreams(element.label as string);
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
    if (element.contextValue === 'namespace' || element.contextValue === 'message' || element.contextValue === 'k8s-root') {
      return null;
    } else if (element.contextValue === 'k8s-namespace') {
      return this.getKubernetesRoot();
    } else if (element.contextValue === 'stream-group') {
      const namespaces = this.getNamespaces();
      return namespaces.find(ns => ns.label === element.namespace);
    } else if (element.contextValue === 'stream') {
      const group = element.streamGroup ?? '';
      if (this.isGroupRedundant(group)) {
        const namespaces = this.getNamespaces();
        return namespaces.find(ns => ns.label === element.namespace);
      }
      if (group === 'kubernetes') {
        const namespaces = this.getKubernetesNamespaces();
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
      if (group === 'kubernetes') {
        const streamItems = this.getKubernetesStreams(element.namespace!);
        return streamItems.find(s => s.label === element.resourceType);
      }
      const streamItems = this.getStreamsForGroup(element.namespace!, element.streamGroup!);
      return streamItems.find(s => s.label === element.resourceType);
    }
    return null;
  }

  public async expandAllNamespaces(treeView: vscode.TreeView<TreeItemBase>): Promise<void> {
    const roots = await this.getChildren();
    await Promise.all(
      roots.map(item => treeView.reveal(item, { expand: 3 }))
    );
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

    const sorted = this.cachedNamespaces.slice().sort();
    const items: TreeItemBase[] = [];
    for (const ns of sorted) {
      if (!this.namespaceMatches(ns)) {
        continue;
      }
      const treeItem = new TreeItemBase(
        ns,
        this.expandAll ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
        'namespace'
      );
      treeItem.iconPath = new vscode.ThemeIcon('package');
      treeItem.namespace = ns;
      items.push(treeItem);
    }
    return items;
  }

  private getKubernetesRoot(): TreeItemBase | undefined {
    if (!this.k8sClient) {
      return undefined;
    }
    if (this.treeFilter && !this.kubernetesRootMatches()) {
      return undefined;
    }
    const item = new TreeItemBase(
      'Kubernetes',
      this.expandAll
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
      'k8s-root'
    );
    item.iconPath = this.kubernetesIcon;
    return item;
  }

  private getKubernetesNamespaces(): TreeItemBase[] {
    if (!this.k8sClient) {
      return [];
    }
    const namespaces = this.k8sClient.getCachedNamespaces().slice().sort();
    if (namespaces.length === 0) {
      const msgItem = new TreeItemBase(
        'No Kubernetes namespaces found',
        vscode.TreeItemCollapsibleState.None,
        'message'
      );
      msgItem.iconPath = new vscode.ThemeIcon('warning');
      return [msgItem];
    }
    const items: TreeItemBase[] = [];
    for (const ns of namespaces) {
      if (!this.kubernetesNamespaceMatches(ns)) {
        continue;
      }
      const item = new TreeItemBase(
        ns,
        this.expandAll
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
        'k8s-namespace'
      );
      item.iconPath = this.kubernetesIcon;
      item.namespace = ns;
      items.push(item);
    }
    return items;
  }

  private getKubernetesStreams(namespace: string): TreeItemBase[] {
    return this.getStreamsForGroup(namespace, 'kubernetes');
  }

  /** Get stream group items under a namespace */
  private getStreamGroups(namespace: string): TreeItemBase[] {
    const groups = Object.keys(this.cachedStreamGroups)
      .filter(g => g !== 'kubernetes')
      .sort();
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
      const visibleStreams = streams.filter(s => {
        if (!this.streamHasData(namespace, s)) {
          return false;
        }
        return !this.treeFilter || this.streamMatches(namespace, s);
      });

      if (visibleStreams.length === 0) {
        continue;
      }

      if (this.isGroupRedundant(g)) {
        const s = visibleStreams[0];
        if (!s) {
          continue;
        }
        const ti = new TreeItemBase(
          s,
          this.expandAll
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed,
          'stream'
        );
        ti.iconPath = new vscode.ThemeIcon('search-expand-results');
        ti.namespace = namespace;
        ti.streamGroup = g;
        items.push(ti);
      } else {
        const ti = new TreeItemBase(
          g,
          this.expandAll
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed,
          'stream-group'
        );
        ti.iconPath = new vscode.ThemeIcon('folder-library');
        ti.namespace = namespace;
        ti.streamGroup = g;
        items.push(ti);
      }
    }

    return items;
  }

  /** Get stream items under a group */
  private getStreamsForGroup(namespace: string, group: string): TreeItemBase[] {
    const streams = (this.cachedStreamGroups[group] || []).slice().sort();
    const items: TreeItemBase[] = [];
    for (const s of streams) {
      if (!this.streamHasData(namespace, s)) {
        continue;
      }
      if (this.treeFilter && !this.streamMatches(namespace, s)) {
        continue;
      }
      const ti = new TreeItemBase(
        s,
        this.expandAll
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
        'stream'
      );
      ti.iconPath = new vscode.ThemeIcon('search-expand-results');
      ti.namespace = namespace;
      ti.streamGroup = group;
      items.push(ti);
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

  /** Update cached namespaces from stream messages */
  private handleNamespaceMessage(msg: any): void {
    const updates = Array.isArray(msg.msg?.updates) ? msg.msg.updates : [];
    if (updates.length === 0) {
      return;
    }
    let changed = false;
    for (const up of updates) {
      let name: string | undefined = up.data?.metadata?.name || up.data?.name;
      if (!name && up.key) {
        const parsed = parseUpdateKey(String(up.key));
        name = parsed.name;
      }
      if (!name) continue;
      if (up.data === null) {
        const idx = this.cachedNamespaces.indexOf(name);
        if (idx !== -1) {
          this.cachedNamespaces.splice(idx, 1);
          changed = true;
        }
      } else if (!this.cachedNamespaces.includes(name)) {
        this.cachedNamespaces.push(name);
        changed = true;
      }
    }
    if (changed) {
      this.edaClient.setCachedNamespaces(this.cachedNamespaces);
      if (this.k8sClient) {
        const existing = this.k8sClient.getCachedNamespaces();
        const all = Array.from(new Set([...existing, ...this.cachedNamespaces]));
        void this.k8sClient.setWatchedNamespaces(all);
      }
      this.refresh();
    }
  }

  /** Extract name and namespace from a stream update */
  private extractNames(update: any): { name?: string; namespace?: string } {
    let name = update.data?.metadata?.name;
    let namespace = update.data?.metadata?.namespace;
    if ((!name || !namespace) && update.key) {
      const parsed = parseUpdateKey(String(update.key));
      if (!name) {
        name = parsed.name;
      }
      if (!namespace) {
        namespace = parsed.namespace;
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
      const parentMatched =
        !!this.treeFilter &&
        (this.matchesFilter(stream) ||
          (streamGroup && this.matchesFilter(streamGroup)));
      for (const resource of items) {
        const name = resource.metadata?.name;
        if (!name) {
          const snippet = JSON.stringify(resource).slice(0, 200);
          log(
            `Resource in stream ${stream} missing name: ${snippet}`,
            LogLevel.DEBUG
          );
          continue;
        }
        if (!parentMatched && this.treeFilter && !this.matchesFilter(name)) {
          continue;
        }
        const ti = new TreeItemBase(name, vscode.TreeItemCollapsibleState.None, 'stream-item', resource);
        if (stream === 'pods') {
          ti.contextValue = 'pod';
        } else if (stream === 'deployments') {
          ti.contextValue = 'k8s-deployment-instance';
        }
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

          // Mark derived resources with a special icon but keep status color
          if (resource?.metadata?.labels?.['eda.nokia.com/source'] === 'derived') {
            const color = this.statusService.getThemeStatusIcon(indicator).color;
            ti.iconPath = new vscode.ThemeIcon('debug-breakpoint-data-unverified', color);
          }
        }
        out.push(ti);
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
    const parentMatched =
      !!this.treeFilter &&
      (this.matchesFilter(stream) ||
        (streamGroup && this.matchesFilter(streamGroup)));
    for (const [name, resource] of Array.from(map.entries()).sort()) {
      if (!parentMatched && this.treeFilter && !this.matchesFilter(name)) {
        continue;
      }
      const ti = new TreeItemBase(
        name,
        vscode.TreeItemCollapsibleState.None,
        'stream-item',
        resource
      );
      if (stream === 'pods') {
        ti.contextValue = 'pod';
      } else if (stream === 'deployments') {
        ti.contextValue = 'k8s-deployment-instance';
      } else if (streamGroup === 'core' && stream === 'toponodes') {
        ti.contextValue = 'toponode';
      }
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

        // Mark derived resources with a special icon but keep status color
        if (resource?.metadata?.labels?.['eda.nokia.com/source'] === 'derived') {
          const color = this.statusService.getThemeStatusIcon(indicator).color;
          ti.iconPath = new vscode.ThemeIcon('debug-breakpoint-data-unverified', color);
        }
      }
      items.push(ti);
    }

    return items;
  }

  public dispose(): void {
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        // ignore
      }
    }
    this.disposables = [];
  }
}

/**
 * Simple helper for array equality (shallow).
 */
