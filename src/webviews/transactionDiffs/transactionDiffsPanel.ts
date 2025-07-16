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
      const beforeContentEl = document.getElementById('beforeContent');
      const afterContentEl = document.getElementById('afterContent');
      const resourceTitleEl = document.getElementById('resourceTitle');
      const diffStatsEl = document.getElementById('diffStats');
      const emptyStateEl = document.getElementById('emptyState');
      const diffContainerEl = document.getElementById('diffContainer');
      
      let resources = [];
      let currentResource = null;
      
      window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.command === 'resources') {
          resources = msg.resources;
          renderList();
        } else if (msg.command === 'diff') {
          renderDiff(msg.diff, msg.resource);
        } else if (msg.command === 'error') {
          showError(msg.message);
        }
      });
      
      function renderList() {
        listEl.innerHTML = '';
        resources.forEach((r, idx) => {
          const btn = document.createElement('button');
          btn.className = 'resource-item';
          btn.innerHTML = \`
            <div>\${r.name}</div>
            <div class="resource-kind">\${r.kind} • \${r.namespace}</div>
          \`;
          btn.addEventListener('click', () => {
            currentResource = r;
            vscode.postMessage({ command: 'loadDiff', resource: r });
            document.querySelectorAll('.resource-item').forEach(el => el.classList.remove('selected'));
            btn.classList.add('selected');
          });
          if (idx === 0) {
            btn.classList.add('selected');
            currentResource = r;
          }
          listEl.appendChild(btn);
        });
        
        if (resources.length > 0) {
          vscode.postMessage({ command: 'loadDiff', resource: resources[0] });
        } else {
          showEmptyState();
        }
      }
      
      function createDiffLines(content, otherContent, isAfter = false) {
        if (!content) return '<div class="diff-line context"><span class="line-number">1</span><span class="line-content"></span></div>';
        
        const lines = content.split('\\n');
        const otherLines = otherContent ? otherContent.split('\\n') : [];
        let html = '';
        
        // Simple diff algorithm - mark lines as added/removed/unchanged
        lines.forEach((line, idx) => {
          const lineNum = idx + 1;
          const otherLine = otherLines[idx];
          
          let lineClass = 'context';
          if (!otherContent) {
            lineClass = isAfter ? 'added' : 'removed';
          } else if (line !== otherLine) {
            lineClass = isAfter ? 'added' : 'removed';
          }
          
          const escapedLine = line
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/ /g, '&nbsp;');
          
          html += \`<div class="diff-line \${lineClass}">
            <span class="line-number">\${lineNum}</span>
            <span class="line-content">\${escapedLine || '&nbsp;'}</span>
          </div>\`;
        });
        
        return html;
      }
      
      function computeDiffStats(beforeContent, afterContent) {
        const beforeLines = beforeContent ? beforeContent.split('\\n').length : 0;
        const afterLines = afterContent ? afterContent.split('\\n').length : 0;
        
        const added = Math.max(0, afterLines - beforeLines);
        const removed = Math.max(0, beforeLines - afterLines);
        
        return { added, removed, total: Math.max(beforeLines, afterLines) };
      }
      
      function renderDiff(diff, resource) {
        emptyStateEl.classList.remove('visible');
        diffContainerEl.classList.remove('hidden');
        
        // Update title
        resourceTitleEl.textContent = \`\${resource.kind}/\${resource.name}\`;
        
        // Get content
        const beforeContent = diff.before?.data || '';
        const afterContent = diff.after?.data || '';
        
        // Compute stats
        const stats = computeDiffStats(beforeContent, afterContent);
        diffStatsEl.innerHTML = \`
          <span class="stat-item">
            <span class="stat-add">+\${stats.added}</span>
          </span>
          <span class="stat-item">
            <span class="stat-remove">-\${stats.removed}</span>
          </span>
          <span class="stat-item">
            Total: \${stats.total} lines
          </span>
        \`;
        
        // Render diff with line numbers
        beforeContentEl.innerHTML = createDiffLines(beforeContent, afterContent, false);
        afterContentEl.innerHTML = createDiffLines(afterContent, beforeContent, true);
        
        // Sync scroll positions
        let syncing = false;
        const syncScroll = (source, target) => {
          if (syncing) return;
          syncing = true;
          const percentage = source.scrollTop / (source.scrollHeight - source.clientHeight);
          target.scrollTop = percentage * (target.scrollHeight - target.clientHeight);
          setTimeout(() => syncing = false, 10);
        };
        
        beforeContentEl.addEventListener('scroll', () => syncScroll(beforeContentEl, afterContentEl));
        afterContentEl.addEventListener('scroll', () => syncScroll(afterContentEl, beforeContentEl));
      }
      
      function showError(message) {
        emptyStateEl.classList.add('visible');
        diffContainerEl.classList.add('hidden');
        emptyStateEl.innerHTML = \`
          <span class="empty-icon">❌</span>
          <p>Error loading diff:</p>
          <p style="color: var(--error); font-size: 0.875rem; margin-top: 8px;">\${message}</p>
        \`;
      }
      
      function showEmptyState() {
        emptyStateEl.classList.add('visible');
        diffContainerEl.classList.add('hidden');
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
