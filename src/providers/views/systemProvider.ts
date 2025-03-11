import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { serviceManager } from '../../services/serviceManager';
import { ResourceService } from '../../services/resourceService';
import { EdaService } from '../../services/edaService';
import { CrdService } from '../../services/crdService';
import { KubernetesClient } from '../../clients/kubernetesClient';
import { resourceStore } from '../../extension.js';
import { log, LogLevel, globalTreeFilter } from '../../extension.js';
import { TreeItemBase } from './common/treeItem';
import { resourceStatusService } from '../../extension.js';

export class EdaSystemProvider implements vscode.TreeDataProvider<SystemTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<SystemTreeItem | undefined | null | void>
    = new vscode.EventEmitter<SystemTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<SystemTreeItem | undefined | null | void>
    = this._onDidChangeTreeData.event;

    private systemNamespace = 'eda-system';
    private k8sService: ResourceService;
    private crdService: CrdService;
    private k8sClient: KubernetesClient;

  constructor(
    private context: vscode.ExtensionContext
  ) {
    this.k8sService = serviceManager.getService<ResourceService>('resource');
    this.crdService = serviceManager.getService<CrdService>('crd');
    this.k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');
    // Listen for system namespace changes
    resourceStore.onDidChangeResources(changes => {
      // Only refresh if changes affect the system namespace
      const systemChanges = changes.filter(change =>
        change.item.namespace === 'eda-system'
      );

      if (systemChanges.length > 0) {
        this.refresh();
      }
    });

    // Listen for system namespace reloads
    resourceStore.onDidReloadNamespace(namespace => {
      if (namespace === 'eda-system') {
        this.refresh();
      }
    });
  }

  refresh(): void {
    log("EdaSystemProvider: refresh called", LogLevel.DEBUG);
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SystemTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SystemTreeItem): Promise<SystemTreeItem[]> {
    if (!globalTreeFilter) {
      // No filter => normal lazy
      return await this.getChildrenLazy(element);
    } else {
      // BFS filter approach
      return await this.getChildrenFiltered(element, globalTreeFilter);
    }
  }

  /**
   * Original lazy approach
   */
  private async getChildrenLazy(element?: SystemTreeItem): Promise<SystemTreeItem[]> {
    if (!element) {
      return this.getSystemResourceCategories();
    }
    if (element.contextValue === 'k8s-category') {
      return this.getKubernetesResourceTypes();
    }
    if (element.contextValue === 'resource-type' && element.resourceType) {
      return this.loadResourceItems(element.resourceType);
    }
    if (element.contextValue === 'eda-category') {
      return this.getEdaCrdGroups();
    }
    if (element.contextValue === 'crd-group' && element.crdGroup) {
      return this.loadCrdTypes(element.crdGroup);
    }
    if (element.contextValue === 'crd-type' && element.crdInfo) {
      return this.loadCrdInstances(element.crdInfo);
    }
    return [];
  }

  /**
   * BFS approach to find matches
   */
  private async getChildrenFiltered(element: SystemTreeItem | undefined, filter: string): Promise<SystemTreeItem[]> {
    const lowerFilter = filter.toLowerCase();

    // If root level, filter the top-level categories
    if (!element) {
      const categories = await this.getSystemResourceCategories();

      // For top-level categories, we need to check if any of their children match
      const result: SystemTreeItem[] = [];

      for (const category of categories) {
        // Direct match on category name
        if (category.label.toLowerCase().includes(lowerFilter)) {
          result.push(category);
          continue;
        }

        // Check children
        let matchingChildren: SystemTreeItem[] = [];

        if (category.contextValue === 'k8s-category') {
          // Get k8s resource types and check if any match
          const resourceTypes = await this.getKubernetesResourceTypes();
          matchingChildren = await this.filterItems(resourceTypes, filter);
        }
        else if (category.contextValue === 'eda-category') {
          // Get CRD groups and check if any match
          const crdGroups = await this.getEdaCrdGroups();
          matchingChildren = await this.filterItems(crdGroups, filter);
        }

        if (matchingChildren.length > 0) {
          const newCategory = this.copySystemTreeItem(category);
          newCategory.description = `${matchingChildren.length} matching items`;
          result.push(newCategory);
        }
      }

      return result;
    }

    // Handle k8s-category
    if (element.contextValue === 'k8s-category') {
      // If "kubernetes" or "resources" is in the filter, show all resource types
      if ("kubernetes".includes(lowerFilter) || "resources".includes(lowerFilter)) {
        return await this.getKubernetesResourceTypes();
      }

      const resourceTypes = await this.getKubernetesResourceTypes();
      return this.filterItems(resourceTypes, filter);
    }

    // Handle eda-category
    if (element.contextValue === 'eda-category') {
      // If "eda" is in the filter, show all EDA resources
      if ("eda".includes(lowerFilter) || "resources".includes(lowerFilter)) {
        return await this.getEdaCrdGroups();
      }

      const crdGroups = await this.getEdaCrdGroups();
      return this.filterItems(crdGroups, filter);
    }

    // Handle resource-type
    if (element.contextValue === 'resource-type' && element.resourceType) {
      if (element.resourceType.toLowerCase().includes(lowerFilter) ||
          element.label.toLowerCase().includes(lowerFilter)) {
        return await this.loadResourceItems(element.resourceType);
      }

      const resources = await this.loadResourceItems(element.resourceType);
      return resources.filter(r =>
        r.label.toLowerCase().includes(lowerFilter)
      );
    }

    // Handle crd-group
    if (element.contextValue === 'crd-group' && element.crdGroup) {
      if (element.crdGroup.toLowerCase().includes(lowerFilter) ||
          element.label.toLowerCase().includes(lowerFilter) ||
          this.makeFriendlyGroupName(element.crdGroup).toLowerCase().includes(lowerFilter)) {
        return await this.loadCrdTypes(element.crdGroup);
      }

      const crdTypes = await this.loadCrdTypes(element.crdGroup);
      const result: SystemTreeItem[] = [];

      for (const crdType of crdTypes) {
        // Direct match on CRD type name
        if (crdType.label.toLowerCase().includes(lowerFilter)) {
          result.push(crdType);
          continue;
        }

        // Check if any instances match
        if (crdType.crdInfo) {
          const instances = await this.loadCrdInstances(crdType.crdInfo);
          const matchingInstances = instances.filter(instance =>
            instance.label.toLowerCase().includes(lowerFilter)
          );

          if (matchingInstances.length > 0) {
            const newType = this.copySystemTreeItem(crdType);
            newType.description = `${matchingInstances.length} matching instances`;
            result.push(newType);
          }
        }
      }

      return result;
    }

    // Handle crd-type
    if (element.contextValue === 'crd-type' && element.crdInfo) {
      if (element.label.toLowerCase().includes(lowerFilter) ||
          element.crdInfo.kind.toLowerCase().includes(lowerFilter)) {
        return await this.loadCrdInstances(element.crdInfo);
      }

      const instances = await this.loadCrdInstances(element.crdInfo);
      return instances.filter(instance =>
        instance.label.toLowerCase().includes(lowerFilter)
      );
    }

    return [];
  }

  // Helper method to filter items and check their children recursively
  private async filterItems(items: SystemTreeItem[], filter: string): Promise<SystemTreeItem[]> {
    const lowerFilter = filter.toLowerCase();
    const result: SystemTreeItem[] = [];

    for (const item of items) {
      // Direct match on item name
      if (item.label.toLowerCase().includes(lowerFilter)) {
        result.push(item);
        continue;
      }

      // Check children
      let hasMatchingChildren = false;

      if (item.contextValue === 'resource-type' && item.resourceType) {
        if (item.resourceType.toLowerCase().includes(lowerFilter)) {
          result.push(item);
          continue;
        }

        const resources = await this.loadResourceItems(item.resourceType);
        hasMatchingChildren = resources.some(r =>
          r.label.toLowerCase().includes(lowerFilter)
        );
      }
      else if (item.contextValue === 'crd-group' && item.crdGroup) {
        if (item.crdGroup.toLowerCase().includes(lowerFilter) ||
            this.makeFriendlyGroupName(item.crdGroup).toLowerCase().includes(lowerFilter)) {
          result.push(item);
          continue;
        }

        const crdTypes = await this.loadCrdTypes(item.crdGroup);
        for (const crdType of crdTypes) {
          if (crdType.label.toLowerCase().includes(lowerFilter)) {
            hasMatchingChildren = true;
            break;
          }
          if (crdType.crdInfo) {
            const instances = await this.loadCrdInstances(crdType.crdInfo);
            if (instances.some(i => i.label.toLowerCase().includes(lowerFilter))) {
              hasMatchingChildren = true;
              break;
            }
          }
        }
      }

      if (hasMatchingChildren) {
        const newItem = this.copySystemTreeItem(item);
        newItem.description = "Has matching resources";
        result.push(newItem);
      }
    }

    return result;
  }

  // Helper to clone a tree item
  private copySystemTreeItem(item: SystemTreeItem): SystemTreeItem {
    const newItem = new SystemTreeItem(
      item.label,
      item.collapsibleState,
      item.contextValue,
      item.resource
    );
    newItem.crdGroup = item.crdGroup;
    newItem.resourceType = item.resourceType;
    newItem.crdInfo = item.crdInfo;
    newItem.tooltip = item.tooltip;
    newItem.description = item.description;
    newItem.iconPath = item.iconPath;
    newItem.command = item.command;
    return newItem;
  }

  /**
   * Original code for normal lazy expansions
   */
  private async getSystemResourceCategories(): Promise<SystemTreeItem[]> {
    return [
      new SystemTreeItem("Kubernetes Resources", vscode.TreeItemCollapsibleState.Expanded, "k8s-category"),
      new SystemTreeItem("EDA Resources", vscode.TreeItemCollapsibleState.Expanded, "eda-category")
    ];
  }

  private async getKubernetesResourceTypes(): Promise<SystemTreeItem[]> {
    // Ensure system namespace is loaded
    if (!resourceStore.isNamespaceLoaded(this.systemNamespace)) {
      await resourceStore.loadNamespaceResources(this.systemNamespace);
    }

    // Get available resource types directly from store
    const resourceTypes = ['Pods', 'Services', 'Deployments', 'ConfigMaps', 'Secrets']
      .filter(rt => {
        if (rt === 'Pods') {
          return resourceStore.getResourcesByKind(this.systemNamespace, 'Pod').length > 0;
        }
        if (rt === 'Services') {
          return resourceStore.getResourcesByKind(this.systemNamespace, 'Service').length > 0;
        }
        if (rt === 'Deployments') {
          return resourceStore.getResourcesByKind(this.systemNamespace, 'Deployment').length > 0;
        }
        if (rt === 'ConfigMaps') {
          return resourceStore.getResourcesByKind(this.systemNamespace, 'ConfigMap').length > 0;
        }
        if (rt === 'Secrets') {
          return resourceStore.getResourcesByKind(this.systemNamespace, 'Secret').length > 0;
        }
        return true; // fallback
      });

    return resourceTypes.map(rt => {
      const item = new SystemTreeItem(
        rt,
        vscode.TreeItemCollapsibleState.Collapsed,
        'resource-type'
      );
      item.resourceType = rt;
      item.tooltip = `${rt} in ${this.systemNamespace}`;
      return item;
    });
  }

  private async loadResourceItems(rt: string): Promise<SystemTreeItem[]> {
    log(`System: loadResourceItems('${rt}')`, LogLevel.DEBUG);

    // Ensure system namespace is loaded
    if (!resourceStore.isNamespaceLoaded(this.systemNamespace)) {
      await resourceStore.loadNamespaceResources(this.systemNamespace);
    }

    let resources: any[] = [];

    switch (rt) {
      case 'Pods':
        resources = resourceStore.getResourcesByKind(this.systemNamespace, 'Pod').map(item => item.resource);
        break;
      case 'Services':
        resources = resourceStore.getResourcesByKind(this.systemNamespace, 'Service').map(item => item.resource);
        break;
      case 'Deployments':
        resources = resourceStore.getResourcesByKind(this.systemNamespace, 'Deployment').map(item => item.resource);
        break;
      case 'ConfigMaps':
        resources = resourceStore.getResourcesByKind(this.systemNamespace, 'ConfigMap').map(item => item.resource);
        break;
      case 'Secrets':
        resources = resourceStore.getResourcesByKind(this.systemNamespace, 'Secret').map(item => item.resource);
        break;
      default:
        return this.renderGenericResources(rt);
    }

    // Render the resources using the unified approach
    return this.renderResources(resources, rt.toLowerCase().endsWith('s') ? rt.slice(0, -1).toLowerCase() : rt.toLowerCase());
  }

  private async getEdaCrdGroups(): Promise<SystemTreeItem[]> {
    log("System: getEdaCrdGroups()", LogLevel.DEBUG);

    // Ensure system namespace is loaded
    if (!resourceStore.isNamespaceLoaded(this.systemNamespace)) {
      await resourceStore.loadNamespaceResources(this.systemNamespace);
    }

    // Get available groups directly from store
    const groups = resourceStore.getAvailableGroupsInNamespace(this.systemNamespace);

    const items: SystemTreeItem[] = [];
    for (const group of groups) {
      const friendly = this.makeFriendlyGroupName(group);
      const it = new SystemTreeItem(
        friendly,
        vscode.TreeItemCollapsibleState.Collapsed,
        'crd-group'
      );
      it.crdGroup = group;
      it.tooltip = `${friendly} in ${this.systemNamespace}`;
      items.push(it);
    }

    if (!items.length) {
      return [this.noItems("EDA resources")];
    }

    return items;
  }

  private async loadCrdTypes(group: string): Promise<SystemTreeItem[]> {
    const crds = await this.crdService.getCrdsForGroup(group);
    const instSet = await this.crdService.batchCheckCrdInstances(this.systemNamespace, crds);
    if (instSet.size === 0) {
      return [this.noItems(`CRDs in ${this.makeFriendlyGroupName(group)}`)];
    }
    return crds
      .filter((crd: any) => instSet.has(crd.kind))
      .map((crd: any) => {
        const item = new SystemTreeItem(
          crd.kind,
          vscode.TreeItemCollapsibleState.Collapsed,
          'crd-type'
        );
        item.crdInfo = crd;
        item.tooltip = `Kind: ${crd.kind}\nName: ${crd.name}\nGroup: ${crd.apiGroup}\nNamespace: ${this.systemNamespace}`;
        return item;
      });
  }

  private async loadCrdInstances(crdInfo: any): Promise<SystemTreeItem[]> {
    log(`System: loadCrdInstances(${crdInfo.kind})`, LogLevel.DEBUG);
    try {
      const items = await this.crdService.getCrdInstances(this.systemNamespace, crdInfo);
      if (!items.length) {
        return [this.noItems(`${crdInfo.kind} instances`)];
      }
      return items.map((obj: any) => {
        const name = obj.metadata?.name || 'unnamed';
        const it = new SystemTreeItem(
          name,
          vscode.TreeItemCollapsibleState.None,
          'crd-instance',
          obj
        );
        // Delegate to resourceStatusService
        it.iconPath    = resourceStatusService.getResourceStatusIcon(obj);
        it.description = resourceStatusService.getStatusDescription(obj);
        it.tooltip     = resourceStatusService.getResourceTooltip(obj);

        this.createResourceTreeItemCommand(it, obj);
        return it;
      });
    } catch (err) {
      log(`System: error loading CRD instances for ${crdInfo.kind}: ${err}`, LogLevel.ERROR);
      return [this.noItems(`${crdInfo.kind} instances`)];
    }
  }

  private async renderGenericResources(resourceType: string): Promise<SystemTreeItem[]> {
    try {
      const kind = resourceType.endsWith('s') ? resourceType.slice(0, -1) : resourceType;
      const cmd = `${this.k8sClient.getKubectlPath()} get ${resourceType.toLowerCase()} -n ${this.systemNamespace} -o json`;
      const output = execSync(cmd, { encoding: 'utf-8' });
      const resources = JSON.parse(output).items || [];
      if (!resources.length) {
        return [this.noItems(resourceType.toLowerCase())];
      }
      return resources.map((resource: any) => {
        const name = resource.metadata?.name || 'unnamed';
        // Ensure `kind` is set so resourceStatusService can properly detect it
        resource.kind = kind;

        const it = new SystemTreeItem(
          name,
          vscode.TreeItemCollapsibleState.None,
          resourceType.toLowerCase(),
          resource
        );
        // Delegate to resourceStatusService
        it.iconPath    = resourceStatusService.getResourceStatusIcon(resource);
        it.description = resourceStatusService.getStatusDescription(resource);
        it.tooltip     = resourceStatusService.getResourceTooltip(resource);

        this.createResourceTreeItemCommand(it, resource);
        return it;
      });
    } catch (error) {
      log(`System: error rendering ${resourceType}: ${error}`, LogLevel.ERROR);
      return [this.noItems(resourceType.toLowerCase())];
    }
  }

  private renderResources(resources: any[], contextValue: string): SystemTreeItem[] {
    if (!resources.length) {
      return [this.noItems(contextValue + 's')];
    }
    return resources.map(r => {
      const name = r.metadata?.name || 'unnamed';
      // Ensure resource has a kind for the status service
      if (!r.kind) {
        r.kind = this.getResourceKindFromContextValue(contextValue);
      }

      const it = new SystemTreeItem(
        name,
        vscode.TreeItemCollapsibleState.None,
        contextValue,
        r
      );

      // Delegate everything to resourceStatusService
      it.iconPath    = resourceStatusService.getResourceStatusIcon(r);
      it.description = resourceStatusService.getStatusDescription(r);
      it.tooltip     = resourceStatusService.getResourceTooltip(r);

      this.createResourceTreeItemCommand(it, r);
      return it;
    });
  }

  private noItems(msg: string): SystemTreeItem {
    const it = new SystemTreeItem(
      `No ${msg} found`,
      vscode.TreeItemCollapsibleState.None,
      'info'
    );
    // Just a gray icon to indicate "no items"
    it.iconPath = resourceStatusService.getStatusIcon('gray');
    return it;
  }

  private makeFriendlyGroupName(group: string): string {
    const first = group.split('.')[0];
    if (!first) return group;
    return first.charAt(0).toUpperCase() + first.slice(1);
  }

  private createResourceTreeItemCommand(item: SystemTreeItem, resource: any): void {
    if (resource) {
      const kind = resource.kind || this.getResourceKindFromContextValue(item.contextValue);
      const name = resource.metadata?.name;
      if (kind && name) {
        item.command = {
          command: 'vscode-eda.viewResource',
          title: 'View Resource',
          arguments: [{
            kind: kind,
            name: name,
            namespace: this.systemNamespace
          }]
        };
      }
    }
  }

  private getResourceKindFromContextValue(val: string): string {
    switch (val) {
      case 'pod': return 'Pod';
      case 'service': return 'Service';
      case 'deployment': return 'Deployment';
      case 'configmap': return 'ConfigMap';
      case 'secret': return 'Secret';
      default: return val.charAt(0).toUpperCase() + val.slice(1);
    }
  }
}

export class SystemTreeItem extends TreeItemBase {
  public crdGroup?: string;
//  public resourceType?: string;
  public children?: SystemTreeItem[];
}
