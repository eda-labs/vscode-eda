import * as vscode from 'vscode';
import { BasePanel } from '../../basePanel';
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
    super(context, 'resourceBrowser', title, { enableFindWidget: true }, {
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
    return '<div id="root"></div>';
  }

  protected getCustomStyles(): string {
    return this.readWebviewFile('dashboard', 'resource', 'resourceBrowserPanel.css');
  }

  protected getScripts(): string {
    return '';
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'resourceBrowserPanel.js');
    return `<script nonce="${nonce}" src="${scriptUri}"></script>`;
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
