import * as vscode from 'vscode';
import { BasePanel } from '../basePanel';
import * as fs from 'fs';
import * as path from 'path';
import { KubernetesClient } from '../../clients/kubernetesClient';

export interface TargetWizardResult {
  url: string;
  context?: string;
  edaUsername: string;
  kcUsername: string;
  edaPassword: string;
  kcPassword: string;
  coreNamespace?: string;
}

export class TargetWizardPanel extends BasePanel {
  private contexts: string[];
  private targets: {
    url: string;
    context?: string;
    edaUsername?: string;
    kcUsername?: string;
    skipTlsVerify?: boolean;
    coreNamespace?: string;
    edaPassword?: string;
    kcPassword?: string;
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
      kcUsername?: string;
      skipTlsVerify?: boolean;
      coreNamespace?: string;
      edaPassword?: string;
      kcPassword?: string;
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
      }
    });
  }

  protected getHtml(): string {
    try {
      const filePath = this.context.asAbsolutePath(
        path.join('src', 'webviews', 'targetWizard', 'targetWizardPanel.html')
      );
      const html = fs.readFileSync(filePath, 'utf8');
      const logoUri = this.getResourceUri('resources', 'eda.png');
      const options = this.contexts.map(c => `<option value="${c}">${c}</option>`).join('');
      return html.replace('${logo}', logoUri.toString()).replace('${options}', options);
    } catch (err) {
      console.error('Failed to load Target wizard HTML', err);
      return '';
    }
  }

  protected getCustomStyles(): string {
    try {
      const filePath = this.context.asAbsolutePath(
        path.join('src', 'webviews', 'targetWizard', 'targetWizardPanel.css')
      );
      return fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      console.error('Failed to load Target wizard CSS', err);
      return '';
    }
  }

  protected getScripts(): string {
    return '';
  }

  protected buildHtml(): string {
    const nonce = this.getNonce();
    const csp = this.panel.webview.cspSource;
    const codiconUri = this.getResourceUri('resources', 'codicon.css');
    const scriptUri = this.getResourceUri('dist', 'targetWizardPanel.js');
    const data = { targets: this.targets, selected: this.selected };
    const dataJson = JSON.stringify(data).replace(/</g, '\\u003c');
    const tailwind = (BasePanel as any).tailwind ?? '';
    const styles = `${tailwind}\n${this.getCustomStyles()}`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} https:; style-src ${csp} 'unsafe-inline'; font-src ${csp}; script-src 'nonce-${nonce}' ${csp};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${codiconUri}" rel="stylesheet">
  <style>${styles}</style>
</head>
<body>
  ${this.getHtml()}
  <script id="initialData" type="application/json">${dataJson}</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private async saveConfiguration(msg: any, close: boolean): Promise<void> {
    const config = vscode.workspace.getConfiguration('vscode-eda');
    const current = config.get<Record<string, any>>('edaTargets') || {};

    // Handle URL changes (remove old entry if URL changed)
    if (msg.originalUrl && msg.originalUrl !== msg.url) {
      delete current[msg.originalUrl];
    }

    // Save new/updated configuration
    current[msg.url] = {
      context: msg.context || undefined,
      edaUsername: msg.edaUsername || undefined,
      kcUsername: msg.kcUsername || undefined,
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
    if (msg.kcPassword) {
      await this.context.secrets.store(`kcPassword:${host}`, msg.kcPassword);
    }

    // Clean up old passwords if URL changed
    if (msg.originalUrl && msg.originalUrl !== msg.url) {
      try {
        const oldHost = new URL(msg.originalUrl).host;
        await this.context.secrets.delete(`edaPassword:${oldHost}`);
        await this.context.secrets.delete(`kcPassword:${oldHost}`);
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
      await this.context.secrets.delete(`kcPassword:${host}`);
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

    // Build new configuration from targets array
    for (const target of targets) {
      updated[target.url] = {
        context: target.context || undefined,
        edaUsername: target.edaUsername || undefined,
        kcUsername: target.kcUsername || undefined,
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
          await this.context.secrets.delete(`kcPassword:${host}`);
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
        const kcPassword = await context.secrets.get(`kcPassword:${host}`);

        // Handle legacy string format and new object format
        if (typeof val === 'string' || val === null) {
          return {
            url,
            context: val || undefined,
            edaPassword: edaPassword || undefined,
            kcPassword: kcPassword || undefined
          };
        }

        return {
          url,
          context: val.context || undefined,
          edaUsername: val.edaUsername || undefined,
          kcUsername: val.kcUsername || undefined,
          skipTlsVerify: val.skipTlsVerify || undefined,
          coreNamespace: val.coreNamespace || undefined,
          edaPassword: edaPassword || undefined,
          kcPassword: kcPassword || undefined
        };
      })
    );

    const selected = context.globalState.get<number>('selectedEdaTarget', 0) ?? 0;
    const panel = new TargetWizardPanel(context, contexts, targets, selected);
    return panel.waitForClose();
  }
}

export async function configureTargets(context: vscode.ExtensionContext): Promise<void> {
  return TargetWizardPanel.show(context);
}