import * as vscode from 'vscode';

import type { EdaAlarmProvider } from '../../providers/views/alarmProvider';
import type { DashboardProvider } from '../../providers/views/dashboardProvider';
import type { EdaDeviationProvider } from '../../providers/views/deviationProvider';
import type { HelpProvider } from '../../providers/views/helpProvider';
import type { EdaNamespaceProvider } from '../../providers/views/namespaceProvider';
import type { TransactionBasketProvider } from '../../providers/views/transactionBasketProvider';
import type { EdaTransactionProvider } from '../../providers/views/transactionProvider';
import type { ResourceData, TreeItemBase } from '../../providers/views/treeItem';
import {
  EXPLORER_TAB_LABELS,
  EXPLORER_TAB_ORDER,
  type ExplorerAction,
  type ExplorerNode,
  type ExplorerSectionSnapshot,
  type ExplorerSnapshotMessage,
  type ExplorerTabId
} from '../shared/explorer/types';

const CMD_VIEW_STREAM_ITEM = 'vscode-eda.viewStreamItem';
const CMD_VIEW_RESOURCE = 'vscode-eda.viewResource';
const CMD_EDIT_RESOURCE = 'vscode-eda.switchToEditResource';
const CMD_DELETE_RESOURCE = 'vscode-eda.deleteResource';
const LABEL_EDIT_RESOURCE = 'Switch To Edit Mode';
const LABEL_DELETE_RESOURCE = 'Delete Resource';
const INLINE_RESOURCE_ACTIONS = process.env.EDA_EXPLORER_INLINE_RESOURCE_ACTIONS === 'true';
const INCLUDE_RESOURCE_TOOLTIPS = process.env.EDA_EXPLORER_RESOURCE_TOOLTIPS === 'true';

const RESOURCE_CONTEXT_VALUES = new Set([
  'stream-item',
  'pod',
  'k8s-deployment-instance',
  'toponode',
  'crd-instance'
]);

interface ExplorerTreeProvider {
  getChildren(element?: TreeItemBase): vscode.ProviderResult<TreeItemBase[]>;
}

interface LightweightResourceCommand {
  name?: string;
  namespace?: string;
  kind?: string;
  apiVersion?: string;
  uid?: string;
  status?: {
    'node-details'?: string;
  };
}

interface ExplorerTreeItemLike extends TreeItemBase {
  basketIndex?: number;
  deviation?: Record<string, unknown>;
}

export interface ExplorerSnapshotProviders {
  dashboardProvider: DashboardProvider;
  namespaceProvider: EdaNamespaceProvider;
  alarmProvider: EdaAlarmProvider;
  deviationProvider: EdaDeviationProvider;
  basketProvider: TransactionBasketProvider;
  transactionProvider: EdaTransactionProvider;
  helpProvider: HelpProvider;
}

function labelToText(label: string | vscode.TreeItemLabel): string {
  return typeof label === 'string' ? label : label.label;
}

function descriptionToText(description: string | boolean | undefined): string | undefined {
  if (typeof description === 'string') {
    return description;
  }
  return undefined;
}

function tooltipToText(tooltip: vscode.MarkdownString | string | undefined): string | undefined {
  if (typeof tooltip === 'string') {
    return tooltip;
  }
  if (tooltip instanceof vscode.MarkdownString) {
    return tooltip.value;
  }
  return undefined;
}

function serializeUri(uri: vscode.Uri): Record<string, unknown> {
  return {
    __vscodeUri: uri.toString()
  };
}

function toSerializable(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof vscode.Uri) {
    return serializeUri(value);
  }

  if (Array.isArray(value)) {
    return value.map(item => toSerializable(item));
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = toSerializable(nested);
    }
    return output;
  }

  return undefined;
}

function createAction(command: string, label: string, args?: unknown[]): ExplorerAction {
  const serializedArgs = args?.map(item => toSerializable(item));
  const id = `${command}:${label}`;
  return {
    id,
    label,
    command,
    args: serializedArgs
  };
}

function dedupeActions(actions: ExplorerAction[]): ExplorerAction[] {
  const seen = new Set<string>();
  const unique: ExplorerAction[] = [];
  for (const action of actions) {
    if (seen.has(action.id)) {
      continue;
    }
    seen.add(action.id);
    unique.push(action);
  }
  return unique;
}

function getNodeDetails(raw: ResourceData['raw'] | undefined): string | undefined {
  const nodeDetails = (raw?.status as { 'node-details'?: string } | undefined)?.['node-details'];
  if (typeof nodeDetails === 'string' && nodeDetails.length > 0) {
    return nodeDetails;
  }
  return undefined;
}

function buildLightweightResource(
  resourceData: ResourceData,
  item: ExplorerTreeItemLike,
  raw: ResourceData['raw'] | undefined
): LightweightResourceCommand {
  return {
    name: resourceData.name,
    namespace: resourceData.namespace ?? item.namespace,
    kind: resourceData.kind,
    apiVersion: resourceData.apiVersion ?? raw?.apiVersion,
    uid: resourceData.uid
  };
}

function buildResourceCommandArgument(item: ExplorerTreeItemLike): Record<string, unknown> {
  const label = labelToText(item.label);
  const resourceData = item.resource as ResourceData | undefined;
  const raw = resourceData?.raw as ResourceData['raw'] | undefined;

  const arg: Record<string, unknown> = {
    label,
    namespace: item.namespace,
    resourceType: item.resourceType,
    streamGroup: item.streamGroup,
    contextValue: item.contextValue,
    name: resourceData?.name ?? label,
    kind: resourceData?.kind ?? item.resourceType,
    apiVersion: resourceData?.apiVersion ?? raw?.apiVersion
  };

  if (resourceData) {
    const lightResource = buildLightweightResource(resourceData, item, raw);
    const nodeDetails = getNodeDetails(raw);
    if (nodeDetails) {
      lightResource.status = { 'node-details': nodeDetails };
      arg.nodeDetails = nodeDetails;
    }
    arg.resource = lightResource;
  }

  if (typeof item.basketIndex === 'number') {
    arg.basketIndex = item.basketIndex;
  }

  if (item.deviation) {
    arg.deviation = toSerializable(item.deviation);
  }

  return arg;
}

function buildMinimalResourceCommandArgument(item: ExplorerTreeItemLike): Record<string, unknown> {
  const label = labelToText(item.label);
  const resourceData = item.resource as ResourceData | undefined;
  const raw = resourceData?.raw as ResourceData['raw'] | undefined;

  return {
    label,
    namespace: item.namespace,
    resourceType: item.resourceType,
    streamGroup: item.streamGroup,
    contextValue: item.contextValue,
    name: resourceData?.name ?? label,
    kind: resourceData?.kind ?? item.resourceType,
    apiVersion: resourceData?.apiVersion ?? raw?.apiVersion
  };
}

function primaryActionFromTreeItem(
  item: ExplorerTreeItemLike,
  sectionId: ExplorerTabId
): ExplorerAction | undefined {
  const contextValue = item.contextValue;
  if (sectionId === 'resources' && RESOURCE_CONTEXT_VALUES.has(contextValue ?? '')) {
    return createAction(CMD_VIEW_STREAM_ITEM, 'View Stream Item');
  }

  const command = item.command;
  if (!command?.command) {
    return undefined;
  }
  const label = command.title || 'Open';
  return createAction(command.command, label, command.arguments);
}

function getResourceActions(contextValue: string | undefined, commandArg: Record<string, unknown>): ExplorerAction[] {
  if (!contextValue) {
    return [];
  }

  const common = [
    createAction(CMD_VIEW_STREAM_ITEM, 'View Stream Item', [commandArg]),
    createAction(CMD_VIEW_RESOURCE, 'View Resource YAML', [commandArg])
  ];

  if (contextValue === 'pod') {
    return [
      ...common,
      createAction('vscode-eda.logsPod', 'View Logs', [commandArg]),
      createAction('vscode-eda.describePod', 'Describe Pod', [commandArg]),
      createAction('vscode-eda.terminalPod', 'Open Terminal', [commandArg]),
      createAction('vscode-eda.deletePod', 'Delete Pod', [commandArg])
    ];
  }

  if (contextValue === 'k8s-deployment-instance') {
    return [
      ...common,
      createAction('vscode-eda.restartDeployment', 'Restart Deployment', [commandArg]),
      createAction(CMD_EDIT_RESOURCE, LABEL_EDIT_RESOURCE, [commandArg]),
      createAction(CMD_DELETE_RESOURCE, LABEL_DELETE_RESOURCE, [commandArg])
    ];
  }

  if (contextValue === 'toponode') {
    return [
      ...common,
      createAction('vscode-eda.viewNodeConfig', 'Get Node Config', [commandArg]),
      createAction('vscode-eda.sshTopoNode', 'SSH To Node', [commandArg]),
      createAction(CMD_EDIT_RESOURCE, LABEL_EDIT_RESOURCE, [commandArg]),
      createAction(CMD_DELETE_RESOURCE, LABEL_DELETE_RESOURCE, [commandArg])
    ];
  }

  if (contextValue === 'crd-instance') {
    return [
      ...common,
      createAction('vscode-eda.showCRDDefinition', 'Show CRD Definition', [commandArg]),
      createAction(CMD_EDIT_RESOURCE, LABEL_EDIT_RESOURCE, [commandArg]),
      createAction(CMD_DELETE_RESOURCE, LABEL_DELETE_RESOURCE, [commandArg])
    ];
  }

  if (contextValue === 'stream-item') {
    return [
      ...common,
      createAction(CMD_EDIT_RESOURCE, LABEL_EDIT_RESOURCE, [commandArg]),
      createAction(CMD_DELETE_RESOURCE, LABEL_DELETE_RESOURCE, [commandArg])
    ];
  }

  return [];
}

function getDeviationActions(contextValue: string | undefined, commandArg: Record<string, unknown>): ExplorerAction[] {
  if (contextValue !== 'eda-deviation') {
    return [];
  }

  return [
    createAction('vscode-eda.acceptDeviation', 'Accept Deviation', [commandArg]),
    createAction('vscode-eda.rejectDeviation', 'Reject Deviation', [commandArg])
  ];
}

function getTransactionActions(contextValue: string | undefined, commandArg: Record<string, unknown>): ExplorerAction[] {
  if (contextValue !== 'transaction') {
    return [];
  }

  return [
    createAction('vscode-eda.revertTransaction', 'Revert Transaction', [commandArg]),
    createAction('vscode-eda.restoreTransaction', 'Restore Transaction', [commandArg])
  ];
}

function getBasketActions(contextValue: string | undefined, commandArg: Record<string, unknown>): ExplorerAction[] {
  if (contextValue !== 'basket-item') {
    return [];
  }

  return [
    createAction('vscode-eda.editBasketItem', 'Edit Basket Item', [commandArg]),
    createAction('vscode-eda.removeBasketItem', 'Remove Basket Item', [commandArg])
  ];
}

function getDashboardActions(contextValue: string | undefined, label: string): ExplorerAction[] {
  if (contextValue !== 'eda-dashboard') {
    return [];
  }

  return [createAction('vscode-eda.showDashboard', 'Open Dashboard', [label])];
}

function getSectionActions(
  sectionId: ExplorerTabId,
  item: ExplorerTreeItemLike,
  commandArg: Record<string, unknown> | undefined
): ExplorerAction[] {
  const contextValue = item.contextValue;
  const label = labelToText(item.label);

  if (sectionId === 'resources') {
    if (!commandArg) {
      return [];
    }
    return getResourceActions(contextValue, commandArg);
  }

  if (sectionId === 'deviations') {
    if (!commandArg) {
      return [];
    }
    return getDeviationActions(contextValue, commandArg);
  }

  if (sectionId === 'transactions') {
    if (!commandArg) {
      return [];
    }
    return getTransactionActions(contextValue, commandArg);
  }

  if (sectionId === 'basket') {
    if (!commandArg) {
      return [];
    }
    return getBasketActions(contextValue, commandArg);
  }

  if (sectionId === 'dashboards') {
    return getDashboardActions(contextValue, label);
  }

  return [];
}

function includeTooltipForSection(sectionId: ExplorerTabId): boolean {
  if (sectionId === 'resources') {
    return INCLUDE_RESOURCE_TOOLTIPS;
  }
  return sectionId !== 'dashboards' && sectionId !== 'help';
}

function getProviderChildren(provider: ExplorerTreeProvider, element?: TreeItemBase): TreeItemBase[] {
  const result = provider.getChildren(element);
  if (Array.isArray(result)) {
    return result;
  }
  return [];
}

function shouldBuildCommandArgForSection(sectionId: ExplorerTabId): boolean {
  return sectionId === 'resources'
    || sectionId === 'deviations'
    || sectionId === 'transactions'
    || sectionId === 'basket';
}

function shouldIncludeNodeActions(sectionId: ExplorerTabId): boolean {
  if (sectionId === 'alarms') {
    return false;
  }
  return !(sectionId === 'resources' && !INLINE_RESOURCE_ACTIONS);
}

function buildNode(
  provider: ExplorerTreeProvider,
  item: ExplorerTreeItemLike,
  sectionId: ExplorerTabId,
  pathId: string
): ExplorerNode {
  const label = labelToText(item.label);
  const description = descriptionToText(item.description);
  const tooltip = includeTooltipForSection(sectionId) ? tooltipToText(item.tooltip) : undefined;
  const isResourceLeaf = sectionId === 'resources' && RESOURCE_CONTEXT_VALUES.has(item.contextValue ?? '');
  const useMinimalResourceCommandArg = sectionId === 'resources' && !INLINE_RESOURCE_ACTIONS;
  const shouldBuildCommandArg = sectionId === 'resources'
    ? isResourceLeaf
    : shouldBuildCommandArgForSection(sectionId);
  let commandArg: Record<string, unknown> | undefined;
  if (shouldBuildCommandArg) {
    commandArg = useMinimalResourceCommandArg
      ? buildMinimalResourceCommandArgument(item)
      : buildResourceCommandArgument(item);
  }
  const primaryAction = primaryActionFromTreeItem(item, sectionId);
  const includeNodeActions = shouldIncludeNodeActions(sectionId);

  const sectionActions = includeNodeActions
    ? getSectionActions(sectionId, item, commandArg)
    : [];
  const mergedActions = includeNodeActions
    ? dedupeActions([
      ...(primaryAction ? [primaryAction] : []),
      ...sectionActions
    ])
    : [];

  const childrenItems = getProviderChildren(provider, item);
  const children: ExplorerNode[] = childrenItems.map((child, index) =>
    buildNode(provider, child as ExplorerTreeItemLike, sectionId, `${pathId}/${index}`)
  );

  return {
    id: item.id || pathId,
    label,
    description,
    tooltip,
    contextValue: item.contextValue,
    statusIndicator: item.status?.indicator,
    statusDescription: item.status?.description,
    commandArg: isResourceLeaf ? commandArg : undefined,
    primaryAction,
    actions: mergedActions,
    children
  };
}

function buildSectionNodes(provider: ExplorerTreeProvider, sectionId: ExplorerTabId): ExplorerNode[] {
  const roots = getProviderChildren(provider);
  return roots.map((item, index) => buildNode(provider, item as ExplorerTreeItemLike, sectionId, `${sectionId}/${index}`));
}

function countNodes(nodes: ExplorerNode[], predicate: (node: ExplorerNode) => boolean): number {
  let total = 0;
  for (const node of nodes) {
    if (predicate(node)) {
      total += 1;
    }
    total += countNodes(node.children, predicate);
  }
  return total;
}

function countForSection(sectionId: ExplorerTabId, nodes: ExplorerNode[]): number {
  if (sectionId === 'resources') {
    return countNodes(nodes, node => RESOURCE_CONTEXT_VALUES.has(node.contextValue ?? ''));
  }

  const byContext: Partial<Record<ExplorerTabId, string>> = {
    dashboards: 'eda-dashboard',
    alarms: 'eda-alarm',
    deviations: 'eda-deviation',
    basket: 'basket-item',
    transactions: 'transaction',
    help: 'help-link'
  };

  const context = byContext[sectionId];
  if (!context) {
    return 0;
  }

  return countNodes(nodes, node => node.contextValue === context);
}

function toolbarActionsForSection(sectionId: ExplorerTabId): ExplorerAction[] {
  if (sectionId === 'resources') {
    return [createAction('vscode-eda.createResource', 'Create Resource')];
  }

  if (sectionId === 'deviations') {
    return [createAction('vscode-eda.rejectAllDeviations', 'Reject All Deviations')];
  }

  if (sectionId === 'basket') {
    return [
      createAction('vscode-eda.commitBasket', 'Commit Basket'),
      createAction('vscode-eda.dryRunBasket', 'Dry Run Basket'),
      createAction('vscode-eda.discardBasket', 'Discard Basket')
    ];
  }

  if (sectionId === 'transactions') {
    return [createAction('vscode-eda.setTransactionLimit', 'Set Transaction Limit')];
  }

  return [];
}

function buildSectionSnapshot(
  sectionId: ExplorerTabId,
  provider: ExplorerTreeProvider
): ExplorerSectionSnapshot {
  const nodes = buildSectionNodes(provider, sectionId);

  return {
    id: sectionId,
    label: EXPLORER_TAB_LABELS[sectionId],
    count: countForSection(sectionId, nodes),
    nodes,
    toolbarActions: toolbarActionsForSection(sectionId)
  };
}

export function buildExplorerSnapshot(
  providers: ExplorerSnapshotProviders,
  filterText: string
): ExplorerSnapshotMessage {
  const sections: ExplorerSectionSnapshot[] = EXPLORER_TAB_ORDER.map(sectionId => {
    if (sectionId === 'dashboards') {
      return buildSectionSnapshot(sectionId, providers.dashboardProvider);
    }
    if (sectionId === 'resources') {
      return buildSectionSnapshot(sectionId, providers.namespaceProvider);
    }
    if (sectionId === 'alarms') {
      return buildSectionSnapshot(sectionId, providers.alarmProvider);
    }
    if (sectionId === 'deviations') {
      return buildSectionSnapshot(sectionId, providers.deviationProvider);
    }
    if (sectionId === 'basket') {
      return buildSectionSnapshot(sectionId, providers.basketProvider);
    }
    if (sectionId === 'transactions') {
      return buildSectionSnapshot(sectionId, providers.transactionProvider);
    }
    return buildSectionSnapshot(sectionId, providers.helpProvider);
  });

  return {
    command: 'snapshot',
    filterText,
    sections
  };
}
