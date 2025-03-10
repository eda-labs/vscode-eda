// src/commands/clusterCommands.ts
import * as vscode from 'vscode';
import { KubernetesService } from '../services/kubernetes/kubernetes';
import { ClusterManager } from '../services/kubernetes/clusterManager';
import { ResourceStore } from '../services/store/resourceStore';
import { log, LogLevel } from '../extension.js';

/**
 * Registers commands for managing and switching between Kubernetes clusters
 */
export function registerClusterCommands(
  context: vscode.ExtensionContext,
  k8sService: KubernetesService,
  clusterManager: ClusterManager,
  resourceStore: ResourceStore
) {
  // Register the switch cluster command
  const switchClusterCommand = vscode.commands.registerCommand(
    'vscode-eda.switchCluster',
    async () => {
      const clusters = clusterManager.getAvailableContexts();
      if (clusters.length === 0) {
        vscode.window.showErrorMessage('No Kubernetes clusters found in kubeconfig');
        return;
      }

      const currentContext = k8sService.getCurrentContext();
      const selectedCluster = await vscode.window.showQuickPick(
        clusters.map(cluster => ({
          label: cluster,
          description: cluster === currentContext ? '(current)' : '',
        })),
        {
          placeHolder: 'Select a Kubernetes cluster',
          title: 'Switch Kubernetes Cluster'
        }
      );

      if (selectedCluster && selectedCluster.label !== currentContext) {
        try {
          vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Switching to cluster ${selectedCluster.label}`,
            cancellable: false
          }, async (progress) => {
            progress.report({ increment: 0 });

            const success = await clusterManager.switchContext(selectedCluster.label);

            if (success) {
              // Clear all caches and refresh all providers
              k8sService.clearAllCaches();
              await resourceStore.refreshAll();

              vscode.window.showInformationMessage(`Switched to cluster ${selectedCluster.label}`);
            } else {
              vscode.window.showErrorMessage(`Failed to switch to cluster ${selectedCluster.label}`);
            }

            progress.report({ increment: 100 });
          });
        } catch (error) {
          vscode.window.showErrorMessage(`Error switching clusters: ${error}`);
        }
      }
    }
  );



  context.subscriptions.push(switchClusterCommand);
}