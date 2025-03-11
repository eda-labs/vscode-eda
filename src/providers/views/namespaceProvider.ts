import * as vscode from 'vscode';
import { serviceManager } from '../../services/serviceManager';
import { ResourceService } from '../../services/resourceService';
import { EdaService } from '../../services/edaService';
import { CrdService } from '../../services/crdService';
import { resourceStatusService } from '../../extension.js';
import { resourceStore } from '../../extension.js';
import { log, LogLevel, globalTreeFilter } from '../../extension.js';
import { TreeItemBase } from './common/treeItem';

export class EdaNamespaceProvider implements vscode.TreeDataProvider<NamespaceTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<NamespaceTreeItem | undefined | null | void>
    = new vscode.EventEmitter<NamespaceTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<NamespaceTreeItem | undefined | null | void>
    = this._onDidChangeTreeData.event;

    private k8sService: ResourceService;
    private edaService: EdaService;
    private crdService: CrdService;


  constructor(
    private context: vscode.ExtensionContext
  ) {
    this.k8sService = serviceManager.getService<ResourceService>('resource');
    this.edaService = serviceManager.getService<EdaService>('eda');
    this.crdService = serviceManager.getService<CrdService>('crd');
    // Listen for resource store changes
    resourceStore.onDidChangeResources(changes => {
      // Only refresh the tree if there are namespace-related changes
      const namespaceChanges = changes.filter(change =>
        change.item.namespace !== 'eda-system' &&
        change.item.kind !== 'Transaction'
      );

      if (namespaceChanges.length > 0) {
        this.refresh();
      }
    });

    // Listen for namespace reloads
    resourceStore.onDidReloadNamespace(namespace => {
      if (namespace !== 'eda-system') {
        this.refresh();
      }
    });
  }


  // Called by extension or user refresh
  refresh(): void {
    log("EdaNamespaceProvider: Refresh called", LogLevel.DEBUG);
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: NamespaceTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: NamespaceTreeItem): Promise<NamespaceTreeItem[]> {
    try {
      // If no filter => use normal lazy approach
      if (!globalTreeFilter) {
        return await this.getChildrenLazy(element);
      }
      // Else do BFS filter approach
      return await this.getChildrenFiltered(element, globalTreeFilter);
    } catch (error) {
      log(`EdaNamespaceProvider: Error loading children: ${error}`, LogLevel.ERROR, true);
      vscode.window.showErrorMessage(`${error}`);
      return [];
    }
  }

  /**
   * Lazy approach from your original code
   */
  private async getChildrenLazy(element?: NamespaceTreeItem): Promise<NamespaceTreeItem[]> {
    if (!element) {
      // root => EDA namespaces (excluding eda-system)
      return this.getNamespaceItems();
    }
    if (element.contextValue === 'namespace') {
      return this.getResourceCategoriesForNamespace(element.label);
    }
    if (element.contextValue === 'resource-category') {
      const ns = element.namespace;
      if (ns) {
        if (element.resourceCategory === 'NPP Pods') {
          return this.getNppPodsForNamespace(ns);
        } else {
          return this.getCrdTypesForGroup(ns, element.resourceCategory!);
        }
      }
    }
    if (element.contextValue === 'crd-type') {
      if (element.namespace && element.crdInfo) {
        return this.getCrdInstances(element.namespace, element.crdInfo);
      }
    }
    return [];
  }

  /**
   * Filter BFS approach:
   *  - If node’s label matches => keep it, and do “shallow” expansions only if user expands it in the UI
   *  - If node’s label doesn’t match => we do a BFS expansion of its children to see if any child matches
   */

  private async getChildrenFiltered(element: NamespaceTreeItem | undefined, filter: string): Promise<NamespaceTreeItem[]> {
    const lowerFilter = filter.toLowerCase();

    // If no element (root level), filter namespaces
    if (!element) {
      const namespaces = await this.getNamespaceItems();
      const result: NamespaceTreeItem[] = [];

      for (const namespace of namespaces) {
        // Direct match on namespace name
        if (namespace.label.toLowerCase().includes(lowerFilter)) {
          result.push(namespace);
          continue;
        }

        // Check if any resources in this namespace match
        if (resourceStore.isNamespaceLoaded(namespace.namespace || '')) {
          const hasMatchingResources = resourceStore.filterResourcesInNamespace(
            namespace.namespace || '', filter
          ).length > 0;

          if (hasMatchingResources) {
            result.push(namespace);
          }
        }
      }

      return result;
    }

    // If we're at a namespace level, filter resource categories
    if (element.contextValue === 'namespace' && element.namespace) {
      // Ensure namespace is loaded
      if (!resourceStore.isNamespaceLoaded(element.namespace)) {
        await resourceStore.loadNamespaceResources(element.namespace);
      }

      // Get all categories
      const allCategories = await this.getResourceCategoriesForNamespace(element.namespace);
      const result: NamespaceTreeItem[] = [];

      // Filter categories based on name or content
      for (const category of allCategories) {
        // Direct match on category name - include the category itself
        if (category.label.toLowerCase().includes(lowerFilter)) {
          result.push(category);
          continue;
        }

        // For NPP Pods
        if (category.resourceCategory === 'NPP Pods') {
          // Check if the "NPP Pods" category name itself contains the filter term
          if ("npp pods".includes(lowerFilter) || "pods".includes(lowerFilter)) {
            const newCategory = this.copyTreeItem(category);
            const nppPods = resourceStore.getNppPodsForNamespace(element.namespace);
            newCategory.description = `${nppPods.length} pods`;
            result.push(newCategory);
            continue;
          }

          const nppPods = resourceStore.getNppPodsForNamespace(element.namespace);
          const matchingPods = nppPods.filter(pod =>
            pod.name.toLowerCase().includes(lowerFilter)
          );

          if (matchingPods.length > 0) {
            const newCategory = this.copyTreeItem(category);
            newCategory.description = `${matchingPods.length} matching pods`;
            result.push(newCategory);
          }
          continue;
        }

        // For CRD groups
        if (category.resourceCategory && category.resourceCategory !== 'NPP Pods') {
          const group = category.resourceCategory;

          // If the category or any variation of its name matches the filter, show all resources
          if (category.resourceCategory.toLowerCase().includes(lowerFilter) ||
              group.toLowerCase().includes(lowerFilter)) {
            const resources = resourceStore.getResourcesForGroup(element.namespace, group);
            if (resources.length > 0) {
              const newCategory = this.copyTreeItem(category);
              newCategory.description = `${resources.length} resources`;
              result.push(newCategory);
            }
            continue;
          }

          // Otherwise, check if any resources in the group match the filter
          const resources = resourceStore.getResourcesForGroup(element.namespace, group);
          const matchingResources = resources.filter(r =>
            r.name.toLowerCase().includes(lowerFilter) ||
            r.kind.toLowerCase().includes(lowerFilter)
          );

          if (matchingResources.length > 0) {
            const newCategory = this.copyTreeItem(category);
            newCategory.description = `${matchingResources.length} matching resources`;
            result.push(newCategory);
          }
        }
      }

      return result;
    }

    // If we're at a resource category level, filter resource kinds/instances
    if (element.contextValue === 'resource-category' && element.namespace) {
      if (element.resourceCategory === 'NPP Pods') {
        // Filter NPP pods
        const nppPods = await this.getNppPodsForNamespace(element.namespace);

        // If "pods" is in the filter, show all pods
        if ("pods".includes(lowerFilter)) {
          return nppPods;
        }

        return nppPods.filter(pod =>
          pod.label.toLowerCase().includes(lowerFilter)
        );
      } else if (element.resourceCategory) {
        // Filter CRD types for group
        const crdTypes = await this.getCrdTypesForGroup(element.namespace, element.resourceCategory);
        const result: NamespaceTreeItem[] = [];

        // If the resourceCategory contains the filter term, show all types
        if (element.resourceCategory.toLowerCase().includes(lowerFilter)) {
          return crdTypes;
        }

        for (const crdType of crdTypes) {
          // Direct match on CRD type name
          if (crdType.label.toLowerCase().includes(lowerFilter)) {
            result.push(crdType);
            continue;
          }

          // Check if any instances match
          if (crdType.crdInfo) {
            const instances = await this.getCrdInstances(element.namespace, crdType.crdInfo);
            const matchingInstances = instances.filter(instance =>
              instance.label.toLowerCase().includes(lowerFilter)
            );

            if (matchingInstances.length > 0) {
              const newType = this.copyTreeItem(crdType);
              newType.description = `${matchingInstances.length} matching instances`;
              result.push(newType);
            }
          }
        }

        return result;
      }
    }

    // If we're at a CRD type level, filter CRD instances
    if (element.contextValue === 'crd-type' && element.namespace && element.crdInfo) {
      const instances = await this.getCrdInstances(element.namespace, element.crdInfo);

      // If the CRD type name contains the filter, show all instances
      if (element.label.toLowerCase().includes(lowerFilter) ||
          element.crdInfo.kind.toLowerCase().includes(lowerFilter)) {
        return instances;
      }

      return instances.filter(instance =>
        instance.label.toLowerCase().includes(lowerFilter)
      );
    }

    // Default: no children or no match
    return [];
  }

  // Helper to clone a tree item
  private copyTreeItem(item: NamespaceTreeItem): NamespaceTreeItem {
    const newItem = new NamespaceTreeItem(
      item.label,
      item.collapsibleState,
      item.contextValue,
      item.resource
    );
    newItem.namespace = item.namespace;
    newItem.resourceCategory = item.resourceCategory;
    newItem.crdInfo = item.crdInfo;
    newItem.tooltip = item.tooltip;
    newItem.description = item.description;
    newItem.iconPath = item.iconPath;
    newItem.command = item.command;
    return newItem;
  }

  /**
   * Original code for retrieving data
   */
  private async getNamespaceItems(): Promise<NamespaceTreeItem[]> {
    log("EdaNamespaceProvider: getNamespaceItems()", LogLevel.DEBUG);
    const namespaces = await this.edaService.getEdaNamespaces();

    // Process all namespaces in parallel for initial load
    const loadPromises = [];
    for (const ns of namespaces) {
      if (ns !== 'eda-system' && !resourceStore.isNamespaceLoaded(ns)) {
        loadPromises.push(resourceStore.loadNamespaceResources(ns));
      }
    }

    // Wait for all namespace loads to complete
    if (loadPromises.length > 0) {
      await Promise.all(loadPromises);
    }

    // Create tree items
    return namespaces
      .filter((ns: string) => ns !== 'eda-system')
      .map((ns: string) => {
        const item = new NamespaceTreeItem(
          ns,
          vscode.TreeItemCollapsibleState.Collapsed,
          'namespace'
        );
        item.namespace = ns;
        item.tooltip = `Namespace: ${ns}`;
        return item;
      });
  }

  // Update the Resource Categories method
  private async getResourceCategoriesForNamespace(namespace: string): Promise<NamespaceTreeItem[]> {
    log(`EdaNamespaceProvider: getResourceCategoriesForNamespace('${namespace}')`, LogLevel.DEBUG);

    // Ensure namespace is loaded
    if (!resourceStore.isNamespaceLoaded(namespace)) {
      await resourceStore.loadNamespaceResources(namespace);
    }

    const categories: NamespaceTreeItem[] = [];

    // Check for NPP pods directly from the store
    const nppPods = resourceStore.getNppPodsForNamespace(namespace);
    if (nppPods.length > 0) {
      categories.push(this.createResourceCategoryItem('NPP Pods', namespace));
    }

    // Get CRD groups with instances directly from the store
    const groups = resourceStore.getAvailableGroupsInNamespace(namespace);
    for (const group of groups) {
      const friendly = this.makeFriendlyGroupName(group);
      const catItem = this.createResourceCategoryItem(friendly, namespace);
      catItem.resourceCategory = group;
      categories.push(catItem);
    }

    return categories;
  }

  private createResourceCategoryItem(label: string, namespace: string): NamespaceTreeItem {
    const item = new NamespaceTreeItem(
      label,
      vscode.TreeItemCollapsibleState.Collapsed,
      'resource-category'
    );
    item.namespace = namespace;
    item.resourceCategory = label;
    item.tooltip = `${label} in ${namespace}`;
    return item;
  }

  private makeFriendlyGroupName(group: string): string {
    const first = group.split('.')[0];
    if (!first) return group;
    return first.charAt(0).toUpperCase() + first.slice(1);
  }

  private async getNppPodsForNamespace(namespace: string): Promise<NamespaceTreeItem[]> {
    const pods = await this.edaService.getNppPodsForNamespace(namespace);
    if (pods.length === 0) {
      return [this.createNoResourcesFoundItem('NPP pods')];
    }
    return pods.map((pod: any) => {
      const name = pod.metadata?.name || '';
      const status = pod.status?.phase || 'Unknown';
      const nodeName = name;
      const item = new NamespaceTreeItem(
        nodeName,
        vscode.TreeItemCollapsibleState.None,
        'npp-pod',
        pod
      );
      item.iconPath = resourceStatusService.getResourceStatusIcon(pod);
      item.description = resourceStatusService.getStatusDescription(pod);
      item.tooltip = resourceStatusService.getResourceTooltip(pod);

      item.command = {
        command: 'vscode-eda.viewResource',
        title: 'View Resource',
        arguments: [item]
      };
      return item;
    });
  }

  private async getCrdTypesForGroup(ns: string, group: string): Promise<NamespaceTreeItem[]> {
    const crds = await this.crdService.getCrdsForGroup(group);
    const instancesSet = await this.crdService.batchCheckCrdInstances(ns, crds);
    if (instancesSet.size === 0) {
      return [this.createNoResourcesFoundItem(`CRDs in ${this.makeFriendlyGroupName(group)}`)];
    }
    return crds
      .filter((c: any) => instancesSet.has(c.kind))
      .map((crd: any) => {
        const item = new NamespaceTreeItem(
          crd.kind,
          vscode.TreeItemCollapsibleState.Collapsed,
          'crd-type'
        );
        item.namespace = ns;
        item.crdInfo = crd;
        item.tooltip = `Kind: ${crd.kind}\nName: ${crd.name}\nGroup: ${crd.apiGroup}\nNamespace: ${ns}`;
        return item;
      });
  }

  private async getCrdInstances(ns: string, crdInfo: any): Promise<NamespaceTreeItem[]> {
    try {
      const inst = await this.crdService.getCrdInstances(ns, crdInfo);
      if (inst.length === 0) {
        return [this.createNoResourcesFoundItem(`${crdInfo.kind} instances`)];
      }
      return inst.map((obj: any) => {
        const name = obj.metadata?.name || 'unnamed';
        const item = new NamespaceTreeItem(
          name,
          vscode.TreeItemCollapsibleState.None,
          'crd-instance',
          obj
        );

        item.iconPath = resourceStatusService.getResourceStatusIcon(obj);
        item.description = resourceStatusService.getStatusDescription(obj);
        item.tooltip = resourceStatusService.getResourceTooltip(obj);

        this.createResourceTreeItemCommand(item, obj);
        return item;
      });
    } catch (error) {
      log(`Failed to get CRD Instances for ${crdInfo.kind} in ${ns}: ${error}`, LogLevel.ERROR);
      return [this.createNoResourcesFoundItem(`${crdInfo.kind} instances`)];
    }
  }

  private createNoResourcesFoundItem(name: string): NamespaceTreeItem {
    const item = new NamespaceTreeItem(
      `No ${name} found`,
      vscode.TreeItemCollapsibleState.None,
      'info'
    );

    // Use standard gray status icon
    item.iconPath = resourceStatusService.getStatusIcon('gray');

    return item;
  }

  private createResourceTreeItemCommand(item: NamespaceTreeItem, resource: any): void {
    if (resource && resource.kind && resource.metadata?.name) {
      const ns = resource.metadata.namespace || item.namespace;
      item.command = {
        command: 'vscode-eda.viewResource',
        title: 'View Resource',
        arguments: [{
          kind: resource.kind,
          name: resource.metadata.name,
          namespace: ns
        }]
      };
    }
  }
}

export class NamespaceTreeItem extends TreeItemBase {
  public children?: NamespaceTreeItem[];
}
