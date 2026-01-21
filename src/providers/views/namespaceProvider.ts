// src/providers/views/namespaceProvider.ts

import * as vscode from 'vscode';

import { serviceManager } from '../../services/serviceManager';
import type { KubernetesClient } from '../../clients/kubernetesClient';
import type { EdaClient } from '../../clients/edaClient';
import type { ResourceService } from '../../services/resourceService';
import type { ResourceStatusService } from '../../services/resourceStatusService';
import { log, LogLevel } from '../../extension';
import { parseUpdateKey } from '../../utils/parseUpdateKey';
import { getUpdates } from '../../utils/streamMessageUtils';

import { FilteredTreeProvider } from './filteredTreeProvider';
import { TreeItemBase } from './treeItem';

// Constants for duplicate strings (sonarjs/no-duplicate-string)
const STREAM_GROUP_KUBERNETES = 'kubernetes';
const CONTEXT_K8S_NAMESPACE = 'k8s-namespace';
const CONTEXT_STREAM_GROUP = 'stream-group';
const CONTEXT_STREAM_ITEM = 'stream-item';

/**
 * TreeDataProvider for the EDA Namespaces view
 */
export class EdaNamespaceProvider extends FilteredTreeProvider<TreeItemBase> {
  private expandAll: boolean = false;

  private k8sClient?: KubernetesClient;
  private readonly kubernetesIcon: vscode.ThemeIcon;
  private readonly collapsedStreamIcon = new vscode.ThemeIcon('expand-all');
  private readonly expandedStreamIcon = new vscode.ThemeIcon('collapse-all');
  private edaClient: EdaClient;
  private resourceService?: ResourceService;
  private statusService?: ResourceStatusService;

  // The current filter text (if any) is managed by FilteredTreeProvider

  private cachedNamespaces: string[] = [];
  private cachedStreamGroups: Record<string, string[]> = {};
  private streamData: Map<string, Map<string, any>> = new Map();
  private k8sStreams: string[] = [];
  private disposables: vscode.Disposable[] = [];
  /** Track expanded streams so icons persist across refreshes */
  private expandedStreams: Set<string> = new Set();
  /** Throttled refresh timer */
  private refreshHandle?: ReturnType<typeof setTimeout>;
  private pendingSummary?: string;

constructor() {
    super();
    this.kubernetesIcon = new vscode.ThemeIcon('layers');
    log('EdaNamespaceProvider constructor starting', LogLevel.DEBUG);

    this.initializeKubernetesClient();
    this.initializeServices();
    this.setupEventListeners();
    this.logKubernetesClientStatus();
    this.initializeNamespaceCache();
    this.setupStreamMessageHandler();
  }

  /** Initialize Kubernetes client and related streams */
  private initializeKubernetesClient(): void {
    const hasK8sClient = serviceManager.getClientNames().includes(STREAM_GROUP_KUBERNETES);
    log(`Kubernetes client registered in serviceManager: ${hasK8sClient}`, LogLevel.DEBUG);

    try {
      this.k8sClient = serviceManager.getClient<KubernetesClient>(STREAM_GROUP_KUBERNETES);
      log(`Kubernetes client obtained: ${this.k8sClient ? 'YES' : 'NO'}`, LogLevel.DEBUG);
      this.verifyKubernetesEventEmitter();
    } catch (err) {
      log(`Failed to get Kubernetes client: ${err}`, LogLevel.DEBUG);
      this.k8sClient = undefined;
    }

    if (this.k8sClient) {
      this.k8sStreams = this.k8sClient.getWatchedResourceTypes().slice().sort();
    }
  }

  /** Verify that the Kubernetes event emitter is working */
  private verifyKubernetesEventEmitter(): void {
    if (!this.k8sClient) {
      return;
    }
    log('Testing k8s client event emitter...', LogLevel.DEBUG);
    const testDisp = this.k8sClient.onResourceChanged(() => {
      log('TEST: K8s resource change event received!', LogLevel.DEBUG);
    });
    testDisp.dispose();
    log('Test listener set up and disposed successfully', LogLevel.DEBUG);
  }

  /** Initialize resource and status services */
  private initializeServices(): void {
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
  }

  /** Log the Kubernetes client initialization status */
  private logKubernetesClientStatus(): void {
    if (this.k8sClient) {
      log('Kubernetes client event listeners should be set up', LogLevel.DEBUG);
    } else {
      log('No Kubernetes client - event listeners NOT set up', LogLevel.WARN);
    }
  }

  /** Initialize namespace cache from EDA client */
  private initializeNamespaceCache(): void {
    this.cachedNamespaces = this.edaClient.getCachedNamespaces();
    const coreNs = this.edaClient.getCoreNamespace();
    if (!this.cachedNamespaces.includes(coreNs)) {
      this.cachedNamespaces.push(coreNs);
    }
  }

  /** Set up stream message handler */
  private setupStreamMessageHandler(): void {
    this.edaClient.onStreamMessage((stream, msg) => {
      if (stream === 'namespaces') {
        this.handleNamespaceMessage(msg);
      } else {
        this.processStreamMessage(stream, msg);
      }
    });
  }

  /**
   * Initialize async operations. Call this after construction.
   */
  public async initialize(): Promise<void> {
    await this.loadStreams();
    await this.initializeKubernetesNamespaces();
    await this.edaClient.streamEdaNamespaces();
  }

  /**
   * Listen for changes in resources so we can refresh
   */
  private setupEventListeners(): void {
    // initialize listeners for resource and kubernetes events

    if (this.resourceService) {
      const disp = this.resourceService.onDidChangeResources(summary => {
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
        this.cachedStreamGroups[STREAM_GROUP_KUBERNETES] = this.k8sStreams;
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
      this.k8sClient.setWatchedNamespaces(all);
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
   * Update the icon for a stream item based on expansion state
   */
  public updateStreamExpansion(item: TreeItemBase, collapsed: boolean): void {
    if (item.contextValue === 'stream') {
      const key = `${item.namespace}/${item.streamGroup}/${item.label}`;
      if (collapsed) {
        this.expandedStreams.delete(key);
        item.iconPath = this.collapsedStreamIcon;
      } else {
        this.expandedStreams.add(key);
        item.iconPath = this.expandedStreamIcon;
      }
      this._onDidChangeTreeData.fire(item);
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
    const groups = Object.keys(this.cachedStreamGroups).filter(g => g !== STREAM_GROUP_KUBERNETES);
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
    if (group === STREAM_GROUP_KUBERNETES) {
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
  getChildren(element?: TreeItemBase): TreeItemBase[] {
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
    } else if (element.contextValue === CONTEXT_K8S_NAMESPACE) {
      return this.getKubernetesStreams(element.label as string);
    } else if (element.contextValue === CONTEXT_STREAM_GROUP) {
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
    } else if (element.contextValue === CONTEXT_K8S_NAMESPACE) {
      return this.getKubernetesRoot();
    } else if (element.contextValue === CONTEXT_STREAM_GROUP) {
      const namespaces = this.getNamespaces();
      return namespaces.find(ns => ns.label === element.namespace);
    } else if (element.contextValue === 'stream') {
      const group = element.streamGroup ?? '';
      if (this.isGroupRedundant(group)) {
        const namespaces = this.getNamespaces();
        return namespaces.find(ns => ns.label === element.namespace);
      }
      if (group === STREAM_GROUP_KUBERNETES) {
        const namespaces = this.getKubernetesNamespaces();
        return namespaces.find(ns => ns.label === element.namespace);
      }
      const groups = this.getStreamGroups(element.namespace!);
      return groups.find(g => g.streamGroup === element.streamGroup);
    } else if (element.contextValue === CONTEXT_STREAM_ITEM) {
      const group = element.streamGroup ?? '';
      if (this.isGroupRedundant(group)) {
        const flattened = this.getStreamGroups(element.namespace!);
        return flattened.find(s => s.label === element.resourceType);
      }
      if (group === STREAM_GROUP_KUBERNETES) {
        const streamItems = this.getKubernetesStreams(element.namespace!);
        return streamItems.find(s => s.label === element.resourceType);
      }
      const streamItems = this.getStreamsForGroup(element.namespace!, element.streamGroup!);
      return streamItems.find(s => s.label === element.resourceType);
    }
    return null;
  }

  public async expandAllNamespaces(treeView: vscode.TreeView<TreeItemBase>): Promise<void> {
    const roots = this.getChildren();
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
        CONTEXT_K8S_NAMESPACE
      );
      item.iconPath = this.kubernetesIcon;
      item.namespace = ns;
      items.push(item);
    }
    return items;
  }

  private getKubernetesStreams(namespace: string): TreeItemBase[] {
    return this.getStreamsForGroup(namespace, STREAM_GROUP_KUBERNETES);
  }

  /** Get visible streams for a group */
  private getVisibleStreamsForGroup(namespace: string, group: string): string[] {
    const streams = this.cachedStreamGroups[group] || [];
    return streams.filter(s => this.streamHasData(namespace, s) && (!this.treeFilter || this.streamMatches(namespace, s)));
  }

  /** Create a stream tree item */
  private createStreamTreeItem(namespace: string, group: string, stream: string): TreeItemBase {
    const key = `${namespace}/${group}/${stream}`;
    const isExpanded = this.expandAll || this.expandedStreams.has(key);
    const collapsible = isExpanded
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed;
    const ti = new TreeItemBase(stream, collapsible, 'stream');
    ti.id = key;
    ti.iconPath = isExpanded ? this.expandedStreamIcon : this.collapsedStreamIcon;
    ti.namespace = namespace;
    ti.streamGroup = group;
    return ti;
  }

  /** Create a group tree item */
  private createGroupTreeItem(namespace: string, group: string): TreeItemBase {
    const collapsible = this.expandAll
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed;
    const ti = new TreeItemBase(group, collapsible, CONTEXT_STREAM_GROUP);
    ti.iconPath = new vscode.ThemeIcon('folder-library');
    ti.namespace = namespace;
    ti.streamGroup = group;
    return ti;
  }

  /** Get stream group items under a namespace */
  private getStreamGroups(namespace: string): TreeItemBase[] {
    const groups = Object.keys(this.cachedStreamGroups)
      .filter(g => g !== STREAM_GROUP_KUBERNETES)
      .sort();
    if (groups.length === 0) {
      const item = new TreeItemBase('No streams found', vscode.TreeItemCollapsibleState.None, 'message');
      item.iconPath = new vscode.ThemeIcon('info');
      return [item];
    }

    const items: TreeItemBase[] = [];
    for (const g of groups) {
      if (!this.groupMatches(namespace, g)) {
        continue;
      }
      const visibleStreams = this.getVisibleStreamsForGroup(namespace, g);
      if (visibleStreams.length === 0) {
        continue;
      }
      if (this.isGroupRedundant(g) && visibleStreams[0]) {
        items.push(this.createStreamTreeItem(namespace, g, visibleStreams[0]));
      } else {
        items.push(this.createGroupTreeItem(namespace, g));
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
      const key = `${namespace}/${group}/${s}`;
      const isExpanded = this.expandAll || this.expandedStreams.has(key);
      const collapsible = isExpanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
      const ti = new TreeItemBase(s, collapsible, 'stream');
      ti.id = key;
      ti.iconPath = isExpanded ? this.expandedStreamIcon : this.collapsedStreamIcon;
      ti.namespace = namespace;
      ti.streamGroup = group;
      items.push(ti);
    }

    return items;
  }

  /** Handle incoming stream messages and cache items */
  private processStreamMessage(stream: string, msg: any): void {
    const updates = getUpdates(msg.msg);
    if (updates.length === 0) {
      log(`[STREAM:${stream}] No updates in message`, LogLevel.DEBUG);
      return;
    }
    log(`[STREAM:${stream}] Processing ${updates.length} updates`, LogLevel.DEBUG);
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

  /** Extract namespace name from an update object */
  private extractNamespaceName(up: any): string | undefined {
    let name: string | undefined = up.data?.metadata?.name || up.data?.name;
    if (!name && up.key) {
      name = parseUpdateKey(String(up.key)).name;
    }
    return name;
  }

  /** Process a single namespace update, returns true if changed */
  private processSingleNamespaceUpdate(up: any): boolean {
    const name = this.extractNamespaceName(up);
    if (!name) {
      return false;
    }
    if (up.data === null) {
      const idx = this.cachedNamespaces.indexOf(name);
      if (idx !== -1) {
        this.cachedNamespaces.splice(idx, 1);
        return true;
      }
    } else if (!this.cachedNamespaces.includes(name)) {
      this.cachedNamespaces.push(name);
      return true;
    }
    return false;
  }

  /** Synchronize namespace cache with Kubernetes client */
  private syncNamespacesWithK8s(): void {
    this.edaClient.setCachedNamespaces(this.cachedNamespaces);
    if (this.k8sClient) {
      const existing = this.k8sClient.getCachedNamespaces();
      const all = Array.from(new Set([...existing, ...this.cachedNamespaces]));
      this.k8sClient.setWatchedNamespaces(all);
    }
  }

  /** Update cached namespaces from stream messages */
  private handleNamespaceMessage(msg: any): void {
    const updates = getUpdates(msg.msg);
    if (updates.length === 0) {
      return;
    }
    let changed = false;
    for (const up of updates) {
      if (this.processSingleNamespaceUpdate(up)) {
        changed = true;
      }
    }
    if (changed) {
      this.syncNamespacesWithK8s();
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

  /** Create an empty items placeholder */
  private createNoItemsPlaceholder(): TreeItemBase {
    const item = new TreeItemBase('No Items', vscode.TreeItemCollapsibleState.None, 'message');
    item.iconPath = new vscode.ThemeIcon('info');
    return item;
  }

  /** Check if parent item matched filter */
  private isParentFilterMatched(stream: string, streamGroup?: string): boolean {
    return !!this.treeFilter && (this.matchesFilter(stream) || (!!streamGroup && this.matchesFilter(streamGroup)));
  }

  /** Get the context value for a stream item based on stream type */
  private getStreamItemContextValue(stream: string, streamGroup?: string): string {
    if (stream === 'pods') {
      return 'pod';
    }
    if (stream === 'deployments') {
      return 'k8s-deployment-instance';
    }
    if (streamGroup === 'core' && stream === 'toponodes') {
      return 'toponode';
    }
    return CONTEXT_STREAM_ITEM;
  }

  /** Apply status styling to a tree item */
  private applyStatusStyling(ti: TreeItemBase, resource: any): void {
    if (!resource || !this.statusService) {
      return;
    }
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

  /** Create a tree item for a resource */
  private createResourceTreeItem(
    name: string,
    resource: any,
    namespace: string,
    stream: string,
    streamGroup?: string
  ): TreeItemBase {
    const ti = new TreeItemBase(name, vscode.TreeItemCollapsibleState.None, CONTEXT_STREAM_ITEM, resource);
    ti.contextValue = this.getStreamItemContextValue(stream, streamGroup);
    ti.namespace = namespace;
    ti.resourceType = stream;
    ti.streamGroup = streamGroup;
    ti.command = {
      command: 'vscode-eda.viewStreamItem',
      title: 'View Stream Item',
      arguments: [ti.getCommandArguments()]
    };
    this.applyStatusStyling(ti, resource);
    return ti;
  }

  /** Build items for Kubernetes stream */
  private getKubernetesStreamItems(namespace: string, stream: string, streamGroup: string): TreeItemBase[] {
    const items = this.k8sClient?.getCachedResource(stream, this.k8sClient?.isNamespacedResource(stream) ? namespace : undefined) || [];
    if (items.length === 0) {
      return [this.createNoItemsPlaceholder()];
    }
    const out: TreeItemBase[] = [];
    const parentMatched = this.isParentFilterMatched(stream, streamGroup);
    for (const resource of items) {
      const name = resource.metadata?.name;
      if (!name) {
        log(`Resource in stream ${stream} missing name: ${JSON.stringify(resource).slice(0, 200)}`, LogLevel.DEBUG);
        continue;
      }
      if (!parentMatched && this.treeFilter && !this.matchesFilter(name)) {
        continue;
      }
      out.push(this.createResourceTreeItem(name, resource, namespace, stream, streamGroup));
    }
    return out;
  }

  /** Build items for EDA stream */
  private getEdaStreamItems(namespace: string, stream: string, streamGroup?: string): TreeItemBase[] {
    const key = `${stream}:${namespace}`;
    const map = this.streamData.get(key);
    if (!map || map.size === 0) {
      return [this.createNoItemsPlaceholder()];
    }
    const items: TreeItemBase[] = [];
    const parentMatched = this.isParentFilterMatched(stream, streamGroup);
    for (const [name, resource] of Array.from(map.entries()).sort()) {
      if (!parentMatched && this.treeFilter && !this.matchesFilter(name)) {
        continue;
      }
      items.push(this.createResourceTreeItem(name, resource, namespace, stream, streamGroup));
    }
    return items;
  }

  /** Build items for a specific stream */
  private getItemsForStream(namespace: string, stream: string, streamGroup?: string): TreeItemBase[] {
    if (streamGroup === STREAM_GROUP_KUBERNETES) {
      return this.getKubernetesStreamItems(namespace, stream, streamGroup);
    }
    return this.getEdaStreamItems(namespace, stream, streamGroup);
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
