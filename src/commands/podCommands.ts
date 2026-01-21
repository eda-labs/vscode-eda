import * as vscode from 'vscode';

import type { PodDescribeDocumentProvider } from '../providers/documents/podDescribeProvider';
import { runKubectl, getKubectlContext } from '../utils/kubectlRunner';
import {
  MSG_POD_NS_OR_NAME_MISSING,
  MSG_NO_POD_AVAILABLE_DELETE,
  MSG_NO_POD_AVAILABLE_TERMINAL,
  MSG_NO_POD_AVAILABLE_LOGS,
  MSG_NO_POD_AVAILABLE_DESCRIBE
} from './constants';

export function registerPodCommands(
  context: vscode.ExtensionContext,
  podDescribeProvider: PodDescribeDocumentProvider
) {
  const deletePodCmd = vscode.commands.registerCommand('vscode-eda.deletePod', async (treeItem) => {
    if (!treeItem || !treeItem.resource) {
      vscode.window.showErrorMessage(MSG_NO_POD_AVAILABLE_DELETE);
      return;
    }

    // Get namespace from treeItem directly, and name from resource
    const ns = treeItem.namespace;
    const name = treeItem.resource.name;

    if (!ns || !name) {
      vscode.window.showErrorMessage(MSG_POD_NS_OR_NAME_MISSING);
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

  // Open Terminal (shell) in Pod
  const terminalPodCmd = vscode.commands.registerCommand('vscode-eda.terminalPod', (treeItem) => {
    if (!treeItem || !treeItem.resource) {
      vscode.window.showErrorMessage(MSG_NO_POD_AVAILABLE_TERMINAL);
      return;
    }

    // Get namespace from treeItem directly, and name from resource
    const ns = treeItem.namespace;
    const name = treeItem.resource.name;

    if (!ns || !name) {
      vscode.window.showErrorMessage(MSG_POD_NS_OR_NAME_MISSING);
      return;
    }

    // Create a new VS Code Terminal that runs `kubectl exec -it`
    const ctx = getKubectlContext();
    const execArgs = ctx
      ? ['--context', ctx, 'exec', '-it', '-n', ns, name, '--', '/bin/sh']
      : ['exec', '-it', '-n', ns, name, '--', '/bin/sh'];
    const term = vscode.window.createTerminal({
      name: `Shell: ${name}`,
      shellPath: 'kubectl',
      shellArgs: execArgs
    });
    term.show();
  });

  // View Logs in a new Terminal
  const logsPodCmd = vscode.commands.registerCommand('vscode-eda.logsPod', (treeItem) => {
    if (!treeItem || !treeItem.resource) {
      vscode.window.showErrorMessage(MSG_NO_POD_AVAILABLE_LOGS);
      return;
    }

    // Get namespace from treeItem directly, and name from resource
    const ns = treeItem.namespace;
    const name = treeItem.resource.name;

    if (!ns || !name) {
      vscode.window.showErrorMessage(MSG_POD_NS_OR_NAME_MISSING);
      return;
    }

    // Create a new Terminal that runs `kubectl logs` with follow mode (-f)
    const ctx = getKubectlContext();
    const logArgs = ctx
      ? ['--context', ctx, 'logs', '-f', '--tail=100', '-n', ns, name]
      : ['logs', '-f', '--tail=100', '-n', ns, name];
    const term = vscode.window.createTerminal({
      name: `Logs: ${name}`,
      shellPath: 'kubectl',
      shellArgs: logArgs
    });
    term.show();
  });

  // Describe Pod in a read-only doc
  const describePodCmd = vscode.commands.registerCommand('vscode-eda.describePod', async (treeItem) => {
    if (!treeItem || !treeItem.resource) {
      vscode.window.showErrorMessage(MSG_NO_POD_AVAILABLE_DESCRIBE);
      return;
    }

    // Get namespace from treeItem directly, and name from resource
    const ns = treeItem.namespace;
    const name = treeItem.resource.name;

    if (!ns || !name) {
      vscode.window.showErrorMessage(MSG_POD_NS_OR_NAME_MISSING);
      return;
    }

    try {
      // Get "describe" text via kubectl
      const describeOutput = runKubectl('kubectl', ['describe', 'pod', name], { namespace: ns });
      const docUri = vscode.Uri.parse(`k8s-describe:/${ns}/${name}?ts=${Date.now()}`);
      podDescribeProvider.setDescribeContent(docUri, describeOutput);
      const doc = await vscode.workspace.openTextDocument(docUri);
      await vscode.languages.setTextDocumentLanguage(doc, 'log');
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to describe pod: ${err.message || err}`);
    }
  });

  context.subscriptions.push(deletePodCmd, terminalPodCmd, logsPodCmd, describePodCmd);
}