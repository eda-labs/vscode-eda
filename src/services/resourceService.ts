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
  private _onDidChangeResources = new vscode.EventEmitter<string | undefined>();
  readonly onDidChangeResources = this._onDidChangeResources.event;

  private resourcesInitialized: boolean = false;

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
    if (this.isRefreshing) {
      return;
    }

    try {
      this.isRefreshing = true;

      // Update namespaces
      this.namespaceCache = this.k8sClient.getCachedNamespaces();

      this._onDidChangeResources.fire(undefined);
    } catch (error) {
      log(`Error refreshing cached resources: ${error}`, LogLevel.ERROR);
    } finally {
      this.isRefreshing = false;
    }
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
    return [];
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