import * as vscode from 'vscode';

import { BasePanel } from '../basePanel';

interface WebviewMessage {
  command: string;
  text?: string;
}

export class DeviationDetailsPanel extends BasePanel {
  private static panels: Map<string, DeviationDetailsPanel> = new Map();
  private data: Record<string, unknown>;

  constructor(context: vscode.ExtensionContext, data: Record<string, unknown>) {
    super(context, 'deviationDetails', `Deviation ${data.name}`, undefined, BasePanel.getEdaIconPath(context));

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
    void this.panel.webview.postMessage({
      command: 'init',
      data: this.data
    });
  }

  private update(data: Record<string, unknown>): void {
    this.data = data;
    this.panel.title = `Deviation ${data.name}`;
    this.sendData();
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'deviationDetailsPanel.js');
    return `<script type="module" nonce="${nonce}" src="${scriptUri}"></script>`;
  }

  static show(context: vscode.ExtensionContext, data: Record<string, unknown>): void {
    const name = String(data.name ?? '');
    const namespace = String(data.namespace ?? '');
    const key = `${namespace}/${name}`;
    const existing = DeviationDetailsPanel.panels.get(key);
    if (existing) {
      existing.update(data);
      existing.panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    const panel = new DeviationDetailsPanel(context, data);
    DeviationDetailsPanel.panels.set(key, panel);
    panel.panel.onDidDispose(() => {
      DeviationDetailsPanel.panels.delete(key);
    });
  }
}
