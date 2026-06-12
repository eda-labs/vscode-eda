// src/commands/targetPortabilityCommands.ts
//
// Import/export commands for the EDA target bucket of the current host scope.
// The exported JSON is a self-contained snapshot of the current scope so it
// can be imported on another machine (local or attached via SSH) without
// touching the user's settings JSON by hand.
import * as vscode from 'vscode';

import { getHostFromUrl, log, LogLevel, type EdaTargetConfig, type EdaTargetValue } from '../extension';
import {
  type EdaTargetsByScope,
  getCurrentScope,
  getScopeLabel,
  normalizeTargetsShape
} from '../utils/hostScope';

const CONFIG_SECTION = 'vscode-eda';
const TARGETS_KEY = 'edaTargets';
const EXPORT_FORMAT_VERSION = 1;

interface ExportedTarget {
  url: string;
  config: EdaTargetConfig;
  edaPassword?: string;
  clientSecret?: string;
}

interface ExportEnvelope {
  type: 'vscode-eda.targets';
  version: number;
  scope: string;
  exportedAt: string;
  targets: ExportedTarget[];
}

function asTargetConfig(val: EdaTargetValue): EdaTargetConfig {
  if (typeof val === 'string') {
    return { context: val || undefined };
  }
  if (val && typeof val === 'object') {
    return { ...val };
  }
  return {};
}

function getScopedTargets(
  config: vscode.WorkspaceConfiguration,
  scope: string
): { scoped: EdaTargetsByScope; bucket: Record<string, EdaTargetValue> } {
  const raw = config.get<unknown>(TARGETS_KEY);
  const { scoped } = normalizeTargetsShape(raw, scope);
  return { scoped, bucket: scoped[scope] ?? {} };
}

async function persistScopedTargets(
  config: vscode.WorkspaceConfiguration,
  scoped: EdaTargetsByScope
): Promise<void> {
  const inspect = config.inspect(TARGETS_KEY);
  const target = inspect?.workspaceValue !== undefined
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await config.update(TARGETS_KEY, scoped, target);
}

async function exportCurrentScope(context: vscode.ExtensionContext): Promise<void> {
  const scope = getCurrentScope();
  const scopeLabel = getScopeLabel(scope);
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const { bucket } = getScopedTargets(config, scope);
  const entries = Object.entries(bucket);
  if (entries.length === 0) {
    vscode.window.showInformationMessage(`No EDA targets configured for host scope "${scopeLabel}".`);
    return;
  }

  const includeSecrets = await vscode.window.showQuickPick(
    [
      { label: 'Without secrets', description: 'Recommended. Re-enter passwords on import.', value: false },
      { label: 'With secrets', description: 'Embed EDA password and client secret in the file.', value: true }
    ],
    { placeHolder: `Export ${entries.length} target(s) from "${scopeLabel}"` }
  );
  if (!includeSecrets) {
    return;
  }

  const exported: ExportedTarget[] = await Promise.all(entries.map(async ([url, val]) => {
    const cfg = asTargetConfig(val);
    if (!includeSecrets.value) {
      return { url, config: cfg };
    }
    const host = getHostFromUrl(url);
    const edaPassword = await context.secrets.get(`edaPassword:${host}`);
    const clientSecret = await context.secrets.get(`clientSecret:${host}`);
    return {
      url,
      config: cfg,
      edaPassword: edaPassword || undefined,
      clientSecret: clientSecret || undefined
    };
  }));

  const envelope: ExportEnvelope = {
    type: 'vscode-eda.targets',
    version: EXPORT_FORMAT_VERSION,
    scope,
    exportedAt: new Date().toISOString(),
    targets: exported
  };

  const defaultName = `eda-targets-${sanitizeScopeForFilename(scope)}.json`;
  const uri = await vscode.window.showSaveDialog({
    saveLabel: 'Export EDA Targets',
    filters: { JSON: ['json'] },
    defaultUri: vscode.Uri.file(defaultName)
  });
  if (!uri) {
    return;
  }
  const body = JSON.stringify(envelope, null, 2);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(body, 'utf8'));
  vscode.window.showInformationMessage(
    `Exported ${exported.length} target(s) from "${scopeLabel}" to ${uri.fsPath}.`
  );
}

function sanitizeScopeForFilename(scope: string): string {
  return scope.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function parseEnvelope(body: string): ExportEnvelope {
  const parsed = JSON.parse(body) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Import file is not a JSON object.');
  }
  const env = parsed as Partial<ExportEnvelope>;
  if (env.type !== 'vscode-eda.targets') {
    throw new Error('Import file is not a vscode-eda targets export.');
  }
  if (!Array.isArray(env.targets)) {
    throw new Error('Import file is missing a targets array.');
  }
  return env as ExportEnvelope;
}

async function importIntoCurrentScope(context: vscode.ExtensionContext): Promise<void> {
  const scope = getCurrentScope();
  const scopeLabel = getScopeLabel(scope);
  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: 'Import',
    filters: { JSON: ['json'] }
  });
  if (!uris || uris.length === 0) {
    return;
  }
  const data = await vscode.workspace.fs.readFile(uris[0]);
  let envelope: ExportEnvelope;
  try {
    envelope = parseEnvelope(Buffer.from(data).toString('utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Could not import targets: ${message}`);
    return;
  }

  if (envelope.targets.length === 0) {
    vscode.window.showInformationMessage('Import file contains no targets.');
    return;
  }

  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const { scoped, bucket } = getScopedTargets(config, scope);
  const existingUrls = new Set(Object.keys(bucket));
  const collisions = envelope.targets.filter(t => existingUrls.has(t.url));

  let overwrite = false;
  if (collisions.length > 0) {
    const collisionMode = await vscode.window.showQuickPick(
      [
        { label: 'Skip existing', description: 'Keep current entries, add only new URLs.', value: 'skip' },
        { label: 'Overwrite existing', description: `Replace ${collisions.length} matching entries.`, value: 'overwrite' },
        { label: 'Cancel', description: 'Do nothing.', value: 'cancel' }
      ],
      {
        placeHolder: `Import into "${scopeLabel}": ${collisions.length} URL(s) already exist.`
      }
    );
    if (!collisionMode || collisionMode.value === 'cancel') {
      return;
    }
    overwrite = collisionMode.value === 'overwrite';
  }

  const result = mergeImportedTargets(envelope.targets, bucket, existingUrls, overwrite);
  scoped[scope] = result.bucket;
  await persistScopedTargets(config, scoped);

  await storeImportedSecrets(context, result.secrets);

  log(
    `Imported targets into scope '${scope}': added ${result.added}, updated ${result.updated}, secrets ${result.secrets.length}.`,
    LogLevel.INFO,
    true
  );
  vscode.window.showInformationMessage(
    `Imported ${result.added + result.updated} target(s) into "${scopeLabel}" (added ${result.added}, updated ${result.updated}).`
  );
}

interface MergeResult {
  bucket: Record<string, EdaTargetValue>;
  added: number;
  updated: number;
  secrets: Array<{ url: string; edaPassword?: string; clientSecret?: string }>;
}

function mergeImportedTargets(
  incoming: ExportedTarget[],
  bucket: Record<string, EdaTargetValue>,
  existingUrls: Set<string>,
  overwrite: boolean
): MergeResult {
  const newBucket: Record<string, EdaTargetValue> = { ...bucket };
  const secrets: MergeResult['secrets'] = [];
  let added = 0;
  let updated = 0;
  for (const target of incoming) {
    if (existingUrls.has(target.url) && !overwrite) {
      continue;
    }
    newBucket[target.url] = sanitizeTargetConfig(target.config);
    if (existingUrls.has(target.url)) {
      updated += 1;
    } else {
      added += 1;
    }
    const inlineEdaPassword = target.edaPassword || target.config?.edaPassword;
    const inlineClientSecret = target.clientSecret;
    if (inlineEdaPassword || inlineClientSecret) {
      secrets.push({
        url: target.url,
        edaPassword: inlineEdaPassword,
        clientSecret: inlineClientSecret
      });
    }
  }
  return { bucket: newBucket, added, updated, secrets };
}

async function storeImportedSecrets(
  context: vscode.ExtensionContext,
  secrets: MergeResult['secrets']
): Promise<void> {
  for (const entry of secrets) {
    const host = getHostFromUrl(entry.url);
    if (entry.edaPassword) {
      await context.secrets.store(`edaPassword:${host}`, entry.edaPassword);
    }
    if (entry.clientSecret) {
      await context.secrets.store(`clientSecret:${host}`, entry.clientSecret);
    }
  }
}

function sanitizeTargetConfig(cfg: EdaTargetConfig | undefined): EdaTargetConfig {
  // Match the wizard: secrets (edaPassword, kcPassword) never land in
  // settings; they go through context.secrets instead. If an import file
  // includes them inline we move them to the top-level secrets fields, not
  // back into the bucket entry.
  if (!cfg || typeof cfg !== 'object') {
    return {};
  }
  return {
    context: cfg.context || undefined,
    edaUsername: cfg.edaUsername || undefined,
    skipTlsVerify: cfg.skipTlsVerify || undefined,
    coreNamespace: cfg.coreNamespace || undefined,
    kcUsername: cfg.kcUsername || undefined
  };
}

export function registerTargetPortabilityCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-eda.exportTargets', () => exportCurrentScope(context)),
    vscode.commands.registerCommand('vscode-eda.importTargets', () => importIntoCurrentScope(context))
  );
}
