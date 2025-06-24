import * as vscode from 'vscode';
import { serviceManager } from '../services/serviceManager';
import { EdaClient } from '../clients/edaClient';
import { edaDeviationProvider, log, LogLevel } from '../extension';

interface Deviation {
  name?: string;
  metadata?: { name?: string; namespace?: string };
  namespace?: string;
  'namespace.name'?: string;
  spec?: { nodeEndpoint?: string; path?: string };
  [key: string]: any;
}

function getDeviationName(dev: Deviation): string | undefined {
  return dev.name || dev.metadata?.name;
}

function getDeviationNamespace(dev: Deviation): string | undefined {
  return dev['namespace.name'] || dev.namespace || dev.metadata?.namespace;
}

export function registerDeviationCommands(
  context: vscode.ExtensionContext,
): void {
  const edaClient = serviceManager.getClient<EdaClient>('eda');

  async function handleAction(
    dev: Deviation,
    action: 'setAccept' | 'reject'
  ): Promise<void> {
    const name = getDeviationName(dev);
    const ns = getDeviationNamespace(dev);
    const nodeEndpoint = dev.spec?.nodeEndpoint;
    const path = dev.spec?.path;
    if (!name || !ns || !nodeEndpoint || !path) {
      vscode.window.showErrorMessage('Deviation information incomplete.');
      return;
    }
    const actionName = `${action === 'setAccept' ? 'accept' : 'reject'}-${name}`;
    const body = {
      apiVersion: 'core.eda.nokia.com/v1',
      kind: 'DeviationAction',
      metadata: { name: actionName, namespace: ns },
      spec: {
        actions: [
          {
            action,
            path,
            recurse: false,
          },
        ],
        nodeEndpoint,
      },
    };
    try {
      await edaClient.createDeviationAction(ns, body);
      vscode.window.showInformationMessage(
        `Deviation ${name} ${action === 'setAccept' ? 'accepted' : 'rejected'} successfully.`,
      );
      edaDeviationProvider.updateDeviation(name, ns, 'Processing...');
    } catch (err: any) {
      const msg = `Failed to ${action === 'setAccept' ? 'accept' : 'reject'} deviation: ${err.message || err}`;
      vscode.window.showErrorMessage(msg);
      log(msg, LogLevel.ERROR, true);
    }
  }

  const acceptCmd = vscode.commands.registerCommand(
    'vscode-eda.acceptDeviation',
    async (treeItem: any) => {
      if (!treeItem?.deviation) {
        vscode.window.showErrorMessage('No deviation selected.');
        return;
      }
      await handleAction(treeItem.deviation as Deviation, 'setAccept');
    },
  );

  const rejectCmd = vscode.commands.registerCommand(
    'vscode-eda.rejectDeviation',
    async (treeItem: any) => {
      if (!treeItem?.deviation) {
        vscode.window.showErrorMessage('No deviation selected.');
        return;
      }
      await handleAction(treeItem.deviation as Deviation, 'reject');
    },
  );

  context.subscriptions.push(acceptCmd, rejectCmd);
}
