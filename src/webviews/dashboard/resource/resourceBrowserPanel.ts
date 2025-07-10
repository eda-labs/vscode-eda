import * as vscode from 'vscode';
import { BasePanel } from '../../basePanel';
import * as fs from 'fs';
import * as path from 'path';
import { serviceManager } from '../../../services/serviceManager';
import { SchemaProviderService } from '../../../services/schemaProviderService';
import { EdaCrd } from '../../../types';
import * as yaml from 'js-yaml';

export class ResourceBrowserPanel extends BasePanel {
  private schemaProvider: SchemaProviderService;
  private resources: EdaCrd[] = [];
  private target?: { group: string; kind: string };

  constructor(
    context: vscode.ExtensionContext,
    title: string,
    target?: { group: string; kind: string }
  ) {
    super(context, 'resourceBrowser', title, undefined, {
      light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-black.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-white.svg')
    });

    this.target = target;

    this.schemaProvider = serviceManager.getService<SchemaProviderService>('schema-provider');

    this.panel.webview.onDidReceiveMessage(async msg => {
      if (msg.command === 'ready') {
        await this.loadResources();
      } else if (msg.command === 'showResource') {
        await this.showResource(msg.name as string);
      } else if (msg.command === 'viewYaml') {
        await this.openResourceYaml(msg.name as string);
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
          'resource',
          'resourceBrowserPanel.html'
        )
      );
      return fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      console.error('Failed to load Resource Browser HTML', err);
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
          'resource',
          'resourceBrowserPanel.css'
        )
      );
      return fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      console.error('Failed to load Resource Browser CSS', err);
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
    const scriptUri = this.getResourceUri('dist', 'resourceBrowserPanel.js');
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

  private async loadResources(): Promise<void> {
    try {
      this.resources = await this.schemaProvider.getCustomResourceDefinitions();
      const list = this.resources.map(r => ({
        name: `${r.plural}.${r.group}`,
        kind: r.kind
      }));
      let selected: string | undefined;
      if (this.target) {
        const match = this.resources.find(
          r => r.group === this.target?.group && r.kind === this.target?.kind
        );
        selected = match ? `${match.plural}.${match.group}` : undefined;
      }
      this.panel.webview.postMessage({ command: 'resources', list, selected });
    } catch (err: any) {
      this.panel.webview.postMessage({ command: 'error', message: String(err) });
    }
  }

  private async showResource(name: string): Promise<void> {
    const [plural, ...groupParts] = name.split('.');
    const group = groupParts.join('.');
    const def = this.resources.find(r => r.group === group && r.plural === plural);
    if (def) {
      const schema = await this.schemaProvider.getSchemaForKind(def.kind);
      const meta = { apiVersion: `${def.group}/${def.version}`, kind: def.kind };
      const yamlText = yaml.dump(meta, { indent: 2 });
      this.panel.webview.postMessage({
        command: 'resourceData',
        schema,
        kind: def.kind,
        description: def.description,
        yaml: yamlText
      });
    }
  }

  private async openResourceYaml(name: string): Promise<void> {
    const [plural, ...groupParts] = name.split('.');
    const group = groupParts.join('.');
    const def = this.resources.find(r => r.group === group && r.plural === plural);
    if (!def) return;
    const schema = await this.schemaProvider.getSchemaForKind(def.kind);
    const yamlText = yaml.dump(schema, { indent: 2 });
    const doc = await vscode.workspace.openTextDocument({ language: 'yaml', content: yamlText });
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  static show(
    context: vscode.ExtensionContext,
    title: string,
    target?: { group: string; kind: string }
  ): void {
    new ResourceBrowserPanel(context, title, target);
  }
}
