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
      let beforeScrollListener = null;
      let afterScrollListener = null;
      
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
      
      function generateDiff(beforeContent, afterContent) {
        const beforeLines = beforeContent ? beforeContent.split('\\n') : [];
        const afterLines = afterContent ? afterContent.split('\\n') : [];
        
        // Simple LCS-based diff
        const lcs = computeLCS(beforeLines, afterLines);
        const beforeDiff = [];
        const afterDiff = [];
        
        let beforeIdx = 0;
        let afterIdx = 0;
        let lcsIdx = 0;
        
        while (beforeIdx < beforeLines.length || afterIdx < afterLines.length) {
          if (lcsIdx < lcs.length && beforeIdx < beforeLines.length && 
              beforeLines[beforeIdx] === lcs[lcsIdx] && afterIdx < afterLines.length &&
              afterLines[afterIdx] === lcs[lcsIdx]) {
            // Both lines match the LCS - unchanged
            beforeDiff.push({ line: beforeLines[beforeIdx], type: 'context', lineNum: beforeIdx + 1 });
            afterDiff.push({ line: afterLines[afterIdx], type: 'context', lineNum: afterIdx + 1 });
            beforeIdx++;
            afterIdx++;
            lcsIdx++;
          } else if (beforeIdx < beforeLines.length && 
                     (lcsIdx >= lcs.length || beforeLines[beforeIdx] !== lcs[lcsIdx])) {
            // Line only in before - removed
            beforeDiff.push({ line: beforeLines[beforeIdx], type: 'removed', lineNum: beforeIdx + 1 });
            beforeIdx++;
          } else if (afterIdx < afterLines.length && 
                     (lcsIdx >= lcs.length || afterLines[afterIdx] !== lcs[lcsIdx])) {
            // Line only in after - added
            afterDiff.push({ line: afterLines[afterIdx], type: 'added', lineNum: afterIdx + 1 });
            afterIdx++;
          }
        }
        
        return { beforeDiff, afterDiff };
      }
      
      function computeLCS(arr1, arr2) {
        const m = arr1.length;
        const n = arr2.length;
        const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
        
        for (let i = 1; i <= m; i++) {
          for (let j = 1; j <= n; j++) {
            if (arr1[i - 1] === arr2[j - 1]) {
              dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
              dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
          }
        }
        
        // Reconstruct LCS
        const lcs = [];
        let i = m, j = n;
        while (i > 0 && j > 0) {
          if (arr1[i - 1] === arr2[j - 1]) {
            lcs.unshift(arr1[i - 1]);
            i--;
            j--;
          } else if (dp[i - 1][j] > dp[i][j - 1]) {
            i--;
          } else {
            j--;
          }
        }
        
        return lcs;
      }
      
      function createDiffLines(diffData) {
        if (!diffData || diffData.length === 0) {
          return '<div class="diff-line context"><span class="line-number">1</span><span class="line-content"></span></div>';
        }
        
        let html = '';
        
        diffData.forEach((item, idx) => {
          const escapedLine = item.line
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          
          html += \`<div class="diff-line \${item.type}">
            <span class="line-number">\${idx + 1}</span>
            <span class="line-content">\${escapedLine || ' '}</span>
          </div>\`;
        });
        
        return html;
      }
      
      function computeDiffStats(beforeDiff, afterDiff) {
        const added = afterDiff.filter(item => item.type === 'added').length;
        const removed = beforeDiff.filter(item => item.type === 'removed').length;
        const total = Math.max(beforeDiff.length, afterDiff.length);
        
        return { added, removed, total };
      }
      
      function renderDiff(diff, resource) {
        emptyStateEl.classList.remove('visible');
        diffContainerEl.classList.remove('hidden');
        
        // Update title
        resourceTitleEl.textContent = \`\${resource.kind}/\${resource.name}\`;
        
        // Get content
        const beforeContent = diff.before?.data || '';
        const afterContent = diff.after?.data || '';
        
        // Generate diff
        const diffData = generateDiff(beforeContent, afterContent);
        
        // Compute stats
        const stats = computeDiffStats(diffData.beforeDiff, diffData.afterDiff);
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
        beforeContentEl.innerHTML = createDiffLines(diffData.beforeDiff);
        afterContentEl.innerHTML = createDiffLines(diffData.afterDiff);
        
        // Reset any previous height settings
        beforeContentEl.style.height = '';
        afterContentEl.style.height = '';
        
        // Remove old scroll listeners
        if (beforeScrollListener) {
          beforeContentEl.removeEventListener('scroll', beforeScrollListener);
        }
        if (afterScrollListener) {
          afterContentEl.removeEventListener('scroll', afterScrollListener);
        }
        
        // Sync scroll positions
        let syncing = false;
        const syncScroll = (source, target) => {
          if (syncing) return;
          syncing = true;
          
          // Calculate scroll percentage
          const maxScroll = source.scrollHeight - source.clientHeight;
          if (maxScroll <= 0) {
            target.scrollTop = 0;
          } else {
            const percentage = source.scrollTop / maxScroll;
            const targetMaxScroll = target.scrollHeight - target.clientHeight;
            target.scrollTop = percentage * targetMaxScroll;
          }
          
          requestAnimationFrame(() => {
            syncing = false;
          });
        };
        
        // Add new scroll listeners
        beforeScrollListener = () => syncScroll(beforeContentEl, afterContentEl);
        afterScrollListener = () => syncScroll(afterContentEl, beforeContentEl);
        
        beforeContentEl.addEventListener('scroll', beforeScrollListener);
        afterContentEl.addEventListener('scroll', afterScrollListener);
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
