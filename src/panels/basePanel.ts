import * as vscode from 'vscode';

export abstract class BasePanel {
  protected panel: vscode.WebviewPanel;
  protected context: vscode.ExtensionContext;

  constructor(
    context: vscode.ExtensionContext,
    viewType: string,
    title: string,
    options?: vscode.WebviewPanelOptions & vscode.WebviewOptions
  ) {
    this.context = context;
    this.panel = vscode.window.createWebviewPanel(
      viewType,
      title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        ...options
      }
    );
  }

  protected getNonce(): string {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 32 }, () => possible.charAt(Math.floor(Math.random() * possible.length))).join('');
  }

  protected getResourceUri(...pathSegments: string[]): vscode.Uri {
    return this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, ...pathSegments)
    );
  }

  protected abstract getHtml(): string;

  protected abstract getStyles(): string;

  protected abstract getScripts(): string;

  protected buildHtml(): string {
    const nonce = this.getNonce();
    const csp = this.panel.webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} https:; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}' ${csp};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${this.getStyles()}</style>
</head>
<body>
  ${this.getHtml()}
  <script nonce="${nonce}">${this.getScripts()}</script>
</body>
</html>`;
  }

  public dispose(): void {
    this.panel.dispose();
  }
}