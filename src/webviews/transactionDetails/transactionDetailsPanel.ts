import * as vscode from 'vscode';
import { BasePanel } from '../basePanel';
import { TransactionDiffsPanel } from '../transactionDiffs/transactionDiffsPanel';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export class TransactionDetailsPanel extends BasePanel {
  private static panels: Map<string, TransactionDetailsPanel> = new Map();
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
          case 'showDiffs':
            TransactionDiffsPanel.show(
              this.context,
              this.data.id,
              this.data.changedCrs || [],
              this.data.nodesWithConfigChanges || []
            );
            break;
        }
      },
      undefined,
      context.subscriptions
    );
  }

  private update(data: Record<string, any>): void {
    this.data = data;
    this.panel.title = `Transaction ${data.id}`;
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
    return `
      const vscode = acquireVsCodeApi();
      
      document.addEventListener('DOMContentLoaded', () => {
        const copyButton = document.querySelector('.copy-button');
        const diffButton = document.querySelector('.diff-button');
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
        if (diffButton) {
          diffButton.addEventListener('click', () => {
            vscode.postMessage({ command: 'showDiffs' });
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

  private formatNodeError(error: string): string {
    // Parse validation errors for better formatting
    const validationMatch = error.match(/failed\s+validate:\s*(.+?)\s*error_str:"(.+?)"\s*cr_name:"(.+?)"/);
    if (validationMatch) {
      const [, jspath, errorStr, crName] = validationMatch;
      return `
        <div class="error-item validation-error">
          <div class="error-type">Validation Error</div>
          <div class="error-details">
            <div class="error-field">
              <span class="field-label">JsPath:</span>
              <code>${escapeHtml(jspath)}</code>
            </div>
            <div class="error-field">
              <span class="field-label">Error:</span>
              <span class="error-message">${escapeHtml(errorStr)}</span>
            </div>
            <div class="error-field">
              <span class="field-label">CR Name:</span>
              <code>${escapeHtml(crName)}</code>
            </div>
          </div>
        </div>
      `;
    }

    // Parse commit errors
    const commitMatch = error.match(/failed\s+commit\s+apply:\s*(.+)/);
    if (commitMatch) {
      const [, errorDetail] = commitMatch;
      return `
        <div class="error-item commit-error">
          <div class="error-type">Commit Error</div>
          <div class="error-message">${escapeHtml(errorDetail)}</div>
        </div>
      `;
    }

    // Default error format
    return `<div class="error-item"><div class="error-message">${escapeHtml(error)}</div></div>`;
  }

  private renderNodeList(nodes: any[]): string {
    if (!nodes || nodes.length === 0) {
      return '<div class="empty-state">No nodes with configuration changes</div>';
    }

    const nodeItems = nodes.map(node => {
      const hasErrors = node.errors && (Array.isArray(node.errors) ? node.errors.length > 0 : true);
      return `
        <li class="node-item ${hasErrors ? 'has-errors' : ''}">
          <div class="node-header">
            <div class="node-name">${escapeHtml(node.name)}</div>
            <div class="node-namespace">Namespace: ${escapeHtml(node.namespace)}</div>
          </div>
          ${hasErrors ? `<div class="node-errors">
            ${Array.isArray(node.errors)
              ? node.errors.map((err: any) => this.formatNodeError(String(err))).join('')
              : this.formatNodeError(String(node.errors))}
          </div>` : ''}
        </li>
      `;
    }).join('');

    return `<ul class="node-list">${nodeItems}</ul>`;
  }

  private buildContent(): string {
    const d = this.data;

    // Collect all errors
    const allErrors: Array<{type: string, source: string, message: string, crName?: string}> = [];

    // Collect intent errors
    if (d.intentsRun && Array.isArray(d.intentsRun)) {
      d.intentsRun.forEach((intent: any) => {
        if (intent.errors && Array.isArray(intent.errors) && intent.errors.length > 0) {
          intent.errors.forEach((err: any) => {
            const errorMessage = err.rawError || err.message || String(err);
            const shortError = errorMessage.split('\n').pop()?.trim() || errorMessage;
            allErrors.push({
              type: 'Intent Error',
              source: intent.intentName?.name || 'Unknown Intent',
              message: shortError
            });
          });
        }
      });
    }

    // Collect node validation errors
    if (d.nodesWithConfigChanges && Array.isArray(d.nodesWithConfigChanges)) {
      d.nodesWithConfigChanges.forEach((node: any) => {
        if (node.errors && Array.isArray(node.errors)) {
          node.errors.forEach((err: string) => {
            const validationMatch = err.match(/failed\s+validate:\s*(.+?)\s*error_str:"(.+?)"\s*cr_name:"(.+?)"/);
            if (validationMatch) {
              const [, , errorStr, crName] = validationMatch;
              allErrors.push({
                type: 'Validation Error',
                source: node.name,
                message: errorStr,
                crName: crName
              });
            }
          });
        }
      });
    }

    const header = `
      <div class="header">
        <div class="header-top">
          <h1>
            Transaction
            <span class="transaction-id ${d.success === 'No' ? 'error' : ''}">#${escapeHtml(String(d.id))}</span>
          </h1>
          <button class="diff-button">Show Diffs</button>
        </div>
        ${allErrors.length > 0 ? `
          <div class="errors-summary">
            <div class="errors-header">
              <span class="error-icon">⚠️</span>
              <span class="error-title">Errors (${allErrors.length})</span>
            </div>
            <div class="errors-list">
              ${allErrors.map(({type, source, message, crName}) => `
                <div class="error-summary-item">
                  <div class="error-summary-header">
                    <span class="error-type-badge ${type === 'Intent Error' ? 'intent' : 'validation'}">${escapeHtml(type)}</span>
                    <span class="error-source">${escapeHtml(source)}</span>
                    ${crName ? `<span class="error-cr-name">CR: ${escapeHtml(crName)}</span>` : ''}
                  </div>
                  <div class="error-summary-message">${escapeHtml(message)}</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
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
          `<li class="resource-item"><span class="resource-path">${escapeHtml(res)}</span></li>`
        ))}
      </div>
    ` : '';

    const inputResourcesSection = d.inputCrs && d.inputCrs.length > 0 ? `
      <div class="section">
        <h2><span class="section-icon">📥</span> Input Resources</h2>
        ${this.renderResourceList(d.inputCrs.map((cr: any) =>
          `<li class="resource-item">
            <span class="resource-path">${escapeHtml(cr.name?.namespace || 'default')} / ${escapeHtml(cr.name?.gvk?.kind || 'Unknown')}</span>
            <span class="resource-name">${escapeHtml(cr.name?.name || '')}</span>
            ${cr.isDelete ? '<span class="delete-badge">DELETE</span>' : ''}
          </li>`
        ))}
      </div>
    ` : '';

    const changedResourcesSection = d.changedCrs && d.changedCrs.length > 0 ? `
      <div class="section">
        <h2><span class="section-icon">✏️</span> Changed Resources</h2>
        ${this.renderResourceList(d.changedCrs.map((cr: any) => {
          const names = Array.isArray(cr.names) && cr.names.length > 0
            ? cr.names
            : cr.name
              ? [cr.name]
              : [];
          if (names.length === 0) {
            return `<li class="resource-item">
              <span class="resource-path">${escapeHtml(cr.namespace || 'default')} / ${escapeHtml(cr.gvk?.kind || 'Unknown')}</span>
            </li>`;
          }
          return names
            .map((name: string) => `
              <li class="resource-item">
                <span class="resource-path">${escapeHtml(cr.namespace || 'default')} / ${escapeHtml(cr.gvk?.kind || 'Unknown')}</span>
                <span class="resource-name">${escapeHtml(name)}</span>
              </li>`)
            .join('');
        }).flat())}
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

    return header + deletedResourcesSection + inputResourcesSection +
           changedResourcesSection + nodesSection + errorSection + rawJsonSection;
  }

  static show(context: vscode.ExtensionContext, data: Record<string, any>): void {
    const key = String(data.id);
    const existing = TransactionDetailsPanel.panels.get(key);
    if (existing) {
      existing.update(data);
      existing.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = new TransactionDetailsPanel(context, data);
    TransactionDetailsPanel.panels.set(key, panel);
    panel.panel.onDidDispose(() => {
      TransactionDetailsPanel.panels.delete(key);
    });
  }
}
