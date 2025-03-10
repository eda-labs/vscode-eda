import * as vscode from 'vscode';
import { KubernetesService } from '../services/kubernetes/kubernetes';
import { edaOutputChannel } from '../extension.js';
import { PodDescribeDocumentProvider } from '../providers/documents/podDescribeProvider';

export function registerPodCommands(
  context: vscode.ExtensionContext,
  k8sService: KubernetesService,
  podDescribeProvider: PodDescribeDocumentProvider
) {
  // 1) Delete Pod
  const deletePodCmd = vscode.commands.registerCommand('vscode-eda.deletePod', async (treeItem) => {
    if (!treeItem || !treeItem.resource) {
      vscode.window.showErrorMessage('No pod available to delete.');
      return;
    }
    const pod = treeItem.resource;
    const ns = pod.metadata.namespace;
    const name = pod.metadata.name;

    const confirmed = await vscode.window.showWarningMessage(
      `Delete Pod '${name}' in namespace '${ns}'? This action is irreversible.`,
      { modal: true },
      'Yes'
    );
    if (confirmed === 'Yes') {
      try {
        await k8sService.deletePod(ns, name);
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
    const pod = treeItem.resource;
    const ns = pod.metadata.namespace;
    const name = pod.metadata.name;

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
    const pod = treeItem.resource;
    const ns = pod.metadata.namespace;
    const name = pod.metadata.name;

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
    const pod = treeItem.resource;
    const ns = pod.metadata.namespace;
    const name = pod.metadata.name;

    try {
      // 1) Get "describe" text via kubectl
      const describeOutput = k8sService.getPodDescribeOutput(ns, name);

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