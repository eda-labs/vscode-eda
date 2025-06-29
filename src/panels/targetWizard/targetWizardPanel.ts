import * as vscode from 'vscode';
import { BasePanel } from '../basePanel';
import { targetWizardStyles } from './targetWizardPanel.styles';
import { targetWizardHtml } from './targetWizardPanel.html';
import { targetWizardScripts } from './targetWizardPanel.scripts';
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
    const logoUri = this.getResourceUri('resources', 'eda.png');
    const options = this.contexts.map(c => `<option value="${c}">${c}</option>`).join('');
    return targetWizardHtml
      .replace('${logo}', logoUri.toString())
      .replace('${options}', options);
  }

  protected getCustomStyles(): string {
    return targetWizardStyles;
  }

  protected getScripts(): string {
    const data = JSON.stringify(this.targets);
    return targetWizardScripts
      .replace('${targets}', data)
      .replace('${selected}', this.selected.toString());
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