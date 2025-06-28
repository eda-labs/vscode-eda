import * as vscode from 'vscode';
import { BasePanel } from './basePanel';
import { nodeConfigStyles } from './nodeConfigPanel.styles';
import { nodeConfigHtml } from './nodeConfigPanel.html';
import { nodeConfigScripts } from './nodeConfigPanel.scripts';

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
    super(context, 'nodeConfig', `Node Config: ${title}`);

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
    return nodeConfigHtml;
  }

  protected getStyles(): string {
    return nodeConfigStyles;
  }

  protected getScripts(): string {
    return nodeConfigScripts.replace('${colorMode}', NodeConfigPanel.colorMode);
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
