import * as vscode from 'vscode';

import { BasePanel } from '../basePanel';

import type {
  ExplorerResourceListInvokeCommandMessage,
  ExplorerResourceListOutgoingMessage,
  ExplorerResourceListPayload
} from './explorerResourceListTypes';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isInvokeCommandMessage(
  message: ExplorerResourceListOutgoingMessage
): message is ExplorerResourceListInvokeCommandMessage {
  return message.command === 'invokeCommand';
}

function toCommandArgument(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => toCommandArgument(item));
  }

  if (!isObject(value)) {
    return value;
  }

  if (typeof value.__vscodeUri === 'string') {
    return vscode.Uri.parse(value.__vscodeUri);
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = toCommandArgument(nested);
  }
  return output;
}

export class ExplorerResourceListPanel extends BasePanel {
  private static currentPanel: ExplorerResourceListPanel | undefined;

  private payload: ExplorerResourceListPayload;

  constructor(context: vscode.ExtensionContext, payload: ExplorerResourceListPayload) {
    super(
      context,
      'explorerResourceList',
      payload.title,
      { enableFindWidget: true },
      BasePanel.getEdaIconPath(context),
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: true }
    );

    this.payload = payload;

    this.panel.webview.onDidReceiveMessage((message: ExplorerResourceListOutgoingMessage) => {
      void this.handleMessage(message);
    });

    this.panel.webview.html = this.buildHtml();
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'explorerResourceListPanel.js');
    return `<script type="module" nonce="${nonce}" src="${scriptUri}"></script>`;
  }

  private async handleMessage(message: ExplorerResourceListOutgoingMessage): Promise<void> {
    if (message.command === 'ready') {
      this.postData();
      return;
    }

    if (!isInvokeCommandMessage(message) || !message.commandId) {
      return;
    }

    const args = Array.isArray(message.args)
      ? message.args.map(item => toCommandArgument(item))
      : [];

    try {
      await vscode.commands.executeCommand(message.commandId, ...args);
    } catch (error: unknown) {
      const messageText = error instanceof Error ? error.message : String(error);
      void this.panel.webview.postMessage({
        command: 'error',
        message: messageText
      });
    }
  }

  private postData(): void {
    void this.panel.webview.postMessage({
      command: 'setData',
      payload: this.payload
    });
  }

  public updatePayload(payload: ExplorerResourceListPayload): void {
    this.payload = payload;
    this.panel.title = payload.title;
    this.postData();
  }

  public static show(context: vscode.ExtensionContext, payload: ExplorerResourceListPayload): ExplorerResourceListPanel {
    if (ExplorerResourceListPanel.currentPanel) {
      ExplorerResourceListPanel.currentPanel.updatePayload(payload);
      ExplorerResourceListPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active, true);
      return ExplorerResourceListPanel.currentPanel;
    }

    const panel = new ExplorerResourceListPanel(context, payload);
    ExplorerResourceListPanel.currentPanel = panel;
    panel.panel.reveal(vscode.ViewColumn.Active, true);

    panel.panel.onDidDispose(() => {
      if (ExplorerResourceListPanel.currentPanel === panel) {
        ExplorerResourceListPanel.currentPanel = undefined;
      }
    });

    return panel;
  }
}
