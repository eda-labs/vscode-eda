import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import * as vscode from 'vscode';

import { RESOURCES_DIR, ICON_LIGHT, ICON_DARK } from './constants';

export abstract class BasePanel {
  protected panel: vscode.WebviewPanel;
  protected context: vscode.ExtensionContext;
  private static tailwind: string | null = null;

  constructor(
    context: vscode.ExtensionContext,
    viewType: string,
    title: string,
    options?: vscode.WebviewPanelOptions & vscode.WebviewOptions,
    iconPath?: { light: vscode.Uri; dark: vscode.Uri }
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

    if (iconPath) {
      this.panel.iconPath = iconPath;
    }

    if (!BasePanel.tailwind) {
      try {
        const filePath = path.join(this.context.extensionPath, RESOURCES_DIR, 'tailwind.css');
        BasePanel.tailwind = fs.readFileSync(filePath, 'utf8');
      } catch (err) {
        BasePanel.tailwind = '';
        console.error('Failed to load Tailwind CSS', err);
      }
    }
  }

  protected getNonce(): string {
    return randomBytes(16).toString('hex');
  }

  /**
   * Helper to get the standard EDA icon path for webview panels
   */
  protected static getEdaIconPath(context: vscode.ExtensionContext): { light: vscode.Uri; dark: vscode.Uri } {
    return {
      light: vscode.Uri.joinPath(context.extensionUri, RESOURCES_DIR, ICON_LIGHT),
      dark: vscode.Uri.joinPath(context.extensionUri, RESOURCES_DIR, ICON_DARK)
    };
  }

  protected getResourceUri(...pathSegments: string[]): vscode.Uri {
    return this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, ...pathSegments)
    );
  }

  protected readWebviewFile(...segments: string[]): string {
    try {
      const filePath = this.context.asAbsolutePath(
        path.join('src', 'webviews', ...segments)
      );
      return fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      console.error(`Failed to load ${segments.join('/')}`, err);
      return '';
    }
  }

  protected getCustomStyles(): string {
    return '';
  }

  protected getScriptTags(_nonce: string): string {
    return '';
  }

  protected buildHtml(): string {
    const nonce = this.getNonce();
    const csp = this.panel.webview.cspSource;
    const codiconUri = this.getResourceUri(RESOURCES_DIR, 'codicon.css');
    const customStyles = this.getCustomStyles();
    const styles = customStyles ? `${BasePanel.tailwind ?? ''}\n${customStyles}` : BasePanel.tailwind ?? '';
    const scriptTags = this.getScriptTags(nonce);

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
  <div id="root"></div>
  ${scriptTags}
</body>
</html>`;
  }

  public dispose(): void {
    this.panel.dispose();
  }
}
