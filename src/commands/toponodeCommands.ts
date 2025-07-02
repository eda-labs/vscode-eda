import * as vscode from 'vscode';
import { serviceManager } from '../services/serviceManager';
import { EdaClient } from '../clients/edaClient';
import { KubernetesClient } from '../clients/kubernetesClient';

export function registerTopoNodeCommands(context: vscode.ExtensionContext) {
  const sshCmd = vscode.commands.registerCommand('vscode-eda.sshTopoNode', async (info: any) => {
    const name = info?.name || info?.label || info?.resource?.metadata?.name;
    const nodeDetails: string | undefined = info?.nodeDetails;

    if (!name) {
      vscode.window.showErrorMessage('No node specified.');
      return;
    }

    if (typeof nodeDetails !== 'string' || nodeDetails.length === 0) {
      vscode.window.showErrorMessage('No node address available for SSH.');
      return;
    }

    const edaClient = serviceManager.getClient<EdaClient>('eda');
    const coreNs = edaClient.getCoreNamespace();

    // Attempt to obtain the current Kubernetes context if available
    let kubectlContext = '';
    try {
      if (serviceManager.getClientNames().includes('kubernetes')) {
        const k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');
        const ctx = k8sClient.getCurrentContext();
        if (ctx && ctx !== 'none') {
          kubectlContext = `--context ${ctx}`;
        }
      }
    } catch {
      /* ignore */
    }

    const host = nodeDetails.split(':')[0];
    const nsFlag = `-n ${coreNs}`;
    const ctxFlag = kubectlContext;
    const flags = [nsFlag, ctxFlag].filter(a => a).join(' ');
    const cmd = `kubectl ${flags} exec -it $(kubectl ${flags} get pods -l eda.nokia.com/app=eda-toolbox -o=jsonpath='{.items[0].metadata.name}') ${ctxFlag} -- ssh admin@${host}`;

    const terminal = vscode.window.createTerminal({
      name: `SSH: ${name}`,
      shellPath: 'bash',
      shellArgs: ['-c', cmd]
    });

    terminal.show();
  });

  context.subscriptions.push(sshCmd);
}
