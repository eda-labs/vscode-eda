import * as vscode from 'vscode';
import { serviceManager } from '../services/serviceManager';
import { KubernetesClient } from '../clients/kubernetesClient';
import { edaOutputChannel } from '../extension';
import { PodDescribeDocumentProvider } from '../providers/documents/podDescribeProvider';
import { runKubectl } from '../utils/kubectlRunner';

export function registerPodCommands(
  context: vscode.ExtensionContext,
  podDescribeProvider: PodDescribeDocumentProvider
) {
  // 1) Delete Pod
  const deletePodCmd = vscode.commands.registerCommand('vscode-eda.deletePod', async (treeItem) => {
    if (!treeItem || !treeItem.resource) {
      vscode.window.showErrorMessage('No pod available to delete.');
      return;
    }

    // Get namespace from treeItem directly, and name from resource
    const ns = treeItem.namespace;
    const name = treeItem.resource.name;

    if (!ns || !name) {
      vscode.window.showErrorMessage('Pod namespace or name is missing.');
      return;
    }

    const confirmed = await vscode.window.showWarningMessage(
      `Delete Pod '${name}' in namespace '${ns}'? This action is irreversible.`,
      { modal: true },
      'Yes'
    );
    if (confirmed === 'Yes') {
      try {
        // Use kubectl directly
        runKubectl('kubectl', ['delete', 'pod', name], { namespace: ns });
        vscode.window.showInformationMessage(`Pod '${name}' deleted successfully.`);
      } catch (err: any) {
        vscode.window.showErrorMessage(err.message);
      }
    }
  });

  // 2) Open Terminal (shell) in Pod
  const terminalPodCmd = vscode.commands.registerCommand('vscode-eda.terminalPod', async (treeItem) => {
    if (!treeItem || !treeItem.resource) {
      vscode.window.showErrorMessage('No pod available for terminal.');
      return;
    }

    // Get namespace from treeItem directly, and name from resource
    const ns = treeItem.namespace;
    const name = treeItem.resource.name;

    if (!ns || !name) {
      vscode.window.showErrorMessage('Pod namespace or name is missing.');
      return;
    }

    // Create a new VS Code Terminal that runs `kubectl exec -it`
    const term = vscode.window.createTerminal({
      name: `Shell: ${name}`,
      shellPath: 'kubectl',
      shellArgs: ['exec', '-it', '-n', ns, name, '--', '/bin/sh']
    });
    term.show();
  });

  // 3) View Logs in a new Terminal
  const logsPodCmd = vscode.commands.registerCommand('vscode-eda.logsPod', async (treeItem) => {
    if (!treeItem || !treeItem.resource) {
      vscode.window.showErrorMessage('No pod available for logs.');
      return;
    }

    // Get namespace from treeItem directly, and name from resource
    const ns = treeItem.namespace;
    const name = treeItem.resource.name;

    if (!ns || !name) {
      vscode.window.showErrorMessage('Pod namespace or name is missing.');
      return;
    }

    // Create a new Terminal that runs `kubectl logs` with follow mode (-f)
    const term = vscode.window.createTerminal({
      name: `Logs: ${name}`,
      shellPath: 'kubectl',
      shellArgs: ['logs', '-f', '--tail=100', '-n', ns, name]
    });
    term.show();
  });

  // 4) Describe Pod in a read-only doc
  const describePodCmd = vscode.commands.registerCommand('vscode-eda.describePod', async (treeItem) => {
    if (!treeItem || !treeItem.resource) {
      vscode.window.showErrorMessage('No pod available to describe.');
      return;
    }

    // Get namespace from treeItem directly, and name from resource
    const ns = treeItem.namespace;
    const name = treeItem.resource.name;

    if (!ns || !name) {
      vscode.window.showErrorMessage('Pod namespace or name is missing.');
      return;
    }

    try {
      // 1) Get "describe" text via kubectl
      const describeOutput = runKubectl('kubectl', ['describe', 'pod', name], { namespace: ns });

      // 2) Construct a "k8s-describe:" URI (with a random query param)
      //    so each time you call "describePod" for that pod, it refreshes
      const docUri = vscode.Uri.parse(`k8s-describe:/${ns}/${name}?ts=${Date.now()}`);

      // 3) Store the output in the read-only provider
      podDescribeProvider.setDescribeContent(docUri, describeOutput);

      // 4) Open the doc
      const doc = await vscode.workspace.openTextDocument(docUri);

      // 5) Force log syntax highlighting
      await vscode.languages.setTextDocumentLanguage(doc, 'log');

      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to describe pod: ${err.message || err}`);
    }
  });

  context.subscriptions.push(deletePodCmd, terminalPodCmd, logsPodCmd, describePodCmd);
}