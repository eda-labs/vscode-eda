import * as vscode from 'vscode';

import type { TreeItemBase } from '../providers/views/treeItem';
import type { ExplorerAction } from '../webviews/shared/explorer/types';
import type {
  ExplorerResourceListItemPayload,
  ExplorerResourceListPayload,
  ExplorerResourceListViewKind
} from '../webviews/explorer/explorerResourceListTypes';

const ALL_RESOURCE_NAMESPACES_VALUE = '__all_namespaces__';
const CONTEXT_STREAM = 'stream';
const CONTEXT_RESOURCE_CATEGORY = 'resource-category';
const CONTEXT_MESSAGE = 'message';
const CONTEXT_INFO = 'info';
const CMD_VIEW_STREAM_ITEM = 'vscode-eda.viewStreamItem';
const CMD_VIEW_RESOURCE = 'vscode-eda.viewResource';
const CMD_EDIT_RESOURCE = 'vscode-eda.switchToEditResource';
const CMD_DELETE_RESOURCE = 'vscode-eda.deleteResource';
const LABEL_EDIT_RESOURCE = 'Switch To Edit Mode';
const LABEL_DELETE_RESOURCE = 'Delete Resource';

interface ResourceTreeProvider {
  getChildren(element?: TreeItemBase): vscode.ProviderResult<TreeItemBase[]>;
  onDidChangeTreeData?: vscode.Event<TreeItemBase | undefined | null | void>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function labelToText(value: string | vscode.TreeItemLabel): string {
  return typeof value === 'string' ? value : value.label;
}

function isResourceListViewKind(value: unknown): value is ExplorerResourceListViewKind {
  return value === 'resources'
    || value === 'alarms'
    || value === 'deviations'
    || value === 'basket'
    || value === 'transactions';
}

function getNonEmptyString(holder: Record<string, unknown>, key: string): string | undefined {
  const value = holder[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

function normalizeAction(value: unknown, index: number): ExplorerAction | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const command = typeof value.command === 'string' ? value.command : '';
  if (!command) {
    return undefined;
  }

  const label = typeof value.label === 'string' && value.label
    ? value.label
    : command;
  const id = typeof value.id === 'string' && value.id
    ? value.id
    : `${command}:${index}`;
  const args = Array.isArray(value.args) ? value.args : undefined;

  return {
    id,
    label,
    command,
    args
  };
}

function normalizeResourceItem(value: unknown, index: number): ExplorerResourceListItemPayload | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const id = getNonEmptyString(value, 'id') ?? `resource:${index}`;
  const label = getNonEmptyString(value, 'label') ?? id;
  const name = getNonEmptyString(value, 'name') ?? label;
  const namespace = getNonEmptyString(value, 'namespace') ?? '';
  const kind = getNonEmptyString(value, 'kind');
  const stream = getNonEmptyString(value, 'stream');
  const labels = getNonEmptyString(value, 'labels');
  const apiVersion = getNonEmptyString(value, 'apiVersion');
  const state = getNonEmptyString(value, 'state');

  const description = getNonEmptyString(value, 'description');
  const statusDescription = getNonEmptyString(value, 'statusDescription');
  const statusIndicator = getNonEmptyString(value, 'statusIndicator');

  const primaryAction = normalizeAction(value.primaryAction, -1);
  const actions = Array.isArray(value.actions)
    ? value.actions
      .map((action, actionIndex) => normalizeAction(action, actionIndex))
      .filter((action): action is ExplorerAction => Boolean(action))
    : [];

  return {
    id,
    label,
    name,
    namespace,
    kind,
    stream,
    labels,
    apiVersion,
    state,
    description,
    statusDescription,
    statusIndicator,
    primaryAction,
    actions
  };
}

function normalizePayload(value: unknown): ExplorerResourceListPayload | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const title = typeof value.title === 'string' && value.title
    ? value.title
    : 'Resources';
  const namespace = typeof value.namespace === 'string' && value.namespace
    ? value.namespace
    : ALL_RESOURCE_NAMESPACES_VALUE;
  const viewKind = isResourceListViewKind(value.viewKind) ? value.viewKind : undefined;
  const sourceNodeId = getNonEmptyString(value, 'sourceNodeId');
  const sourceNodeContext = value.sourceNodeContext === CONTEXT_STREAM
    || value.sourceNodeContext === CONTEXT_RESOURCE_CATEGORY
    ? value.sourceNodeContext
    : undefined;

  const resources = Array.isArray(value.resources)
    ? value.resources
      .map((resource, index) => normalizeResourceItem(resource, index))
      .filter((resource): resource is ExplorerResourceListItemPayload => Boolean(resource))
    : [];

  return {
    title,
    namespace,
    viewKind,
    sourceNodeId,
    sourceNodeContext,
    resources
  };
}

function descriptionToText(value: string | boolean | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

function normalizeLookupSegment(value: string | undefined): string {
  return (value || '').trim();
}

function makeSortKey(namespace: string, name: string): string {
  return `${namespace.toLowerCase()}\u0000${name.toLowerCase()}`;
}

function commandToAction(command: vscode.Command | undefined): ExplorerAction | undefined {
  if (!command?.command) {
    return undefined;
  }

  const args = Array.isArray(command.arguments) ? command.arguments : undefined;
  return {
    id: `${command.command}:${command.title || 'Open'}`,
    label: command.title || 'Open',
    command: command.command,
    args
  };
}

function createAction(command: string, label: string, args?: unknown[]): ExplorerAction {
  return {
    id: `${command}:${label}`,
    label,
    command,
    args
  };
}

function dedupeActions(actions: ExplorerAction[]): ExplorerAction[] {
  const seen = new Set<string>();
  const unique: ExplorerAction[] = [];
  for (const action of actions) {
    const key = `${action.command}:${action.label}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(action);
  }
  return unique;
}

function formatLabels(item: TreeItemBase): string | undefined {
  const labels = item.resource?.raw?.metadata?.labels;
  if (!labels || typeof labels !== 'object') {
    return undefined;
  }
  const entries = Object.entries(labels)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  if (entries.length === 0) {
    return undefined;
  }
  return entries.map(([key, value]) => `${key}=${value}`).join('\n');
}

function resolveNamespace(item: TreeItemBase): string {
  return item.namespace || item.resource?.namespace || '';
}

function resolveName(item: TreeItemBase): string {
  const fromResource = item.resource?.name;
  if (fromResource) {
    return fromResource;
  }
  const label = labelToText(item.label);
  const slash = label.indexOf('/');
  if (slash >= 0 && slash < label.length - 1) {
    return label.slice(slash + 1);
  }
  return label;
}

function resolveStatusDescription(item: TreeItemBase): string | undefined {
  return item.status?.description || descriptionToText(item.description);
}

function getNodeDetails(raw: unknown): string | undefined {
  const status = raw && typeof raw === 'object' && 'status' in raw
    ? (raw.status as Record<string, unknown> | undefined)
    : undefined;
  const value = status?.['node-details'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function buildResourceCommandArgument(item: TreeItemBase): Record<string, unknown> {
  const label = labelToText(item.label);
  const name = resolveName(item);
  const namespace = resolveNamespace(item);
  const kind = item.resource?.kind ?? item.resourceType ?? 'Resource';
  const apiVersion = item.resource?.apiVersion;
  const raw = item.resource?.raw;

  const arg: Record<string, unknown> = {
    label,
    namespace,
    resourceType: item.resourceType,
    streamGroup: item.streamGroup,
    contextValue: item.contextValue,
    name,
    kind,
    apiVersion
  };

  const labelsText = formatLabels(item);
  if (labelsText) {
    arg.labelsText = labelsText;
  }

  const nodeDetails = getNodeDetails(raw);
  if (nodeDetails) {
    arg.nodeDetails = nodeDetails;
  }

  arg.resource = {
    name,
    namespace,
    kind,
    apiVersion,
    uid: item.resource?.uid
  };

  return arg;
}

function buildResourceActions(contextValue: string | undefined, commandArg: Record<string, unknown>): ExplorerAction[] {
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

  return common;
}

function isResourceTreeItem(item: TreeItemBase): boolean {
  if (item.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
    return false;
  }
  if (item.contextValue === CONTEXT_MESSAGE || item.contextValue === CONTEXT_INFO) {
    return false;
  }
  return typeof item.resourceType === 'string' && item.resourceType.length > 0;
}

async function getProviderChildren(provider: ResourceTreeProvider, element?: TreeItemBase): Promise<TreeItemBase[]> {
  const result = await Promise.resolve(provider.getChildren(element));
  if (!Array.isArray(result)) {
    return [];
  }
  return result;
}

function makeVisitKey(item: TreeItemBase): string {
  if (typeof item.id === 'string' && item.id.length > 0) {
    return item.id;
  }
  return [
    item.contextValue || '',
    labelToText(item.label),
    item.namespace || '',
    item.resourceType || ''
  ].join('|');
}

async function findNodeById(provider: ResourceTreeProvider, nodeId: string): Promise<TreeItemBase | undefined> {
  const stack = await getProviderChildren(provider);
  const visited = new Set<string>();

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }

    const currentId = typeof node.id === 'string' ? node.id : '';
    if (currentId === nodeId) {
      return node;
    }

    const visitKey = makeVisitKey(node);
    if (visited.has(visitKey)) {
      continue;
    }
    visited.add(visitKey);

    const children = await getProviderChildren(provider, node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }

  return undefined;
}

async function collectStreamItems(provider: ResourceTreeProvider, streamNode: TreeItemBase): Promise<TreeItemBase[]> {
  const children = await getProviderChildren(provider, streamNode);
  return children.filter(isResourceTreeItem);
}

async function collectCategoryItems(provider: ResourceTreeProvider, categoryNode: TreeItemBase): Promise<TreeItemBase[]> {
  const resources: TreeItemBase[] = [];
  const streams = await getProviderChildren(provider, categoryNode);
  for (const streamNode of streams) {
    if (streamNode.contextValue !== CONTEXT_STREAM) {
      continue;
    }
    resources.push(...(await collectStreamItems(provider, streamNode)));
  }
  return resources;
}

async function collectTrackedStreamItems(
  provider: ResourceTreeProvider,
  trackedStreams: ReadonlySet<string>
): Promise<TreeItemBase[]> {
  if (trackedStreams.size === 0) {
    return [];
  }

  const resources: TreeItemBase[] = [];
  const stack = await getProviderChildren(provider);
  const visited = new Set<string>();

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }

    const visitKey = makeVisitKey(node);
    if (visited.has(visitKey)) {
      continue;
    }
    visited.add(visitKey);

    if (node.contextValue === CONTEXT_STREAM && trackedStreams.has(labelToText(node.label))) {
      resources.push(...(await collectStreamItems(provider, node)));
      continue;
    }

    const children = await getProviderChildren(provider, node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }

  return resources;
}

async function collectCurrentResources(
  provider: ResourceTreeProvider,
  payload: ExplorerResourceListPayload
): Promise<TreeItemBase[]> {
  if (payload.sourceNodeId && payload.sourceNodeContext) {
    const selectedNode = await findNodeById(provider, payload.sourceNodeId);
    if (!selectedNode) {
      return [];
    }

    if (payload.sourceNodeContext === CONTEXT_STREAM) {
      return collectStreamItems(provider, selectedNode);
    }

    return collectCategoryItems(provider, selectedNode);
  }

  const trackedStreams = new Set(
    payload.resources
      .map(resource => normalizeLookupSegment(resource.stream))
      .filter(stream => stream.length > 0)
  );
  return collectTrackedStreamItems(provider, trackedStreams);
}

function toResourceListItem(
  item: TreeItemBase,
  index: number,
  existingById: Map<string, ExplorerResourceListItemPayload>
): ExplorerResourceListItemPayload {
  const existing = typeof item.id === 'string' ? existingById.get(item.id) : undefined;
  const commandArg = buildResourceCommandArgument(item);
  const generatedActions = buildResourceActions(item.contextValue, commandArg);
  const mergedActions = dedupeActions([
    ...(existing?.actions || []),
    ...generatedActions
  ]);
  const generatedPrimaryAction = mergedActions.find(action => action.command === CMD_VIEW_RESOURCE)
    || mergedActions[0];

  const id = typeof item.id === 'string' && item.id.length > 0
    ? item.id
    : `live-resource:${index}:${labelToText(item.label)}`;
  const label = labelToText(item.label);
  const name = resolveName(item);
  const namespace = resolveNamespace(item);
  const kind = item.resource?.kind;
  const stream = item.resourceType;
  const apiVersion = item.resource?.apiVersion;
  const statusDescription = resolveStatusDescription(item);

  return {
    id,
    label,
    name,
    namespace,
    kind,
    stream,
    labels: formatLabels(item),
    apiVersion,
    state: statusDescription,
    description: descriptionToText(item.description) || statusDescription,
    statusDescription,
    statusIndicator: item.status?.indicator,
    primaryAction: existing?.primaryAction || generatedPrimaryAction || commandToAction(item.command),
    actions: mergedActions
  };
}

function sortResourceItems(resources: ExplorerResourceListItemPayload[]): ExplorerResourceListItemPayload[] {
  return resources.slice().sort((left, right) => {
    const leftKey = makeSortKey(left.namespace, left.name);
    const rightKey = makeSortKey(right.namespace, right.name);
    if (leftKey !== rightKey) {
      return leftKey.localeCompare(rightKey);
    }
    return left.id.localeCompare(right.id);
  });
}

async function buildLivePayload(
  provider: ResourceTreeProvider,
  payload: ExplorerResourceListPayload
): Promise<ExplorerResourceListPayload> {
  const currentItems = await collectCurrentResources(provider, payload);
  const existingById = new Map(
    payload.resources.map(resource => [resource.id, resource] as const)
  );
  const resources = sortResourceItems(
    currentItems.map((item, index) => toResourceListItem(item, index, existingById))
  );

  return {
    ...payload,
    resources
  };
}

function createLiveDataSource(
  payload: ExplorerResourceListPayload,
  provider?: ResourceTreeProvider
): {
  loadPayload: () => Promise<ExplorerResourceListPayload>;
  onDidChangeData: vscode.Event<unknown>;
} | undefined {
  if (!provider?.onDidChangeTreeData) {
    return undefined;
  }

  return {
    loadPayload: () => buildLivePayload(provider, payload),
    onDidChangeData: provider.onDidChangeTreeData as vscode.Event<unknown>
  };
}

export function registerExplorerResourceListCommand(
  context: vscode.ExtensionContext,
  provider?: ResourceTreeProvider
): void {
  const command = vscode.commands.registerCommand('vscode-eda.openExplorerResourceList', async (value: unknown) => {
    const payload = normalizePayload(value);
    if (!payload) {
      return;
    }

    const { ExplorerResourceListPanel } = await import('../webviews/explorer/explorerResourceListPanel');
    const dataSource = createLiveDataSource(payload, provider);
    if (!dataSource) {
      ExplorerResourceListPanel.show(context, payload);
      return;
    }

    try {
      const initialPayload = await dataSource.loadPayload();
      ExplorerResourceListPanel.show(context, initialPayload, dataSource);
    } catch {
      ExplorerResourceListPanel.show(context, payload, dataSource);
    }
  });

  context.subscriptions.push(command);
}
