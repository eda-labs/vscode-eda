import * as vscode from 'vscode';
import { BasePanel } from '../basePanel';
import { serviceManager } from '../../services/serviceManager';
import { EdaClient } from '../../clients/edaClient';

interface ResourceRef {
  group: string;
  version: string;
  kind: string;
  name: string;
  namespace: string;
}

interface NodeRef {
  name: string;
  namespace: string;
}

export class TransactionDiffsPanel extends BasePanel {
  private transactionId: string | number;
  private diffs: ResourceRef[];
  private nodes: NodeRef[];
  private edaClient: EdaClient;

  constructor(
    context: vscode.ExtensionContext,
    transactionId: string | number,
    diffs: ResourceRef[],
    nodes: NodeRef[]
  ) {
    super(context, 'transactionDiffs', `Transaction ${transactionId} Diffs`, undefined, {
      light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-black.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-white.svg')
    });
    this.transactionId = transactionId;
    this.diffs = diffs;
    this.nodes = nodes;
    this.edaClient = serviceManager.getClient<EdaClient>('eda');

    this.panel.webview.onDidReceiveMessage(async msg => {
      if (msg.command === 'ready') {
        this.panel.webview.postMessage({
          command: 'diffs',
          diffs: this.diffs,
          nodes: this.nodes
        });
      } else if (msg.command === 'loadDiff') {
        try {
          let diff;
          if (msg.resource.type === 'node') {
            diff = await this.edaClient.getNodeConfigDiff(
              this.transactionId,
              msg.resource.name,
              msg.resource.namespace
            );
          } else {
            diff = await this.edaClient.getResourceDiff(
              this.transactionId,
              msg.resource.group,
              msg.resource.version,
              msg.resource.kind,
              msg.resource.name,
              msg.resource.namespace
            );
          }
          this.panel.webview.postMessage({ command: 'diff', diff, resource: msg.resource });
        } catch (err: any) {
          this.panel.webview.postMessage({ command: 'error', message: String(err) });
        }
      }
    });

    this.panel.webview.html = this.buildHtml();
  }

  protected getCustomStyles(): string {
    return this.readWebviewFile('transactionDiffs', 'transactionDiffsPanel.css');
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'transactionDiffsPanel.js');
    return `<script nonce="${nonce}" src="${scriptUri}"></script>`;
  }


  static show(
    context: vscode.ExtensionContext,
    transactionId: string | number,
    crs: any[],
    nodes: any[]
  ): void {
    const diffs: ResourceRef[] = [];
    for (const cr of crs) {
      const group = cr.gvk?.group || '';
      const version = cr.gvk?.version || '';
      const kind = cr.gvk?.kind || '';
      const namespace = cr.namespace || 'default';
      const names = Array.isArray(cr.names) ? cr.names : cr.name ? [cr.name] : [];
      for (const n of names) {
        diffs.push({ group, version, kind, namespace, name: n });
      }
    }
    const nodeRefs: NodeRef[] = [];
    for (const node of nodes) {
      if (node?.name) {
        nodeRefs.push({ name: node.name, namespace: node.namespace || 'default' });
      }
    }
    new TransactionDiffsPanel(context, transactionId, diffs, nodeRefs);
  }
}
