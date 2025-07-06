import * as vscode from 'vscode';
import { BasePanel } from '../../basePanel';
import * as fs from 'fs';
import * as path from 'path';
import { serviceManager } from '../../../services/serviceManager';
import { EdaClient } from '../../../clients/edaClient';

export class QueriesDashboardPanel extends BasePanel {
  private edaClient: EdaClient;
  private queryStreamName?: string;
  private columns: string[] = [];
  private rows: any[][] = [];
  private rowMap: Map<string, any[]> = new Map();

  constructor(context: vscode.ExtensionContext, title: string) {
    super(context, 'queriesDashboard', title, undefined, {
      light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-black.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-white.svg')
    });

    this.edaClient = serviceManager.getClient<EdaClient>('eda');

    this.edaClient.onStreamMessage((stream, msg) => {
      if (stream === this.queryStreamName) {
        this.handleQueryStream(msg);
      }
    });

    this.panel.onDidDispose(() => {
      if (this.queryStreamName) {
        void this.edaClient.closeEqlStream(this.queryStreamName);
      }
    });

    this.panel.webview.onDidReceiveMessage(async msg => {
      if (msg.command === 'ready') {
        await this.sendNamespaces();
      } else if (msg.command === 'runQuery') {
        await this.startQueryStream(msg.query as string, msg.namespace as string);
      } else if (msg.command === 'autocomplete') {
        const list = await this.edaClient.autocompleteEql(msg.query as string, 20);
        this.panel.webview.postMessage({ command: 'autocomplete', list });
      }
    });

    this.panel.webview.html = this.buildHtml();
  }

  protected getHtml(): string {
    try {
      const filePath = this.context.asAbsolutePath(
        path.join(
          'src',
          'webviews',
          'dashboard',
          'queries',
          'queriesDashboard.html'
        )
      );
      return fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      console.error('Failed to load Queries dashboard HTML', err);
      return '';
    }
  }

  protected getCustomStyles(): string {
    try {
      const filePath = this.context.asAbsolutePath(
        path.join(
          'src',
          'webviews',
          'dashboard',
          'queries',
          'queriesDashboard.css'
        )
      );
      return fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      console.error('Failed to load Queries dashboard CSS', err);
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
    const scriptUri = this.getResourceUri('dist', 'queriesDashboard.js');
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
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
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
      await this.edaClient.closeEqlStream(this.queryStreamName);
    }
    this.queryStreamName = `query-${Date.now()}`;
    const ns = namespace === 'All Namespaces' ? undefined : namespace;
    await this.edaClient.streamEql(query, ns, this.queryStreamName);
    this.panel.webview.postMessage({ command: 'clear' });
  }

  private handleQueryStream(msg: any): void {
    const ops: any[] = Array.isArray(msg.msg?.op) ? msg.msg.op : [];
    if (ops.length === 0) {
      if (this.rows.length === 0) {
        this.panel.webview.postMessage({
          command: 'results',
          columns: [],
          rows: [],
          status: 'No results to display'
        });
      }
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
