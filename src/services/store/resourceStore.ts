// src/services/resourceStore.ts
import * as vscode from 'vscode';
import { KubernetesService } from '../kubernetes/kubernetes';
import { log, LogLevel, measurePerformance } from '../../extension.js';

export interface ResourceStoreItem {
  kind: string;
  name: string;
  namespace: string;
  apiGroup?: string;
  resource: any; // The actual K8s resource object
  resourceVersion?: string;
  lastUpdated: number; // Timestamp
}

export interface ResourceChange {
  type: 'added' | 'modified' | 'deleted';
  item: ResourceStoreItem;
}

/**
 * Central store for all Kubernetes resources across namespaces
 */
export class ResourceStore {
  private _onDidChangeResources = new vscode.EventEmitter<ResourceChange[]>();
  readonly onDidChangeResources = this._onDidChangeResources.event;

  private _onDidReloadNamespace = new vscode.EventEmitter<string>();
  readonly onDidReloadNamespace = this._onDidReloadNamespace.event;

  // Main store of all resources
  // Structure: namespace -> kind -> name -> resource
  private store: Map<string, Map<string, Map<string, ResourceStoreItem>>> = new Map();

  // Tracks which namespaces have been loaded
  private loadedNamespaces: Set<string> = new Set();

  // Cached CRD group information
  private crdGroups: Map<string, string[]> = new Map(); // group -> kinds[]

  // Last refresh time per namespace
  private lastRefreshTime: Map<string, number> = new Map();

  constructor(private k8sService: KubernetesService) {}

  /**
   * Gets all resources for a namespace
   */
  public getResourcesForNamespace(namespace: string): ResourceStoreItem[] {
    const result: ResourceStoreItem[] = [];
    const nsStore = this.store.get(namespace);
    if (!nsStore) return result;

    for (const kindMap of nsStore.values()) {
      for (const resource of kindMap.values()) {
        result.push(resource);
      }
    }

    return result;
  }

  /**
   * Gets resources by kind for a namespace
   */
  public getResourcesByKind(namespace: string, kind: string): ResourceStoreItem[] {
    const result: ResourceStoreItem[] = [];
    const nsStore = this.store.get(namespace);
    if (!nsStore) return result;

    const kindMap = nsStore.get(kind);
    if (!kindMap) return result;

    return Array.from(kindMap.values());
  }

  /**
   * Gets all resources for a specific CRD group in a namespace
   */
  public getResourcesForGroup(namespace: string, group: string): ResourceStoreItem[] {
    const result: ResourceStoreItem[] = [];
    const kinds = this.crdGroups.get(group) || [];

    for (const kind of kinds) {
      result.push(...this.getResourcesByKind(namespace, kind));
    }

    return result;
  }

  /**
   * Gets a specific resource by namespace, kind, and name
   */
  public getResource(namespace: string, kind: string, name: string): ResourceStoreItem | undefined {
    return this.store.get(namespace)?.get(kind)?.get(name);
  }

  /**
   * Returns if a specific kind is available in a namespace
   */
  public hasResourceKind(namespace: string, kind: string): boolean {
    const kindMap = this.store.get(namespace)?.get(kind);
    return !!kindMap && kindMap.size > 0;
  }

  /**
   * Returns all resource kinds available in a namespace
   */
  public getAvailableKinds(namespace: string): string[] {
    const nsStore = this.store.get(namespace);
    if (!nsStore) return [];

    return Array.from(nsStore.keys());
  }

  /**
   * Returns all CRD groups that have instances in a namespace
   */
  public getAvailableGroupsInNamespace(namespace: string): string[] {
    const result = new Set<string>();
    const nsStore = this.store.get(namespace);
    if (!nsStore) return [];

    // For each group, check if any of its kinds exist in the namespace
    for (const [group, kinds] of this.crdGroups.entries()) {
      for (const kind of kinds) {
        if (this.hasResourceKind(namespace, kind)) {
          result.add(group);
          break;
        }
      }
    }

    return Array.from(result);
  }

  /**
   * Returns all NPP pods for a namespace
   */
  public getNppPodsForNamespace(namespace: string): ResourceStoreItem[] {
    // NPP pods follow a naming pattern: eda-npp-<namespace>-<node>
    const prefix = `eda-npp-${namespace}`;
    const result: ResourceStoreItem[] = [];

    const systemPods = this.getResourcesByKind('eda-system', 'Pod');
    for (const pod of systemPods) {
      if (pod.name.startsWith(prefix)) {
        result.push(pod);
      }
    }

    return result;
  }

  /**
   * Filter resources in a namespace by search text
   */
  public filterResourcesInNamespace(namespace: string, searchText: string): ResourceStoreItem[] {
    if (!searchText) return this.getResourcesForNamespace(namespace);

    const lowerSearch = searchText.toLowerCase();
    return this.getResourcesForNamespace(namespace).filter(item =>
      item.name.toLowerCase().includes(lowerSearch) ||
      item.kind.toLowerCase().includes(lowerSearch)
    );
  }

  /**
   * Check if a namespace has been loaded
   */
  public isNamespaceLoaded(namespace: string): boolean {
    return this.loadedNamespaces.has(namespace);
  }

  /**
   * Get all loaded namespaces
   */
  public getLoadedNamespaces(): Set<string> {
    return this.loadedNamespaces;
  }

  /**
   * Initialize the CRD group information
   */
  public async initCrdGroups(): Promise<void> {
    try {
      log('Initializing CRD group information...', LogLevel.INFO);
      const groups = await this.k8sService.getAvailableCrdGroups();

      // Clear existing data
      this.crdGroups.clear();

      // Fetch each group and its kinds
      for (const group of groups) {
        const crds = await this.k8sService.getCrdsForGroup(group);
        const kinds = crds.map(crd => crd.kind);
        this.crdGroups.set(group, kinds);
      }

      log(`Initialized ${this.crdGroups.size} CRD groups with associated kinds`, LogLevel.INFO);
    } catch (error) {
      log(`Error initializing CRD groups: ${error}`, LogLevel.ERROR);
    }
  }

  /**
   * Load or refresh all resources for a namespace (bulk fetch)
   */
  public async loadNamespaceResources(namespace: string): Promise<string> {
    return measurePerformance(async () => {
      try {
        // Create namespace store if needed
        if (!this.store.has(namespace)) {
          this.store.set(namespace, new Map());
        }

        // Track existing resources to detect deletions
        const existingResources = new Map<string, ResourceStoreItem>();
        const nsStore = this.store.get(namespace)!;
        for (const kindMap of nsStore.values()) {
          for (const [name, resource] of kindMap.entries()) {
            existingResources.set(`${resource.kind}/${name}`, resource);
          }
        }

        // Create empty resources lists
        const changes: ResourceChange[] = [];

        // Load standard Kubernetes resources
        await Promise.all([
          this.loadK8sResourceType(namespace, 'Pod', changes, existingResources),
          this.loadK8sResourceType(namespace, 'Service', changes, existingResources),
          this.loadK8sResourceType(namespace, 'Deployment', changes, existingResources),
          this.loadK8sResourceType(namespace, 'ConfigMap', changes, existingResources),
          this.loadK8sResourceType(namespace, 'Secret', changes, existingResources)
        ]);


        // Add NPP pods if this is not the system namespace
        await Promise.all([
          Promise.all(
            Array.from(this.crdGroups.entries()).map(([group, kinds]) =>
              this.loadCrdGroup(namespace, group, kinds, changes, existingResources)
            )
          ),
          namespace !== 'eda-system' ? this.loadNppPods(namespace, changes, existingResources) : Promise.resolve()
        ]);

        // Handle deletions
        for (const resource of existingResources.values()) {
          // Remove from store
          const kindMap = nsStore.get(resource.kind);
          if (kindMap) {
            kindMap.delete(resource.name);
            if (kindMap.size === 0) {
              nsStore.delete(resource.kind);
            }
          }

          // Add to changes
          changes.push({
            type: 'deleted',
            item: resource
          });
        }

        // Mark namespace as loaded
        this.loadedNamespaces.add(namespace);
        this.lastRefreshTime.set(namespace, Date.now());

        // Notify listeners
        if (changes.length > 0) {
          this._onDidChangeResources.fire(changes);
        }

        // Always fire the reload event for the namespace
        this._onDidReloadNamespace.fire(namespace);

      // Return a meaningful result for the log message
      return `Loaded ${changes.length} resources for namespace '${namespace}'`;
    } catch (error) {
      log(`Error loading namespace resources: ${error}`, LogLevel.ERROR);
      throw error;
    }
  }, `Loading all resources for namespace '${namespace}'`, LogLevel.INFO, true);
}


  /**
   * Load standard Kubernetes resources of a specific type
   */
  private async loadK8sResourceType(
    namespace: string,
    kind: string,
    changes: ResourceChange[],
    existingResources: Map<string, ResourceStoreItem>
  ): Promise<void> {
    try {
      let resources: any[] = [];

      // Get resources based on type
      switch (kind) {
        case 'Pod':
          resources = await this.k8sService.getPods(namespace);
          break;
        case 'Service':
            resources = await this.k8sService.getServices(namespace);
            break;
        case 'Deployment':
          resources = await this.k8sService.getDeployments(namespace);
          break
        case 'ConfigMap':
          resources = await this.k8sService.getConfigMaps(namespace);
          break
        case 'Secret':
          resources = await this.k8sService.getSecrets(namespace);
      }

      // Process resources
      await this.processResources(namespace, kind, resources, changes, existingResources);
    } catch (error) {
      log(`Error loading ${kind} resources in ${namespace}: ${error}`, LogLevel.ERROR);
    }
  }

  /**
   * Load CRD resources for a specific group
   */
  private async loadCrdGroup(
    namespace: string,
    group: string,
    kinds: string[],
    changes: ResourceChange[],
    existingResources: Map<string, ResourceStoreItem>
  ): Promise<void> {
    try {
      // Get CRD info for ALL kinds in the group at once
      const allCrdInfos = await this.k8sService.getCrdsForGroup(group);

      // Process kinds in parallel with Promise.all
      await Promise.all(kinds.map(async kind => {
        // Find the matching CRD info from our single batch call
        const crdInfo = allCrdInfos.find(crd => crd.kind === kind);
        if (!crdInfo) return;

        // Get instances and process them
        const resources = await this.k8sService.getCrdInstances(namespace, crdInfo);
        await this.processResources(namespace, kind, resources, changes, existingResources);
      }));
    } catch (error) {
      log(`Error loading CRD group ${group} in ${namespace}: ${error}`, LogLevel.ERROR);
    }
  }

  /**
   * Load NPP pods for a namespace
   */
  private async loadNppPods(
    namespace: string,
    changes: ResourceChange[],
    existingResources: Map<string, ResourceStoreItem>
  ): Promise<void> {
    try {
      const nppPods = await this.k8sService.getNppPodsForNamespace(namespace);

      // NPP pods are special - they're in the system namespace but we present them
      // as part of the user namespace. We'll still store them in system namespace,
      // but we need to track them separately for this namespace.

      // Process each pod
      for (const pod of nppPods) {
        const name = pod.metadata?.name || '';
        const resourceVersion = pod.metadata?.resourceVersion || '';

        // Create a resource store item for this pod
        const item: ResourceStoreItem = {
          kind: 'Pod',
          name,
          namespace: 'eda-system', // Store in actual namespace
          resource: pod,
          resourceVersion,
          lastUpdated: Date.now()
        };

        // Check if this is a new/modified resource
        const key = `Pod/${name}`;
        const existing = existingResources.get(key);

        if (!existing) {
          // New resource
          this.addToStore('eda-system', 'Pod', name, item);
          changes.push({ type: 'added', item });
        } else if (existing.resourceVersion !== resourceVersion) {
          // Modified resource
          this.addToStore('eda-system', 'Pod', name, item);
          changes.push({ type: 'modified', item });
        }

        // Remove from existing resources map
        existingResources.delete(key);
      }
    } catch (error) {
      log(`Error loading NPP pods for ${namespace}: ${error}`, LogLevel.ERROR);
    }
  }

  /**
   * Process a list of resources and add them to the store
   */
  private async processResources(
    namespace: string,
    kind: string,
    resources: any[],
    changes: ResourceChange[],
    existingResources: Map<string, ResourceStoreItem>
  ): Promise<void> {
    if (!resources || !Array.isArray(resources)) return;

    const nsStore = this.store.get(namespace)!;

    // Create kind map if needed
    if (!nsStore.has(kind)) {
      nsStore.set(kind, new Map());
    }

    // Process each resource
    for (const resource of resources) {
      const name = resource.metadata?.name || '';
      const resourceVersion = resource.metadata?.resourceVersion || '';

      // Skip if name is empty
      if (!name) continue;

      // Create a resource store item
      const item: ResourceStoreItem = {
        kind,
        name,
        namespace,
        resource,
        resourceVersion,
        lastUpdated: Date.now()
      };

      // Check if this is a new/modified resource
      const key = `${kind}/${name}`;
      const existing = existingResources.get(key);

      if (!existing) {
        // New resource
        this.addToStore(namespace, kind, name, item);
        changes.push({ type: 'added', item });
      } else if (existing.resourceVersion !== resourceVersion) {
        // Modified resource
        this.addToStore(namespace, kind, name, item);
        changes.push({ type: 'modified', item });
      }

      // Remove from existing resources map
      existingResources.delete(key);
    }
  }

  /**
   * Add a resource to the store
   */
  private addToStore(namespace: string, kind: string, name: string, item: ResourceStoreItem): void {
    if (!this.store.has(namespace)) {
      this.store.set(namespace, new Map());
    }

    const nsStore = this.store.get(namespace)!;
    if (!nsStore.has(kind)) {
      nsStore.set(kind, new Map());
    }

    const kindMap = nsStore.get(kind)!;
    kindMap.set(name, item);
  }

  /**
   * Get CRD info for a kind
   */
  private async getCrdInfoForKind(kind: string): Promise<any> {
    try {
      // Use our cached mapping instead of calling getCrdsForGroup repeatedly
      for (const [group, kinds] of this.crdGroups.entries()) {
        if (kinds.includes(kind)) {
          // Get the cached CRD infos for this group
          const crds = await this.k8sService.getCrdsForGroup(group);
          return crds.find(crd => crd.kind === kind);
        }
      }
      return null;
    } catch (error) {
      log(`Error getting CRD info for kind ${kind}: ${error}`, LogLevel.ERROR);
      return null;
    }
  }

  /**
   * Reset and refresh all resources and views
   * Used after operations like switching clusters
   */
  public async refreshAll(): Promise<void> {
    try {
      log('Starting full refresh of all resources...', LogLevel.INFO, true);

      // Clear current store
      this.clear();

      // IMPORTANT: Get namespaces fresh from the new context
      const namespaces = await this.k8sService.getEdaNamespaces();

      // Reinitialize everything
      await this.initCrdGroups();

      // Load eda-system first, then other known EDA namespaces
      await this.loadNamespaceResources('eda-system');

      for (const ns of namespaces) {
        if (ns !== 'eda-system') {
          await this.loadNamespaceResources(ns);
        }
      }

      // Fire events
      this._onDidChangeResources.fire([]);

      for (const namespace of this.loadedNamespaces) {
        this._onDidReloadNamespace.fire(namespace);
      }

      log('Full resource refresh completed successfully', LogLevel.INFO, true);
    } catch (error) {
      log(`Error during full refresh: ${error}`, LogLevel.ERROR, true);
      throw error;
    }
  }

  /**
   * Clear all stored data
   */
  public clear(): void {
    this.store.clear();
    this.loadedNamespaces.clear();
    this.lastRefreshTime.clear();
  }

  /**
   * Get last refresh time for a namespace
   */
  public getLastRefreshTime(namespace: string): number {
    return this.lastRefreshTime.get(namespace) || 0;
  }
}