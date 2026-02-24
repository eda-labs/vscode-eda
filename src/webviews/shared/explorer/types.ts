export type ExplorerTabId =
  | 'dashboards'
  | 'resources'
  | 'alarms'
  | 'deviations'
  | 'basket'
  | 'transactions'
  | 'help';

export const EXPLORER_TAB_ORDER: ExplorerTabId[] = [
  'dashboards',
  'resources',
  'alarms',
  'deviations',
  'basket',
  'transactions',
  'help'
];

export const EXPLORER_TAB_LABELS: Record<ExplorerTabId, string> = {
  dashboards: 'Dashboards',
  resources: 'Resources',
  alarms: 'Alarms',
  deviations: 'Deviations',
  basket: 'Basket',
  transactions: 'Transactions',
  help: 'Help'
};

export interface ExplorerAction {
  id: string;
  label: string;
  command: string;
  args?: unknown[];
}

export interface ExplorerNode {
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  contextValue?: string;
  statusIndicator?: string;
  statusDescription?: string;
  commandArg?: unknown;
  primaryAction?: ExplorerAction;
  actions: ExplorerAction[];
  children: ExplorerNode[];
}

export interface ExplorerSectionSnapshot {
  id: ExplorerTabId;
  label: string;
  count: number;
  nodes: ExplorerNode[];
  toolbarActions: ExplorerAction[];
}

export interface ExplorerSnapshotMessage {
  command: 'snapshot';
  filterText: string;
  sections: ExplorerSectionSnapshot[];
}

export interface ExplorerFilterStateMessage {
  command: 'filterState';
  filterText: string;
}

export interface ExplorerErrorMessage {
  command: 'error';
  message: string;
}

export interface ExplorerExpandAllResourcesMessage {
  command: 'expandAllResources';
}

export type ExplorerIncomingMessage =
  | ExplorerSnapshotMessage
  | ExplorerFilterStateMessage
  | ExplorerErrorMessage
  | ExplorerExpandAllResourcesMessage;

export interface ExplorerReadyMessage {
  command: 'ready';
}

export interface ExplorerSetFilterMessage {
  command: 'setFilter';
  value: string;
}

export interface ExplorerInvokeCommandMessage {
  command: 'invokeCommand';
  commandId: string;
  args?: unknown[];
}

export interface ExplorerRequestRefreshMessage {
  command: 'requestRefresh';
}

export interface ExplorerRenderMetricsMessage {
  command: 'renderMetrics';
  snapshotId: number;
  renderMs: number;
  totalNodes: number;
  resourceLeafCount: number;
}

export type ExplorerOutgoingMessage =
  | ExplorerReadyMessage
  | ExplorerSetFilterMessage
  | ExplorerInvokeCommandMessage
  | ExplorerRequestRefreshMessage
  | ExplorerRenderMetricsMessage;
