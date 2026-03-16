import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

import type { EdaCrd } from '../../types';
import { log, LogLevel } from '../../extension';

import { BasePanel } from '../basePanel';

import type {
  JsonSchemaNode,
  ResourceCreatePanelToWebviewMessage,
  ResourceCreateWebviewMessage
} from './types';

interface ResourceCreatePanelInput {
  resourceUri: vscode.Uri;
  crd: EdaCrd;
  schema: JsonSchemaNode | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseYamlResource(yamlText: string): Record<string, unknown> {
  const parsed = yaml.load(yamlText) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('YAML must represent a single resource object.');
  }
  return parsed;
}

function dumpYamlResource(resource: Record<string, unknown>): string {
  return yaml.dump(resource, { indent: 2 });
}

function isWebviewMessage(message: unknown): message is ResourceCreateWebviewMessage {
  if (!isRecord(message)) {
    return false;
  }
  const command = message.command;
  return command === 'ready' || command === 'formUpdate';
}

export class ResourceCreatePanel extends BasePanel {
  private static readonly panels = new Map<string, ResourceCreatePanel>();

  private readonly resourceUri: vscode.Uri;
  private readonly crd: EdaCrd;
  private readonly schema: JsonSchemaNode | null;
  private readonly subscriptions: vscode.Disposable[] = [];
  private pendingYamlFromForm: string | undefined;
  private disposed = false;

  private constructor(
    context: vscode.ExtensionContext,
    input: ResourceCreatePanelInput,
    showOptions: vscode.ViewColumn | { readonly viewColumn: vscode.ViewColumn; readonly preserveFocus?: boolean }
  ) {
    super(
      context,
      'edaCreateResourcePanel',
      `Create ${input.crd.kind}`,
      { enableFindWidget: true },
      BasePanel.getEdaIconPath(context),
      showOptions
    );
    this.resourceUri = input.resourceUri;
    this.crd = input.crd;
    this.schema = input.schema;

    this.panel.webview.html = this.buildHtml();
    this.registerListeners();
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'resourceCreatePanel.js');
    return `<script type="module" nonce="${nonce}" src="${scriptUri}"></script>`;
  }

  private registerListeners(): void {
    this.subscriptions.push(
      this.panel.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleWebviewMessage(message);
      })
    );

    this.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.uri.toString() === this.resourceUri.toString()) {
          this.handleYamlDocumentChange(event.document);
        }
      })
    );

    this.subscriptions.push(
      this.panel.onDidDispose(() => {
        this.dispose();
      })
    );
  }

  private async handleWebviewMessage(message: unknown): Promise<void> {
    if (!isWebviewMessage(message)) {
      return;
    }

    if (message.command === 'ready') {
      await this.sendInitState();
      return;
    }

    if (message.command === 'formUpdate') {
      if (!isRecord(message.resource)) {
        return;
      }
      await this.applyFormUpdate(message.resource);
    }
  }

  private async sendInitState(): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(this.resourceUri);
      const yamlText = document.getText();
      const resource = parseYamlResource(yamlText);

      this.postMessage({
        command: 'init',
        uri: this.resourceUri.toString(),
        crd: this.crd,
        schema: this.schema,
        resource,
        yaml: yamlText
      });
    } catch (error: unknown) {
      this.postYamlError(error);
    }
  }

  private async applyFormUpdate(resource: Record<string, unknown>): Promise<void> {
    const normalizedYaml = dumpYamlResource(resource);
    const document = await vscode.workspace.openTextDocument(this.resourceUri);
    if (document.getText() === normalizedYaml) {
      return;
    }

    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(this.resourceUri, fullRange, normalizedYaml);
    this.pendingYamlFromForm = normalizedYaml;
    await vscode.workspace.applyEdit(edit);
  }

  private handleYamlDocumentChange(document: vscode.TextDocument): void {
    const yamlText = document.getText();
    if (this.pendingYamlFromForm && yamlText === this.pendingYamlFromForm) {
      this.pendingYamlFromForm = undefined;
      return;
    }

    try {
      const resource = parseYamlResource(yamlText);
      this.pendingYamlFromForm = undefined;
      this.postMessage({
        command: 'yamlModel',
        resource,
        yaml: yamlText
      });
    } catch (error: unknown) {
      this.postYamlError(error);
    }
  }

  private postYamlError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.postMessage({
      command: 'yamlError',
      error: message
    });
  }

  private postMessage(message: ResourceCreatePanelToWebviewMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private async revealYamlEditor(preserveFocus: boolean): Promise<void> {
    const document = await vscode.workspace.openTextDocument(this.resourceUri);
    await vscode.languages.setTextDocumentLanguage(document, 'yaml');
    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus,
      preview: false
    });
  }

  public static async show(
    context: vscode.ExtensionContext,
    input: ResourceCreatePanelInput
  ): Promise<ResourceCreatePanel> {
    const key = input.resourceUri.toString();
    const existing = ResourceCreatePanel.panels.get(key);
    if (existing) {
      existing.panel.reveal(existing.panel.viewColumn ?? vscode.ViewColumn.One);
      await existing.revealYamlEditor(true);
      return existing;
    }

    const baseColumn = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    const panel = new ResourceCreatePanel(
      context,
      input,
      { viewColumn: baseColumn, preserveFocus: false }
    );
    ResourceCreatePanel.panels.set(key, panel);
    await panel.revealYamlEditor(true);
    return panel;
  }

  public override dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    const key = this.resourceUri.toString();
    if (ResourceCreatePanel.panels.get(key) === this) {
      ResourceCreatePanel.panels.delete(key);
    }

    while (this.subscriptions.length > 0) {
      const disposable = this.subscriptions.pop();
      disposable?.dispose();
    }

    log(`Closed create-resource panel for ${this.crd.kind}`, LogLevel.DEBUG);
    super.dispose();
  }
}
