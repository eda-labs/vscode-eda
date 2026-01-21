import * as vscode from 'vscode';
import { BasePanel } from '../basePanel';

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
      if (message.command === 'ready') {
        this.panel.webview.postMessage({
          command: 'loadData',
          config: this.config,
          annotations: this.annotations,
          colorMode: NodeConfigPanel.colorMode,
        });
      } else if (message.command === 'saveColorMode') {
        NodeConfigPanel.colorMode = message.colorMode;
        this.context.globalState.update('nodeConfigColorMode', NodeConfigPanel.colorMode);
      }
    });
  }

  protected getCustomStyles(): string {
    return this.readWebviewFile('nodeConfig', 'nodeConfigPanel.css');
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'nodeConfigPanel.js');
    return `<script nonce="${nonce}" src="${scriptUri}"></script>`;
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
