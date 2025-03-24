// src/commands/deploymentCommands.ts
import * as vscode from 'vscode';
import { runKubectl } from '../utils/kubectlRunner';
import { log, LogLevel, edaOutputChannel } from '../extension';
import { serviceManager } from '../services/serviceManager';
import { ResourceService } from '../services/resourceService';

export function registerDeploymentCommands(context: vscode.ExtensionContext) {
  const restartDeploymentCmd = vscode.commands.registerCommand('vscode-eda.restartDeployment', async (treeItem: any) => {
    // First check if this is actually a deployment
    if (!treeItem || !treeItem.resourceType || treeItem.resourceType.toLowerCase() !== 'deployment') {
      vscode.window.showErrorMessage('This command can only be used on Deployments.');
      return;
    }

    // Get namespace and name
    const ns = treeItem.namespace;
    const name = treeItem.resource?.name || treeItem.label;

    if (!ns || !name) {
      vscode.window.showErrorMessage('Deployment namespace or name is missing.');
      return;
    }

    const confirmed = await vscode.window.showWarningMessage(
      `Restart Deployment '${name}' in namespace '${ns}'? This will cause a rolling restart of all pods.`,
      { modal: true },
      'Yes', 'No'
    );

    if (confirmed === 'Yes') {
      try {
        log(`Restarting deployment ${name} in namespace ${ns}...`, LogLevel.INFO, true);

        // Execute the rollout restart command
        const result = runKubectl('kubectl', ['rollout', 'restart', 'deployment', name], { namespace: ns });

        vscode.window.showInformationMessage(`Deployment '${name}' restart initiated successfully.`);
        log(`Restart result: ${result}`, LogLevel.INFO, true);

        // Show output in the EDA output channel
        edaOutputChannel.appendLine(`Restarting deployment ${name} in namespace ${ns}:`);
        edaOutputChannel.appendLine(result);

        // Refresh resources after restart
        const resourceService = serviceManager.getService<ResourceService>('kubernetes-resources');
        setTimeout(() => resourceService.forceRefresh(), 1000);
      } catch (err: any) {
        const errorMsg = err.message || String(err);
        vscode.window.showErrorMessage(`Failed to restart deployment '${name}': ${errorMsg}`);
        log(`Error restarting deployment: ${errorMsg}`, LogLevel.ERROR, true);
        edaOutputChannel.show();
      }
    }
  });

  context.subscriptions.push(restartDeploymentCmd);
}