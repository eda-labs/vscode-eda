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

interface NodeRef {
  name: string;
  namespace: string;
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
    super(context, 'transactionDiffs', `Transaction ${transactionId} Diffs`, undefined, {
      light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-black.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-white.svg')
    });
    this.transactionId = transactionId;
    this.diffs = diffs;
    this.nodes = nodes;
    this.edaClient = serviceManager.getClient<EdaClient>('eda');

    this.panel.webview.onDidReceiveMessage(async msg => {
      if (msg.command === 'ready') {
        this.panel.webview.postMessage({
          command: 'diffs',
          diffs: this.diffs,
          nodes: this.nodes
        });
      } else if (msg.command === 'loadDiff') {
        try {
          let diff;
          if (msg.resource.type === 'node') {
            diff = await this.edaClient.getNodeConfigDiff(
              this.transactionId,
              msg.resource.name,
              msg.resource.namespace
            );
          } else {
            diff = await this.edaClient.getResourceDiff(
              this.transactionId,
              msg.resource.group,
              msg.resource.version,
              msg.resource.kind,
              msg.resource.name,
              msg.resource.namespace
            );
          }
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
      const filterSelect = document.getElementById('typeFilter');

      let allDiffs = [];
      let diffs = [];
      let currentResource = null;
      let beforeScrollListener = null;
      let afterScrollListener = null;
      let fullBeforeDiff = [];
      let fullAfterDiff = [];
      let beforeStart = 0;
      let beforeEnd = 0;
      let afterStart = 0;
      let afterEnd = 0;

      filterSelect.addEventListener('change', applyFilter);

      function applyFilter() {
        const val = filterSelect.value;
        if (val === 'all') {
          diffs = [...allDiffs];
        } else {
          diffs = allDiffs.filter(r => r.type === val);
        }
        renderList();
      }
      
      window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.command === 'diffs') {
          allDiffs = [];
          (msg.diffs || []).forEach(r => {
            allDiffs.push({ ...r, type: 'resource' });
          });
          (msg.nodes || []).forEach(n => {
            allDiffs.push({ ...n, type: 'node' });
          });
          applyFilter();
        } else if (msg.command === 'diff') {
          renderDiff(msg.diff, msg.resource);
        } else if (msg.command === 'error') {
          showError(msg.message);
        }
      });
      
      function renderList() {
        listEl.innerHTML = '';
        diffs.forEach((r, idx) => {
          const btn = document.createElement('button');
          btn.className = 'resource-item';
          const kind = r.type === 'node' ? 'Node Config' : r.kind;
          btn.innerHTML = \`
            <div>\${r.name}</div>
            <div class="resource-kind">\${kind} • \${r.namespace}</div>
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
        
        if (diffs.length > 0) {
          vscode.postMessage({ command: 'loadDiff', resource: diffs[0] });
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
          if (
            lcsIdx < lcs.length &&
            beforeIdx < beforeLines.length &&
            afterIdx < afterLines.length &&
            beforeLines[beforeIdx] === lcs[lcsIdx] &&
            afterLines[afterIdx] === lcs[lcsIdx]
          ) {
            // Both lines match the LCS - unchanged
            beforeDiff.push({ line: beforeLines[beforeIdx], type: 'context', lineNum: beforeIdx + 1 });
            afterDiff.push({ line: afterLines[afterIdx], type: 'context', lineNum: afterIdx + 1 });
            beforeIdx++;
            afterIdx++;
            lcsIdx++;
          } else if (
            beforeIdx < beforeLines.length &&
            afterIdx < afterLines.length &&
            (lcsIdx >= lcs.length || beforeLines[beforeIdx] !== lcs[lcsIdx]) &&
            (lcsIdx >= lcs.length || afterLines[afterIdx] !== lcs[lcsIdx])
          ) {
            // Line modified in-place
            beforeDiff.push({ line: beforeLines[beforeIdx], type: 'removed', lineNum: beforeIdx + 1 });
            afterDiff.push({ line: afterLines[afterIdx], type: 'added', lineNum: afterIdx + 1 });
            beforeIdx++;
            afterIdx++;
          } else if (beforeIdx < beforeLines.length && (lcsIdx >= lcs.length || beforeLines[beforeIdx] !== lcs[lcsIdx])) {
            // Line only in before - removed
            beforeDiff.push({ line: beforeLines[beforeIdx], type: 'removed', lineNum: beforeIdx + 1 });
            afterDiff.push({ line: '', type: 'blank', lineNum: '' });
            beforeIdx++;
          } else if (afterIdx < afterLines.length && (lcsIdx >= lcs.length || afterLines[afterIdx] !== lcs[lcsIdx])) {
            // Line only in after - added
            beforeDiff.push({ line: '', type: 'blank', lineNum: '' });
            afterDiff.push({ line: afterLines[afterIdx], type: 'added', lineNum: afterIdx + 1 });
            afterIdx++;
          } else {
            beforeIdx++;
            afterIdx++;
            lcsIdx++;
          }
        }

        return { beforeDiff, afterDiff };
      }

      function findFirstChange(arr) {
        for (let i = 0; i < arr.length; i++) {
          if (arr[i].type !== 'context') {
            return i;
          }
        }
        return 0;
      }

      function findLastChange(arr) {
        for (let i = arr.length - 1; i >= 0; i--) {
          if (arr[i].type !== 'context') {
            return i;
          }
        }
        return arr.length - 1;
      }

      function renderVisibleDiff() {
        const beforeSlice = fullBeforeDiff.slice(beforeStart, beforeEnd + 1);
        const afterSlice = fullAfterDiff.slice(afterStart, afterEnd + 1);

        let beforeHtml = '';
        if (beforeStart > 0) {
          beforeHtml += \`<div class="diff-more" data-side="before" data-pos="top">Show previous lines</div>\`;
        }
        beforeHtml += createDiffLines(beforeSlice);
        if (beforeEnd < fullBeforeDiff.length - 1) {
          beforeHtml += \`<div class="diff-more" data-side="before" data-pos="bottom">Show next lines</div>\`;
        }
        beforeContentEl.innerHTML = beforeHtml;

        let afterHtml = '';
        if (afterStart > 0) {
          afterHtml += \`<div class="diff-more" data-side="after" data-pos="top">Show previous lines</div>\`;
        }
        afterHtml += createDiffLines(afterSlice);
        if (afterEnd < fullAfterDiff.length - 1) {
          afterHtml += \`<div class="diff-more" data-side="after" data-pos="bottom">Show next lines</div>\`;
        }
        afterContentEl.innerHTML = afterHtml;

        document.querySelectorAll('.diff-more').forEach(el => {
          el.addEventListener('click', () => {
            const pos = el.getAttribute('data-pos');
            if (pos === 'top') {
              beforeStart = 0;
              afterStart = 0;
            } else {
              beforeEnd = fullBeforeDiff.length - 1;
              afterEnd = fullAfterDiff.length - 1;
            }
            renderVisibleDiff();
          });
        });
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
        
        diffData.forEach((item) => {
          const escapedLine = item.line
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

          html += \`<div class="diff-line \${item.type}">
            <span class="line-number">\${item.lineNum}</span>
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
        const titleKind = resource.type === 'node' ? 'Node Config' : resource.kind;
        resourceTitleEl.textContent = \`\${titleKind}/\${resource.name}\`;
        
        // Get content
        const beforeContent = diff.before?.data || '';
        const afterContent = diff.after?.data || '';
        
        // Generate diff
        const diffData = generateDiff(beforeContent, afterContent);
        fullBeforeDiff = diffData.beforeDiff;
        fullAfterDiff = diffData.afterDiff;
        const firstBefore = findFirstChange(fullBeforeDiff);
        const lastBefore = findLastChange(fullBeforeDiff);
        const firstAfter = findFirstChange(fullAfterDiff);
        const lastAfter = findLastChange(fullAfterDiff);

        const firstChange = Math.min(firstBefore, firstAfter);
        const lastChange = Math.max(lastBefore, lastAfter);

        beforeStart = Math.max(firstChange - 5, 0);
        afterStart = beforeStart;
        beforeEnd = Math.min(lastChange + 5, fullBeforeDiff.length - 1);
        afterEnd = beforeEnd;

        // Compute stats
        const stats = computeDiffStats(fullBeforeDiff, fullAfterDiff);
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
        renderVisibleDiff();
        
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

  static show(
    context: vscode.ExtensionContext,
    transactionId: string | number,
    crs: any[],
    nodes: any[]
  ): void {
    const diffs: ResourceRef[] = [];
    for (const cr of crs) {
      const group = cr.gvk?.group || '';
      const version = cr.gvk?.version || '';
      const kind = cr.gvk?.kind || '';
      const namespace = cr.namespace || 'default';
      const names = Array.isArray(cr.names) ? cr.names : cr.name ? [cr.name] : [];
      for (const n of names) {
        diffs.push({ group, version, kind, namespace, name: n });
      }
    }
    const nodeRefs: NodeRef[] = [];
    for (const node of nodes) {
      if (node?.name) {
        nodeRefs.push({ name: node.name, namespace: node.namespace || 'default' });
      }
    }
    new TransactionDiffsPanel(context, transactionId, diffs, nodeRefs);
  }
}
