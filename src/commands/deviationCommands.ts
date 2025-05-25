import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { execSync } from 'child_process';
import { serviceManager } from '../services/serviceManager';
import { EdactlClient } from '../clients/edactlClient';
import { log, LogLevel, edaOutputChannel } from '../extension';

// Define interface for DeviationResource if not imported
interface DeviationResource {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    [key: string]: any;
  };
  spec: {
    nodeEndpoint?: string;
    path?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

/**
 * Check if a deviation still exists
 */
async function checkDeviationExists(name: string, namespace: string): Promise<boolean> {
  try {
    const edactlClient = serviceManager.getClient<EdactlClient>('edactl');
    const deviations = await edactlClient.getEdaDeviations();
    return deviations.some((dev: any) => dev.name === name && dev["namespace.name"] === namespace);
  } catch (error) {
    log(`Error checking if deviation exists: ${error}`, LogLevel.ERROR);
    return true;
  }
}

/**
 * Delete a DeviationAction resource
 */
async function deleteDeviationAction(name: string, namespace: string): Promise<void> {
  try {
    log(`Deleting DeviationAction ${name} in namespace ${namespace}`, LogLevel.INFO);
    const kubectlPath = 'kubectl'; // Default, or you could get this from a config
    execSync(`${kubectlPath} delete deviationaction ${name} -n ${namespace}`, { encoding: 'utf-8' });
    log(`Successfully deleted DeviationAction ${name}`, LogLevel.INFO);
  } catch (error) {
    log(`Error deleting DeviationAction: ${error}`, LogLevel.ERROR);
  }
}

/**
 * Register commands for deviation acceptance and rejection
 */
export function registerDeviationCommands(
  context: vscode.ExtensionContext,
  edaDeviationProvider: any  // Add this parameter
) {

  // Helper function to repeatedly try deleting the deviation action
  async function attemptCleanup(
    name: string,
    namespace: string,
    actionName: string
  ) {
    const maxWaitTime = 60000; // 60 seconds
    const pollInterval = 5000; // every 5 seconds
    const startTime = Date.now();

    async function cleanupLoop() {
      try {
        const deviationExists = await checkDeviationExists(name, namespace);
        if (!deviationExists) {
          log(`Deviation ${name} has been successfully handled, deleting DeviationAction...`, LogLevel.INFO);
          await deleteDeviationAction(actionName, namespace);
          edaDeviationProvider.removeDeviation(name, namespace);
        } else if (Date.now() - startTime < maxWaitTime) {
          setTimeout(cleanupLoop, pollInterval);
        } else {
          edaDeviationProvider.updateDeviation(name, namespace, "Still processing...");
        }
      } catch (error) {
        log(`Error during deletion cleanup: ${error}`, LogLevel.ERROR);
      }
    }

    // Start checking after 2 seconds
    setTimeout(cleanupLoop, 2000);
  }

  // Register accept deviation command
  const acceptDeviationCmd = vscode.commands.registerCommand('vscode-eda.acceptDeviation', async (treeItem: any) => {
    if (!treeItem?.deviation) {
      vscode.window.showErrorMessage('No deviation selected.');
      return;
    }

    try {
      const deviation = treeItem.deviation;
      const name = deviation.name;
      const namespace = deviation["namespace.name"];
      const actionName = `accept-${name}`;

      log(`Accepting deviation ${name} in namespace ${namespace}`, LogLevel.INFO, true);

      // Get the YAML content for the deviation
      let yamlContent;
      try {
        // Using edactl directly instead of k8sService.getResourceYaml
        const edactlClient = serviceManager.getClient<EdactlClient>('edactl');
        yamlContent = await edactlClient.executeEdactl(`get deviation ${name} -n ${namespace} -o yaml`);
      } catch (error) {
        throw new Error(`Failed to get deviation details: ${error}`);
      }

      const fullDeviation = yaml.load(yamlContent) as DeviationResource;

      if (!fullDeviation || !fullDeviation.spec) {
        vscode.window.showErrorMessage(`Failed to get full details for deviation ${name}`);
        return;
      }

      const nodeEndpoint = fullDeviation.spec.nodeEndpoint;
      const path = fullDeviation.spec.path;

      if (!nodeEndpoint || !path) {
        vscode.window.showErrorMessage('Deviation is missing required properties');
        return;
      }

      const acceptResource = {
        apiVersion: 'core.eda.nokia.com/v1',
        kind: 'DeviationAction',
        metadata: {
          name: actionName,
          namespace: namespace
        },
        spec: {
          actions: [
            {
              action: 'setAccept',
              path: path,
              recurse: false
            }
          ],
          nodeEndpoint: nodeEndpoint
        }
      };

      // Apply the resource using kubectl
      const yamlData = yaml.dump(acceptResource);
      execSync(`kubectl apply -f - <<EOF\n${yamlData}\nEOF`, { encoding: 'utf8' });

      vscode.window.showInformationMessage(`Deviation ${name} accepted successfully`);
      edaDeviationProvider.updateDeviation(name, namespace, "Processing...");

      // Attempt to clean up the deviation action resource for up to 60 seconds
      attemptCleanup(name, namespace, actionName);

    } catch (error) {
      vscode.window.showErrorMessage(`Failed to accept deviation: ${error}`);
      edaOutputChannel.appendLine(`Error accepting deviation: ${error}`);
    }
  });

  // Register reject deviation command
  const rejectDeviationCmd = vscode.commands.registerCommand('vscode-eda.rejectDeviation', async (treeItem: any) => {
    if (!treeItem?.deviation) {
      vscode.window.showErrorMessage('No deviation selected.');
      return;
    }

    try {
      const deviation = treeItem.deviation;
      const name = deviation.name;
      const namespace = deviation["namespace.name"];
      const actionName = `reject-${name}`;

      log(`Rejecting deviation ${name} in namespace ${namespace}`, LogLevel.INFO, true);

      // Get the YAML content for the deviation
      let yamlContent;
      try {
        // Using edactl directly instead of k8sService.getResourceYaml
        const edactlClient = serviceManager.getClient<EdactlClient>('edactl');
        yamlContent = await edactlClient.executeEdactl(`get deviation ${name} -n ${namespace} -o yaml`);
      } catch (error) {
        throw new Error(`Failed to get deviation details: ${error}`);
      }

      const fullDeviation = yaml.load(yamlContent) as DeviationResource;

      if (!fullDeviation || !fullDeviation.spec) {
        vscode.window.showErrorMessage(`Failed to get full details for deviation ${name}`);
        return;
      }

      const nodeEndpoint = fullDeviation.spec.nodeEndpoint;
      const path = fullDeviation.spec.path;

      if (!nodeEndpoint || !path) {
        vscode.window.showErrorMessage('Deviation is missing required properties');
        return;
      }

      const rejectResource = {
        apiVersion: 'core.eda.nokia.com/v1',
        kind: 'DeviationAction',
        metadata: {
          name: actionName,
          namespace: namespace
        },
        spec: {
          actions: [
            {
              action: "reject",
              path: path,
              recurse: false
            }
          ],
          nodeEndpoint: nodeEndpoint
        }
      };

      // Apply the resource using kubectl
      const yamlData = yaml.dump(rejectResource);
      execSync(`kubectl apply -f - <<EOF\n${yamlData}\nEOF`, { encoding: 'utf8' });

      vscode.window.showInformationMessage(`Deviation ${name} rejected successfully`);
      edaDeviationProvider.updateDeviation(name, namespace, "Processing...");

      // Attempt to clean up the deviation action resource for up to 60 seconds
      attemptCleanup(name, namespace, actionName);

    } catch (error) {
      vscode.window.showErrorMessage(`Failed to reject deviation: ${error}`);
      edaOutputChannel.appendLine(`Error rejecting deviation: ${error}`);
    }
  });

  context.subscriptions.push(acceptDeviationCmd, rejectDeviationCmd);
}