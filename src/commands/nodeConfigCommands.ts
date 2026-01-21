import * as vscode from 'vscode';

import { serviceManager } from '../services/serviceManager';
import type { EdaClient } from '../clients/edaClient';
import { LogLevel, log } from '../extension';
import type { Annotation } from '../webviews/nodeConfig/nodeConfigPanel';
import { NodeConfigPanel } from '../webviews/nodeConfig/nodeConfigPanel';

interface TreeItemLike {
  label?: string;
  name?: string;
  namespace?: string;
  resource?: {
    name?: string;
    metadata?: {
      name?: string;
      namespace?: string;
    };
  };
}

interface NodeConfigResult {
  running?: string;
  annotations?: Annotation[];
}

function extractNodeName(treeItem: TreeItemLike | undefined): string | undefined {
  if (!treeItem) {
    return undefined;
  }
  return (
    treeItem.label ??
    treeItem.name ??
    treeItem.resource?.name ??
    treeItem.resource?.metadata?.name
  );
}

function extractNamespace(treeItem: TreeItemLike | undefined): string {
  if (!treeItem) {
    return 'default';
  }
  return (
    treeItem.namespace ??
    treeItem.resource?.metadata?.namespace ??
    'default'
  );
}

async function handleViewNodeConfig(
  context: vscode.ExtensionContext,
  treeItem: TreeItemLike | undefined
): Promise<void> {
  const nodeName = extractNodeName(treeItem);
  if (!nodeName) {
    vscode.window.showErrorMessage('No node specified.');
    return;
  }

  const namespace = extractNamespace(treeItem);
  const edaClient = serviceManager.getClient<EdaClient>('eda');
  const result = (await edaClient.getNodeConfig(namespace, nodeName)) as NodeConfigResult;

  NodeConfigPanel.show(
    context,
    result.running ?? '',
    result.annotations ?? [],
    nodeName
  );
}

export function registerNodeConfigCommands(context: vscode.ExtensionContext) {
  const viewCmd = vscode.commands.registerCommand(
    'vscode-eda.viewNodeConfig',
    async (treeItem: TreeItemLike | undefined) => {
      try {
        await handleViewNodeConfig(context, treeItem);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log(`Failed to load node config: ${message}`, LogLevel.ERROR, true);
        vscode.window.showErrorMessage(`Failed to load node config: ${message}`);
      }
    }
  );
  context.subscriptions.push(viewCmd);
}
