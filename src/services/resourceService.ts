import * as vscode from 'vscode';
import { CoreService } from './coreService';
import { KubernetesClient } from '../clients/kubernetesClient';
import { log, LogLevel } from '../extension';
import { serviceManager } from './serviceManager';
import { ResourceStatusService } from './resourceStatusService';

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
  private _onDidChangeResources = new vscode.EventEmitter<string | undefined>();
  readonly onDidChangeResources = this._onDidChangeResources.event;

  // In-memory cached results to avoid fetching on tree builds
  private cachedResourceResults: ResourceResult[] = [];
  private lastRefreshTime: number = 0;
  private resourcesInitialized: boolean = false;
  private lastCrdCount: number = 0;

  private pendingRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
  private isRefreshing: boolean = false;

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
    const now = Date.now();

    // If already refreshing, don't start another refresh
    if (this.isRefreshing) {
      return;
    }

    // Rate limiting to prevent too frequent refreshes
    if (now - this.lastRefreshTime < 500) {
      // Cancel any existing pending refresh
      if (this.pendingRefreshTimeout) {
        clearTimeout(this.pendingRefreshTimeout);
      }

      // Schedule a single refresh for later
      this.pendingRefreshTimeout = setTimeout(() => {
        this.pendingRefreshTimeout = null;
        this.refreshCachedResources();
      }, 500);
      return;
    }

    try {
      this.isRefreshing = true;
      log('Refreshing cached resources...', LogLevel.DEBUG);

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

      // Reload status schemas only if CRD count changed
      const statusService = serviceManager.getService<ResourceStatusService>('resource-status');
      if (crds.length !== this.lastCrdCount) {
        await statusService.refreshStatusSchemas();
        this.lastCrdCount = crds.length;
      }

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

        newResults.push({ resource: rd, instances });
      }

      // Check if anything has changed before updating
      const summary = this.getResourceChangeSummary(
        this.cachedResourceResults,
        newResults
      );

      if (summary) {
        log(
          `Resource changes detected${summary ? ` (${summary})` : ''}, updating cache and notifying listeners`,
          LogLevel.DEBUG
        );
        this.cachedResourceResults = newResults;
        this.lastRefreshTime = now;
        this._onDidChangeResources.fire(summary);
      } else {
        log(`No resource changes detected, keeping existing cache`, LogLevel.DEBUG);
        this.lastRefreshTime = now;
      }
    } catch (error) {
      log(`Error refreshing cached resources: ${error}`, LogLevel.ERROR);
    } finally {
      this.isRefreshing = false;
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
   * Generate a short summary of changes between old and new resource results
   */
  private getResourceChangeSummary(
    oldResults: ResourceResult[],
    newResults: ResourceResult[]
  ): string | undefined {
    if (this.hasResourceResultsChanged(oldResults, newResults) === false) {
      return undefined;
    }

    const oldMap = new Map<string, string | undefined>();
    for (const r of oldResults) {
      for (const inst of r.instances) {
        const uid = inst.metadata?.uid;
        if (uid) {
          oldMap.set(uid, inst.metadata?.resourceVersion);
        }
      }
    }

    let added = 0;
    let removed = 0;
    let updated = 0;

    const newMap = new Map<string, string | undefined>();
    for (const r of newResults) {
      for (const inst of r.instances) {
        const uid = inst.metadata?.uid;
        if (uid) {
          const version = inst.metadata?.resourceVersion;
          newMap.set(uid, version);
          if (!oldMap.has(uid)) {
            added++;
          } else if (oldMap.get(uid) !== version) {
            updated++;
          }
        }
      }
    }

    for (const uid of oldMap.keys()) {
      if (!newMap.has(uid)) {
        removed++;
      }
    }

    const parts: string[] = [];
    if (added) parts.push(`${added} added`);
    if (updated) parts.push(`${updated} updated`);
    if (removed) parts.push(`${removed} removed`);

    return parts.join(', ');
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