import * as vscode from 'vscode';
import { BasePanel } from '../basePanel';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export class TransactionDetailsPanel extends BasePanel {
  private data: Record<string, any>;

  constructor(context: vscode.ExtensionContext, data: Record<string, any>) {
    super(context, 'transactionDetails', `Transaction ${data.id}`, undefined, {
      light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-black.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-white.svg')
    });
    this.data = data;
    this.panel.webview.html = this.buildHtml();
  }

  protected getHtml(): string {
    const base = this.readWebviewFile('transactionDetails', 'transactionDetailsPanel.html');
    const content = this.buildContent();
    return base.replace('${content}', content);
  }

  protected getCustomStyles(): string {
    return this.readWebviewFile('transactionDetails', 'transactionDetailsPanel.css');
  }

  protected getScripts(): string {
    return '';
  }

  protected getScriptTags(_nonce: string): string {
    return '';
  }

  private renderList(title: string, items: string[]): string {
    if (!items || items.length === 0) {
      return '';
    }
    const list = items.map(it => `<li>${escapeHtml(it)}</li>`).join('');
    return `<h2>${escapeHtml(title)}</h2><ul>${list}</ul>`;
  }

  private buildContent(): string {
    const d = this.data;
    const summary = `
<h1>Transaction ${escapeHtml(String(d.id))}</h1>
<table class="summary">
<tr><th>ID</th><td>${escapeHtml(String(d.id))}</td></tr>
<tr><th>State</th><td>${escapeHtml(String(d.state))}</td></tr>
<tr><th>User</th><td>${escapeHtml(String(d.username))}</td></tr>
<tr><th>Description</th><td>${escapeHtml(String(d.description))}</td></tr>
<tr><th>Dry Run</th><td>${escapeHtml(String(d.dryRun))}</td></tr>
<tr><th>Success</th><td style="color:${escapeHtml(String(d.successColor))}">${escapeHtml(String(d.success))}</td></tr>
</table>`;

    const changed = (d.changedCrs || []).map((cr: any) => `${cr.gvk?.kind} in namespace ${cr.namespace}`).join('\n');
    const input = (d.inputCrs || []).map((cr: any) => `${cr.name.gvk.kind} in namespace ${cr.name.namespace} name: ${cr.name.name}${cr.isDelete ? ' (delete)' : ''}`);
    const nodes = (d.nodesWithConfigChanges || []).map((n: any) => `${n.name} (namespace: ${n.namespace})${n.errors ? ' Errors: ' + n.errors : ''}`);

    const sections = [
      this.renderList('Deleted Resources', d.deleteResources || []),
      this.renderList('Changed Resources', changed ? changed.split('\n') : []),
      this.renderList('Input Resources', input),
      this.renderList('Nodes With Config Changes', nodes)
    ].join('');

    const errors = d.generalErrors ? `<h2>General Errors</h2><pre>${escapeHtml(String(d.generalErrors))}</pre>` : '';

    const raw = `<h2>Raw JSON</h2><pre>${escapeHtml(String(d.rawJson))}</pre>`;

    return summary + sections + errors + raw;
  }

  static show(context: vscode.ExtensionContext, data: Record<string, any>): void {
    new TransactionDetailsPanel(context, data);
  }
}
