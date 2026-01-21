import * as vscode from 'vscode';

import { serviceManager } from '../services/serviceManager';
import type { EdaClient } from '../clients/edaClient';
import { edaDeviationProvider, log, LogLevel } from '../extension';
import { MSG_NO_DEVIATION_SELECTED } from './constants';

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

interface DeviationDetails {
  name: string;
  namespace: string;
  nodeEndpoint: string;
  path: string;
}

function extractDeviationDetails(dev: Deviation): DeviationDetails | null {
  const name = getDeviationName(dev);
  const namespace = getDeviationNamespace(dev);
  const nodeEndpoint = dev.spec?.nodeEndpoint;
  const path = dev.spec?.path;
  if (!name || !namespace || !nodeEndpoint || !path) {
    return null;
  }
  return { name, namespace, nodeEndpoint, path };
}

function buildDeviationActionCR(
  details: DeviationDetails,
  action: 'setAccept' | 'reject',
  recurse: boolean
): Record<string, unknown> {
  return {
    type: {
      create: {
        value: {
          apiVersion: 'core.eda.nokia.com/v1',
          kind: 'DeviationAction',
          metadata: { name: `${action === 'setAccept' ? 'accept' : 'reject'}-${details.name}`, namespace: details.namespace },
          spec: {
            actions: [
              {
                action,
                path: details.path,
                recurse,
              },
            ],
            nodeEndpoint: details.nodeEndpoint,
          },
        },
      },
    },
  };
}

function buildRejectTransaction(crs: Record<string, unknown>[]): Record<string, unknown> {
  return {
    description: '',
    dryRun: false,
    retain: true,
    resultType: 'normal',
    crs,
  };
}

async function promptRejectAllChoice(count: number): Promise<{ confirmed: boolean; recurse: boolean }> {
  const choice = await vscode.window.showWarningMessage(
    `Reject all ${count} deviations?`,
    { modal: true },
    'Yes',
    'Yes (Recurse)',
    'No'
  );
  if (!choice || choice === 'No') {
    return { confirmed: false, recurse: false };
  }
  return { confirmed: true, recurse: choice === 'Yes (Recurse)' };
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
    const details = extractDeviationDetails(dev);
    if (!details) {
      vscode.window.showErrorMessage('Deviation information incomplete.');
      return;
    }
    const actionVerb = action === 'setAccept' ? 'accept' : 'reject';
    const actionName = `${actionVerb}-${details.name}`;
    const body = {
      apiVersion: 'core.eda.nokia.com/v1',
      kind: 'DeviationAction',
      metadata: { name: actionName, namespace: details.namespace },
      spec: {
        actions: [
          {
            action,
            path: details.path,
            recurse: false,
          },
        ],
        nodeEndpoint: details.nodeEndpoint,
      },
    };
    try {
      await edaClient.createDeviationAction(details.namespace, body);
      if (!silent) {
        vscode.window.showInformationMessage(
          `Deviation ${details.name} ${actionVerb}ed successfully.`,
        );
      }
      edaDeviationProvider.updateDeviation(details.name, details.namespace, 'Processing...');
    } catch (err: any) {
      const msg = `Failed to ${actionVerb} deviation: ${err.message || err}`;
      vscode.window.showErrorMessage(msg);
      log(msg, LogLevel.ERROR, true);
    }
  }

  const acceptCmd = vscode.commands.registerCommand(
    'vscode-eda.acceptDeviation',
    async (treeItem: any) => {
      if (!treeItem?.deviation) {
        vscode.window.showErrorMessage(MSG_NO_DEVIATION_SELECTED);
        return;
      }
      await handleAction(treeItem.deviation as Deviation, 'setAccept');
    },
  );

  const rejectCmd = vscode.commands.registerCommand(
    'vscode-eda.rejectDeviation',
    async (treeItem: any) => {
      if (!treeItem?.deviation) {
        vscode.window.showErrorMessage(MSG_NO_DEVIATION_SELECTED);
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

      const { confirmed, recurse } = await promptRejectAllChoice(deviations.length);
      if (!confirmed) {
        return;
      }

      const crs = deviations
        .map((d) => extractDeviationDetails(d))
        .filter((details): details is DeviationDetails => details !== null)
        .map((details) => buildDeviationActionCR(details, 'reject', recurse));

      if (crs.length === 0) {
        vscode.window.showInformationMessage('No valid deviations to reject.');
        return;
      }

      const tx = buildRejectTransaction(crs);

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Rejecting ${crs.length} deviations`,
        },
        async () => {
          await edaClient.runTransaction(tx);
        }
      );

      for (const d of deviations) {
        const details = extractDeviationDetails(d);
        if (details) {
          edaDeviationProvider.updateDeviation(details.name, details.namespace, 'Processing...');
        }
      }

      vscode.window.showInformationMessage(
        `Submitted reject actions for ${crs.length} deviations.`
      );
    }
  );

  context.subscriptions.push(acceptCmd, rejectCmd, rejectAllCmd);
}
