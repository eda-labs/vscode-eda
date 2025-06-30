import * as vscode from 'vscode';
import { BasePanel } from '../../basePanel';
import { queriesDashboardHtml } from './queriesDashboardPanel.html';
import { queriesDashboardStyles } from './queriesDashboardPanel.styles';
import { queriesDashboardScripts } from './queriesDashboardPanel.scripts';
import { serviceManager } from '../../../services/serviceManager';
import { EdaClient } from '../../../clients/edaClient';

export class QueriesDashboardPanel extends BasePanel {
  private edaClient: EdaClient;
  private queryStreamName?: string;
  private columns: string[] = [];
  private rows: any[][] = [];
  private rowMap: Map<string, any[]> = new Map();

  constructor(context: vscode.ExtensionContext, title: string) {
    super(context, 'queriesDashboard', title);

    this.edaClient = serviceManager.getClient<EdaClient>('eda');

    this.edaClient.onStreamMessage((stream, msg) => {
      if (stream === this.queryStreamName) {
        this.handleQueryStream(msg);
      }
    });

    this.panel.onDidDispose(() => {
      if (this.queryStreamName) {
        this.edaClient.closeEqlStream(this.queryStreamName);
      }
    });

    this.panel.webview.onDidReceiveMessage(async msg => {
      if (msg.command === 'ready') {
        await this.sendNamespaces();
      } else if (msg.command === 'runQuery') {
        await this.startQueryStream(msg.query as string, msg.namespace as string);
      }
    });

    this.panel.webview.html = this.buildHtml();
  }

  protected getHtml(): string {
    return queriesDashboardHtml;
  }

  protected getCustomStyles(): string {
    return queriesDashboardStyles;
  }

  protected getScripts(): string {
    return queriesDashboardScripts;
  }

  private async sendNamespaces(): Promise<void> {
    const coreNs = this.edaClient.getCoreNamespace();
    const namespaces = this.edaClient
      .getCachedNamespaces()
      .filter(ns => ns !== coreNs);
    namespaces.unshift('All Namespaces');
    this.panel.webview.postMessage({
      command: 'init',
      namespaces,
      selected: 'All Namespaces'
    });
  }

  private async startQueryStream(query: string, namespace: string): Promise<void> {
    this.columns = [];
    this.rows = [];
    this.rowMap.clear();
    if (this.queryStreamName) {
      this.edaClient.closeEqlStream(this.queryStreamName);
    }
    this.queryStreamName = `query-${Date.now()}`;
    const ns = namespace === 'All Namespaces' ? undefined : namespace;
    await this.edaClient.streamEql(query, ns, this.queryStreamName);
    this.panel.webview.postMessage({ command: 'clear' });
  }

  private handleQueryStream(msg: any): void {
    const ops: any[] = Array.isArray(msg.msg?.op) ? msg.msg.op : [];
    if (ops.length === 0) {
      return;
    }
    for (const op of ops) {
      if (Array.isArray(op.delete?.ids)) {
        for (const id of op.delete.ids) {
          this.rowMap.delete(String(id));
        }
      }

      const rows = op?.insert_or_modify?.rows;
      if (!Array.isArray(rows)) continue;

      for (const r of rows) {
        const data = r.data || r;
        if (this.columns.length === 0) {
          this.columns = Object.keys(data);
        }
        const row = this.columns.map(c => data[c]);
        const key = r.id !== undefined ? String(r.id) : `${Date.now()}${Math.random()}`;
        this.rowMap.set(key, row);
      }
    }

    this.rows = Array.from(this.rowMap.values());
    this.panel.webview.postMessage({
      command: 'results',
      columns: this.columns,
      rows: this.rows,
      status: `Count: ${this.rows.length}`
    });
  }

  static show(context: vscode.ExtensionContext, title: string): void {
    new QueriesDashboardPanel(context, title);
  }
}
