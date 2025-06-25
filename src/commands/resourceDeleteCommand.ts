import * as vscode from 'vscode';
import { log, LogLevel, edaOutputChannel } from '../extension';
import { runKubectl } from '../utils/kubectlRunner';
import { serviceManager } from '../services/serviceManager';
import { EdaClient } from '../clients/edaClient';

export function registerResourceDeleteCommand(context: vscode.ExtensionContext) {
  const deleteResourceCmd = vscode.commands.registerCommand(
    'vscode-eda.deleteResource',
    async (treeItem: any) => {
      if (!treeItem) {
        vscode.window.showErrorMessage('No resource selected.');
        return;
      }

      // Get the resource information - either from the raw resource or tree item properties
      const resourceName = treeItem.resource?.name || treeItem.label;
      const resourceNamespace = treeItem.namespace;
      const streamGroup = treeItem.streamGroup;
      const apiVersion = treeItem.resource?.raw?.apiVersion || treeItem.resource?.apiVersion;
      // Try to determine the resource kind
      let resourceKind = treeItem.resource?.kind;

      // If not available directly, try to infer from resourceType
      if (!resourceKind && treeItem.resourceType) {
        // Convert to proper case for display (e.g., "deployment" -> "Deployment")
        resourceKind = treeItem.resourceType.charAt(0).toUpperCase() + treeItem.resourceType.slice(1);
      }

      if (!resourceName || !resourceKind) {
        vscode.window.showErrorMessage(
          `Cannot delete: Missing resource information (name: ${resourceName}, kind: ${resourceKind})`
        );
        return;
      }

      // Show confirmation dialog
      const confirmed = await vscode.window.showWarningMessage(
        `Delete ${resourceKind} '${resourceName}'${resourceNamespace ? ` in namespace '${resourceNamespace}'` : ''}? This action is irreversible.`,
        { modal: true },
        'Yes'
      );

      if (confirmed === 'Yes') {
        try {
          log(
            `Deleting ${resourceKind} '${resourceName}'${resourceNamespace ? ` in namespace '${resourceNamespace}'` : ''}...`,
            LogLevel.INFO,
            true
          );

          if (streamGroup && streamGroup !== 'kubernetes') {
            const edaClient = serviceManager.getClient<EdaClient>('eda');
            if (!apiVersion) {
              throw new Error('Missing apiVersion for EDA resource');
            }
            const [group, version] = apiVersion.split('/');
            await edaClient.deleteCustomResource(
              group,
              version,
              resourceNamespace,
              treeItem.resourceType,
              resourceName,
              !!resourceNamespace
            );
            vscode.window.showInformationMessage(`${resourceKind} '${resourceName}' deleted successfully.`);
            log(`EDA delete completed`, LogLevel.INFO, true);
          } else {
            const result = runKubectl(
              'kubectl',
              ['delete', resourceKind.toLowerCase(), resourceName],
              { namespace: resourceNamespace }
            );
            vscode.window.showInformationMessage(`${resourceKind} '${resourceName}' deleted successfully.`);
            log(`Delete result: ${result}`, LogLevel.INFO, true);
          }

        } catch (err: any) {
          const errorMsg = err.message || String(err);
          log(`Error deleting resource ${resourceKind}/${resourceName}: ${errorMsg}`, LogLevel.ERROR, true);
          vscode.window.showErrorMessage(`Failed to delete ${resourceKind} '${resourceName}': ${errorMsg}`);

          // Show output channel with error details
          edaOutputChannel.show();
        }
      }
    }
  );

  context.subscriptions.push(deleteResourceCmd);
}