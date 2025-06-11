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

    void this.edactlClient.streamEdaNamespaces(ns => {
      log(`Namespace stream provided ${ns.length} namespaces`, LogLevel.DEBUG);
      if (!arraysEqual(this.cachedNamespaces, ns)) {
        this.cachedNamespaces = ns;
        this.refresh();
      }
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
      return this.getResourceCategories(element.label as string);
    } else if (element.contextValue === 'resource-category') {
      return this.getResourcesForCategory(element.namespace || '', element.resourceCategory || '');
    } else if (element.contextValue === 'resource-type') {
      return this.getResourceInstances(
        element.namespace || '',
        element.resourceType || '',
        element.resourceCategory || '',
        element.crdInfo
      );
    }
    return [];
  }

  /**
   * Implementation of TreeDataProvider: gets the parent of a tree item
   */
  getParent(element: TreeItemBase): vscode.ProviderResult<TreeItemBase> {
    // If element is namespace or a message, it's a root element, so no parent
    if (element.contextValue === 'namespace' || element.contextValue === 'message') {
      return null;
    }
    // If element is a resource category, its parent is the namespace
    else if (element.contextValue === 'resource-category') {
      // Find the namespace item that matches this element's namespace
      const namespaces = this.getNamespaces();
      return namespaces.find(ns => ns.label === element.namespace);
    }
    // If element is a resource type, its parent is the resource category
    else if (element.contextValue === 'resource-type') {
      // Find the category that contains this resource type
      const categories = this.getResourceCategories(element.namespace || '');
      return categories.find(cat => cat.resourceCategory === element.resourceCategory);
    }
    // If element is a resource instance (pod, crd-instance, etc), its parent is the resource type
    else if (element.contextValue === 'pod' || element.contextValue === 'crd-instance') {
      const namespace = element.namespace || '';
      const resourceType = element.resourceType || '';
      const resourceCategory = element.resourceCategory || '';

      // Find the appropriate parent resource type
      if (resourceCategory === 'eda') {
        const edaTypes = this.getEdaResourceTypes(namespace);
        return edaTypes.find(type => type.resourceType === resourceType);
      } else if (resourceCategory === 'k8s') {
        const k8sTypes = this.getK8sResourceTypes(namespace);
        return k8sTypes.find(type => type.resourceType === resourceType);
      }
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

        // Then reveal categories under each namespace
        const categories = await this.getChildren(namespace);
        for (const category of categories) {
          await treeView.reveal(category, { expand: 2 });
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

  /**
   * Resource categories under each namespace: "EDA Resources" and "Kubernetes Resources"
   */
  private getResourceCategories(namespace: string): TreeItemBase[] {
    if (!this.resourceService) {
      return [];
    }
    const allResources = this.resourceService.getAllResourceInstances();
    const hasEdaResources = allResources.some(r => {
      const group = r.resource.apiGroup || '';
      return !group.endsWith('k8s.io');
    });

    const categories = [
      {
        id: 'eda',
        label: hasEdaResources ? 'EDA Resources' : 'EDA Resources (init)',
        icon: 'zap'
      },
      { id: 'k8s', label: 'Kubernetes Resources', icon: 'symbol-namespace' }
    ];

    // Build items, but filter them if no match
    const result: TreeItemBase[] = [];

    for (const cat of categories) {
      const catLabel = cat.label.toLowerCase();
      const catMatches = this.treeFilter && catLabel.includes(this.treeFilter); // <-- NEW

      // Make a node for the category
      const treeItem = new TreeItemBase(
        cat.label,
        this.expandAll ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
        'resource-category'
      );
      treeItem.iconPath = new vscode.ThemeIcon(cat.icon);
      treeItem.namespace = namespace;
      treeItem.resourceCategory = cat.id;

      if (!this.treeFilter) {
        // No filter => keep all categories
        result.push(treeItem);
      } else {
        if (catMatches) {
          // Category label matched => show entire category
          result.push(treeItem);
        } else {
          // Otherwise, only show if the sub-resources have some match
          const resourceTypes = this.getResourcesForCategory(namespace, cat.id);
          if (resourceTypes.length > 0) {
            result.push(treeItem);
          }
        }
      }
    }

    // If after filtering we have none, show a "no matches" item
    if (result.length === 0 && this.treeFilter) {
      const noMatchItem = new TreeItemBase(
        `No categories match "${this.treeFilter}"`,
        this.expandAll ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
        'message'
      );
      noMatchItem.iconPath = new vscode.ThemeIcon('info');
      return [noMatchItem];
    }

    return result;
  }

  /**
   * EDA vs. k8s resource "types" under the category
   */
  private getResourcesForCategory(namespace: string, category: string): TreeItemBase[] {
    if (category === 'eda' && !this.resourceService) {
      return [];
    }
    if (category === 'k8s' && !this.k8sClient) {
      return [];
    }
    try {
      if (category === 'eda') {
        return this.getEdaResourceTypes(namespace);
      } else if (category === 'k8s') {
        return this.getK8sResourceTypes(namespace);
      }
      return [];
    } catch (error) {
      log(`Error getting resource types for category ${category}: ${error}`, LogLevel.ERROR);
      const errorItem = new TreeItemBase(
        'Error loading resources',
        this.expandAll ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
        'error'
      );
      errorItem.iconPath = new vscode.ThemeIcon('error');
      errorItem.tooltip = String(error);
      return [errorItem];
    }
  }

  /**
   * Build EDA resource type nodes (CRD kinds)
   */
  private getEdaResourceTypes(namespace: string): TreeItemBase[] {
    if (!this.resourceService) {
      return [];
    }
    const allResources = this.resourceService.getAllResourceInstances(); // from ResourceService
    // We only want CRDs that are not standard k8s (i.e. group doesn't end with k8s.io)
    const edaRes = allResources.filter(r => {
      const group = r.resource.apiGroup || '';
      return !group.endsWith('k8s.io');
    });

    if (edaRes.length === 0 && !this.treeFilter) {
      const msgItem = new TreeItemBase(
        'No EDA CRDs found',
        vscode.TreeItemCollapsibleState.None,
        'message'
      );
      msgItem.iconPath = new vscode.ThemeIcon('info');
      return [msgItem];
    }

    const items: TreeItemBase[] = [];

    for (const r of edaRes) {
      const { kind, apiGroup, apiVersion, plural, namespaced } = r.resource;
      if (!kind) continue;

      // Filter to ensure there's at least one instance in this namespace
      let inst = r.instances;
      if (namespaced) {
        inst = inst.filter(i => i.metadata?.namespace === namespace);
      }
      if (inst.length === 0) continue;

      const label = kind;

      // We handle name-based filtering of children in getResourceInstances,
      // so the resource type nodes are always created here.
      const treeItem = new TreeItemBase(
        label,
        this.expandAll ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
        'resource-type'
      );
      treeItem.iconPath = new vscode.ThemeIcon('symbol-class');
      treeItem.namespace = namespace;
      treeItem.resourceType = kind.toLowerCase();
      treeItem.resourceCategory = 'eda';
      treeItem.crdInfo = {
        group: apiGroup,
        version: apiVersion,
        plural: plural,
        namespaced: namespaced
      };

      items.push(treeItem);
    }

    // If there's a filter, remove resource types that end up with zero matching children
    if (this.treeFilter) {
      const filteredItems = items.filter(typeItem => {
        // if resource-type label matches => keep it
        const typeLabel = typeItem.label.toString().toLowerCase();
        if (typeLabel.includes(this.treeFilter)) return true;

        // otherwise see if at least one child instance name matches
        const children = this.getResourceInstances(
          typeItem.namespace!,
          typeItem.resourceType!,
          typeItem.resourceCategory!,
          typeItem.crdInfo
        );
        return (children.length > 0);
      });
      return filteredItems;
    }

    return items;
  }

  /**
   * Build standard K8s resource type nodes
   */
  private getK8sResourceTypes(namespace: string): TreeItemBase[] {
    if (!this.k8sClient) {
      return [];
    }
    const k8sClient = this.k8sClient!;
    const k8sResourceTypes = [
      {
        kind: 'Pod',
        icon: 'vm',
        plural: 'pods',
        getResources: () => k8sClient.getCachedPods(namespace)
      },
      {
        kind: 'Deployment',
        icon: 'rocket',
        plural: 'deployments',
        getResources: () => k8sClient.getCachedDeployments(namespace)
      },
      {
        kind: 'Service',
        icon: 'globe',
        plural: 'services',
        getResources: () => k8sClient.getCachedServices(namespace)
      },
      {
        kind: 'ConfigMap',
        icon: 'file-binary',
        plural: 'configmaps',
        getResources: () => k8sClient.getCachedConfigMaps(namespace)
      },
      {
        kind: 'Secret',
        icon: 'lock',
        plural: 'secrets',
        getResources: () => k8sClient.getCachedSecrets(namespace)
      }
    ];

    const items: TreeItemBase[] = [];

    for (const rt of k8sResourceTypes) {
      const resources = rt.getResources() || [];
      if (resources.length === 0) continue;

      const label = rt.kind;
      const treeItem = new TreeItemBase(
        label,
        this.expandAll ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
        'resource-type'
      );
      treeItem.iconPath = new vscode.ThemeIcon(rt.icon);
      treeItem.namespace = namespace;
      treeItem.resourceType = rt.kind.toLowerCase();
      treeItem.resourceCategory = 'k8s';
      treeItem.crdInfo = {
        group: '',
        version: 'v1',
        plural: rt.plural,
        namespaced: true
      };

      items.push(treeItem);
    }

    // Apply a filter if set
    if (this.treeFilter) {
      const filteredItems = items.filter(typeItem => {
        const lbl = typeItem.label.toString().toLowerCase();
        if (lbl.includes(this.treeFilter)) {
          return true;
        } else {
          // see if any child matches the filter by name
          const childInstances = this.getResourceInstances(
            typeItem.namespace!,
            typeItem.resourceType!,
            'k8s',
            typeItem.crdInfo
          );
          return childInstances.length > 0;
        }
      });
      return filteredItems;
    }

    return items;
  }

  /**
   * Build resource instance items for the chosen resource-type
   */
  private getResourceInstances(
    namespace: string,
    resourceType: string,
    category: string,
    crdInfo: any
  ): TreeItemBase[] {
    let instances: any[] = [];

    // EDA CRDs
    if (category === 'eda' && crdInfo) {
      if (!this.resourceService) {
        return [];
      }
      // find the matching CRD in the ResourceService
      const all = this.resourceService.getAllResourceInstances();
      for (const r of all) {
        const rd = r.resource;
        if (
          rd.kind?.toLowerCase() === resourceType &&
          rd.apiGroup === crdInfo.group &&
          rd.plural === crdInfo.plural
        ) {
          instances = r.instances;
          if (rd.namespaced) {
            instances = instances.filter(i => i.metadata?.namespace === namespace);
          }
          break;
        }
      }
    }
    // K8s resources
    else if (category === 'k8s') {
      if (!this.k8sClient) {
        return [];
      }
      switch (resourceType) {
        case 'pod':
          instances = this.k8sClient.getCachedPods(namespace);
          break;
        case 'deployment':
          instances = this.k8sClient.getCachedDeployments(namespace);
          break;
        case 'service':
          instances = this.k8sClient.getCachedServices(namespace);
          break;
        case 'configmap':
          instances = this.k8sClient.getCachedConfigMaps(namespace);
          break;
        case 'secret':
          instances = this.k8sClient.getCachedSecrets(namespace);
          break;
      }
    }

    if (!instances || instances.length === 0) {
      return [];
    }

    const items = instances.map(inst => {
      const name = inst.metadata?.name || 'unnamed';
      const contextValue = (resourceType === 'pod') ? 'pod' :
                    (resourceType === 'deployment' && category === 'k8s') ?
                    'k8s-deployment-instance' : 'crd-instance';

      const treeItem = new TreeItemBase(
        name,
        this.expandAll ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
        contextValue,
        inst
      );

      // Get status
      if (this.statusService) {
        const statusIndicator = this.statusService.getResourceStatusIndicator(inst);
        const statusDescription = this.statusService.getStatusDescription(inst);
        treeItem.setStatus(statusIndicator, statusDescription);

        try {
          // Custom status icon if available
          treeItem.iconPath = this.statusService.getStatusIcon(statusIndicator);
        } catch {
          // fallback if not found
          treeItem.iconPath = this.statusService.getThemeStatusIcon(statusIndicator);
        }
        treeItem.tooltip = this.statusService.getResourceTooltip(inst);
      }

      treeItem.namespace = namespace;
      treeItem.resourceType = resourceType;

      // Command
      treeItem.command = {
        command: resourceType === 'pod'
          ? 'vscode-eda.describePod'
          : 'vscode-eda.viewResource',
        title: 'View Resource Details',
        arguments: [treeItem]
      };

      return treeItem;
    });

    // If parent's label didn't match, we filter instances by name
    if (this.treeFilter) {
      // We have to check if the parent's resource-type name matched already.
      // We'll just do a direct re-check here:
      const parentTypeMatches = resourceType.toLowerCase().includes(this.treeFilter);

      if (!parentTypeMatches) {
        return items.filter(it =>
          it.label.toLowerCase().includes(this.treeFilter)
        );
      }
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
