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

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'copy':
            await vscode.env.clipboard.writeText(message.text);
            break;
        }
      },
      undefined,
      context.subscriptions
    );
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
    return `
      const vscode = acquireVsCodeApi();
      
      document.addEventListener('DOMContentLoaded', () => {
        const copyButton = document.querySelector('.copy-button');
        if (copyButton) {
          copyButton.addEventListener('click', () => {
            const rawJson = document.getElementById('raw-json').textContent;
            vscode.postMessage({
              command: 'copy',
              text: rawJson
            });
            
            const originalHTML = copyButton.innerHTML;
            copyButton.innerHTML = '<span>✓</span> Copied!';
            copyButton.style.background = 'var(--success)';
            
            setTimeout(() => {
              copyButton.innerHTML = originalHTML;
              copyButton.style.background = '';
            }, 2000);
          });
        }
      });
    `;
  }

  protected getScriptTags(nonce: string): string {
    const scripts = this.getScripts();
    return `<script nonce="${nonce}">${scripts}</script>`;
  }

  private renderResourceList(items: any[]): string {
    if (!items || items.length === 0) {
      return '<div class="empty-state">No resources found</div>';
    }
    return `<ul class="resource-list">${items.map(item => item).join('')}</ul>`;
  }

  private renderNodeList(nodes: any[]): string {
    if (!nodes || nodes.length === 0) {
      return '<div class="empty-state">No nodes with configuration changes</div>';
    }

    const nodeItems = nodes.map(node => `
      <li class="node-item">
        <div class="node-name">${escapeHtml(node.name)}</div>
        <div class="node-namespace">Namespace: ${escapeHtml(node.namespace)}</div>
        ${node.errors ? `<div class="node-errors">${escapeHtml(node.errors)}</div>` : ''}
      </li>
    `).join('');

    return `<ul class="node-list">${nodeItems}</ul>`;
  }

  private buildContent(): string {
    const d = this.data;

    const header = `
      <div class="header">
        <h1>
          Transaction
          <span class="transaction-id ${d.success === 'No' ? 'error' : ''}">#${escapeHtml(String(d.id))}</span>
        </h1>
        <div class="summary">
          <div class="summary-item">
            <div class="summary-label">State</div>
            <div class="summary-value">
              <div class="status-badge">
                <span class="status-indicator ${d.success === 'Yes' ? 'success' : 'error'}"></span>
                ${escapeHtml(String(d.state))}
              </div>
            </div>
          </div>
          <div class="summary-item">
            <div class="summary-label">User</div>
            <div class="summary-value">${escapeHtml(String(d.username))}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Success</div>
            <div class="summary-value" style="color: ${d.success === 'Yes' ? 'var(--success)' : 'var(--error)'}">
              ${escapeHtml(String(d.success))}
            </div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Dry Run</div>
            <div class="summary-value">${escapeHtml(String(d.dryRun))}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Description</div>
            <div class="summary-value">${escapeHtml(String(d.description))}</div>
          </div>
        </div>
      </div>
    `;

    const deletedResourcesSection = d.deleteResources && d.deleteResources.length > 0 ? `
      <div class="section">
        <h2><span class="section-icon">🗑️</span> Deleted Resources</h2>
        ${this.renderResourceList(d.deleteResources.map((res: string) =>
          `<li class="resource-item">${escapeHtml(res)}</li>`
        ))}
      </div>
    ` : '';

    const changedResourcesSection = d.changedCrs && d.changedCrs.length > 0 ? `
      <div class="section">
        <h2><span class="section-icon">✏️</span> Changed Resources</h2>
        ${this.renderResourceList(d.changedCrs.map((cr: any) =>
          `<li class="resource-item">
            <span class="resource-kind">${escapeHtml(cr.gvk?.kind || 'Unknown')}</span>
            <span class="resource-namespace">namespace: ${escapeHtml(cr.namespace || 'default')}</span>
          </li>`
        ))}
      </div>
    ` : '';

    const inputResourcesSection = d.inputCrs && d.inputCrs.length > 0 ? `
      <div class="section">
        <h2><span class="section-icon">📥</span> Input Resources</h2>
        ${this.renderResourceList(d.inputCrs.map((cr: any) =>
          `<li class="resource-item">
            <span class="resource-kind">${escapeHtml(cr.name?.gvk?.kind || 'Unknown')}</span>
            <span class="resource-name">${escapeHtml(cr.name?.name || '')}</span>
            <span class="resource-namespace">namespace: ${escapeHtml(cr.name?.namespace || 'default')}</span>
            ${cr.isDelete ? '<span class="delete-badge">DELETE</span>' : ''}
          </li>`
        ))}
      </div>
    ` : '';

    const nodesSection = d.nodesWithConfigChanges && d.nodesWithConfigChanges.length > 0 ? `
      <div class="section">
        <h2><span class="section-icon">🖥️</span> Nodes with Configuration Changes</h2>
        ${this.renderNodeList(d.nodesWithConfigChanges)}
      </div>
    ` : '';

    const errorSection = d.generalErrors ? `
      <div class="error-section">
        <h2>⚠️ General Errors</h2>
        <div class="error-content">${escapeHtml(String(d.generalErrors))}</div>
      </div>
    ` : '';

    const rawJsonSection = `
      <div class="raw-json-section">
        <h2>
          <span>📋 Raw JSON</span>
          <button class="copy-button">
            <span>📋</span> Copy
          </button>
        </h2>
        <pre id="raw-json">${escapeHtml(String(d.rawJson))}</pre>
      </div>
    `;

    return header + deletedResourcesSection + changedResourcesSection +
           inputResourcesSection + nodesSection + errorSection + rawJsonSection;
  }

  static show(context: vscode.ExtensionContext, data: Record<string, any>): void {
    new TransactionDetailsPanel(context, data);
  }
}
