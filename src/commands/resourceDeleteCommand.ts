import * as vscode from 'vscode';

import type { EdaClient } from '../clients/edaClient';
import { log, LogLevel, edaOutputChannel, edaTransactionBasketProvider } from '../extension';
import { serviceManager } from '../services/serviceManager';
import { runKubectl } from '../utils/kubectlRunner';

import {
  MSG_NO_RESOURCE_SELECTED,
  MSG_BASKET_EDA_ONLY,
  MSG_MISSING_API_VERSION
} from './constants';

/** Represents a tree item for resource operations */
interface ResourceTreeItem {
  resource?: {
    name?: string;
    kind?: string;
    apiVersion?: string;
    raw?: {
      apiVersion?: string;
    };
  };
  label?: string;
  namespace?: string;
  streamGroup?: string;
  resourceType?: string;
}

/** Extracted resource information from a tree item */
interface ResourceInfo {
  name: string;
  kind: string;
  namespace: string | undefined;
  streamGroup: string | undefined;
  apiVersion: string | undefined;
  resourceType: string | undefined;
}

/** Delete transaction structure for EDA */
interface DeleteTransaction {
  crs: Array<{
    type: {
      delete: {
        gvk: { group: string; version: string; kind: string };
        name: string;
        namespace: string | undefined;
      };
    };
  }>;
  description: string;
  retain: boolean;
  dryRun: boolean;
}

function formatNamespaceSuffix(namespace: string | undefined): string {
  return namespace ? ` in namespace '${namespace}'` : '';
}

/**
 * Extracts resource information from a tree item
 */
function extractResourceInfo(treeItem: ResourceTreeItem): ResourceInfo | null {
  const resourceName = treeItem.resource?.name ?? treeItem.label;
  const resourceNamespace = treeItem.namespace;
  const streamGroup = treeItem.streamGroup;
  const apiVersion = treeItem.resource?.raw?.apiVersion ?? treeItem.resource?.apiVersion;
  let resourceKind = treeItem.resource?.kind;

  // If not available directly, try to infer from resourceType
  if (!resourceKind && treeItem.resourceType) {
    // Convert to proper case for display (e.g., "deployment" -> "Deployment")
    resourceKind = treeItem.resourceType.charAt(0).toUpperCase() + treeItem.resourceType.slice(1);
  }

  if (!resourceName || !resourceKind) {
    return null;
  }

  return {
    name: resourceName,
    kind: resourceKind,
    namespace: resourceNamespace,
    streamGroup,
    apiVersion,
    resourceType: treeItem.resourceType
  };
}

/**
 * Creates a delete transaction object for EDA resources
 */
function createDeleteTransaction(
  apiVersion: string,
  resourceKind: string,
  resourceName: string,
  resourceNamespace: string | undefined
): DeleteTransaction {
  const [group, version] = apiVersion.split('/');
  return {
    crs: [
      {
        type: {
          delete: {
            gvk: { group, version, kind: resourceKind },
            name: resourceName,
            namespace: resourceNamespace
          }
        }
      }
    ],
    description: `vscode basket delete ${resourceKind}/${resourceName}`,
    retain: true,
    dryRun: false
  };
}

/**
 * Adds a delete operation to the transaction basket
 */
async function addDeleteToBasket(info: ResourceInfo): Promise<boolean> {
  if (!info.streamGroup || info.streamGroup === 'kubernetes') {
    vscode.window.showErrorMessage(MSG_BASKET_EDA_ONLY);
    return false;
  }

  if (!info.apiVersion) {
    vscode.window.showErrorMessage(MSG_MISSING_API_VERSION);
    return false;
  }

  const tx = createDeleteTransaction(info.apiVersion, info.kind, info.name, info.namespace);
  await edaTransactionBasketProvider.addTransaction(tx);
  vscode.window.showInformationMessage(
    `Added delete for ${info.kind} '${info.name}' to transaction basket.`
  );
  return true;
}

/**
 * Executes immediate deletion of an EDA resource
 */
async function deleteEdaResource(info: ResourceInfo): Promise<void> {
  const edaClient = serviceManager.getClient<EdaClient>('eda');
  if (!info.apiVersion) {
    throw new Error('Missing apiVersion for EDA resource');
  }
  if (!info.resourceType) {
    throw new Error('Missing resourceType for EDA resource');
  }
  const [group, version] = info.apiVersion.split('/');
  await edaClient.deleteCustomResource(
    group,
    version,
    info.namespace,
    info.resourceType,
    info.name,
    !!info.namespace
  );
  vscode.window.showInformationMessage(`${info.kind} '${info.name}' deleted successfully.`);
  log('EDA delete completed', LogLevel.INFO, true);
}

/**
 * Executes immediate deletion of a Kubernetes resource via kubectl
 */
function deleteKubernetesResource(info: ResourceInfo): void {
  const result = runKubectl(
    'kubectl',
    ['delete', info.kind.toLowerCase(), info.name],
    { namespace: info.namespace }
  );
  vscode.window.showInformationMessage(`${info.kind} '${info.name}' deleted successfully.`);
  log(`Delete result: ${result}`, LogLevel.INFO, true);
}

/**
 * Handles the immediate deletion of a resource
 */
async function executeImmediateDelete(info: ResourceInfo): Promise<void> {
  const nsSuffix = formatNamespaceSuffix(info.namespace);
  const confirmed = await vscode.window.showWarningMessage(
    `Delete ${info.kind} '${info.name}'${nsSuffix}? This action is irreversible.`,
    { modal: true },
    'Yes'
  );

  if (confirmed !== 'Yes') {
    return;
  }

  try {
    log(`Deleting ${info.kind} '${info.name}'${nsSuffix}...`, LogLevel.INFO, true);

    const isEdaResource = info.streamGroup && info.streamGroup !== 'kubernetes';
    if (isEdaResource) {
      await deleteEdaResource(info);
    } else {
      deleteKubernetesResource(info);
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log(`Error deleting resource ${info.kind}/${info.name}: ${errorMsg}`, LogLevel.ERROR, true);
    vscode.window.showErrorMessage(`Failed to delete ${info.kind} '${info.name}': ${errorMsg}`);
    edaOutputChannel.show();
  }
}

export function registerResourceDeleteCommand(context: vscode.ExtensionContext) {
  const deleteResourceCmd = vscode.commands.registerCommand(
    'vscode-eda.deleteResource',
    async (treeItem: ResourceTreeItem | undefined) => {
      if (!treeItem) {
        vscode.window.showErrorMessage(MSG_NO_RESOURCE_SELECTED);
        return;
      }

      const info = extractResourceInfo(treeItem);
      if (!info) {
        vscode.window.showErrorMessage(
          'Cannot delete: Missing resource information (name or kind)'
        );
        return;
      }

      const action = await vscode.window.showQuickPick(
        [
          { label: 'Remove Immediately', id: 'delete' },
          { label: 'Add Delete to Basket', id: 'basket' }
        ],
        {
          placeHolder: `Remove ${info.kind} '${info.name}' or add to basket?`,
          title: 'Delete Resource'
        }
      );

      if (!action) {
        return;
      }

      if (action.id === 'basket') {
        await addDeleteToBasket(info);
      } else {
        await executeImmediateDelete(info);
      }
    }
  );

  const addDeleteCmd = vscode.commands.registerCommand(
    'vscode-eda.addDeleteToBasket',
    async (treeItem: ResourceTreeItem | undefined) => {
      if (!treeItem) {
        vscode.window.showErrorMessage(MSG_NO_RESOURCE_SELECTED);
        return;
      }

      const info = extractResourceInfo(treeItem);
      if (!info) {
        vscode.window.showErrorMessage(
          'Cannot add delete to basket: Missing resource information (name or kind)'
        );
        return;
      }

      await addDeleteToBasket(info);
    }
  );

  context.subscriptions.push(deleteResourceCmd, addDeleteCmd);
}
