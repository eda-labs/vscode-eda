// src/utils/hostScope.ts
//
// Helpers for the per-host EDA target scope. Targets are bucketed by where VS
// Code is running (local, attached over SSH, WSL, dev-container, ...) so the
// URLs and Kubernetes contexts that make sense from one machine don't leak
// into the picker on another.
import * as os from 'os';
// Use CommonJS-style import so `vscode` references the live module object.
// `import * as vscode` would go through `__importStar` and give us a frozen
// snapshot at import time — tests that mutate the mock's `env` after require
// would not be visible to this module's reads.
import vscode = require('vscode');

import type { EdaTargetValue } from '../extension';

export const LOCAL_SCOPE = 'local';

export type EdaTargetsByScope = Record<string, Record<string, EdaTargetValue>>;

function sanitizeHostname(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

/**
 * Return the scope key for the current host. When VS Code is attached to a
 * remote (SSH, WSL, dev-container, ...) we use `remoteName` plus the extension
 * host's own hostname — that uniquely identifies the machine the extension
 * is running on, which is what targets actually need to reach.
 *
 * We deliberately do NOT touch `vscode.env.remoteAuthority`: that field is a
 * proposed API ("resolvers") and reading it throws for non-proposed
 * extensions ("CANNOT use API proposal: resolvers").
 */
export function getCurrentScope(): string {
  const env = (vscode.env ?? {}) as Partial<typeof vscode.env>;
  const remoteName = env.remoteName;
  if (remoteName) {
    return `${remoteName}+${sanitizeHostname(os.hostname())}`;
  }
  return LOCAL_SCOPE;
}

/**
 * Friendly label for a scope key. Used in the wizard header and the switch
 * QuickPick so the user knows which bucket they're editing.
 */
export function getScopeLabel(scope: string): string {
  if (scope === LOCAL_SCOPE) {
    return 'Local';
  }
  const plusIdx = scope.indexOf('+');
  if (plusIdx > 0) {
    const kind = scope.slice(0, plusIdx);
    const rest = scope.slice(plusIdx + 1);
    switch (kind) {
      case 'ssh-remote':
        return `SSH: ${rest}`;
      case 'wsl':
        return `WSL: ${rest}`;
      case 'dev-container':
      case 'attached-container':
        return `Container: ${rest}`;
      case 'codespaces':
        return `Codespace: ${rest}`;
      case 'tunnel':
        return `Tunnel: ${rest}`;
      default:
        return `${kind}: ${rest}`;
    }
  }
  return scope;
}

/**
 * True when the persisted `edaTargets` object is the new bucketed shape
 * (top-level keys are scope identifiers, values are target maps).
 *
 * We detect the legacy flat shape by looking at the first level: in the new
 * shape the values are plain objects whose own values describe targets; in
 * the legacy shape the values are either strings (legacy context-only form)
 * or target objects with fields like `edaUsername`. URLs always start with
 * `http://` / `https://`, so any top-level key starting with that is also a
 * strong legacy signal.
 */
export function isScopedTargetsShape(raw: unknown): raw is EdaTargetsByScope {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) {
    return true;
  }
  for (const [key, value] of entries) {
    if (key.startsWith('http://') || key.startsWith('https://')) {
      return false;
    }
    if (typeof value === 'string' || value === null || value === undefined) {
      return false;
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    if (hasTargetFieldShape(value as Record<string, unknown>)) {
      return false;
    }
  }
  return true;
}

const TARGET_FIELD_NAMES = new Set([
  'context',
  'edaUsername',
  'edaPassword',
  'kcUsername',
  'kcPassword',
  'skipTlsVerify',
  'coreNamespace'
]);

function hasTargetFieldShape(obj: Record<string, unknown>): boolean {
  for (const key of Object.keys(obj)) {
    if (TARGET_FIELD_NAMES.has(key)) {
      return true;
    }
  }
  return false;
}

/**
 * Convert whatever is persisted under `edaTargets` to the scoped shape.
 * Legacy flat entries go into the current scope's bucket — that's the host
 * they were just read from, which is the closest thing to "where they apply".
 * Users who need the same target from a different host can re-add it there
 * or use the import/export commands. Returns `{scoped, migrated}` so the
 * caller can decide whether to write back.
 */
export function normalizeTargetsShape(
  raw: unknown,
  currentScope: string
): { scoped: EdaTargetsByScope; migrated: boolean } {
  if (isScopedTargetsShape(raw)) {
    return { scoped: { ...(raw as EdaTargetsByScope) }, migrated: false };
  }
  const scoped: EdaTargetsByScope = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    scoped[currentScope] = { ...(raw as Record<string, EdaTargetValue>) };
  } else {
    scoped[currentScope] = {};
  }
  return { scoped, migrated: true };
}

/**
 * Return the target bucket for `scope`, never undefined. The wizard and the
 * switcher always operate on a Record even when the bucket is empty.
 */
export function getScopeBucket(
  scoped: EdaTargetsByScope,
  scope: string
): Record<string, EdaTargetValue> {
  return scoped[scope] ?? {};
}

export interface ScopedTargetEntry {
  url: string;
  value: EdaTargetValue;
  scope: string;
}

/**
 * Compute the entries visible from `currentScope` — just the current scope's
 * bucket. Each scope is independent: to use a URL from a different host you
 * either re-add it there or use the import/export commands.
 */
export function getVisibleEntries(
  scoped: EdaTargetsByScope,
  currentScope: string
): ScopedTargetEntry[] {
  return Object.entries(scoped[currentScope] ?? {}).map(([url, value]) => ({
    url,
    value,
    scope: currentScope
  }));
}

/**
 * Names of buckets other than `currentScope` that contain at least one
 * target. Useful when the current bucket is empty: the wizard surfaces these
 * so the user can see they have targets configured for another host and
 * decide whether to copy or import them.
 */
export function getNonEmptyOtherScopes(
  scoped: EdaTargetsByScope,
  currentScope: string
): string[] {
  return Object.entries(scoped)
    .filter(([scope, bucket]) => scope !== currentScope && Object.keys(bucket ?? {}).length > 0)
    .map(([scope]) => scope);
}

const SELECTED_TARGET_KEY = 'selectedEdaTargetByScope';

/**
 * Read the index of the active target within `scope`'s bucket. The memento
 * stores a per-scope map so each host remembers its own selection.
 */
export function getSelectedTargetIndex(
  context: vscode.ExtensionContext,
  scope: string
): number {
  const map = context.globalState.get<Record<string, number>>(SELECTED_TARGET_KEY);
  if (map && typeof map[scope] === 'number') {
    return map[scope];
  }
  // Legacy single-number memento, used before scoping. Treat it as the
  // selection for the current scope so the first activation after upgrade
  // keeps the same target.
  if (scope === getCurrentScope()) {
    const legacy = context.globalState.get<number>('selectedEdaTarget');
    if (typeof legacy === 'number') {
      return legacy;
    }
  }
  return 0;
}

export async function setSelectedTargetIndex(
  context: vscode.ExtensionContext,
  scope: string,
  index: number
): Promise<void> {
  const map = { ...(context.globalState.get<Record<string, number>>(SELECTED_TARGET_KEY) ?? {}) };
  map[scope] = index;
  await context.globalState.update(SELECTED_TARGET_KEY, map);
}
