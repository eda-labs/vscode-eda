import * as vscode from 'vscode';
import { fetch, Agent } from 'undici';

import { BasePanel } from '../basePanel';
import { EXTENSION_CONFIG_SECTION } from '../constants';
import { KubernetesClient } from '../../clients/kubernetesClient';

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

// Helper to load targets from configuration with their secrets
async function loadTargetsFromConfig(
  context: vscode.ExtensionContext,
  targetsMap: Record<string, unknown>
): Promise<TargetConfig[]> {
  return Promise.all(
    Object.entries(targetsMap).map(async ([url, val]) => {
      const host = extractHost(url);
      const edaPassword = await context.secrets.get(`edaPassword:${host}`);
      const clientSecret = await context.secrets.get(`clientSecret:${host}`);
      return buildTargetFromConfig(url, val, edaPassword, clientSecret);
    })
  );
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
  private targets: {
    url: string;
    context?: string;
    edaUsername?: string;
    edaPassword?: string;
    clientSecret?: string;
    skipTlsVerify?: boolean;
    coreNamespace?: string;
  }[];
  private selected: number;
  private resolve: (value: void | PromiseLike<void>) => void;

  constructor(
    context: vscode.ExtensionContext,
    contexts: string[],
    targets: {
      url: string;
      context?: string;
      edaUsername?: string;
      edaPassword?: string;
      clientSecret?: string;
      skipTlsVerify?: boolean;
      coreNamespace?: string;
    }[],
    selected: number
  ) {
    super(context, 'edaTargetWizard', 'Configure EDA Targets');
    this.contexts = contexts;
    this.targets = targets;
    this.selected = selected;
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
      select: () => this.context.globalState.update('selectedEdaTarget', message.index),
      close: () => this.showReload(),
      retrieveClientSecret: () => this.retrieveClientSecret(message.url as string)
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
      logoUri: logoUri.toString()
    });
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'targetWizardPanel.js');
    return `<script type="module" nonce="${nonce}" src="${scriptUri}"></script>`;
  }

  private async saveConfiguration(msg: { command: string; [key: string]: unknown }, close: boolean): Promise<void> {
    const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
    const current = config.get<Record<string, unknown>>('edaTargets') || {};
    const url = msg.url as string;
    const originalUrl = msg.originalUrl as string | undefined;

    // Handle URL changes (remove old entry if URL changed)
    if (originalUrl && originalUrl !== url) {
      delete current[originalUrl];
    }

    // Save new/updated configuration (excluding secrets)
    current[url] = {
      context: msg.context || undefined,
      edaUsername: msg.edaUsername || undefined,
      skipTlsVerify: msg.skipTlsVerify || undefined,
      coreNamespace: msg.coreNamespace || undefined
    };

    await config.update('edaTargets', current, vscode.ConfigurationTarget.Global);

    // Extract host for password storage
    const host = extractHost(url);

    // Store passwords securely
    if (msg.edaPassword) {
      await this.context.secrets.store(`edaPassword:${host}`, msg.edaPassword as string);
    }
    if (msg.clientSecret) {
      await this.context.secrets.store(`clientSecret:${host}`, msg.clientSecret as string);
    }

    // Clean up old passwords if URL changed
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
    const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
    const current = config.get<Record<string, unknown>>('edaTargets') || {};
    delete current[url];
    await config.update('edaTargets', current, vscode.ConfigurationTarget.Global);
    await this.cleanupSecrets(url);
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
    const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
    const previous = config.get<Record<string, unknown>>('edaTargets') || {};
    const updated: Record<string, unknown> = {};

    // Build new configuration from targets array (excluding secrets)
    for (const target of targets as Array<{ url: string; context?: string; edaUsername?: string; skipTlsVerify?: boolean; coreNamespace?: string }>) {
      updated[target.url] = {
        context: target.context || undefined,
        edaUsername: target.edaUsername || undefined,
        skipTlsVerify: target.skipTlsVerify || undefined,
        coreNamespace: target.coreNamespace || undefined
      };
    }

    await config.update('edaTargets', updated, vscode.ConfigurationTarget.Global);

    // Clean up passwords for removed targets
    const cleanupPromises = Object.keys(previous)
      .filter(url => !updated[url])
      .map(url => this.cleanupSecrets(url));
    await Promise.all(cleanupPromises);
  }

  private showReload(): void {
    vscode.window
      .showInformationMessage('EDA targets updated. Reload window to apply changes.', 'Reload')
      .then(selection => {
        if (selection === 'Reload') {
          void vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      });

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
    const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
    const targetsMap = config.get<Record<string, unknown>>('edaTargets') || {};

    const targets = await loadTargetsFromConfig(context, targetsMap);
    const selected = context.globalState.get<number>('selectedEdaTarget', 0) ?? 0;
    const panel = new TargetWizardPanel(context, contexts, targets, selected);
    return panel.waitForClose();
  }
}

interface TokenResponse {
  access_token: string;
}

interface KeycloakClient {
  id: string;
  clientId: string;
}

interface ClientSecretResponse {
  value?: string;
}

export async function fetchClientSecretDirectly(
  baseUrl: string,
  kcUsername: string,
  kcPassword: string
): Promise<string> {
  // Ensure baseUrl doesn't have trailing slash
  baseUrl = baseUrl.replace(/\/$/, '');

  const kcUrl = `${baseUrl}/core/httpproxy/v1/keycloak`;
  const agent = new Agent({ connect: { rejectUnauthorized: false } });

  // Step 1: Get admin token
  const adminTokenUrl = `${kcUrl}/realms/master/protocol/openid-connect/token`;
  const adminTokenRes = await fetch(adminTokenUrl, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: kcUsername,
      password: kcPassword
    }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    dispatcher: agent
  });

  if (!adminTokenRes.ok) {
    const errorText = await adminTokenRes.text();
    throw new Error(
      `Failed to authenticate with Keycloak admin: ${adminTokenRes.status} ${adminTokenRes.statusText}. ${errorText}`
    );
  }

  const adminTokenData = (await adminTokenRes.json()) as TokenResponse;
  const adminToken = adminTokenData.access_token;

  // Step 2: List clients to find EDA client
  const clientsUrl = `${kcUrl}/admin/realms/eda/clients`;
  const clientsRes = await fetch(clientsUrl, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    dispatcher: agent
  });

  if (!clientsRes.ok) {
    throw new Error(`Failed to list clients: ${clientsRes.status}`);
  }

  const clients = (await clientsRes.json()) as KeycloakClient[];
  const edaClient = clients.find((c) => c.clientId === 'eda');

  if (!edaClient) {
    throw new Error('EDA client not found in Keycloak');
  }

  // Step 3: Get client secret
  const secretUrl = `${clientsUrl}/${edaClient.id}/client-secret`;
  const secretRes = await fetch(secretUrl, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    dispatcher: agent
  });

  if (!secretRes.ok) {
    throw new Error(`Failed to fetch client secret: ${secretRes.status}`);
  }

  const secretData = (await secretRes.json()) as ClientSecretResponse;
  return secretData.value || '';
}

export async function configureTargets(context: vscode.ExtensionContext): Promise<void> {
  return TargetWizardPanel.show(context);
}