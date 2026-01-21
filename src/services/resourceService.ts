import * as vscode from 'vscode';

import type { KubernetesClient } from '../clients/kubernetesClient';
import { log, LogLevel } from '../extension';

import { CoreService } from './coreService';

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
  instances: unknown[];
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

    // Schedule initialization outside of the constructor to avoid async in constructor
    setTimeout(() => this.initializeResources(), 0);
  }

  /**
   * Initialize resources on startup
   */
  private initializeResources(): void {
    if (this.resourcesInitialized) {
      return;
    }

    try {
      this.refreshCachedResources();
      this.resourcesInitialized = true;
    } catch (error) {
      log(`Error initializing resources: ${error}`, LogLevel.ERROR);
    }
  }

  /**
   * Refresh cached resources (called by watchers when resources change)
   */
  private refreshCachedResources(): void {
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
  public forceRefresh(): void {
    this.refreshCachedResources();
  }

  /**
   * Dispose service resources
   */
  public dispose(): void {
    super.dispose();
    this._onDidChangeResources.dispose();
  }
}