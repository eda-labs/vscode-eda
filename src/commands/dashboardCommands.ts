import * as vscode from 'vscode';

import type { EdaAlarmProvider } from '../providers/views/alarmProvider';
import type { EdaDeviationProvider } from '../providers/views/deviationProvider';
import type { TransactionBasketProvider } from '../providers/views/transactionBasketProvider';
import type { EdaTransactionProvider } from '../providers/views/transactionProvider';
import type { TreeItemBase } from '../providers/views/treeItem';
import { namespaceSelectionService } from '../services/namespaceSelectionService';
import { ALL_NAMESPACES } from '../webviews/constants';
import type { ExplorerAction } from '../webviews/shared/explorer/types';
import type {
  ExplorerResourceListItemDetails,
  ExplorerResourceListItemPayload,
  ExplorerResourceListPayload,
  ExplorerResourceListViewKind
} from '../webviews/explorer/explorerResourceListTypes';

interface DashboardCommandProviders {
  alarmProvider: EdaAlarmProvider;
  deviationProvider: EdaDeviationProvider;
  basketProvider: TransactionBasketProvider;
  transactionProvider: EdaTransactionProvider;
}

interface DashboardTreeProvider {
  getChildren(element?: TreeItemBase): vscode.ProviderResult<TreeItemBase[]>;
  onDidChangeTreeData?: vscode.Event<TreeItemBase | undefined | null | void>;
}

interface AlarmLike {
  name?: string;
  type?: string;
  severity?: string;
  description?: string;
  resource?: string;
  lastChanged?: string;
  namespace?: string;
  'namespace.name'?: string;
  '.namespace.name'?: string;
}

interface DeviationLike {
  name?: string;
  status?: string;
  spec?: {
    path?: string;
    nodeEndpoint?: string;
  };
}

interface BasketTypeLike {
  create?: unknown;
  replace?: unknown;
  modify?: unknown;
  update?: unknown;
  patch?: unknown;
  delete?: unknown;
  [key: string]: unknown;
}

interface BasketLike {
  type?: BasketTypeLike;
  crs?: unknown[];
}

interface TransactionLike {
  id?: string | number;
  username?: string;
  state?: string;
  description?: string;
  lastChangeTimestamp?: string;
  dryRun?: boolean;
  success?: boolean;
}

const ALL_RESOURCE_NAMESPACES_VALUE = '__all_namespaces__';

function toExplorerNamespace(namespace: string): string {
  return namespace === ALL_NAMESPACES ? ALL_RESOURCE_NAMESPACES_VALUE : namespace;
}

function labelToText(label: string | vscode.TreeItemLabel): string {
  return typeof label === 'string' ? label : label.label;
}

function descriptionToText(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function createAction(command: string, label: string, args?: unknown[]): ExplorerAction {
  return {
    id: `${command}:${label}`,
    label,
    command,
    args
  };
}

function commandToAction(command: vscode.Command | undefined): ExplorerAction | undefined {
  if (!command?.command) {
    return undefined;
  }
  const label = command.title || 'Open';
  return createAction(command.command, label, command.arguments);
}

function getNamespaceFromItem(item: TreeItemBase): string {
  if (item.namespace) {
    return item.namespace;
  }

  const description = descriptionToText(item.description);
  if (!description) {
    return '';
  }

  const match = description.match(/\bns:\s*([^\s()]+)/i);
  if (!match || typeof match[1] !== 'string') {
    return '';
  }

  return match[1];
}

function getKindFromItem(item: TreeItemBase): string {
  const resourceKind = item.resource?.kind;
  if (resourceKind) {
    return resourceKind;
  }

  switch (item.contextValue) {
    case 'eda-alarm':
      return 'Alarm';
    case 'eda-deviation':
      return 'Deviation';
    case 'basket-item':
      return 'Basket Item';
    case 'transaction':
      return 'Transaction';
    default:
      return '';
  }
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

function getCommandObjectArgument(item: TreeItemBase): Record<string, unknown> | undefined {
  const firstArg = Array.isArray(item.command?.arguments) ? item.command.arguments[0] : undefined;
  if (!firstArg || typeof firstArg !== 'object' || Array.isArray(firstArg)) {
    return undefined;
  }
  return firstArg as Record<string, unknown>;
}

function getAlarmFromItem(item: TreeItemBase): AlarmLike | undefined {
  const arg = getCommandObjectArgument(item);
  if (!arg) {
    return undefined;
  }

  const hasAlarmFields = Boolean(
    nonEmptyString(arg.severity)
    || nonEmptyString(arg.type)
    || nonEmptyString(arg.resource)
    || nonEmptyString(arg.lastChanged)
  );

  return hasAlarmFields ? (arg as AlarmLike) : undefined;
}

function getDeviationFromItem(item: TreeItemBase): (DeviationLike & Record<string, unknown>) | undefined {
  const directDeviation = (item as { deviation?: unknown }).deviation;
  if (directDeviation && typeof directDeviation === 'object' && !Array.isArray(directDeviation)) {
    return directDeviation as DeviationLike & Record<string, unknown>;
  }

  const commandArg = getCommandObjectArgument(item);
  if (!commandArg) {
    return undefined;
  }
  return commandArg as DeviationLike & Record<string, unknown>;
}

function getBasketFromItem(item: TreeItemBase): BasketLike | undefined {
  const raw = item.resource?.raw;
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  return raw as BasketLike;
}

function getTransactionFromItem(item: TreeItemBase): TransactionLike | undefined {
  const raw = item.resource?.raw;
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  return raw as TransactionLike;
}

function getAlarmNamespace(alarm: AlarmLike | undefined, fallback: string): string {
  const ns = alarm?.['.namespace.name'] || alarm?.['namespace.name'] || alarm?.namespace;
  return nonEmptyString(ns) || fallback;
}

function getTransactionId(tx: TransactionLike | undefined, fallbackLabel: string): string {
  if (tx?.id !== undefined && tx?.id !== null) {
    return String(tx.id);
  }
  const prefix = fallbackLabel.split(' - ')[0];
  return nonEmptyString(prefix) || fallbackLabel;
}

function getTransactionUser(tx: TransactionLike | undefined, fallbackLabel: string): string | undefined {
  const direct = nonEmptyString(tx?.username);
  if (direct) {
    return direct;
  }

  const parts = fallbackLabel.split(' - ');
  if (parts.length < 2) {
    return undefined;
  }
  return nonEmptyString(parts.slice(1).join(' - '));
}

function getBasketOperation(item: TreeItemBase, basket: BasketLike | undefined): string | undefined {
  const description = descriptionToText(item.description);
  if (description && !description.includes('resource(s)')) {
    return description;
  }

  const type = basket?.type;
  if (!type || typeof type !== 'object') {
    return undefined;
  }

  const operation = Object.keys(type).find(key => Boolean((type as Record<string, unknown>)[key]));
  return nonEmptyString(operation);
}

function getBasketResourceCount(item: TreeItemBase, basket: BasketLike | undefined): number | undefined {
  if (Array.isArray(basket?.crs)) {
    return basket.crs.length;
  }

  const description = descriptionToText(item.description);
  if (!description) {
    return basket?.type ? 1 : undefined;
  }

  const match = description.match(/(\d+)\s+resource\(s\)/i);
  if (!match) {
    return basket?.type ? 1 : undefined;
  }

  const count = Number.parseInt(match[1], 10);
  return Number.isNaN(count) ? undefined : count;
}

function deriveStatusIndicator(text: string | undefined): string | undefined {
  const normalized = nonEmptyString(text)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized.includes('fail') || normalized.includes('error') || normalized.includes('reject')) {
    return 'red';
  }
  if (
    normalized.includes('warn')
    || normalized.includes('pending')
    || normalized.includes('processing')
    || normalized.includes('drift')
  ) {
    return 'yellow';
  }
  if (
    normalized.includes('accept')
    || normalized.includes('success')
    || normalized.includes('resolved')
    || normalized.includes('complete')
  ) {
    return 'green';
  }
  return undefined;
}

function getBasketIndexFromItem(item: TreeItemBase): number | undefined {
  const basketIndex = (item as { basketIndex?: number }).basketIndex;
  return typeof basketIndex === 'number' ? basketIndex : undefined;
}

function buildTransactionCommandArg(item: TreeItemBase): Record<string, unknown> {
  const arg: Record<string, unknown> = {
    label: labelToText(item.label)
  };

  if (item.resource?.raw) {
    arg.resource = {
      raw: item.resource.raw
    };
  }

  return arg;
}

function buildAdditionalActions(item: TreeItemBase): ExplorerAction[] {
  if (item.contextValue === 'eda-deviation') {
    const deviation = getDeviationFromItem(item);
    if (!deviation) {
      return [];
    }
    return [
      createAction('vscode-eda.acceptDeviation', 'Accept Deviation', [{ deviation }]),
      createAction('vscode-eda.rejectDeviation', 'Reject Deviation', [{ deviation }])
    ];
  }

  if (item.contextValue === 'basket-item') {
    const basketIndex = getBasketIndexFromItem(item);
    if (basketIndex === undefined) {
      return [];
    }
    return [
      createAction('vscode-eda.editBasketItem', 'Edit Basket Item', [{ basketIndex }]),
      createAction('vscode-eda.removeBasketItem', 'Remove Basket Item', [{ basketIndex }])
    ];
  }

  if (item.contextValue === 'transaction') {
    const transactionArg = buildTransactionCommandArg(item);
    return [
      createAction('vscode-eda.revertTransaction', 'Revert Transaction', [transactionArg]),
      createAction('vscode-eda.restoreTransaction', 'Restore Transaction', [transactionArg])
    ];
  }

  return [];
}

function buildAlarmItemDetails(item: TreeItemBase): ExplorerResourceListItemDetails | undefined {
  const alarm = getAlarmFromItem(item);
  if (!alarm) {
    return undefined;
  }
  return {
    alarmSeverity: nonEmptyString(alarm.severity),
    alarmType: nonEmptyString(alarm.type),
    alarmResource: nonEmptyString(alarm.resource),
    alarmLastChanged: nonEmptyString(alarm.lastChanged)
  };
}

function buildDeviationItemDetails(item: TreeItemBase): ExplorerResourceListItemDetails | undefined {
  const deviation = getDeviationFromItem(item);
  if (!deviation) {
    return undefined;
  }
  const spec = (deviation.spec && typeof deviation.spec === 'object')
    ? (deviation.spec as { path?: unknown; nodeEndpoint?: unknown })
    : undefined;
  return {
    deviationStatus: nonEmptyString(deviation.status),
    deviationPath: nonEmptyString(spec?.path),
    deviationNodeEndpoint: nonEmptyString(spec?.nodeEndpoint)
  };
}

function buildBasketItemDetails(item: TreeItemBase): ExplorerResourceListItemDetails {
  const basket = getBasketFromItem(item);
  return {
    basketOperation: getBasketOperation(item, basket),
    basketResourceCount: getBasketResourceCount(item, basket)
  };
}

function buildTransactionItemDetails(item: TreeItemBase): ExplorerResourceListItemDetails {
  const tx = getTransactionFromItem(item);
  const fallbackLabel = labelToText(item.label);
  return {
    transactionId: getTransactionId(tx, fallbackLabel),
    transactionUser: getTransactionUser(tx, fallbackLabel),
    transactionTimestamp: nonEmptyString(tx?.lastChangeTimestamp),
    transactionDryRun: typeof tx?.dryRun === 'boolean' ? tx.dryRun : undefined,
    transactionSuccess: typeof tx?.success === 'boolean' ? tx.success : undefined
  };
}

function buildItemDetails(item: TreeItemBase, viewKind: ExplorerResourceListViewKind): ExplorerResourceListItemDetails | undefined {
  switch (viewKind) {
    case 'alarms':
      return buildAlarmItemDetails(item);
    case 'deviations':
      return buildDeviationItemDetails(item);
    case 'basket':
      return buildBasketItemDetails(item);
    case 'transactions':
      return buildTransactionItemDetails(item);
    default:
      return undefined;
  }
}

async function getProviderChildren(provider: DashboardTreeProvider, element?: TreeItemBase): Promise<TreeItemBase[]> {
  const result = await Promise.resolve(provider.getChildren(element));
  if (!Array.isArray(result)) {
    return [];
  }
  return result;
}

async function collectLeafItems(provider: DashboardTreeProvider): Promise<TreeItemBase[]> {
  const leaves: TreeItemBase[] = [];
  const visit = async (nodes: TreeItemBase[]): Promise<void> => {
    for (const node of nodes) {
      const children = await getProviderChildren(provider, node);
      if (children.length === 0) {
        leaves.push(node);
        continue;
      }
      await visit(children);
    }
  };

  const roots = await getProviderChildren(provider);
  await visit(roots);

  return leaves;
}

function isNonResourceItem(contextValue: string): boolean {
  return contextValue === 'info' || contextValue === 'message' || contextValue === 'dashboard-empty';
}

function getAlarmForView(item: TreeItemBase, viewKind: ExplorerResourceListViewKind): AlarmLike | undefined {
  return viewKind === 'alarms' ? getAlarmFromItem(item) : undefined;
}

function getTransactionForView(item: TreeItemBase, viewKind: ExplorerResourceListViewKind): TransactionLike | undefined {
  return viewKind === 'transactions' ? getTransactionFromItem(item) : undefined;
}

function resolveResourceName(
  viewKind: ExplorerResourceListViewKind,
  label: string,
  alarm: AlarmLike | undefined,
  details: ExplorerResourceListItemDetails | undefined
): string {
  if (viewKind === 'alarms') {
    return nonEmptyString(alarm?.name) || label;
  }
  if (viewKind === 'transactions') {
    return details?.transactionId || label;
  }
  return label;
}

function resolveResourceNamespace(
  item: TreeItemBase,
  viewKind: ExplorerResourceListViewKind,
  alarm: AlarmLike | undefined
): string {
  const fallbackNamespace = getNamespaceFromItem(item);
  if (viewKind === 'alarms') {
    return getAlarmNamespace(alarm, fallbackNamespace);
  }
  if (viewKind === 'transactions') {
    return '';
  }
  return fallbackNamespace;
}

function resolveResourceKind(item: TreeItemBase, viewKind: ExplorerResourceListViewKind): string | undefined {
  if (viewKind === 'alarms') {
    return 'Alarm';
  }
  return getKindFromItem(item) || undefined;
}

function resolveResourceState(
  viewKind: ExplorerResourceListViewKind,
  details: ExplorerResourceListItemDetails | undefined,
  statusDescription: string | undefined,
  description: string | undefined,
  transaction: TransactionLike | undefined
): string | undefined {
  const fallbackState = statusDescription || description;
  if (viewKind === 'alarms') {
    return details?.alarmSeverity || fallbackState;
  }
  if (viewKind === 'deviations') {
    return details?.deviationStatus || fallbackState;
  }
  if (viewKind === 'transactions') {
    return nonEmptyString(transaction?.state) || fallbackState;
  }
  return fallbackState;
}

function resolveResourceStream(item: TreeItemBase, viewKind: ExplorerResourceListViewKind): string | undefined {
  if (viewKind !== 'resources') {
    return undefined;
  }
  return item.resourceType || item.streamGroup;
}

function resolveResourceApiVersion(item: TreeItemBase, viewKind: ExplorerResourceListViewKind): string | undefined {
  if (viewKind !== 'resources') {
    return undefined;
  }
  return item.resource?.apiVersion;
}

function toResourceListItem(
  item: TreeItemBase,
  index: number,
  viewKind: ExplorerResourceListViewKind
): ExplorerResourceListItemPayload | undefined {
  const contextValue = item.contextValue ?? '';
  if (isNonResourceItem(contextValue)) {
    return undefined;
  }

  const label = labelToText(item.label);
  const description = descriptionToText(item.description) || undefined;
  const statusDescription = item.status?.description;
  const details = buildItemDetails(item, viewKind);
  const alarm = getAlarmForView(item, viewKind);
  const transaction = getTransactionForView(item, viewKind);
  const state = resolveResourceState(viewKind, details, statusDescription, description, transaction);
  const statusIndicator = item.status?.indicator || deriveStatusIndicator(state);

  return {
    id: item.id || `dashboard-row:${index}:${label}`,
    label,
    name: resolveResourceName(viewKind, label, alarm, details),
    namespace: resolveResourceNamespace(item, viewKind, alarm),
    kind: resolveResourceKind(item, viewKind),
    stream: resolveResourceStream(item, viewKind),
    apiVersion: resolveResourceApiVersion(item, viewKind),
    state: state || undefined,
    description,
    statusDescription,
    statusIndicator,
    details,
    primaryAction: commandToAction(item.command),
    actions: buildAdditionalActions(item)
  };
}

async function buildProviderResourceListPayload(
  title: string,
  provider: DashboardTreeProvider,
  viewKind: ExplorerResourceListViewKind
): Promise<ExplorerResourceListPayload> {
  const selectedNamespace = namespaceSelectionService.getSelectedNamespace();
  const applyNamespaceFilter = selectedNamespace !== ALL_NAMESPACES && viewKind !== 'transactions';
  const items = await collectLeafItems(provider);
  const allResources = items
    .map((item, index) => toResourceListItem(item, index, viewKind))
    .filter((item): item is ExplorerResourceListItemPayload => Boolean(item));
  const resources = applyNamespaceFilter
    ? allResources.filter(item => item.namespace === selectedNamespace)
    : allResources;

  return {
    title,
    namespace: toExplorerNamespace(selectedNamespace),
    viewKind,
    resources
  };
}

async function openProviderResourceList(
  context: vscode.ExtensionContext,
  title: string,
  provider: DashboardTreeProvider,
  viewKind: ExplorerResourceListViewKind
): Promise<void> {
  const payload = await buildProviderResourceListPayload(title, provider, viewKind);
  const dataSource = {
    loadPayload: () => buildProviderResourceListPayload(title, provider, viewKind),
    onDidChangeData: ((listener, thisArgs, disposables) => {
      const invoke = () => listener.call(thisArgs, undefined);
      const subscriptions: vscode.Disposable[] = [
        namespaceSelectionService.onDidChangeSelection(() => {
          invoke();
        })
      ];
      if (provider.onDidChangeTreeData) {
        subscriptions.push(provider.onDidChangeTreeData(() => {
          invoke();
        }));
      }
      const composite = new vscode.Disposable(() => {
        for (const subscription of subscriptions) {
          subscription.dispose();
        }
      });
      if (Array.isArray(disposables)) {
        disposables.push(composite);
      }
      return composite;
    }) as vscode.Event<unknown>
  };

  const { ExplorerResourceListPanel } = await import('../webviews/explorer/explorerResourceListPanel');
  ExplorerResourceListPanel.show(context, payload, dataSource);
}

export function registerDashboardCommands(
  context: vscode.ExtensionContext,
  providers: DashboardCommandProviders
): void {
  const cmd = vscode.commands.registerCommand('vscode-eda.showDashboard', async (name: string) => {
    try {
      if (name === 'Alarms') {
        await openProviderResourceList(context, 'Alarms', providers.alarmProvider, 'alarms');
      } else if (name === 'Deviations') {
        await openProviderResourceList(context, 'Deviations', providers.deviationProvider, 'deviations');
      } else if (name === 'Basket') {
        await openProviderResourceList(context, 'Basket', providers.basketProvider, 'basket');
      } else if (name === 'Transactions') {
        await openProviderResourceList(context, 'Transactions', providers.transactionProvider, 'transactions');
      } else if (name === 'Queries') {
        const { QueriesDashboardPanel } = await import('../webviews/dashboard/queries/queriesDashboardPanel');
        QueriesDashboardPanel.show(context, name);
      } else if (name === 'Nodes') {
        const { ToponodesDashboardPanel } = await import('../webviews/dashboard/toponodes/toponodesDashboard');
        ToponodesDashboardPanel.show(context, name);
      } else if (name === 'Pods') {
        const { PodsDashboardPanel } = await import('../webviews/dashboard/pods/podsDashboard');
        PodsDashboardPanel.show(context, name);
      } else if (name === 'Simnodes') {
        const { SimnodesDashboardPanel } = await import('../webviews/dashboard/simnodes/simnodesDashboard');
        SimnodesDashboardPanel.show(context, name);
      } else if (name === 'Topology') {
        const { TopologyFlowDashboardPanel } = await import('../webviews/dashboard/topologyFlow/topologyFlowDashboardPanel');
        TopologyFlowDashboardPanel.show(context, name);
      } else if (name === 'Topo Builder') {
        const { TopoBuilderDashboardPanel } = await import('../webviews/dashboard/topobuilder/topobuilderDashboardPanel');
        TopoBuilderDashboardPanel.show(context, name);
      } else if (name === 'Resource Browser') {
        const { ResourceBrowserPanel } = await import('../webviews/dashboard/resource/resourceBrowserPanel');
        ResourceBrowserPanel.show(context, name);
      } else if (name === 'Workflows') {
        const { WorkflowsDashboardPanel } = await import('../webviews/dashboard/workflows/workflowsDashboard');
        WorkflowsDashboardPanel.show(context, name);
      } else {
        const { FabricDashboardPanel } = await import('../webviews/dashboard/fabric/fabricDashboardPanel');
        await FabricDashboardPanel.show(context, name || 'Fabric');
      }
    } catch (error: unknown) {
      console.error('Failed to show dashboard:', error);
    }
  });
  context.subscriptions.push(cmd);
}
