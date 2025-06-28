import * as vscode from 'vscode';
import { serviceManager } from '../services/serviceManager';
import { EdaClient } from '../clients/edaClient';
import { LogLevel, log } from '../extension';
import { NodeConfigPanel, Annotation } from '../panels/nodeConfig/nodeConfigPanel';

export function registerNodeConfigCommands(context: vscode.ExtensionContext) {
  const viewCmd = vscode.commands.registerCommand('vscode-eda.viewNodeConfig', async (treeItem: any) => {
    try {
      const nodeName = treeItem?.label || treeItem?.name || treeItem?.resource?.name || treeItem?.resource?.metadata?.name;
      const namespace = treeItem?.namespace || treeItem?.resource?.metadata?.namespace || 'default';
      if (!nodeName) {
        vscode.window.showErrorMessage('No node specified.');
        return;
      }
      const edaClient = serviceManager.getClient<EdaClient>('eda');
      const result = await edaClient.getNodeConfig(namespace, nodeName);
      NodeConfigPanel.show(
        context,
        result.running || '',
        (result.annotations || []) as Annotation[],
        nodeName
      );
    } catch (err: any) {
      log(`Failed to load node config: ${err}`, LogLevel.ERROR, true);
      vscode.window.showErrorMessage(`Failed to load node config: ${err.message || err}`);
    }
  });
  context.subscriptions.push(viewCmd);
}
