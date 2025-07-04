import * as vscode from 'vscode';
import { serviceManager } from '../services/serviceManager';
import { EdaClient } from '../clients/edaClient';
import { KubernetesClient } from '../clients/kubernetesClient';
import { log, LogLevel } from '../extension';

export function registerTopoNodeCommands(context: vscode.ExtensionContext) {
  const sshCmd = vscode.commands.registerCommand('vscode-eda.sshTopoNode', async (info: any) => {
    const name = info?.name || info?.label || info?.resource?.metadata?.name;
    const nodeDetails: string | undefined =
      info?.nodeDetails ||
      info?.rawResource?.status?.['node-details'] ||
      info?.resource?.raw?.status?.['node-details'] ||
      info?.resource?.status?.['node-details'];

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

    // Determine username from NodeUser resources
    let username = 'admin';
    let foundUser = false;
    try {
      const nodeNs = info?.namespace || coreNs;
      const [node, users] = await Promise.all([
        edaClient.getTopoNode(nodeNs, name),
        edaClient.listNodeUsers(nodeNs)
      ]);
      const labels: Record<string, string> = node?.metadata?.labels || {};
      for (const u of users) {
        const bindings = Array.isArray(u.spec?.groupBindings)
          ? u.spec.groupBindings
          : [];
        const match = bindings.some((b: any) => {
          if (Array.isArray(b.nodes) && b.nodes.includes(name)) {
            return true;
          }
          if (Array.isArray(b.nodeSelector)) {
            return b.nodeSelector.some((sel: string) => {
              const [k, v] = sel.split('=');
              return labels[k] === v;
            });
          }
          return false;
        });
        if (match) {
          username = u.spec?.username || u.metadata?.name || 'admin';
          foundUser = true;
          break;
        }
      }
    } catch (err: any) {
      log(`Failed to fetch NodeUser for node ${name}: ${err}`, LogLevel.DEBUG);
    }
    if (!foundUser) {
      log(`Could not determine username for node ${name}; using default 'admin'`, LogLevel.DEBUG);
    }

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
    const cmd = `kubectl ${flags} exec -it $(kubectl ${flags} get pods -l eda.nokia.com/app=eda-toolbox -o=jsonpath='{.items[0].metadata.name}') ${ctxFlag} -- ssh ${username}@${host}`;

    const terminal = vscode.window.createTerminal({
      name: `SSH: ${name}`,
      shellPath: 'bash',
      shellArgs: ['-c', cmd]
    });

    terminal.show();
  });

  context.subscriptions.push(sshCmd);
}
