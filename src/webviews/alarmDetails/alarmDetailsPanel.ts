import * as vscode from 'vscode';

import { BasePanel } from '../basePanel';

interface WebviewMessage {
  command: string;
  text?: string;
}

export class AlarmDetailsPanel extends BasePanel {
  private static panels: Map<string, AlarmDetailsPanel> = new Map();
  private data: Record<string, unknown>;

  constructor(context: vscode.ExtensionContext, data: Record<string, unknown>) {
    super(context, 'alarmDetails', `Alarm ${data.name}`, undefined, BasePanel.getEdaIconPath(context));

    this.data = data;
    this.panel.webview.html = this.buildHtml();

    this.panel.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        switch (message.command) {
          case 'ready':
            this.sendData();
            break;
          case 'copy':
            await vscode.env.clipboard.writeText(message.text ?? '');
            break;
        }
      },
      undefined,
      context.subscriptions
    );
  }

  private sendData(): void {
    this.panel.webview.postMessage({
      command: 'init',
      data: this.data
    });
  }

  private update(data: Record<string, unknown>): void {
    this.data = data;
    this.panel.title = `Alarm ${data.name}`;
    this.sendData();
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'alarmDetailsPanel.js');
    return `<script nonce="${nonce}" src="${scriptUri}"></script>`;
  }

  static show(context: vscode.ExtensionContext, data: Record<string, unknown>): void {
    const key = String(data.name);
    const existing = AlarmDetailsPanel.panels.get(key);
    if (existing) {
      existing.update(data);
      existing.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = new AlarmDetailsPanel(context, data);
    AlarmDetailsPanel.panels.set(key, panel);
    panel.panel.onDidDispose(() => {
      AlarmDetailsPanel.panels.delete(key);
    });
  }
}
