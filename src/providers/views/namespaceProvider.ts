import * as vscode from 'vscode';
import { TreeItemBase } from './treeItem';
import { serviceManager } from '../../services/serviceManager';
import { KubernetesClient } from '../../clients/kubernetesClient';
import { ResourceService } from '../../services/resourceService';
import { ResourceStatusService } from '../../services/resourceStatusService';
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
  private statusService: ResourceStatusService;
  private edactlClient: EdactlClient;
  private treeFilter: string = '';
  private _refreshDebounceTimer: NodeJS.Timeout | undefined;
  private cachedNamespaces: string[] = [];

  constructor(private context: vscode.ExtensionContext) {
    this.k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');
    this.resourceService = serviceManager.getService<ResourceService>('kubernetes-resources');
    this.statusService = serviceManager.getService<ResourceStatusService>('resource-status');
    this.edactlClient = serviceManager.getClient<EdactlClient>('edactl');
    this.setupEventListeners();
    this.fetchNamespaces();
  }

  /**
   * Set up event listeners for resource changes
   */
  private setupEventListeners(): void {
    this.resourceService.onDidChangeResources(async () => {
      log('Resource change detected, refreshing tree view', LogLevel.DEBUG);
      await this.fetchNamespaces();
      this.refresh();
    });
    this.resourceService.onDidChangeNamespace((namespace) => {
      log(`Namespace changed to: ${namespace}, refreshing tree view`, LogLevel.DEBUG);
      this.refresh();
    });
    vscode.window.onDidChangeActiveTextEditor(() => {
      this.validateTreeState();
    });
  }

  /**
   * Periodically validate tree state to ensure it's consistent with resource cache.
   * (This is not a timer, just a check when the user switches editors.)
   */
  private validateTreeState(): void {
    try {
      this.edactlClient.getEdaNamespaces().then(namespaces => {
        if (
          this.cachedNamespaces.length !== namespaces.length ||
          !this.cachedNamespaces.every(ns => namespaces.includes(ns))
        ) {
          log(
            `Namespace cache mismatch, updating
             (cached=${this.cachedNamespaces.join(',')}
              new=${namespaces.join(',')})`,
            LogLevel.DEBUG
          );
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
   * Fetch namespaces once (from edactl) and cache them.
   * Watchers will trigger more updates if anything changes.
   */
  private async fetchNamespaces(): Promise<void> {
    try {
      const namespaces = await this.edactlClient.getEdaNamespaces();
      const currentNsStr = JSON.stringify(this.cachedNamespaces.sort());
      const newNsStr = JSON.stringify(namespaces.sort());
      if (currentNsStr !== newNsStr) {
        log(
          `Namespace changes detected.
           Old: [${this.cachedNamespaces.join(', ')}],
           New: [${namespaces.join(', ')}]`,
          LogLevel.DEBUG
        );
        this.cachedNamespaces = namespaces;
        this.refresh();
      }
    } catch (error) {
      log(`Error fetching namespaces: ${error}`, LogLevel.ERROR);
    }
  }

  /**
   * Refresh the entire tree.
   */
  public refresh(): void {
    log('Refreshing EDA namespaces tree view...', LogLevel.DEBUG);
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
        return items.filter(item =>
          item.label.toString().toLowerCase().includes(this.treeFilter)
        );
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
   * Check if the namespace has any Kubernetes resources
   * @param namespace Namespace name
   * @returns boolean indicating if namespace has any K8s resources
   */
  private hasKubernetesResources(namespace: string): boolean {
    const pods = this.k8sClient.getCachedPods(namespace);
    if (pods && pods.length > 0) {
      return true;
    }
    const deployments = this.k8sClient.getCachedDeployments(namespace);
    if (deployments && deployments.length > 0) {
      return true;
    }
    const services = this.k8sClient.getCachedServices(namespace);
    if (services && services.length > 0) {
      return true;
    }
    const configMaps = this.k8sClient.getCachedConfigMaps(namespace);
    if (configMaps && configMaps.length > 0) {
      return true;
    }
    const secrets = this.k8sClient.getCachedSecrets(namespace);
    if (secrets && secrets.length > 0) {
      return true;
    }
    return false;
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
    const allResources = this.resourceService.getAllResourceInstances();
    for (const category of categories) {
      let hasResources = false;
      if (category.id === 'eda') {
        hasResources = allResources.some(res => {
          const group = (res.resource.apiGroup || '');
          return (
            !group.endsWith('k8s.io') &&
            res.instances.some(inst => !res.resource.namespaced || inst.metadata?.namespace === namespace)
          );
        });
      } else if (category.id === 'k8s') {
        hasResources = this.hasKubernetesResources(namespace);
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
      return result.filter(item =>
        item.label.toString().toLowerCase().includes(this.treeFilter)
      );
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
      const allResources = this.resourceService.getAllResourceInstances();
      if (category === 'eda') {
        for (const resourceResult of allResources) {
          const resource = resourceResult.resource;
          const instances = resourceResult.instances;
          const group = resource.apiGroup || '';
          if (!group || group.endsWith('k8s.io')) continue;
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
        const k8sResourceTypes = [
          {
            kind: 'Pod',
            icon: 'vm',
            plural: 'pods',
            getResources: () => this.k8sClient.getCachedPods(namespace)
          },
          {
            kind: 'Deployment',
            icon: 'rocket',
            plural: 'deployments',
            getResources: () => this.k8sClient.getCachedDeployments(namespace)
          },
          {
            kind: 'Service',
            icon: 'globe',
            plural: 'services',
            getResources: () => this.k8sClient.getCachedServices(namespace)
          },
          {
            kind: 'ConfigMap',
            icon: 'file-binary',
            plural: 'configmaps',
            getResources: () => this.k8sClient.getCachedConfigMaps(namespace)
          },
          {
            kind: 'Secret',
            icon: 'lock',
            plural: 'secrets',
            getResources: () => this.k8sClient.getCachedSecrets(namespace)
          }
        ];
        for (const resourceType of k8sResourceTypes) {
          const resources = resourceType.getResources();
          if (resources && resources.length > 0) {
            const treeItem = new TreeItemBase(
              resourceType.kind,
              vscode.TreeItemCollapsibleState.Collapsed,
              'resource-type'
            );
            treeItem.iconPath = new vscode.ThemeIcon(resourceType.icon);
            treeItem.namespace = namespace;
            treeItem.resourceType = resourceType.kind.toLowerCase();
            treeItem.resourceCategory = category;
            treeItem.crdInfo = {
              group: '',
              version: 'v1',
              plural: resourceType.plural,
              namespaced: true
            };
            items.push(treeItem);
          }
        }
      }
      if (this.treeFilter) {
        return items.filter(item =>
          item.label.toString().toLowerCase().includes(this.treeFilter)
        );
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
   * Get resource instances for a specific type - use cached data and add status
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
        if (category === 'eda') {
          const allResources = this.resourceService.getAllResourceInstances();
          const { group, version, plural, namespaced } = crdInfo;
          for (const resourceResult of allResources) {
            const resource = resourceResult.resource;
            if (
              (resource.apiGroup === group || (!resource.apiGroup && !group)) &&
              (resource.plural === plural || resource.kind?.toLowerCase() === resourceType)
            ) {
              instances = resourceResult.instances;
              if (namespaced) {
                instances = instances.filter(inst => inst.metadata?.namespace === namespace);
              }
              break;
            }
          }
        } else if (category === 'k8s') {
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
            default:
              break;
          }
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

        // Get status information for this resource instance
        const statusIndicator = this.statusService.getResourceStatusIndicator(instance);
        const statusDescription = this.statusService.getStatusDescription(instance);

        // Apply status to the tree item
        treeItem.setStatus(statusIndicator, statusDescription);

        // Set iconPath based on status - either use ThemeIcon or custom status icon if available
        if (this.context && this.statusService.getStatusIcon) {
          try {
            // Try to use custom status icon
            treeItem.iconPath = this.statusService.getStatusIcon(statusIndicator);
          } catch (error) {
            // Fall back to theme icon if custom icons aren't available
            treeItem.iconPath = this.statusService.getThemeStatusIcon(statusIndicator);
          }
        } else {
          // Default icons for resource types if status icons not available
          if (resourceType === 'pod') {
            treeItem.iconPath = new vscode.ThemeIcon('vm');
          } else {
            treeItem.iconPath = new vscode.ThemeIcon('symbol-variable');
          }
        }

        treeItem.namespace = namespace;
        treeItem.resourceType = resourceType;

        // Set tooltip to include detailed resource information
        treeItem.tooltip = this.statusService.getResourceTooltip(instance);

        // Set command for when the item is clicked
        treeItem.command = {
          command:
            resourceType === 'pod'
              ? 'vscode-eda.describePod'
              : 'vscode-eda.viewResource',
          title: 'View Resource Details',
          arguments: [treeItem]
        };

        return treeItem;
      });

      if (this.treeFilter) {
        return items.filter(item =>
          item.label.toString().toLowerCase().includes(this.treeFilter)
        );
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