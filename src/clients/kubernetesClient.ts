// src/clients/kubernetesClient.ts
import { KubeConfig, CoreV1Api, AppsV1Api, ApiextensionsV1Api, CustomObjectsApi } from '@kubernetes/client-node';
import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { LogLevel, log } from '../extension';

/**
 * Client for interacting with Kubernetes API
 */
export class KubernetesClient {
  private kc: KubeConfig;
  private coreV1Api: CoreV1Api;
  private appsV1Api: AppsV1Api;
  private apiExtensionsV1Api: ApiextensionsV1Api;
  private customObjectsApi: CustomObjectsApi;

  private kubectlPath: string;

  private _onDidChangeContext = new vscode.EventEmitter<string>();
  readonly onDidChangeContext = this._onDidChangeContext.event;

  constructor() {
    this.kc = new KubeConfig();
    try {
      this.kc.loadFromDefault();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to load Kubernetes configuration: ${error}`);
    }

    this.coreV1Api = this.kc.makeApiClient(CoreV1Api);
    this.appsV1Api = this.kc.makeApiClient(AppsV1Api);
    this.apiExtensionsV1Api = this.kc.makeApiClient(ApiextensionsV1Api);
    this.customObjectsApi = this.kc.makeApiClient(CustomObjectsApi);

    this.kubectlPath = this.findKubectlPath();
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

  // Get API clients
  public getCoreV1Api(): CoreV1Api {
    return this.coreV1Api;
  }

  public getAppsV1Api(): AppsV1Api {
    return this.appsV1Api;
  }

  public getApiExtensionsV1Api(): ApiextensionsV1Api {
    return this.apiExtensionsV1Api;
  }

  public getCustomObjectsApi(): CustomObjectsApi {
    return this.customObjectsApi;
  }

  // Get kubectl path
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
      return this.kc.getContexts().map(context => context.name);
    } catch (error) {
      log(`Error getting available contexts: ${error}`, LogLevel.ERROR);
      return [];
    }
  }

  /**
   * Get cluster name for a context
   */
  public getClusterNameForContext(contextName: string): string {
    try {
      const contexts = this.kc.getContexts();
      const context = contexts.find(ctx => ctx.name === contextName);

      if (context && context.cluster) {
        return context.cluster;
      }

      return "Unknown";
    } catch (error) {
      log(`Error getting cluster name for context ${contextName}: ${error}`, LogLevel.ERROR);
      return "Unknown";
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

      // Use kubectl to change context
      execSync(`${this.kubectlPath} config use-context ${contextName}`, { encoding: 'utf-8' });

      // Reload kubeconfig
      this.kc = new KubeConfig();
      this.kc.loadFromDefault();

      // Recreate API clients
      this.coreV1Api = this.kc.makeApiClient(CoreV1Api);
      this.appsV1Api = this.kc.makeApiClient(AppsV1Api);
      this.apiExtensionsV1Api = this.kc.makeApiClient(ApiextensionsV1Api);
      this.customObjectsApi = this.kc.makeApiClient(CustomObjectsApi);

      // Emit event
      this._onDidChangeContext.fire(contextName);

      log(`Successfully switched to context '${contextName}'`, LogLevel.INFO, true);
    } catch (error) {
      log(`Failed to switch to context '${contextName}': ${error}`, LogLevel.ERROR, true);
      throw error;
    }
  }

  /**
   * Get KubeConfig object
   */
  public getKubeConfig(): KubeConfig {
    return this.kc;
  }
}