import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

import { BasePanel } from '../../basePanel';
import { serviceManager } from '../../../services/serviceManager';
import type { SchemaProviderService } from '../../../services/schemaProviderService';
import type { EdaCrd } from '../../../types';

interface WebviewMessage {
  command: string;
  name?: string;
}

export class ResourceBrowserPanel extends BasePanel {
  private static currentPanel: ResourceBrowserPanel | undefined;
  private schemaProvider: SchemaProviderService;
  private resources: EdaCrd[] = [];
  private target?: { group: string; kind: string };

  constructor(
    context: vscode.ExtensionContext,
    title: string,
    target?: { group: string; kind: string }
  ) {
    super(context, 'resourceBrowser', title, { enableFindWidget: true }, BasePanel.getEdaIconPath(context));

    this.target = target;

    this.schemaProvider = serviceManager.getService<SchemaProviderService>('schema-provider');

    this.panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      if (msg.command === 'ready') {
        await this.loadResources();
      } else if (msg.command === 'showResource' && msg.name) {
        await this.showResource(msg.name);
      } else if (msg.command === 'viewYaml' && msg.name) {
        await this.openResourceYaml(msg.name);
      }
    });

    this.panel.webview.html = this.buildHtml();
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'resourceBrowserPanel.js');
    return `<script type="module" nonce="${nonce}" src="${scriptUri}"></script>`;
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
    } catch (err: unknown) {
      this.panel.webview.postMessage({ command: 'error', message: String(err) });
    }
  }

  private async updateTarget(
    title: string,
    target?: { group: string; kind: string }
  ): Promise<void> {
    this.panel.title = title;
    this.target = target;
    await this.loadResources();
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
  ): ResourceBrowserPanel {
    if (ResourceBrowserPanel.currentPanel) {
      void ResourceBrowserPanel.currentPanel.updateTarget(title, target);
      ResourceBrowserPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
      return ResourceBrowserPanel.currentPanel;
    }

    const panel = new ResourceBrowserPanel(context, title, target);
    ResourceBrowserPanel.currentPanel = panel;
    panel.panel.onDidDispose(() => {
      if (ResourceBrowserPanel.currentPanel === panel) {
        ResourceBrowserPanel.currentPanel = undefined;
      }
    });
    return panel;
  }
}
