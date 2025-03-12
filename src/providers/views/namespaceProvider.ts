import * as vscode from 'vscode';
import { TreeItemBase } from './treeItem';
import { serviceManager } from '../../services/serviceManager';
import { KubernetesClient } from '../../clients/kubernetesClient';
import { ResourceService } from '../../services/resourceService';
import { EdactlClient } from '../../clients/edactlClient';
import { log, LogLevel } from '../../extension';

/**
 * TreeDataProvider for the EDA Namespaces view
 */
export class EdaNamespaceProvider implements vscode.TreeDataProvider<TreeItemBase> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItemBase | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private k8sClient: KubernetesClient;
  private resourceService: ResourceService;
  private edactlClient: EdactlClient;
  private treeFilter: string = '';
  private _refreshDebounceTimer: NodeJS.Timeout | undefined;

  // Cache namespaces to avoid fetching during tree builds
  private cachedNamespaces: string[] = [];

  constructor(private context: vscode.ExtensionContext) {
    this.k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');
    this.resourceService = serviceManager.getService<ResourceService>('kubernetes-resources');
    this.edactlClient = serviceManager.getClient<EdactlClient>('edactl');

    this.setupEventListeners();
    this.setupAutoRefresh();

    // Initial namespace fetch - do this once at startup
    this.fetchNamespaces();
  }

  /**
   * Set up event listeners for resource changes
   */
  private setupEventListeners(): void {
    // Listen for changes to resources and refresh the tree
    this.resourceService.onDidChangeResources(() => {
      log('Resource change detected, refreshing tree view', LogLevel.DEBUG);
      this.refresh();
    });

    // Listen for namespace changes
    this.resourceService.onDidChangeNamespace((namespace) => {
      log(`Namespace changed to: ${namespace}, refreshing tree view`, LogLevel.DEBUG);
      this.refresh();
    });

    // Debug events to trace through the event chain
    vscode.window.onDidChangeActiveTextEditor(() => {
      // Use editor focus as a trigger to validate tree state
      this.validateTreeState();
    });
  }

  /**
   * Periodically validate tree state to ensure it's consistent with resource cache
   */
  private validateTreeState(): void {
    try {
      // Check if the cached namespaces match the edactl namespaces
      this.edactlClient.getEdaNamespaces().then(namespaces => {
        if (this.cachedNamespaces.length !== namespaces.length || 
            !this.cachedNamespaces.every(ns => namespaces.includes(ns))) {
          log(`Namespace cache mismatch, updating (${this.cachedNamespaces.join(',')} vs ${namespaces.join(',')})`, LogLevel.DEBUG);
          this.cachedNamespaces = namespaces;
          this.refresh();
        }
      }).catch(err => {
        log(`Error validating namespace cache: ${err}`, LogLevel.ERROR);
      });
    } catch (error) {
      log(`Error in validateTreeState: ${error}`, LogLevel.ERROR);
    }
  }

  /**
   * Set up auto-refresh for the tree view
   */
  private setupAutoRefresh(): void {
    const refreshInterval = vscode.workspace.getConfiguration('vscode-eda').get<number>('refreshInterval', 30000);
    if (refreshInterval > 0) {
      setInterval(() => {
        // Just refresh namespaces on interval - resources will update via watchers
        this.fetchNamespaces();
      }, refreshInterval);
    }
  }

  /**
   * Fetch namespaces once and cache them
   */
  private async fetchNamespaces(): Promise<void> {
    try {
      const namespaces = await this.edactlClient.getEdaNamespaces();
      
      // Deep comparison to avoid unnecessary refreshes
      const currentNsStr = JSON.stringify(this.cachedNamespaces.sort());
      const newNsStr = JSON.stringify(namespaces.sort());
      
      if (currentNsStr !== newNsStr) {
        log(`Namespace changes detected. Old: [${this.cachedNamespaces.join(', ')}], New: [${namespaces.join(', ')}]`, LogLevel.DEBUG);
        this.cachedNamespaces = namespaces;
        this.refresh();
      }
    } catch (error) {
      log(`Error fetching namespaces: ${error}`, LogLevel.ERROR);
    }
  }

  /**
   * Refresh the entire tree
   */
  public refresh(): void {
    log('Refreshing EDA namespaces tree view...', LogLevel.DEBUG);
    
    // To prevent multiple rapid refreshes, add a small debounce
    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer);
    }
    
    this._refreshDebounceTimer = setTimeout(() => {
      this._onDidChangeTreeData.fire(undefined);
      this._refreshDebounceTimer = undefined;
    }, 100);
  }

  /**
   * Filter the tree by text
   * @param filterText Text to filter by
   */
  public setTreeFilter(filterText: string): void {
    this.treeFilter = filterText.toLowerCase();
    log(`Setting tree filter to: "${filterText}"`, LogLevel.INFO);
    this.refresh();
  }

  /**
   * Clear the current tree filter
   */
  public clearTreeFilter(): void {
    this.treeFilter = '';
    log(`Clearing tree filter`, LogLevel.INFO);
    this.refresh();
  }

  /**
   * Get the TreeItem representation of an element
   * @param element The tree item
   * @returns The TreeItem
   */
  getTreeItem(element: TreeItemBase): vscode.TreeItem {
    return element;
  }

  /**
   * Get children of the provided element
   * @param element The parent element
   * @returns Array of child elements
   */
  async getChildren(element?: TreeItemBase): Promise<TreeItemBase[]> {
    if (!element) {
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
   * Get namespaces as tree items - use cached values
   * @returns Array of namespace tree items
   */
  private getNamespaces(): TreeItemBase[] {
    try {
      // Use cached namespaces instead of fetching
      const namespaces = this.cachedNamespaces;

      if (namespaces.length === 0) {
        const treeItem = new TreeItemBase(
          'No EDA namespaces found',
          vscode.TreeItemCollapsibleState.None,
          'message'
        );
        treeItem.iconPath = new vscode.ThemeIcon('warning');
        return [treeItem];
      }

      const items = namespaces.map(ns => {
        const treeItem = new TreeItemBase(
          ns,
          vscode.TreeItemCollapsibleState.Collapsed,
          'namespace'
        );
        treeItem.iconPath = new vscode.ThemeIcon('package');
        treeItem.namespace = ns;
        return treeItem;
      });

      if (this.treeFilter) {
        return items.filter(item => item.label.toString().toLowerCase().includes(this.treeFilter));
      }

      return items;
    } catch (error) {
      log(`Error getting namespaces for tree view: ${error}`, LogLevel.ERROR);

      const treeItem = new TreeItemBase(
        'Error loading namespaces',
        vscode.TreeItemCollapsibleState.None,
        'error'
      );
      treeItem.iconPath = new vscode.ThemeIcon('error');
      treeItem.tooltip = `${error}`;
      return [treeItem];
    }
  }

  /**
   * Get resource categories as tree items - use cached resources
   * @param namespace Namespace name
   * @returns Array of resource category tree items
   */
  private getResourceCategories(namespace: string): TreeItemBase[] {
    const categories = [
      { id: 'eda', label: 'EDA Resources', icon: 'zap' },
      { id: 'k8s', label: 'Kubernetes Resources', icon: 'symbol-namespace' }
    ];
    const result: TreeItemBase[] = [];

    // Use cached resource instances
    const allResources = this.resourceService.getAllResourceInstances();

    for (const category of categories) {
      let hasResources = false;

      if (category.id === 'eda') {
        hasResources = allResources.some(res => {
          const group = (res.resource.apiGroup || '');
          // Check if there are any instances for this namespace
          return !group.endsWith('k8s.io') && res.instances.some(
            inst => !res.resource.namespaced || inst.metadata?.namespace === namespace
          );
        });
      } else if (category.id === 'k8s') {
        // Always show k8s resources
        hasResources = true;
      }

      if (hasResources) {
        const treeItem = new TreeItemBase(
          category.label,
          vscode.TreeItemCollapsibleState.Collapsed,
          'resource-category'
        );
        treeItem.iconPath = new vscode.ThemeIcon(category.icon);
        treeItem.namespace = namespace;
        treeItem.resourceCategory = category.id;
        result.push(treeItem);
      }
    }

    if (this.treeFilter) {
      return result.filter(item => item.label.toString().toLowerCase().includes(this.treeFilter));
    }

    return result;
  }

  /**
   * Get resource types for a specific category - use cached data
   * @param namespace Namespace name
   * @param category Resource category ID
   * @returns Array of resource type tree items
   */
  private getResourcesForCategory(namespace: string, category: string): TreeItemBase[] {
    try {
      const items: TreeItemBase[] = [];

      // Use cached resource instances
      const allResources = this.resourceService.getAllResourceInstances();

      if (category === 'eda') {
        for (const resourceResult of allResources) {
          const resource = resourceResult.resource;
          const instances = resourceResult.instances;

          const group = resource.apiGroup || '';
          if (!group || group.endsWith('k8s.io')) continue;

          // Filter instances for this namespace
          const namespaceInstances = instances.filter(inst =>
            !resource.namespaced || inst.metadata?.namespace === namespace
          );

          if (namespaceInstances.length === 0) continue;

          const kind = resource.kind || '';
          if (!kind) continue;

          const treeItem = new TreeItemBase(
            kind,
            vscode.TreeItemCollapsibleState.Collapsed,
            'resource-type'
          );
          treeItem.iconPath = new vscode.ThemeIcon('symbol-class');
          treeItem.namespace = namespace;
          treeItem.resourceType = kind.toLowerCase();
          treeItem.resourceCategory = category;
          treeItem.crdInfo = {
            group: group,
            version: resource.apiVersion || 'v1',
            plural: resource.plural || kind.toLowerCase() + 's',
            namespaced: resource.namespaced
          };
          items.push(treeItem);
        }
      } else if (category === 'k8s') {
        const k8sResources = [
          { kind: 'Pod', icon: 'vm', plural: 'pods' },
          { kind: 'Deployment', icon: 'rocket', plural: 'deployments' },
          { kind: 'Service', icon: 'globe', plural: 'services' },
          { kind: 'ConfigMap', icon: 'file-binary', plural: 'configmaps' },
          { kind: 'Secret', icon: 'lock', plural: 'secrets' }
        ];

        for (const res of k8sResources) {
          const treeItem = new TreeItemBase(
            res.kind,
            vscode.TreeItemCollapsibleState.Collapsed,
            'resource-type'
          );
          treeItem.iconPath = new vscode.ThemeIcon(res.icon);
          treeItem.namespace = namespace;
          treeItem.resourceType = res.kind.toLowerCase();
          treeItem.resourceCategory = category;
          treeItem.crdInfo = {
            group: '',
            version: 'v1',
            plural: res.plural,
            namespaced: true
          };
          items.push(treeItem);
        }
      }

      if (this.treeFilter) {
        return items.filter(item => item.label.toString().toLowerCase().includes(this.treeFilter));
      }

      if (items.length === 0) {
        const treeItem = new TreeItemBase(
          `No ${category} resources found`,
          vscode.TreeItemCollapsibleState.None,
          'message'
        );
        treeItem.iconPath = new vscode.ThemeIcon('info');
        return [treeItem];
      }

      return items;
    } catch (error) {
      log(`Error getting resource types for category ${category}: ${error}`, LogLevel.ERROR);

      const treeItem = new TreeItemBase(
        'Error loading resources',
        vscode.TreeItemCollapsibleState.None,
        'error'
      );
      treeItem.iconPath = new vscode.ThemeIcon('error');
      treeItem.tooltip = `${error}`;
      return [treeItem];
    }
  }

  /**
   * Get resource instances for a specific type - use cached data
   * @param namespace Namespace name
   * @param resourceType Resource type name
   * @param category Resource category ID
   * @param crdInfo CRD information
   * @returns Array of resource instance tree items
   */

    private getResourceInstances(
      namespace: string,
      resourceType: string,
      category: string,
      crdInfo: any
    ): TreeItemBase[] {
      try {
        let instances: any[] = [];

        if (crdInfo) {
          // Use cached resources
          const allResources = this.resourceService.getAllResourceInstances();

          const { group, version, plural, namespaced } = crdInfo;

          for (const resourceResult of allResources) {
            const resource = resourceResult.resource;

            if ((resource.apiGroup === group || (!resource.apiGroup && !group)) &&
                (resource.plural === plural || resource.kind?.toLowerCase() === resourceType)) {

              instances = resourceResult.instances;

              if (namespaced) {
                instances = instances.filter(inst => inst.metadata?.namespace === namespace);
              }

              break;
            }
          }

          if (instances.length === 0 && group === '' && category === 'k8s') {
            // For standard K8s resources, we might need placeholder data
            instances = [
              {
                metadata: {
                  name: `sample-${resourceType}-1`,
                  namespace: namespace,
                  uid: `uid-${resourceType}-1`
                }
              },
              {
                metadata: {
                  name: `sample-${resourceType}-2`,
                  namespace: namespace,
                  uid: `uid-${resourceType}-2`
                }
              }
            ];
          }
        }

        if (instances.length === 0) {
          const treeItem = new TreeItemBase(
            `No ${resourceType} resources found`,
            vscode.TreeItemCollapsibleState.None,
            'message'
          );
          treeItem.iconPath = new vscode.ThemeIcon('info');
          return [treeItem];
        }

        const items = instances.map(instance => {
          const name = instance.metadata?.name || 'unnamed';
          const contextValue = resourceType === 'pod' ? 'pod' : 'crd-instance';

          const treeItem = new TreeItemBase(
            name,
            vscode.TreeItemCollapsibleState.None,
            contextValue,
            instance
          );

          if (resourceType === 'pod') {
            treeItem.iconPath = new vscode.ThemeIcon('vm');
          } else {
            treeItem.iconPath = new vscode.ThemeIcon('symbol-variable');
          }

          treeItem.namespace = namespace;
          treeItem.resourceType = resourceType;

          // FIX: Avoid circular reference by passing only the necessary data
          // instead of the entire treeItem
          treeItem.command = {
            command: resourceType === 'pod' ? 'vscode-eda.describePod' : 'vscode-eda.showCRDDefinition',
            title: 'View Resource Details',
            arguments: [{
              name: name,
              namespace: namespace,
              resourceType: resourceType,
              kind: instance.kind || resourceType,
              uid: instance.metadata?.uid,
              resource: instance // Include just the resource data
            }]
          };

          return treeItem;
        });

        if (this.treeFilter) {
          return items.filter(item => item.label.toString().toLowerCase().includes(this.treeFilter));
        }

        return items;
      } catch (error) {
        log(`Error getting instances for ${resourceType}: ${error}`, LogLevel.ERROR);

        const treeItem = new TreeItemBase(
          `Error loading ${resourceType} resources`,
          vscode.TreeItemCollapsibleState.None,
          'error'
        );
        treeItem.iconPath = new vscode.ThemeIcon('error');
        treeItem.tooltip = `${error}`;
        return [treeItem];
      }
    }
}