import * as vscode from 'vscode';
import { log, LogLevel, edaOutputChannel } from '../extension';
import { runKubectl } from '../utils/kubectlRunner';

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

      // Try to determine the resource kind
      let resourceKind = treeItem.resource?.kind;

      // If not available directly, try to infer from resourceType
      if (!resourceKind && treeItem.resourceType) {
        // Convert to proper case for display (e.g., "deployment" -> "Deployment")
        resourceKind = treeItem.resourceType.charAt(0).toUpperCase() + treeItem.resourceType.slice(1);
      }

      if (!resourceName || !resourceNamespace || !resourceKind) {
        vscode.window.showErrorMessage(
          `Cannot delete: Missing resource information (name: ${resourceName}, namespace: ${resourceNamespace}, kind: ${resourceKind})`
        );
        return;
      }

      // Show confirmation dialog
      const confirmed = await vscode.window.showWarningMessage(
        `Delete ${resourceKind} '${resourceName}' in namespace '${resourceNamespace}'? This action is irreversible.`,
        { modal: true },
        'Yes'
      );

      if (confirmed === 'Yes') {
        try {
          log(`Deleting ${resourceKind} '${resourceName}' in namespace '${resourceNamespace}'...`, LogLevel.INFO, true);

          // Use kubectl to delete the resource
          const result = runKubectl(
            'kubectl',
            ['delete', resourceKind.toLowerCase(), resourceName],
            { namespace: resourceNamespace }
          );

          vscode.window.showInformationMessage(`${resourceKind} '${resourceName}' deleted successfully.`);

          // Log the result
          log(`Delete result: ${result}`, LogLevel.INFO, true);

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