import * as vscode from 'vscode';
import { CoreService } from './coreService';
import { KubernetesClient } from '../clients/kubernetesClient';
import { log, LogLevel } from '../extension';

interface ResourceDefinition {
  namespaced?: boolean;
  name?: string;
  kind?: string;
  apiGroup?: string;
  apiVersion?: string;
  plural?: string;
}

interface ResourceResult {
  resource: ResourceDefinition;
  instances: any[];
}

/**
 * Service for managing custom resources
 */
export class ResourceService extends CoreService {
  private k8sClient: KubernetesClient;
  private namespaceCache: string[] = [];
  private _onDidChangeResources = new vscode.EventEmitter<void>();
  readonly onDidChangeResources = this._onDidChangeResources.event;

  // In-memory cached results to avoid fetching on tree builds
  private cachedResourceResults: ResourceResult[] = [];
  private lastRefreshTime: number = 0;
  private resourcesInitialized: boolean = false;

  constructor(k8sClient: KubernetesClient) {
    super();
    this.k8sClient = k8sClient;

    // Subscribe to resource changes from the K8s client
    this.k8sClient.onResourceChanged(() => {
      this.refreshCachedResources();
    });

    // Initialize resources
    this.initializeResources();
  }

  /**
   * Initialize resources on startup
   */
  private async initializeResources(): Promise<void> {
    if (this.resourcesInitialized) {
      return;
    }

    try {
      await this.refreshCachedResources();
      this.resourcesInitialized = true;
    } catch (error) {
      log(`Error initializing resources: ${error}`, LogLevel.ERROR);
    }
  }

  /**
   * Refresh cached resources (called by watchers when resources change)
   */
  private async refreshCachedResources(): Promise<void> {
    //log('Refreshing cached resources...', LogLevel.DEBUG);
    const now = Date.now();

    // Rate limiting to prevent too frequent refreshes
    if (now - this.lastRefreshTime < 500) {
      // For very rapid changes, defer the refresh but don't skip it
      setTimeout(() => this.refreshCachedResources(), 500);
      return;
    }

    try {
      // Get namespaces
      this.namespaceCache = this.k8sClient
        .getCachedNamespaces()
        .map(n => n.metadata?.name)
        .filter(name => !!name) as string[]; // remove duplicates if needed

      // Get CRDs from cache
      const crds = this.k8sClient.getCachedCrds().filter(crd => {
        const group = crd.spec?.group || '';
        return !group.endsWith('k8s.io');
      });

      // Process CRDs to build resource results
      const newResults: ResourceResult[] = [];

      for (const crd of crds) {
        const group = crd.spec?.group || '';
        if (!group || group.endsWith('k8s.io')) {
          continue;
        }

        const versionObj = crd.spec?.versions?.find((v: any) => v.served) || crd.spec?.versions?.[0];
        if (!versionObj) {
          continue;
        }

        const version = versionObj.name;
        const plural = crd.spec?.names?.plural || '';
        const kind = crd.spec?.names?.kind || '';

        if (!plural || !kind) {
          continue;
        }

        // Create resource definition
        const rd: ResourceDefinition = {
          name: crd.metadata?.name || '',
          kind: kind,
          namespaced: crd.spec?.scope === 'Namespaced',
          plural: plural,
          apiGroup: group,
          apiVersion: version
        };

        // Get instances from cache
        let instances: any[] = [];

        if (rd.namespaced) {
          // For namespaced resources, get instances from each namespace
          for (const ns of this.namespaceCache) {
            const nsInstances = this.k8sClient.getCachedResources(group, version, plural, ns);
            instances = [...instances, ...nsInstances];
          }
        } else {
          // For cluster-wide resources, get all instances
          instances = this.k8sClient.getCachedResources(group, version, plural);
        }

        //log(`Found ${instances.length} instances of ${kind} (${group}/${version})`, LogLevel.DEBUG);
        newResults.push({ resource: rd, instances });
      }

      // Check if anything has changed before updating
      const hasChanges = this.hasResourceResultsChanged(this.cachedResourceResults, newResults);

      if (hasChanges) {
        log(`Resource changes detected, updating cache and notifying listeners`, LogLevel.DEBUG);
        this.cachedResourceResults = newResults;
        this.lastRefreshTime = now;
        this._onDidChangeResources.fire();
      } else {
        //log(`No resource changes detected, keeping existing cache`, LogLevel.DEBUG);
        this.lastRefreshTime = now;
      }
    } catch (error) {
      log(`Error refreshing cached resources: ${error}`, LogLevel.ERROR);
    }
  }

  /**
   * Compare resource results to detect changes
   */
  private hasResourceResultsChanged(oldResults: ResourceResult[], newResults: ResourceResult[]): boolean {
    // Quick check for length changes
    if (oldResults.length !== newResults.length) {
      return true;
    }

    // Check each resource type
    for (let i = 0; i < newResults.length; i++) {
      const newResult = newResults[i];

      // Find matching resource in old results
      const oldResult = oldResults.find(r =>
        r.resource.kind === newResult.resource.kind &&
        r.resource.apiGroup === newResult.resource.apiGroup);

      if (!oldResult) {
        // New resource type found
        return true;
      }

      // Check instance count
      if (oldResult.instances.length !== newResult.instances.length) {
        return true;
      }

      // Check for new or updated instances by UID
      for (const newInstance of newResult.instances) {
        const uid = newInstance.metadata?.uid;
        if (!uid) {
          continue;
        }

        const oldInstance = oldResult.instances.find(i => i.metadata?.uid === uid);
        if (!oldInstance) {
          // New instance found
          return true;
        }

        // Check resource version for updates
        const newVersion = newInstance.metadata?.resourceVersion;
        const oldVersion = oldInstance.metadata?.resourceVersion;
        if (newVersion !== oldVersion) {
          // Instance was updated
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get all CRDs from cache
   */
  public getAllCrds(): ResourceDefinition[] {
    return this.cachedResourceResults.map(result => result.resource);
  }

  /**
   * Get (and cache) the namespaces, filtered by ALLOWED_NAMESPACES
   */
  public getAllNamespaces(): string[] {
    return this.namespaceCache;
  }

  /**
   * Get all resource instances from cache
   */
  public getAllResourceInstances(): ResourceResult[] {
    return this.cachedResourceResults;
  }

  /**
   * Manually refresh resources (typically only needed for initial setup)
   */
  public async forceRefresh(): Promise<void> {
    await this.refreshCachedResources();
  }

  /**
   * Dispose service resources
   */
  public dispose(): void {
    super.dispose();
    this._onDidChangeResources.dispose();
  }
}