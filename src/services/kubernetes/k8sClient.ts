// src/services/kubernetes/k8sClient.ts
import * as vscode from 'vscode';
import { log, LogLevel } from '../../extension';

/**
 * A wrapper for the Kubernetes client to handle ES Module import
 * This provides a consistent way to access the k8s client throughout the extension
 */
export class K8sClient {
  private static instance: K8sClient;
  private client: any = null;
  private initializing: boolean = false;
  private initPromise: Promise<void> | null = null;

  private constructor() {}

  public static getInstance(): K8sClient {
    if (!K8sClient.instance) {
      K8sClient.instance = new K8sClient();
    }
    return K8sClient.instance;
  }

  /**
   * Initialize the Kubernetes client
   */
  public async initialize(): Promise<void> {
    if (this.client) {
      return; // Already initialized
    }

    if (this.initializing && this.initPromise) {
      return this.initPromise; // Already initializing
    }

    this.initializing = true;
    this.initPromise = this.loadK8sClient();
    return this.initPromise;
  }

  /**
   * Load the Kubernetes client using dynamic import
   * This explicitly uses dynamic import to support ES modules
   */
  private async loadK8sClient(): Promise<void> {
    try {
      log('Loading @kubernetes/client-node as ES Module...', LogLevel.INFO);
      
      // Use dynamic import with new Function to avoid transpilation issues
      // This ensures the import is not transformed during compilation
      const importDynamic = new Function('modulePath', 'return import(modulePath)');
      this.client = await importDynamic('@kubernetes/client-node');
      
      log('Successfully loaded @kubernetes/client-node', LogLevel.INFO);
    } catch (error) {
      log(`Failed to load @kubernetes/client-node: ${error}`, LogLevel.ERROR, true);
      vscode.window.showErrorMessage(`Failed to initialize Kubernetes client: ${error}`);
      throw error;
    } finally {
      this.initializing = false;
    }
  }

  /**
   * Get the Kubernetes client
   */
  public getClient(): any {
    if (!this.client) {
      throw new Error('Kubernetes client not initialized. Call initialize() first.');
    }
    return this.client;
  }

  /**
   * Check if the client is initialized
   */
  public isInitialized(): boolean {
    return this.client !== null;
  }
}

// Export a singleton instance
export const k8sClient = K8sClient.getInstance();