import type { ExplorerAction } from '../shared/explorer/types';

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
  primaryAction?: ExplorerAction;
  actions: ExplorerAction[];
}

export interface ExplorerResourceListPayload {
  title: string;
  namespace: string;
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
