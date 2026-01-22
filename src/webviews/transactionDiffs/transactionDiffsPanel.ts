import type * as vscode from 'vscode';

import { BasePanel } from '../basePanel';
import { serviceManager } from '../../services/serviceManager';
import type { EdaClient } from '../../clients/edaClient';

/** Reference to a Kubernetes resource for diff viewing */
interface ResourceRef {
  group: string;
  version: string;
  kind: string;
  name: string;
  namespace: string;
}

/** Reference to a node for config diff viewing */
interface NodeRef {
  name: string;
  namespace: string;
}

/** Message received from webview */
interface WebviewMessage {
  command: string;
  resource?: DiffResource;
}

/** Resource reference in diff request */
interface DiffResource {
  type?: string;
  group?: string;
  version?: string;
  kind?: string;
  name: string;
  namespace: string;
}

/** CR object from transaction containing GVK and resource references */
export interface TransactionCR {
  gvk?: {
    group?: string;
    version?: string;
    kind?: string;
  };
  namespace?: string;
  name?: string;
  names?: string[];
}

/** Node object from transaction */
export interface TransactionNode {
  name?: string;
  namespace?: string;
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
    super(context, 'transactionDiffs', `Transaction ${transactionId} Diffs`, undefined, BasePanel.getEdaIconPath(context));
    this.transactionId = transactionId;
    this.diffs = diffs;
    this.nodes = nodes;
    this.edaClient = serviceManager.getClient<EdaClient>('eda');

    this.panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      if (msg.command === 'ready') {
        this.panel.webview.postMessage({
          command: 'diffs',
          diffs: this.diffs,
          nodes: this.nodes
        });
      } else if (msg.command === 'loadDiff' && msg.resource) {
        try {
          let diff: unknown;
          if (msg.resource.type === 'node') {
            diff = await this.edaClient.getNodeConfigDiff(
              this.transactionId,
              msg.resource.name,
              msg.resource.namespace
            ) as unknown;
          } else {
            diff = await this.edaClient.getResourceDiff(
              this.transactionId,
              msg.resource.group ?? '',
              msg.resource.version ?? '',
              msg.resource.kind ?? '',
              msg.resource.name,
              msg.resource.namespace
            ) as unknown;
          }
          this.panel.webview.postMessage({ command: 'diff', diff, resource: msg.resource });
        } catch (err: unknown) {
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


  /** Extract names array from CR object */
  private static extractNames(cr: TransactionCR): string[] {
    if (Array.isArray(cr.names)) return cr.names;
    if (cr.name) return [cr.name];
    return [];
  }

  /** Convert CR to ResourceRef array */
  private static crToResourceRefs(cr: TransactionCR): ResourceRef[] {
    const group = cr.gvk?.group ?? '';
    const version = cr.gvk?.version ?? '';
    const kind = cr.gvk?.kind ?? '';
    const namespace = cr.namespace ?? 'default';
    const names = TransactionDiffsPanel.extractNames(cr);
    return names.map(n => ({ group, version, kind, namespace, name: n }));
  }

  /** Convert node to NodeRef if valid */
  private static nodeToRef(node: TransactionNode): NodeRef | null {
    if (!node.name) return null;
    return { name: node.name, namespace: node.namespace ?? 'default' };
  }

  static show(
    context: vscode.ExtensionContext,
    transactionId: string | number,
    crs: TransactionCR[],
    nodes: TransactionNode[]
  ): TransactionDiffsPanel {
    const diffs = crs.flatMap(cr => TransactionDiffsPanel.crToResourceRefs(cr));
    const nodeRefs = nodes.map(n => TransactionDiffsPanel.nodeToRef(n)).filter((r): r is NodeRef => r !== null);
    return new TransactionDiffsPanel(context, transactionId, diffs, nodeRefs);
  }
}
