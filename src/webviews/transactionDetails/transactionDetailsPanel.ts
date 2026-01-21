import * as vscode from 'vscode';
import { BasePanel } from '../basePanel';
import { TransactionDiffsPanel } from '../transactionDiffs/transactionDiffsPanel';

export class TransactionDetailsPanel extends BasePanel {
  private static panels: Map<string, TransactionDetailsPanel> = new Map();
  private data: Record<string, unknown>;

  constructor(context: vscode.ExtensionContext, data: Record<string, unknown>) {
    super(context, 'transactionDetails', `Transaction ${data.id}`, undefined, {
      light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-black.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-white.svg')
    });
    this.data = data;
    this.panel.webview.html = this.buildHtml();

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'ready':
            this.sendData();
            break;
          case 'copy':
            await vscode.env.clipboard.writeText(message.text);
            break;
          case 'showDiffs':
            TransactionDiffsPanel.show(
              this.context,
              this.data.id as string,
              (this.data.changedCrs as unknown[]) || [],
              (this.data.nodesWithConfigChanges as unknown[]) || []
            );
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
    this.panel.title = `Transaction ${data.id}`;
    this.sendData();
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'transactionDetailsPanel.js');
    return `<script nonce="${nonce}" src="${scriptUri}"></script>`;
  }

  static show(context: vscode.ExtensionContext, data: Record<string, unknown>): void {
    const key = String(data.id);
    const existing = TransactionDetailsPanel.panels.get(key);
    if (existing) {
      existing.update(data);
      existing.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = new TransactionDetailsPanel(context, data);
    TransactionDetailsPanel.panels.set(key, panel);
    panel.panel.onDidDispose(() => {
      TransactionDetailsPanel.panels.delete(key);
    });
  }
}
