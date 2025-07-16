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

export class TransactionDiffsPanel extends BasePanel {
  private transactionId: string | number;
  private resources: ResourceRef[];
  private edaClient: EdaClient;

  constructor(
    context: vscode.ExtensionContext,
    transactionId: string | number,
    resources: ResourceRef[]
  ) {
    super(context, 'transactionDiffs', `Transaction ${transactionId} Diffs`, undefined, {
      light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-black.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-white.svg')
    });
    this.transactionId = transactionId;
    this.resources = resources;
    this.edaClient = serviceManager.getClient<EdaClient>('eda');

    this.panel.webview.onDidReceiveMessage(async msg => {
      if (msg.command === 'ready') {
        this.panel.webview.postMessage({ command: 'resources', resources: this.resources });
      } else if (msg.command === 'loadDiff') {
        try {
          const diff = await this.edaClient.getResourceDiff(
            this.transactionId,
            msg.resource.group,
            msg.resource.version,
            msg.resource.kind,
            msg.resource.name,
            msg.resource.namespace
          );
          this.panel.webview.postMessage({ command: 'diff', diff, resource: msg.resource });
        } catch (err: any) {
          this.panel.webview.postMessage({ command: 'error', message: String(err) });
        }
      }
    });

    this.panel.webview.html = this.buildHtml();
  }

  protected getHtml(): string {
    return this.readWebviewFile('transactionDiffs', 'transactionDiffsPanel.html');
  }

  protected getCustomStyles(): string {
    return this.readWebviewFile('transactionDiffs', 'transactionDiffsPanel.css');
  }

  protected getScripts(): string {
    return `
      const vscode = acquireVsCodeApi();
      const listEl = document.getElementById('diffList');
      const beforeEl = document.getElementById('before');
      const afterEl = document.getElementById('after');
      let resources = [];
      window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.command === 'resources') {
          resources = msg.resources;
          renderList();
        } else if (msg.command === 'diff') {
          renderDiff(msg.diff);
        } else if (msg.command === 'error') {
          beforeEl.textContent = msg.message;
          afterEl.textContent = '';
        }
      });
      function renderList() {
        listEl.innerHTML = '';
        resources.forEach((r, idx) => {
          const btn = document.createElement('button');
          btn.className = 'resource-btn';
          btn.textContent = r.name;
          btn.addEventListener('click', () => {
            vscode.postMessage({ command: 'loadDiff', resource: r });
            document.querySelectorAll('.resource-btn').forEach(el => el.classList.remove('selected'));
            btn.classList.add('selected');
          });
          if (idx === 0) btn.classList.add('selected');
          listEl.appendChild(btn);
        });
        if (resources.length > 0) {
          vscode.postMessage({ command: 'loadDiff', resource: resources[0] });
        }
      }
      function renderDiff(diff) {
        beforeEl.textContent = diff.before?.data || '';
        afterEl.textContent = diff.after?.data || '';
      }
      vscode.postMessage({ command: 'ready' });
    `;
  }

  static show(context: vscode.ExtensionContext, transactionId: string | number, crs: any[]): void {
    const resources: ResourceRef[] = [];
    for (const cr of crs) {
      const group = cr.gvk?.group || '';
      const version = cr.gvk?.version || '';
      const kind = cr.gvk?.kind || '';
      const namespace = cr.namespace || 'default';
      const names = Array.isArray(cr.names) ? cr.names : cr.name ? [cr.name] : [];
      for (const n of names) {
        resources.push({ group, version, kind, namespace, name: n });
      }
    }
    new TransactionDiffsPanel(context, transactionId, resources);
  }
}
