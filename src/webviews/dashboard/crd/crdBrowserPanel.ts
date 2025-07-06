import * as vscode from 'vscode';
import { BasePanel } from '../../basePanel';
import * as fs from 'fs';
import * as path from 'path';
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
    try {
      const filePath = this.context.asAbsolutePath(
        path.join(
          'src',
          'webviews',
          'dashboard',
          'crd',
          'crdBrowserPanel.html'
        )
      );
      return fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      console.error('Failed to load CRD Browser HTML', err);
      return '';
    }
  }

  protected getCustomStyles(): string {
    try {
      const filePath = this.context.asAbsolutePath(
        path.join(
          'src',
          'webviews',
          'dashboard',
          'crd',
          'crdBrowserPanel.css'
        )
      );
      return fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      console.error('Failed to load CRD Browser CSS', err);
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
    const scriptUri = this.getResourceUri('dist', 'crdBrowserPanel.js');
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
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
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
