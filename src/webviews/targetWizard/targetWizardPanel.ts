import * as vscode from 'vscode';

import { BasePanel } from '../basePanel';
import { EXTENSION_CONFIG_SECTION } from '../constants';
import { KubernetesClient } from '../../clients/kubernetesClient';
import { fetchClientSecretDirectly } from '../../services/clientSecretService';
import { serviceManager } from '../../services/serviceManager';
import type { EdaTargetValue } from '../../extension';
import { loadVisibleTargetEntries } from '../../extension';
import {
  type EdaTargetsByScope,
  getCurrentScope,
  getScopeLabel,
  getSelectedTargetIndex,
  normalizeTargetsShape,
  setSelectedTargetIndex
} from '../../utils/hostScope';

// Helper to extract host from URL, falling back to the URL string if invalid
function extractHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

interface TargetConfig {
  url: string;
  context?: string;
  edaUsername?: string;
  edaPassword?: string;
  clientSecret?: string;
  skipTlsVerify?: boolean;
  coreNamespace?: string;
}

// Helper to build target object from config value
function buildTargetFromConfig(
  url: string,
  val: unknown,
  edaPassword: string | undefined,
  clientSecret: string | undefined
): TargetConfig {
  // Handle legacy string format and new object format
  if (typeof val === 'string' || val === null) {
    return {
      url,
      context: (val as string) || undefined,
      edaPassword: edaPassword || undefined,
      clientSecret: clientSecret || undefined
    };
  }

  const config = val as Record<string, unknown>;
  return {
    url,
    context: (config.context as string) || undefined,
    edaUsername: (config.edaUsername as string) || undefined,
    edaPassword: edaPassword || undefined,
    clientSecret: clientSecret || undefined,
    skipTlsVerify: (config.skipTlsVerify as boolean) || undefined,
    coreNamespace: (config.coreNamespace as string) || undefined
  };
}

// Build the wizard's target list from the current scope's entries, paired
// with their stored secrets.
async function loadVisibleTargets(
  context: vscode.ExtensionContext
): Promise<TargetConfig[]> {
  const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
  const entries = await loadVisibleTargetEntries(config);
  return Promise.all(entries.map(async ({ url, value }) => {
    const host = extractHost(url);
    const edaPassword = await context.secrets.get(`edaPassword:${host}`);
    const clientSecret = await context.secrets.get(`clientSecret:${host}`);
    return buildTargetFromConfig(url, value, edaPassword, clientSecret);
  }));
}

/**
 * Read `edaTargets` from settings, migrating any legacy flat shape into the
 * current scope. Returns `{scoped, bucket}` so callers can mutate the bucket
 * for the current scope and still persist all other buckets unchanged.
 */
function readScopedTargets(
  scope: string
): { scoped: EdaTargetsByScope; bucket: Record<string, EdaTargetValue> } {
  const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
  const raw = config.get<unknown>('edaTargets');
  const { scoped } = normalizeTargetsShape(raw, scope);
  return { scoped, bucket: scoped[scope] ?? {} };
}

async function persistScopedTargets(scoped: EdaTargetsByScope): Promise<void> {
  const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
  const inspect = config.inspect('edaTargets');
  const target = inspect?.workspaceValue !== undefined
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await config.update('edaTargets', scoped, target);
}

function collectAllUrls(scoped: EdaTargetsByScope): Set<string> {
  const urls = new Set<string>();
  for (const bucket of Object.values(scoped)) {
    for (const url of Object.keys(bucket)) {
      urls.add(url);
    }
  }
  return urls;
}

export interface TargetWizardResult {
  url: string;
  context?: string;
  edaUsername: string;
  edaPassword: string;
  clientSecret: string;
  coreNamespace?: string;
}

export class TargetWizardPanel extends BasePanel {
  private contexts: string[];
  private targets: TargetConfig[];
  private selected: number;
  private scope: string;
  private resolve: (value: void | PromiseLike<void>) => void;

  constructor(
    context: vscode.ExtensionContext,
    contexts: string[],
    targets: TargetConfig[],
    selected: number,
    scope: string
  ) {
    super(context, 'edaTargetWizard', `Configure EDA Targets — ${getScopeLabel(scope)}`);
    this.contexts = contexts;
    this.targets = targets;
    this.selected = selected;
    this.scope = scope;
    this.panel.webview.html = this.buildHtml();

    this.panel.webview.onDidReceiveMessage((msg: unknown) => this.handleMessage(msg));
  }

  private async handleMessage(msg: unknown): Promise<void> {
    const message = msg as { command: string; [key: string]: unknown };
    const handlers: Record<string, () => PromiseLike<void> | void> = {
      ready: () => this.sendInitialData(),
      save: () => this.saveConfiguration(message, true),
      add: () => this.saveConfiguration(message, false),
      delete: () => this.deleteTarget(message.url as string),
      confirmDelete: () => this.confirmDelete(message.index as number, message.url as string),
      commit: () => this.commitTargets(message.targets as unknown[]),
      select: () => setSelectedTargetIndex(this.context, this.scope, message.index as number),
      switchTarget: () => this.switchTarget(message.index as number),
      close: () => this.showReload(),
      retrieveClientSecret: () => this.retrieveClientSecret(message.url as string),
      exportTargets: () => vscode.commands.executeCommand('vscode-eda.exportTargets'),
      importTargets: () => this.importTargets()
    };

    const handler = handlers[message.command];
    if (handler) {
      await handler();
    }
  }

  private sendInitialData(): void {
    const logoUri = this.getResourceUri('resources', 'eda.png');
    this.panel.webview.postMessage({
      command: 'init',
      targets: this.targets,
      selected: this.selected,
      contexts: this.contexts,
      logoUri: logoUri.toString(),
      scope: this.scope,
      scopeLabel: getScopeLabel(this.scope)
    });
  }

  private async importTargets(): Promise<void> {
    await vscode.commands.executeCommand('vscode-eda.importTargets');
    await this.reloadTargetsFromConfig();
  }

  private async reloadTargetsFromConfig(): Promise<void> {
    this.targets = await loadVisibleTargets(this.context);
    this.selected = Math.min(getSelectedTargetIndex(this.context, this.scope), Math.max(this.targets.length - 1, 0));
    this.sendInitialData();
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'targetWizardPanel.js');
    return `<script type="module" nonce="${nonce}" src="${scriptUri}"></script>`;
  }

  private async saveConfiguration(msg: { command: string; [key: string]: unknown }, close: boolean): Promise<void> {
    const { scoped, bucket } = readScopedTargets(this.scope);
    const url = msg.url as string;
    const originalUrl = msg.originalUrl as string | undefined;

    if (originalUrl && originalUrl !== url) {
      delete bucket[originalUrl];
    }

    bucket[url] = {
      context: (msg.context as string) || undefined,
      edaUsername: (msg.edaUsername as string) || undefined,
      skipTlsVerify: (msg.skipTlsVerify as boolean) || undefined,
      coreNamespace: (msg.coreNamespace as string) || undefined
    };
    scoped[this.scope] = bucket;
    await persistScopedTargets(scoped);

    const host = extractHost(url);
    if (msg.edaPassword) {
      await this.context.secrets.store(`edaPassword:${host}`, msg.edaPassword as string);
    }
    if (msg.clientSecret) {
      await this.context.secrets.store(`clientSecret:${host}`, msg.clientSecret as string);
    }
    if (originalUrl && originalUrl !== url) {
      await this.cleanupSecrets(originalUrl);
    }

    if (close) {
      this.showReload();
    }
  }

  private async cleanupSecrets(url: string): Promise<void> {
    try {
      const host = new URL(url).host;
      await this.context.secrets.delete(`edaPassword:${host}`);
      await this.context.secrets.delete(`clientSecret:${host}`);
    } catch {
      // ignore invalid url
    }
  }

  private async deleteTarget(url: string): Promise<void> {
    const { scoped, bucket } = readScopedTargets(this.scope);
    delete bucket[url];
    scoped[this.scope] = bucket;
    await persistScopedTargets(scoped);
    // Only clean up secrets when no other scope still references the URL.
    const stillReferenced = Object.values(scoped).some(b => b && Object.prototype.hasOwnProperty.call(b, url));
    if (!stillReferenced) {
      await this.cleanupSecrets(url);
    }
  }

  private async confirmDelete(index: number, url: string): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      `Are you sure you want to delete ${url}?`,
      { modal: true },
      'Delete'
    );
    if (choice === 'Delete') {
      this.panel.webview.postMessage({ command: 'deleteConfirmed', index });
    }
  }

  private async commitTargets(targets: unknown[]): Promise<void> {
    const { scoped, bucket: previous } = readScopedTargets(this.scope);
    const updatedBucket: Record<string, EdaTargetValue> = {};

    for (const t of targets as Array<{ url: string; context?: string; edaUsername?: string; skipTlsVerify?: boolean; coreNamespace?: string }>) {
      updatedBucket[t.url] = {
        context: t.context || undefined,
        edaUsername: t.edaUsername || undefined,
        skipTlsVerify: t.skipTlsVerify || undefined,
        coreNamespace: t.coreNamespace || undefined
      };
    }
    scoped[this.scope] = updatedBucket;
    await persistScopedTargets(scoped);

    // Only clean up secrets when no other scope still references the URL.
    const stillReferenced = collectAllUrls(scoped);
    const cleanupPromises = Object.keys(previous)
      .filter(url => !stillReferenced.has(url))
      .map(url => this.cleanupSecrets(url));
    await Promise.all(cleanupPromises);
  }

  private isServiceArchitectureInitialized(): boolean {
    return serviceManager.getClientNames().includes('eda');
  }

  private async switchTarget(index: number): Promise<void> {
    if (!this.isServiceArchitectureInitialized()) {
      // First-run path: activation bailed out before creating clients, so a
      // runtime switch is impossible.
      await setSelectedTargetIndex(this.context, this.scope, index);
      vscode.window.showInformationMessage('EDA target updated. Reload window to apply.', 'Reload').then(value => {
        if (value === 'Reload') {
          void vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      });
      return;
    }
    const { switchToTarget } = await import('../../services/targetSwitchService');
    await switchToTarget(this.context, index, { excludePanel: this });
  }

  private async showReload(): Promise<void> {
    if (this.isServiceArchitectureInitialized()) {
      // Re-apply the selected target so edited URLs/credentials take effect
      // without a window reload.
      const selected = getSelectedTargetIndex(this.context, this.scope);
      const { switchToTarget } = await import('../../services/targetSwitchService');
      await switchToTarget(this.context, selected, { excludePanel: this });
    } else {
      vscode.window
        .showInformationMessage('EDA targets updated. Reload window to apply changes.', 'Reload')
        .then(selection => {
          if (selection === 'Reload') {
            void vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        });
    }

    this.dispose();
    if (this.resolve) {
      this.resolve();
    }
  }

  public waitForClose(): Promise<void> {
    return new Promise(resolve => {
      this.resolve = resolve;
      this.panel.onDidDispose(() => resolve());
    });
  }

  private async retrieveClientSecret(url: string): Promise<void> {
    try {
      // Validate URL format
      if (!url) {
        vscode.window.showErrorMessage('Please enter the EDA API URL first');
        return;
      }

      // Ensure we have the base URL without /eda or other paths
      try {
        const urlObj = new URL(url);
        // If the URL has a path like /eda, we need just the origin
        if (urlObj.pathname && urlObj.pathname !== '/') {
          const useOrigin = await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: `URL contains path "${urlObj.pathname}". Use base URL "${urlObj.origin}" instead?`
          });
          if (useOrigin === 'Yes') {
            url = urlObj.origin;
          }
        }
      } catch {
        vscode.window.showErrorMessage(`Invalid URL format: ${url}`);
        return;
      }

      // Prompt for KC username
      const kcUsername = await vscode.window.showInputBox({
        prompt: 'Enter Keycloak admin username',
        placeHolder: 'admin',
        value: 'admin',
        ignoreFocusOut: true
      });

      if (!kcUsername) {
        vscode.window.showWarningMessage('Client secret retrieval cancelled');
        return;
      }

      // Prompt for KC password
      const kcPassword = await vscode.window.showInputBox({
        prompt: 'Enter Keycloak admin password',
        placeHolder: 'Password',
        password: true,
        ignoreFocusOut: true
      });

      if (!kcPassword) {
        vscode.window.showWarningMessage('Client secret retrieval cancelled');
        return;
      }

      // Fetch client secret using KC admin credentials
      const clientSecret = await this.fetchClientSecretDirectly(url, kcUsername, kcPassword);

      // Send the secret back to the webview
      this.panel.webview.postMessage({
        command: 'clientSecretRetrieved',
        clientSecret
      });

      vscode.window.showInformationMessage('Client secret retrieved successfully');
    } catch (error: unknown) {
      console.error('Full error:', error);
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to retrieve client secret: ${message}`);
    }
  }

  private async fetchClientSecretDirectly(baseUrl: string, kcUsername: string, kcPassword: string): Promise<string> {
    return fetchClientSecretDirectly(baseUrl, kcUsername, kcPassword);
  }

  static async show(context: vscode.ExtensionContext): Promise<void> {
    const k8sClient = new KubernetesClient();
    const contexts = k8sClient.getAvailableContexts();
    const scope = getCurrentScope();

    const targets = await loadVisibleTargets(context);
    const selected = Math.min(getSelectedTargetIndex(context, scope), Math.max(targets.length - 1, 0));
    const panel = new TargetWizardPanel(context, contexts, targets, selected, scope);
    return panel.waitForClose();
  }
}

export async function configureTargets(context: vscode.ExtensionContext): Promise<void> {
  return TargetWizardPanel.show(context);
}
