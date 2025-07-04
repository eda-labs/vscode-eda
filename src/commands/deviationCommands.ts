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
    action: 'setAccept' | 'reject',
    silent = false
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
      if (!silent) {
        vscode.window.showInformationMessage(
          `Deviation ${name} ${action === 'setAccept' ? 'accepted' : 'rejected'} successfully.`,
        );
      }
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

  const rejectAllCmd = vscode.commands.registerCommand(
    'vscode-eda.rejectAllDeviations',
    async () => {
      const deviations = edaDeviationProvider.getAllDeviations();
      if (deviations.length === 0) {
        vscode.window.showInformationMessage('No deviations to reject.');
        return;
      }
      const confirmed = await vscode.window.showWarningMessage(
        `Reject all ${deviations.length} deviations?`,
        { modal: true },
        'Yes',
        'No'
      );
      if (confirmed !== 'Yes') {
        return;
      }
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Rejecting ${deviations.length} deviations`,
        },
        async () => {
          for (const d of deviations) {
            await handleAction(d as Deviation, 'reject', true);
          }
        }
      );
      vscode.window.showInformationMessage(
        `Submitted reject actions for ${deviations.length} deviations.`
      );
    }
  );

  context.subscriptions.push(acceptCmd, rejectCmd, rejectAllCmd);
}
