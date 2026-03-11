import * as vscode from 'vscode';

import type { ExplorerAction } from '../webviews/shared/explorer/types';
import type {
  ExplorerResourceListItemPayload,
  ExplorerResourceListPayload
} from '../webviews/explorer/explorerResourceListTypes';

const ALL_RESOURCE_NAMESPACES_VALUE = '__all_namespaces__';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

  const resources = Array.isArray(value.resources)
    ? value.resources
      .map((resource, index) => normalizeResourceItem(resource, index))
      .filter((resource): resource is ExplorerResourceListItemPayload => Boolean(resource))
    : [];

  return {
    title,
    namespace,
    resources
  };
}

export function registerExplorerResourceListCommand(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand('vscode-eda.openExplorerResourceList', async (value: unknown) => {
    const payload = normalizePayload(value);
    if (!payload) {
      return;
    }

    const { ExplorerResourceListPanel } = await import('../webviews/explorer/explorerResourceListPanel');
    ExplorerResourceListPanel.show(context, payload);
  });

  context.subscriptions.push(command);
}
