import * as vscode from 'vscode';
import { BasePanel } from '../basePanel';
import { KubernetesClient } from '../../clients/kubernetesClient';
import { fetch, Agent } from 'undici';

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

    this.panel.webview.onDidReceiveMessage(async (msg: any) => {
      switch (msg.command) {
        case 'save':
          await this.saveConfiguration(msg, true);
          break;
        case 'add':
          await this.saveConfiguration(msg, false);
          break;
        case 'delete':
          await this.deleteTarget(msg.url);
          break;
        case 'confirmDelete':
          await this.confirmDelete(msg.index, msg.url);
          break;
        case 'commit':
          await this.commitTargets(msg.targets);
          break;
        case 'select':
          await this.context.globalState.update('selectedEdaTarget', msg.index);
          break;
        case 'close':
          this.showReload();
          break;
        case 'retrieveClientSecret':
          await this.retrieveClientSecret(msg.url);
          break;
      }
    });
  }

  protected getHtml(): string {
    const html = this.readWebviewFile('targetWizard', 'targetWizardPanel.html');
    if (!html) {
      return '';
    }
    const logoUri = this.getResourceUri('resources', 'eda.png');
    const options = this.contexts.map(c => `<option value="${c}">${c}</option>`).join('');
    return html.replace('${logo}', logoUri.toString()).replace('${options}', options);
  }

  protected getCustomStyles(): string {
    return this.readWebviewFile('targetWizard', 'targetWizardPanel.css');
  }

  protected getScripts(): string {
    return '';
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'targetWizardPanel.js');
    const data = { targets: this.targets, selected: this.selected };
    const dataJson = JSON.stringify(data).replace(/</g, '\\u003c');
    return `<script id="initialData" type="application/json">${dataJson}</script>\n<script nonce="${nonce}" src="${scriptUri}"></script>`;
  }

  private async saveConfiguration(msg: any, close: boolean): Promise<void> {
    const config = vscode.workspace.getConfiguration('vscode-eda');
    const current = config.get<Record<string, any>>('edaTargets') || {};

    // Handle URL changes (remove old entry if URL changed)
    if (msg.originalUrl && msg.originalUrl !== msg.url) {
      delete current[msg.originalUrl];
    }

    // Save new/updated configuration (excluding secrets)
    current[msg.url] = {
      context: msg.context || undefined,
      edaUsername: msg.edaUsername || undefined,
      skipTlsVerify: msg.skipTlsVerify || undefined,
      coreNamespace: msg.coreNamespace || undefined
    };

    await config.update('edaTargets', current, vscode.ConfigurationTarget.Global);

    // Extract host for password storage
    const host = (() => {
      try {
        return new URL(msg.url).host;
      } catch {
        return msg.url;
      }
    })();

    // Store passwords securely
    if (msg.edaPassword) {
      await this.context.secrets.store(`edaPassword:${host}`, msg.edaPassword);
    }
    if (msg.clientSecret) {
      await this.context.secrets.store(`clientSecret:${host}`, msg.clientSecret);
    }

    // Clean up old passwords if URL changed
    if (msg.originalUrl && msg.originalUrl !== msg.url) {
      try {
        const oldHost = new URL(msg.originalUrl).host;
        await this.context.secrets.delete(`edaPassword:${oldHost}`);
        await this.context.secrets.delete(`clientSecret:${oldHost}`);
      } catch {
        // ignore invalid url
      }
    }

    if (close) {
      this.showReload();
    }
  }

  private async deleteTarget(url: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('vscode-eda');
    const current = config.get<Record<string, any>>('edaTargets') || {};
    delete current[url];
    await config.update('edaTargets', current, vscode.ConfigurationTarget.Global);

    // Clean up stored passwords
    try {
      const host = new URL(url).host;
      await this.context.secrets.delete(`edaPassword:${host}`);
      await this.context.secrets.delete(`clientSecret:${host}`);
    } catch {
      // ignore invalid url
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

  private async commitTargets(targets: any[]): Promise<void> {
    const config = vscode.workspace.getConfiguration('vscode-eda');
    const previous = config.get<Record<string, any>>('edaTargets') || {};
    const updated: Record<string, any> = {};

    // Build new configuration from targets array (excluding secrets)
    for (const target of targets) {
      updated[target.url] = {
        context: target.context || undefined,
        edaUsername: target.edaUsername || undefined,
        skipTlsVerify: target.skipTlsVerify || undefined,
        coreNamespace: target.coreNamespace || undefined
      };
    }

    await config.update('edaTargets', updated, vscode.ConfigurationTarget.Global);

    // Clean up passwords for removed targets
    for (const url of Object.keys(previous)) {
      if (!updated[url]) {
        try {
          const host = new URL(url).host;
          await this.context.secrets.delete(`edaPassword:${host}`);
      await this.context.secrets.delete(`clientSecret:${host}`);
        } catch {
          // ignore invalid url
        }
      }
    }
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
    } catch (error: any) {
      console.error('Full error:', error);
      vscode.window.showErrorMessage(`Failed to retrieve client secret: ${error.message}`);
    }
  }

  private async fetchClientSecretDirectly(baseUrl: string, kcUsername: string, kcPassword: string): Promise<string> {
    return fetchClientSecretDirectly(baseUrl, kcUsername, kcPassword);
  }

  static async show(context: vscode.ExtensionContext): Promise<void> {
    const k8sClient = new KubernetesClient();
    const contexts = k8sClient.getAvailableContexts();
    const config = vscode.workspace.getConfiguration('vscode-eda');
    const targetsMap = config.get<Record<string, any>>('edaTargets') || {};

    // Load targets with their stored passwords
    const targets = await Promise.all(
      Object.entries(targetsMap).map(async ([url, val]) => {
        const host = (() => {
          try {
            return new URL(url).host;
          } catch {
            return url;
          }
        })();

        const edaPassword = await context.secrets.get(`edaPassword:${host}`);
        const clientSecret = await context.secrets.get(`clientSecret:${host}`);

        // Handle legacy string format and new object format
        if (typeof val === 'string' || val === null) {
          return {
            url,
            context: val || undefined,
            edaPassword: edaPassword || undefined,
            clientSecret: clientSecret || undefined
          };
        }

        return {
          url,
          context: val.context || undefined,
          edaUsername: val.edaUsername || undefined,
          edaPassword: edaPassword || undefined,
          clientSecret: clientSecret || undefined,
          skipTlsVerify: val.skipTlsVerify || undefined,
          coreNamespace: val.coreNamespace || undefined
        };
      })
    );

    const selected = context.globalState.get<number>('selectedEdaTarget', 0) ?? 0;
    const panel = new TargetWizardPanel(context, contexts, targets, selected);
    return panel.waitForClose();
  }
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

  const adminTokenData = (await adminTokenRes.json()) as any;
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

  const clients = (await clientsRes.json()) as any[];
  const edaClient = clients.find((c: any) => c.clientId === 'eda');

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

  const secretData = (await secretRes.json()) as any;
  return secretData.value || '';
}

export async function configureTargets(context: vscode.ExtensionContext): Promise<void> {
  return TargetWizardPanel.show(context);
}