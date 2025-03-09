// src/services/kubernetes/baseK8sService.ts
import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { LogLevel, log } from '../../extension';
import { cache } from '../../utils/cacheUtils';
import { k8sClient } from './k8sClient';

export class BaseK8sService {
  protected kc: any; // KubeConfig
  protected k8sApi: any; // CoreV1Api
  protected k8sAppsApi: any; // AppsV1Api
  protected k8sApiext: any; // ApiextensionsV1Api
  protected k8sCustomObjects: any; // CustomObjectsApi

  protected namespace: string;
  protected toolboxNamespace: string = 'eda-system';
  protected kubectlPath: string;

  private _onDidChangeContext = new vscode.EventEmitter<string>();
  readonly onDidChangeContext = this._onDidChangeContext.event;

  // Common cache TTL
  protected cacheTtl = 15000; // 15s

  // Initialization flag
  protected _initialized: boolean = false;

  constructor() {
    this.namespace = 'eda-system';
    // Cache the path to kubectl once
    this.kubectlPath = this.findKubectlPath();
  }

  /**
   * Initialize the Kubernetes clients
   * This must be called before using any Kubernetes functionality
   */
  public async initialize(): Promise<void> {
    if (this._initialized) {
      return;
    }

    try {
      // Initialize the k8s client wrapper
      await k8sClient.initialize();

      // Get the client
      const k8s = k8sClient.getClient();

      this.kc = new k8s.KubeConfig();
      try {
        this.kc.loadFromDefault();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to load Kubernetes configuration: ${error}`);
      }

      this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
      this.k8sAppsApi = this.kc.makeApiClient(k8s.AppsV1Api);
      this.k8sApiext = this.kc.makeApiClient(k8s.ApiextensionsV1Api);
      this.k8sCustomObjects = this.kc.makeApiClient(k8s.CustomObjectsApi);

      this._initialized = true;
      log('BaseK8sService initialized', LogLevel.INFO);
    } catch (error) {
      log(`Error initializing BaseK8sService: ${error}`, LogLevel.ERROR);
      throw error;
    }
  }


  
  /**
   * Check if the service is initialized
   */
  public isInitialized(): boolean {
    return this._initialized;
  }

  // Helper to find kubectl
  private findKubectlPath(): string {
    try {
      return execSync('which kubectl', { encoding: 'utf-8' }).trim();
    } catch (error) {
      // If "which" command fails, default to 'kubectl'
      return 'kubectl';
    }
  }

  // Set namespace for resource operations
  public setNamespace(namespace: string, shouldLog: boolean = true): void {
    this.namespace = namespace;
    if (shouldLog) {
      log(`BaseK8sService: set resource namespace to '${namespace}'`, LogLevel.INFO);
    }
  }

  // Get current namespace
  public getCurrentNamespace(): string {
    return this.namespace;
  }

  // Get kubectl path for direct usage
  public getKubectlPath(): string {
    return this.kubectlPath;
  }

  /**
   * Get the current Kubernetes context name
   */
  public getCurrentContext(): string {
    try {
      return this.kc.getCurrentContext() || 'unknown-context';
    } catch (error) {
      log(`Error getting current context: ${error}`, LogLevel.ERROR);
      return 'unknown-context';
    }
  }

  /**
   * Get all available Kubernetes contexts
   */
  public getAvailableContexts(): string[] {
    try {
      return this.kc.getContexts().map((context: any) => context.name);
    } catch (error) {
      log(`Error getting available contexts: ${error}`, LogLevel.ERROR);
      return [];
    }
  }

  /**
   * Switch to a different Kubernetes context
   */
  public async useContext(contextName: string): Promise<void> {
    try {
      log(`Switching to Kubernetes context '${contextName}'`, LogLevel.INFO, true);

      // Make sure the context exists
      const contexts = this.getAvailableContexts();
      if (!contexts.includes(contextName)) {
        throw new Error(`Context '${contextName}' not found in kubeconfig`);
      }

      // Use kubectl to change the context (this will update kubeconfig file)
      execSync(`${this.kubectlPath} config use-context ${contextName}`, { encoding: 'utf-8' });

      // Get the client
      const k8s = k8sClient.getClient();

      // Reload the kubeconfig from disk to sync our in-memory state
      this.kc = new k8s.KubeConfig();
      this.kc.loadFromDefault();

      // Recreate the API clients with the new context
      this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
      this.k8sAppsApi = this.kc.makeApiClient(k8s.AppsV1Api);
      this.k8sApiext = this.kc.makeApiClient(k8s.ApiextensionsV1Api);
      this.k8sCustomObjects = this.kc.makeApiClient(k8s.CustomObjectsApi);

      // Clear all caches
      cache.clearAll();
      log('Clearing all caches after context switch', LogLevel.INFO);

      // Emit an event to notify that context has changed
      this._onDidChangeContext.fire(contextName);

      log(`Successfully switched to context '${contextName}'`, LogLevel.INFO, true);
    } catch (error) {
      log(`Failed to switch to context '${contextName}': ${error}`, LogLevel.ERROR, true);
      throw error;
    }
  }
}