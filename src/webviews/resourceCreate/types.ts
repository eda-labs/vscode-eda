import type { EdaCrd } from '../../types';

export interface JsonSchemaNode {
  type?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  required?: string[];
  oneOf?: unknown[];
  anyOf?: unknown[];
  allOf?: unknown[];
  additionalProperties?: unknown;
}

export interface ResourceCreateInitMessage {
  command: 'init';
  uri: string;
  crd: EdaCrd;
  schema: JsonSchemaNode | null;
  resource: Record<string, unknown>;
  yaml: string;
}

export interface ResourceCreateYamlModelMessage {
  command: 'yamlModel';
  resource: Record<string, unknown>;
  yaml: string;
}

export interface ResourceCreateYamlErrorMessage {
  command: 'yamlError';
  error: string;
}

export type ResourceCreatePanelToWebviewMessage =
  | ResourceCreateInitMessage
  | ResourceCreateYamlModelMessage
  | ResourceCreateYamlErrorMessage;

export interface ResourceCreateReadyMessage {
  command: 'ready';
}

export interface ResourceCreateFormUpdateMessage {
  command: 'formUpdate';
  resource: Record<string, unknown>;
}

export interface ResourceCreateExecuteActionMessage {
  command: 'executeAction';
  action: 'commit' | 'dryRun' | 'basket';
}

export type ResourceCreateWebviewMessage =
  | ResourceCreateReadyMessage
  | ResourceCreateFormUpdateMessage
  | ResourceCreateExecuteActionMessage;
