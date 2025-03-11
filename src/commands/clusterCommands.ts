// src/commands/clusterCommands.ts
import * as vscode from 'vscode';
import { ResourceService } from '../services/resourceService';
import { ResourceStore } from '../services/store/resourceStore';
import { log, LogLevel } from '../extension.js';
import { KubernetesClient } from '../clients/kubernetesClient';
import { serviceManager } from '../services/serviceManager';

/**
 * Interface for cluster item in quickpick
 */
interface ClusterQuickPickItem extends vscode.QuickPickItem {
  label: string;
  description: string;
}

/**
 * Registers commands for managing and switching between Kubernetes clusters
 */
export function registerClusterCommands(
  context: vscode.ExtensionContext,
  resourceStore: ResourceStore
): void {
  // Get required services
  const k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');
  const resourceService = serviceManager.getService<ResourceService>('resource');

  // Register the switch cluster command
  const switchClusterCommand = vscode.commands.registerCommand(
    'vscode-eda.switchCluster',
    async () => {
      const contexts = k8sClient.getAvailableContexts();
      if (contexts.length === 0) {
        vscode.window.showErrorMessage('No Kubernetes clusters found in kubeconfig');
        return;
      }

      const currentContext = k8sClient.getCurrentContext();
      const clusterItems: ClusterQuickPickItem[] = contexts.map(context => ({
        label: context,
        description: context === currentContext ? '(current)' : '',
      }));

      const selectedCluster = await vscode.window.showQuickPick(
        clusterItems,
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

            try {
              // Switch Kubernetes context
              await k8sClient.useContext(selectedCluster.label);

              // Clear all caches
              resourceService.clearCaches();

              // Refresh all resources
              await resourceStore.refreshAll();

              vscode.window.showInformationMessage(`Switched to cluster ${selectedCluster.label}`);
            } catch (error) {
              vscode.window.showErrorMessage(`Failed to switch to cluster ${selectedCluster.label}`);
              log(`Error switching clusters: ${error}`, LogLevel.ERROR, true);
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