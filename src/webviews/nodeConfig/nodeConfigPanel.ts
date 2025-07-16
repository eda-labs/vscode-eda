import * as vscode from 'vscode';
import { BasePanel } from '../basePanel';
import * as fs from 'fs';
import * as path from 'path';

export interface LineRange {
  startLine?: number;
  endLine?: number;
}

export interface Annotation {
  cr: {
    name: string;
    gvk: {
      group: string;
      version: string;
      kind: string;
    };
  };
  lines: LineRange[];
}

export class NodeConfigPanel extends BasePanel {
  private static colorMode: 'full' | 'less' | 'none' = 'full';
  private config: string;
  private annotations: Annotation[];

  constructor(
    context: vscode.ExtensionContext,
    config: string,
    annotations: Annotation[],
    title: string
  ) {
    super(context, 'nodeConfig', `Node Config: ${title}`, { enableFindWidget: true }, {
      light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-black.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-white.svg')
    });

    this.config = config;
    this.annotations = annotations;

    NodeConfigPanel.colorMode = context.globalState.get<'full' | 'less' | 'none'>(
      'nodeConfigColorMode',
      vscode.workspace
        .getConfiguration('vscode-eda')
        .get<'full' | 'less' | 'none'>('nodeConfigColorMode', 'full')
    );

    this.panel.webview.html = this.buildHtml();

    this.panel.webview.onDidReceiveMessage((message) => {
      if (message.command === 'saveColorMode') {
        NodeConfigPanel.colorMode = message.colorMode;
        this.context.globalState.update('nodeConfigColorMode', NodeConfigPanel.colorMode);
      }
    });

    // Now reading from the fields so they're actually used:
    this.panel.webview.postMessage({
      command: 'loadData',
      config: this.config,
      annotations: this.annotations,
      colorMode: NodeConfigPanel.colorMode,
    });
  }

  protected getHtml(): string {
    try {
      const filePath = this.context.asAbsolutePath(
        path.join('src', 'webviews', 'nodeConfig', 'nodeConfigPanel.html')
      );
      return fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      console.error('Failed to load Node Config HTML', err);
      return '';
    }
  }

  protected getCustomStyles(): string {
    try {
      const filePath = this.context.asAbsolutePath(
        path.join('src', 'webviews', 'nodeConfig', 'nodeConfigPanel.css')
      );
      return fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      console.error('Failed to load Node Config CSS', err);
      return '';
    }
  }

  protected getScripts(): string {
    return '';
  }

  protected buildHtml(): string {
    const nonce = this.getNonce();
    const csp = this.panel.webview.cspSource;
    const codiconUri = this.getResourceUri('resources', 'codicon.css');
    const scriptUri = this.getResourceUri('dist', 'nodeConfigPanel.js');
    const tailwind = (BasePanel as any).tailwind ?? '';
    const styles = `${tailwind}\n${this.getCustomStyles()}`;

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
  <script nonce="${nonce}" data-color-mode="${NodeConfigPanel.colorMode}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  static show(
    context: vscode.ExtensionContext,
    config: string,
    annotations: Annotation[],
    node: string
  ): void {
    new NodeConfigPanel(context, config, annotations, node);
  }
}
