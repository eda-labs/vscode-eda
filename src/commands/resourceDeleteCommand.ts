import * as vscode from 'vscode';
import { log, LogLevel, edaOutputChannel, edaTransactionBasketProvider } from '../extension';
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

      const action = await vscode.window.showQuickPick(
        [
          { label: '🗑 Remove Immediately', id: 'delete' },
          { label: '🧺 Add Delete to Basket', id: 'basket' }
        ],
        {
          placeHolder: `Remove ${resourceKind} '${resourceName}' or add to basket?`,
          title: 'Delete Resource'
        }
      );

      if (!action) {
        return;
      }

      if (action.id === 'basket') {
        if (streamGroup && streamGroup !== 'kubernetes') {
          if (!apiVersion) {
            vscode.window.showErrorMessage('Missing apiVersion for EDA resource');
            return;
          }
          const [group, version] = apiVersion.split('/');
          const tx = {
            crs: [
              {
                type: {
                  delete: {
                    gvk: { group, version, kind: resourceKind },
                    name: resourceName,
                    namespace: resourceNamespace
                  }
                }
              }
            ],
            description: `vscode basket delete ${resourceKind}/${resourceName}`,
            retain: true,
            dryRun: false
          };
          await edaTransactionBasketProvider.addTransaction(tx);
          vscode.window.showInformationMessage(
            `Added delete for ${resourceKind} '${resourceName}' to transaction basket.`
          );
        } else {
          vscode.window.showErrorMessage('Adding to basket is only supported for EDA resources.');
        }
      } else {
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
    }
  );

  const addDeleteCmd = vscode.commands.registerCommand(
    'vscode-eda.addDeleteToBasket',
    async (treeItem: any) => {
      if (!treeItem) {
        vscode.window.showErrorMessage('No resource selected.');
        return;
      }

      const resourceName = treeItem.resource?.name || treeItem.label;
      const resourceNamespace = treeItem.namespace;
      const streamGroup = treeItem.streamGroup;
      const apiVersion = treeItem.resource?.raw?.apiVersion || treeItem.resource?.apiVersion;
      let resourceKind = treeItem.resource?.kind;

      if (!resourceKind && treeItem.resourceType) {
        resourceKind = treeItem.resourceType.charAt(0).toUpperCase() + treeItem.resourceType.slice(1);
      }

      if (!resourceName || !resourceKind) {
        vscode.window.showErrorMessage(
          `Cannot add delete to basket: Missing resource information (name: ${resourceName}, kind: ${resourceKind})`
        );
        return;
      }

      if (streamGroup && streamGroup !== 'kubernetes') {
        if (!apiVersion) {
          vscode.window.showErrorMessage('Missing apiVersion for EDA resource');
          return;
        }
        const [group, version] = apiVersion.split('/');
        const tx = {
          crs: [
            {
              type: {
                delete: {
                  gvk: { group, version, kind: resourceKind },
                  name: resourceName,
                  namespace: resourceNamespace
                }
              }
            }
          ],
          description: `vscode basket delete ${resourceKind}/${resourceName}`,
          retain: true,
          dryRun: false
        };
        await edaTransactionBasketProvider.addTransaction(tx);
        vscode.window.showInformationMessage(
          `Added delete for ${resourceKind} '${resourceName}' to transaction basket.`
        );
      } else {
        vscode.window.showErrorMessage('Adding to basket is only supported for EDA resources.');
      }
    }
  );

  context.subscriptions.push(deleteResourceCmd, addDeleteCmd);
}