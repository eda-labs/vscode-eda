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
  private resolve: (value: void | PromiseLike<void>) => void;

  constructor(context: vscode.ExtensionContext, contexts: string[]) {
    super(context, 'edaTargetWizard', 'Configure EDA Targets');
    this.contexts = contexts;
    this.panel.webview.html = this.buildHtml();

    this.panel.webview.onDidReceiveMessage(async (msg: any) => {
      if (msg.command === 'save') {
        await this.saveConfiguration(msg);
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
    return targetWizardScripts;
  }

  private async saveConfiguration(msg: any): Promise<void> {
    const config = vscode.workspace.getConfiguration('vscode-eda');
    const current = config.get<Record<string, any>>('edaTargets') || {};
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
    await this.context.secrets.store(`edaPassword:${host}`, msg.edaPassword || '');
    await this.context.secrets.store(`kcPassword:${host}`, msg.kcPassword || '');

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
    const panel = new TargetWizardPanel(context, contexts);
    return panel.waitForClose();
  }
}

export async function configureTargets(context: vscode.ExtensionContext): Promise<void> {
  return TargetWizardPanel.show(context);
}