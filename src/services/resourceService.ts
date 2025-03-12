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
  private ALLOWED_NAMESPACES = ['default', 'eda-system', 'eda', 'clab-eda-st'];
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
    log('Refreshing cached resources...', LogLevel.DEBUG);
    const now = Date.now();

    // Rate limiting to prevent too frequent refreshes
    if (now - this.lastRefreshTime < 2000) {
      return;
    }

    try {
      // Get namespaces
      this.namespaceCache = this.ALLOWED_NAMESPACES.filter(ns =>
        this.k8sClient.getCachedNamespaces().some(n => n.metadata?.name === ns)
      );

      // Get CRDs from cache
      const crds = this.k8sClient.getCachedCrds().filter(crd => {
        const group = crd.spec?.group || '';
        return !group.endsWith('k8s.io');
      });

      // Process CRDs to build resource results
      this.cachedResourceResults = [];

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

        this.cachedResourceResults.push({ resource: rd, instances });
      }

      this.lastRefreshTime = now;
      this._onDidChangeResources.fire();
    } catch (error) {
      log(`Error refreshing cached resources: ${error}`, LogLevel.ERROR);
    }
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