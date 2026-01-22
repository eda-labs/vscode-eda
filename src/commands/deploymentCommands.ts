// src/commands/deploymentCommands.ts
import * as vscode from 'vscode';

import { runKubectl } from '../utils/kubectlRunner';
import { log, LogLevel, edaOutputChannel } from '../extension';
import { serviceManager } from '../services/serviceManager';
import type { ResourceService } from '../services/resourceService';

import { MSG_DEPLOYMENT_NS_OR_NAME_MISSING } from './constants';

interface DeploymentResource {
  name?: string;
}

interface DeploymentTreeItem {
  resourceType?: string;
  namespace?: string;
  resource?: DeploymentResource;
  label?: string;
}

export function registerDeploymentCommands(context: vscode.ExtensionContext) {
  const restartDeploymentCmd = vscode.commands.registerCommand('vscode-eda.restartDeployment', async (treeItem: DeploymentTreeItem | undefined) => {
    // First check if this is actually a deployment
    if (
      !treeItem ||
      !treeItem.resourceType ||
      !['deployment', 'deployments'].includes(treeItem.resourceType.toLowerCase())
    ) {
      vscode.window.showErrorMessage('This command can only be used on Deployments.');
      return;
    }

    // Get namespace and name
    const ns: string | undefined = treeItem.namespace;
    const name: string | undefined = treeItem.resource?.name ?? treeItem.label;

    if (!ns || !name) {
      vscode.window.showErrorMessage(MSG_DEPLOYMENT_NS_OR_NAME_MISSING);
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
        const result: string = runKubectl('kubectl', ['rollout', 'restart', 'deployment', name], { namespace: ns });

        vscode.window.showInformationMessage(`Deployment '${name}' restart initiated successfully.`);
        log(`Restart result: ${result}`, LogLevel.INFO, true);

        // Show output in the EDA output channel
        edaOutputChannel.appendLine(`Restarting deployment ${name} in namespace ${ns}:`);
        edaOutputChannel.appendLine(result);

        // Refresh resources after restart
        const resourceService = serviceManager.getService<ResourceService>('kubernetes-resources');
        setTimeout(() => resourceService.forceRefresh(), 1000);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to restart deployment '${name}': ${errorMsg}`);
        log(`Error restarting deployment: ${errorMsg}`, LogLevel.ERROR, true);
        edaOutputChannel.show();
      }
    }
  });

  context.subscriptions.push(restartDeploymentCmd);
}