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

export class AlarmDetailsPanel extends BasePanel {
  private data: Record<string, any>;

  constructor(context: vscode.ExtensionContext, data: Record<string, any>) {
    super(context, 'alarmDetails', `Alarm ${data.name}`, undefined, {
      light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-black.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-white.svg')
    });

    this.data = data;
    this.panel.webview.html = this.buildHtml();

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
    const base = this.readWebviewFile('alarmDetails', 'alarmDetailsPanel.html');
    const content = this.buildContent();
    return base.replace('${content}', content);
  }

  protected getCustomStyles(): string {
    return this.readWebviewFile('alarmDetails', 'alarmDetailsPanel.css');
  }

  protected getScripts(): string {
    return `
      const vscode = acquireVsCodeApi();
      document.addEventListener('DOMContentLoaded', () => {
        const copyButton = document.querySelector('.copy-button');
        if (copyButton) {
          copyButton.addEventListener('click', () => {
            const rawJson = document.getElementById('raw-json').textContent;
            vscode.postMessage({ command: 'copy', text: rawJson });
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

  private getSeverityColor(sev: string | undefined): string {
    const level = (sev || '').toLowerCase();
    switch (level) {
      case 'critical':
        return 'var(--error)';
      case 'major':
        return 'var(--warning)';
      case 'minor':
      case 'warning':
        return 'var(--info)';
      case 'info':
        return 'var(--success)';
      default:
        return 'var(--info)';
    }
  }

  private buildContent(): string {
    const d = this.data;
    const severityColor = this.getSeverityColor(d.severity);

    const header = `
      <div class="header">
        <div class="header-top">
          <h1>
            Alarm <span class="alarm-name">${escapeHtml(String(d.name))}</span>
          </h1>
        </div>
        <div class="summary">
          <div class="summary-item">
            <div class="summary-label">Kind</div>
            <div class="summary-value">${escapeHtml(String(d.kind))}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Type</div>
            <div class="summary-value">${escapeHtml(String(d.type))}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Severity</div>
            <div class="summary-value" style="color: ${severityColor}">${escapeHtml(String(d.severity))}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Namespace</div>
            <div class="summary-value">${escapeHtml(String(d.namespace))}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Group</div>
            <div class="summary-value">${escapeHtml(String(d.group))}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Source Group</div>
            <div class="summary-value">${escapeHtml(String(d.sourceGroup))}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Source Kind</div>
            <div class="summary-value">${escapeHtml(String(d.sourceKind))}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Source Resource</div>
            <div class="summary-value">${escapeHtml(String(d.sourceResource))}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Parent Alarm</div>
            <div class="summary-value">${escapeHtml(String(d.parentAlarm))}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Cluster Specific</div>
            <div class="summary-value">${escapeHtml(String(d.clusterSpecific))}</div>
          </div>
          <div class="summary-item jspath">
            <div class="summary-label">Jspath</div>
            <div class="summary-value jspath-value">${escapeHtml(String(d.jspath))}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Resource</div>
            <div class="summary-value">${escapeHtml(String(d.resource))}</div>
          </div>
        </div>
      </div>
    `;

    const probableCauseSection = d.probableCause ? `
      <div class="section">
        <h2><span class="section-icon">⚠️</span> Probable Cause</h2>
        <div>${escapeHtml(String(d.probableCause))}</div>
      </div>
    ` : '';

    const remedialActionSection = d.remedialAction ? `
      <div class="section">
        <h2><span class="section-icon">🛠️</span> Remedial Action</h2>
        <div>${escapeHtml(String(d.remedialAction))}</div>
      </div>
    ` : '';

    const descriptionSection = d.description ? `
      <div class="section">
        <h2><span class="section-icon">📝</span> Description</h2>
        <div>${escapeHtml(String(d.description))}</div>
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

    return header + probableCauseSection + remedialActionSection + descriptionSection + rawJsonSection;
  }

  static show(context: vscode.ExtensionContext, data: Record<string, any>): void {
    new AlarmDetailsPanel(context, data);
  }
}

