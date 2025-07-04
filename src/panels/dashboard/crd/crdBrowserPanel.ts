import * as vscode from 'vscode';
import { BasePanel } from '../../basePanel';
import { crdBrowserHtml } from './crdBrowserPanel.html';
import { crdBrowserStyles } from './crdBrowserPanel.styles';
import { crdBrowserScripts } from './crdBrowserPanel.scripts';
import { serviceManager } from '../../../services/serviceManager';
import { KubernetesClient } from '../../../clients/kubernetesClient';
import * as yaml from 'js-yaml';

export class CrdBrowserPanel extends BasePanel {
  private k8sClient: KubernetesClient;
  private crds: any[] = [];
  private target?: { group: string; kind: string };

  constructor(
    context: vscode.ExtensionContext,
    title: string,
    target?: { group: string; kind: string }
  ) {
    super(context, 'crdBrowser', title, undefined, {
      light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-black.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-white.svg')
    });

    this.target = target;

    this.k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');

    this.panel.webview.onDidReceiveMessage(async msg => {
      if (msg.command === 'ready') {
        await this.loadCrds();
      } else if (msg.command === 'showCrd') {
        await this.showCrd(msg.name as string);
      } else if (msg.command === 'viewYaml') {
        await this.openCrdYaml(msg.name as string);
      }
    });

    this.panel.webview.html = this.buildHtml();
  }

  protected getHtml(): string {
    return crdBrowserHtml;
  }

  protected getCustomStyles(): string {
    return crdBrowserStyles;
  }

  protected getScripts(): string {
    return crdBrowserScripts;
  }

  private async loadCrds(): Promise<void> {
    try {
      this.crds = await this.k8sClient.listCrds();
      const list = this.crds.map(c => ({
        name: c.metadata?.name || '',
        kind: c.spec?.names?.kind || c.metadata?.name || ''
      }));
      let selected: string | undefined;
      if (this.target) {
        const match = this.crds.find(
          c =>
            c.spec?.group === this.target?.group &&
            c.spec?.names?.kind === this.target?.kind
        );
        selected = match?.metadata?.name;
      }
      this.panel.webview.postMessage({ command: 'crds', list, selected });
    } catch (err: any) {
      this.panel.webview.postMessage({ command: 'error', message: String(err) });
    }
  }

  private async showCrd(name: string): Promise<void> {
    const crd = this.crds.find(c => c.metadata?.name === name);
    if (crd) {
      const meta = {
        apiVersion: `${crd.spec?.group}/${crd.spec?.versions?.[0]?.name}`,
        kind: crd.spec?.names?.kind
      };
      const yamlText = yaml.dump(meta, { indent: 2 });
      this.panel.webview.postMessage({ command: 'crdData', crd, yaml: yamlText });
    }
  }

  private async openCrdYaml(name: string): Promise<void> {
    const crd = this.crds.find(c => c.metadata?.name === name);
    if (!crd) return;
    const yamlText = yaml.dump(crd, { indent: 2 });
    const doc = await vscode.workspace.openTextDocument({ language: 'yaml', content: yamlText });
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  static show(
    context: vscode.ExtensionContext,
    title: string,
    target?: { group: string; kind: string }
  ): void {
    new CrdBrowserPanel(context, title, target);
  }
}
