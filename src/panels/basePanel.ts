import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export abstract class BasePanel {
  protected panel: vscode.WebviewPanel;
  protected context: vscode.ExtensionContext;
  private static tailwind: string | null = null;

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

    if (!BasePanel.tailwind) {
      try {
        const filePath = path.join(this.context.extensionPath, 'resources', 'tailwind.css');
        BasePanel.tailwind = fs.readFileSync(filePath, 'utf8');
      } catch (err) {
        BasePanel.tailwind = '';
        console.error('Failed to load Tailwind CSS', err);
      }
    }
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

  protected abstract getCustomStyles(): string;

  protected abstract getScripts(): string;

  protected buildHtml(): string {
    const nonce = this.getNonce();
    const csp = this.panel.webview.cspSource;
    const codiconUri = this.getResourceUri('resources', 'codicon.css');
    const styles = `${BasePanel.tailwind ?? ''}\n${this.getCustomStyles()}`;

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
  <script nonce="${nonce}">${this.getScripts()}</script>
</body>
</html>`;
  }

  public dispose(): void {
    this.panel.dispose();
  }
}
