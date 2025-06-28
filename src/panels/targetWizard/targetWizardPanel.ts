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
}

export class TargetWizardPanel extends BasePanel {
  private contexts: string[];
  private targets: { url: string; context?: string; edaUsername?: string; kcUsername?: string }[];
  private selected: number;
  private resolve: (value: void | PromiseLike<void>) => void;

  constructor(
    context: vscode.ExtensionContext,
    contexts: string[],
    targets: { url: string; context?: string; edaUsername?: string; kcUsername?: string }[],
    selected: number
  ) {
    super(context, 'edaTargetWizard', 'Configure EDA Targets');
    this.contexts = contexts;
    this.targets = targets;
    this.selected = selected;
    this.panel.webview.html = this.buildHtml();

    this.panel.webview.onDidReceiveMessage(async (msg: any) => {
      if (msg.command === 'save') {
        await this.saveConfiguration(msg, true);
      } else if (msg.command === 'add') {
        await this.saveConfiguration(msg, false);
      } else if (msg.command === 'delete') {
        await this.deleteTarget(msg.url);
      } else if (msg.command === 'select') {
        await context.globalState.update('selectedEdaTarget', msg.index);
      } else if (msg.command === 'close') {
        this.showReload();
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

  protected getStyles(): string {
    return targetWizardStyles;
  }

  protected getScripts(): string {
    const twJs = this.getResourceUri('resources', 'tailwind.js');
    const data = JSON.stringify(this.targets);
    return targetWizardScripts
      .replace('${twJs}', twJs.toString())
      .replace('${targets}', data)
      .replace('${selected}', this.selected.toString());
  }

  private async saveConfiguration(msg: any, close: boolean): Promise<void> {
    const config = vscode.workspace.getConfiguration('vscode-eda');
    const current = config.get<Record<string, any>>('edaTargets') || {};
    if (msg.originalUrl && msg.originalUrl !== msg.url) {
      delete current[msg.originalUrl];
    }
    current[msg.url] = {
      context: msg.context || undefined,
      edaUsername: msg.edaUsername || undefined,
      kcUsername: msg.kcUsername || undefined
    };
    await config.update('edaTargets', current, vscode.ConfigurationTarget.Global);

    const host = (() => {
      try {
        return new URL(msg.url).host;
      } catch {
        return msg.url;
      }
    })();

    if (msg.edaPassword) {
      await this.context.secrets.store(`edaPassword:${host}`, msg.edaPassword);
    }
    if (msg.kcPassword) {
      await this.context.secrets.store(`kcPassword:${host}`, msg.kcPassword);
    }

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
      vscode.window
        .showInformationMessage('EDA target saved. Reload window to apply.', 'Reload')
        .then(v => {
          if (v === 'Reload') {
            void vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        });

      this.dispose();
      if (this.resolve) {
        this.resolve();
      }
    }
  }

  private async deleteTarget(url: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('vscode-eda');
    const current = config.get<Record<string, any>>('edaTargets') || {};
    delete current[url];
    await config.update('edaTargets', current, vscode.ConfigurationTarget.Global);

    try {
      const host = new URL(url).host;
      await this.context.secrets.delete(`edaPassword:${host}`);
      await this.context.secrets.delete(`kcPassword:${host}`);
    } catch {
      // ignore invalid url
    }
  }

  private showReload(): void {
    vscode.window
      .showInformationMessage('EDA target saved. Reload window to apply.', 'Reload')
      .then(v => {
        if (v === 'Reload') {
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
    const targets = Object.entries(targetsMap).map(([url, val]) => {
      if (typeof val === 'string' || val === null) {
        return { url, context: val || undefined };
      }
      return {
        url,
        context: val.context || undefined,
        edaUsername: val.edaUsername || undefined,
        kcUsername: val.kcUsername || undefined
      };
    });
    const selected = context.globalState.get<number>('selectedEdaTarget', 0) ?? 0;
    const panel = new TargetWizardPanel(context, contexts, targets, selected);
    return panel.waitForClose();
  }
}

export async function configureTargets(context: vscode.ExtensionContext): Promise<void> {
  return TargetWizardPanel.show(context);
}