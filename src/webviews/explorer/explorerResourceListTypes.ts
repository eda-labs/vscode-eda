import type { ExplorerAction } from '../shared/explorer/types';

export type ExplorerResourceListViewKind =
  | 'resources'
  | 'alarms'
  | 'deviations'
  | 'basket'
  | 'transactions';

export interface ExplorerResourceListItemDetails {
  alarmSeverity?: string;
  alarmType?: string;
  alarmResource?: string;
  alarmLastChanged?: string;
  deviationStatus?: string;
  deviationPath?: string;
  deviationNodeEndpoint?: string;
  basketOperation?: string;
  basketResourceCount?: number;
  transactionId?: string;
  transactionUser?: string;
  transactionTimestamp?: string;
  transactionDryRun?: boolean;
  transactionSuccess?: boolean;
}

export interface ExplorerResourceListItemPayload {
  id: string;
  label: string;
  name: string;
  namespace: string;
  kind?: string;
  stream?: string;
  labels?: string;
  apiVersion?: string;
  state?: string;
  description?: string;
  statusDescription?: string;
  statusIndicator?: string;
  details?: ExplorerResourceListItemDetails;
  primaryAction?: ExplorerAction;
  actions: ExplorerAction[];
}

export interface ExplorerResourceListPayload {
  title: string;
  namespace: string;
  viewKind?: ExplorerResourceListViewKind;
  resources: ExplorerResourceListItemPayload[];
}

export interface ExplorerResourceListSetDataMessage {
  command: 'setData';
  payload: ExplorerResourceListPayload;
}

export interface ExplorerResourceListErrorMessage {
  command: 'error';
  message: string;
}

export type ExplorerResourceListIncomingMessage =
  | ExplorerResourceListSetDataMessage
  | ExplorerResourceListErrorMessage;

export interface ExplorerResourceListReadyMessage {
  command: 'ready';
}

export interface ExplorerResourceListInvokeCommandMessage {
  command: 'invokeCommand';
  commandId: string;
  args?: unknown[];
}

export type ExplorerResourceListOutgoingMessage =
  | ExplorerResourceListReadyMessage
  | ExplorerResourceListInvokeCommandMessage;
