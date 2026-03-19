import * as vscode from 'vscode';

import type { EdaClient } from '../clients/edaClient';
import { log, LogLevel, edaOutputChannel, edaTransactionBasketProvider } from '../extension';
import type { SchemaProviderService } from '../services/schemaProviderService';
import { serviceManager } from '../services/serviceManager';
import { runKubectl } from '../utils/kubectlRunner';
import type { Transaction } from '../providers/views/transactionBasketProvider';

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

type CdrDefinitions = Awaited<ReturnType<SchemaProviderService['getCustomResourceDefinitions']>>;
type CdrDefinition = CdrDefinitions[number];

function formatNamespaceSuffix(namespace: string | undefined): string {
  return namespace ? ` in namespace '${namespace}'` : '';
}

function normalizeResourceName(resourceName: string, namespace: string | undefined): string {
  if (!namespace) {
    return resourceName;
  }

  const namespacePrefix = `${namespace}/`;
  if (!resourceName.startsWith(namespacePrefix)) {
    return resourceName;
  }

  const normalized = resourceName.slice(namespacePrefix.length);
  return normalized.length > 0 ? normalized : resourceName;
}

function hasKindDerivedFromResourceType(kind: string, resourceType: string | undefined): boolean {
  if (!resourceType) {
    return false;
  }
  return kind.toLowerCase() === resourceType.toLowerCase();
}

function shouldResolveMetadataFromCrd(info: ResourceInfo, kindDerivedFromResourceType: boolean): boolean {
  if (!info.streamGroup || info.streamGroup === 'kubernetes') {
    return false;
  }
  if (info.apiVersion && info.resourceType && !kindDerivedFromResourceType) {
    return false;
  }
  return true;
}

function getSchemaProviderSafe(): SchemaProviderService | undefined {
  try {
    return serviceManager.getService<SchemaProviderService>('schema-provider');
  } catch {
    return undefined;
  }
}

async function loadCrdDefinitionsSafe(schemaProvider: SchemaProviderService): Promise<CdrDefinitions | undefined> {
  try {
    return await schemaProvider.getCustomResourceDefinitions();
  } catch (err: unknown) {
    log(`Failed to load CRD metadata while deleting resource: ${String(err)}`, LogLevel.DEBUG);
    return undefined;
  }
}

function findMatchingDefinition(definitions: CdrDefinitions, info: ResourceInfo): CdrDefinition | undefined {
  const expectedGroup = info.streamGroup?.toLowerCase();
  const expectedPlural = info.resourceType?.toLowerCase();
  const expectedKind = info.kind.toLowerCase();

  const byPluralAndGroup = expectedPlural && expectedGroup
    ? definitions.find(def => def.plural.toLowerCase() === expectedPlural && def.group.toLowerCase() === expectedGroup)
    : undefined;
  if (byPluralAndGroup) {
    return byPluralAndGroup;
  }

  const byPlural = expectedPlural
    ? definitions.find(def => def.plural.toLowerCase() === expectedPlural)
    : undefined;
  if (byPlural) {
    return byPlural;
  }

  const byKindAndGroup = expectedGroup
    ? definitions.find(def => def.kind.toLowerCase() === expectedKind && def.group.toLowerCase() === expectedGroup)
    : undefined;
  if (byKindAndGroup) {
    return byKindAndGroup;
  }

  return definitions.find(def => def.kind.toLowerCase() === expectedKind);
}

/**
 * Resolve missing EDA metadata from CRD definitions when stream payloads omit apiVersion/kind details.
 */
async function resolveEdaResourceInfo(info: ResourceInfo): Promise<ResourceInfo> {
  const kindDerivedFromResourceType = hasKindDerivedFromResourceType(info.kind, info.resourceType);
  if (!shouldResolveMetadataFromCrd(info, kindDerivedFromResourceType)) {
    return info;
  }

  const schemaProvider = getSchemaProviderSafe();
  if (!schemaProvider) {
    return info;
  }

  const definitions = await loadCrdDefinitionsSafe(schemaProvider);
  if (!Array.isArray(definitions) || definitions.length === 0) {
    return info;
  }

  const match = findMatchingDefinition(definitions, info);
  if (!match) {
    return info;
  }

  return {
    ...info,
    apiVersion: info.apiVersion ?? `${match.group}/${match.version}`,
    resourceType: info.resourceType ?? match.plural,
    kind: kindDerivedFromResourceType ? match.kind : info.kind
  };
}

/**
 * Extracts resource information from a tree item
 */
function extractResourceInfo(treeItem: ResourceTreeItem): ResourceInfo | null {
  const rawResourceName = treeItem.resource?.name ?? treeItem.label;
  const resourceNamespace = treeItem.namespace;
  const streamGroup = treeItem.streamGroup;
  const apiVersion = treeItem.resource?.raw?.apiVersion ?? treeItem.resource?.apiVersion;
  let resourceKind = treeItem.resource?.kind;

  // If not available directly, try to infer from resourceType
  if (!resourceKind && treeItem.resourceType) {
    // Convert to proper case for display (e.g., "deployment" -> "Deployment")
    resourceKind = treeItem.resourceType.charAt(0).toUpperCase() + treeItem.resourceType.slice(1);
  }

  if (!rawResourceName || !resourceKind) {
    return null;
  }
  const resourceName = normalizeResourceName(rawResourceName, resourceNamespace);

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
): Transaction {
  const [group, version] = apiVersion.split('/');
  // The EDA API requires group, version, and kind in the gvk field,
  // but the Transaction type only specifies kind. Use type assertion
  // since this structure is correct for the EDA API.
  return {
    crs: [
      {
        type: {
          delete: {
            gvk: { group, version, kind: resourceKind } as { kind?: string },
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

  const resolvedInfo = await resolveEdaResourceInfo(info);

  if (!resolvedInfo.apiVersion) {
    vscode.window.showErrorMessage(MSG_MISSING_API_VERSION);
    return false;
  }

  const tx = createDeleteTransaction(
    resolvedInfo.apiVersion,
    resolvedInfo.kind,
    resolvedInfo.name,
    resolvedInfo.namespace
  );
  await edaTransactionBasketProvider.addTransaction(tx);
  vscode.window.showInformationMessage(
    `Added delete for ${resolvedInfo.kind} '${resolvedInfo.name}' to transaction basket.`
  );
  return true;
}

/**
 * Executes immediate deletion of an EDA resource
 */
async function deleteEdaResource(info: ResourceInfo): Promise<void> {
  const edaClient = serviceManager.getClient<EdaClient>('eda');
  const resolvedInfo = await resolveEdaResourceInfo(info);

  if (!resolvedInfo.apiVersion) {
    throw new Error('Missing apiVersion for EDA resource');
  }
  if (!resolvedInfo.resourceType) {
    throw new Error('Missing resourceType for EDA resource');
  }
  const [group, version] = resolvedInfo.apiVersion.split('/');
  await edaClient.deleteCustomResource(
    group,
    version,
    resolvedInfo.namespace,
    resolvedInfo.resourceType,
    resolvedInfo.name,
    !!resolvedInfo.namespace
  );
  vscode.window.showInformationMessage(`${resolvedInfo.kind} '${resolvedInfo.name}' deleted successfully.`);
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
