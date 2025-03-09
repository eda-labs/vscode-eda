// src/services/kubernetes/clusterManager.ts
import * as vscode from 'vscode';
import { BaseK8sService } from './baseK8sService';
import { log, LogLevel } from '../../extension';

export class ClusterManager {
  private statusBarItem: vscode.StatusBarItem;
  private k8sService: BaseK8sService;

  constructor(k8sService: BaseK8sService) {
    this.k8sService = k8sService;
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.command = 'vscode-eda.switchCluster';
    this.statusBarItem.tooltip = 'Click to switch Kubernetes cluster';
    this.updateStatusBar();
    this.statusBarItem.show();
  }

  /**
   * Update the status bar item with the current cluster name
   */
  public updateStatusBar(): void {
    const currentContext = this.k8sService.getCurrentContext();

    // Get the cluster name associated with this context
    const clusterName = this.getClusterNameForContext(currentContext);

    // Update text with the new format
    this.statusBarItem.text = `$(kubernetes) EDA: ${currentContext}`;

    // Update tooltip with both context and cluster name
    this.statusBarItem.tooltip = `Context: ${currentContext}\nCluster: ${clusterName}\n\nClick to switch Kubernetes cluster`;
  }

  /**
   * Get all available cluster contexts
   */
  public getAvailableContexts(): string[] {
    return this.k8sService.getAvailableContexts();
  }

  /**
   * Switch to a different cluster context
   */
  public async switchContext(contextName: string): Promise<boolean> {
    try {
      await this.k8sService.useContext(contextName);
      this.updateStatusBar();
      return true;
    } catch (error) {
      log(`Failed to switch to cluster context ${contextName}: ${error}`, LogLevel.ERROR, true);
      return false;
    }
  }

/**
 * Get the cluster name for the given context
 */
private getClusterNameForContext(contextName: string): string {
  try {
    // This assumes k8sService has access to the KubeConfig
    const contexts = (this.k8sService as any).kc.getContexts();
    const context = contexts.find((ctx: any) => ctx.name === contextName);

    if (context && context.context && context.context.cluster) {
      return context.context.cluster;
    }

    return "Unknown";
  } catch (error) {
    log(`Error getting cluster name for context ${contextName}: ${error}`, LogLevel.ERROR);
    return "Unknown";
  }
}

  /**
   * Dispose the status bar item
   */
  public dispose(): void {
    this.statusBarItem.dispose();
  }
}