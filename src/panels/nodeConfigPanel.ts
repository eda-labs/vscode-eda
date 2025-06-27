import * as vscode from 'vscode';

// Interfaces remain the same
interface LineRange {
  startLine?: number;
  endLine?: number;
}
export interface Annotation {
  cr: {
    name: string;
    gvk: {
      group: string;
      version: string;
      kind: string;
    };
  };
  lines: LineRange[];
}

export class NodeConfigPanel {
  private panel: vscode.WebviewPanel;

  constructor(config: string, annotations: Annotation[], title: string) {
    this.panel = vscode.window.createWebviewPanel(
      'nodeConfig',
      `Node Config: ${title}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.webview.html = this.getHtml();

    this.panel.webview.postMessage({
      command: 'loadData',
      config,
      annotations,
    });
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${this.panel.webview.cspSource}; script-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size);
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      padding: 0;
      margin: 0;
      overflow: hidden;
    }
    
    .container {
      display: grid;
      grid-template-rows: auto 1fr;
      height: 100vh;
    }
    
    .toolbar {
      padding: 12px;
      background-color: var(--vscode-side-bar-background);
      border-bottom: 1px solid var(--vscode-sideBar-border);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .button {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      padding: 6px 12px;
      cursor: pointer;
      font-weight: 500;
      font-size: 12px;
      transition: all 0.2s ease-in-out;
      display: flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }
    
    .button:hover {
      background-color: var(--vscode-button-hover-background);
      transform: translateY(-1px);
      box-shadow: 0 2px 3px rgba(0, 0, 0, 0.25);
    }
    
    .button:active {
      transform: translateY(0);
      box-shadow: 0 1px 1px rgba(0, 0, 0, 0.15);
    }
    
    .button-icon {
      font-size: 14px;
      line-height: 1;
    }
    
    .copy-success {
      background-color: var(--vscode-debugConsole-infoForeground) !important;
    }
    
    .config-view {
      display: grid;
      overflow-y: auto;
      font-family: var(--vscode-editor-font-family, monospace);
      transition: grid-template-columns 0.3s ease-in-out;
    }
    
    /* --- Layout States --- */
    .config-view.annotations-visible {
      grid-template-columns: max-content auto 1fr;
    }
    
    .config-view.annotations-hidden {
      grid-template-columns: auto 1fr;
    }
    
    .line {
      display: contents;
    }
    
    .line > div {
      padding: 2px 10px;
      white-space: pre;
    }
    
    .line-annotation {
      color: var(--vscode-descriptionForeground);
      background-color: var(--vscode-editorWidget-background);
      text-align: right;
      cursor: default;
      user-select: none;
      border-right: 1px solid var(--vscode-sideBar-border);
      transition: background-color 0.2s ease-in-out, color 0.2s ease-in-out;
      white-space: pre;
    }
    
    .annotations-hidden .line-annotation {
      display: none;
    }
    
    .line-num {
      text-align: right;
      color: var(--vscode-editorLineNumber-foreground);
      background-color: var(--vscode-editor-background);
      user-select: none;
    }
    
    .line-code {
      background-color: var(--vscode-editor-background);
      transition: background-color 0.2s ease-in-out;
      position: relative;
      z-index: 1;
    }
    
    /* --- Hover and Highlight Effects --- */
    .line-annotation:hover {
      color: var(--vscode-list-hoverForeground);
      background-color: var(--vscode-list-hoverBackground);
    }
    
    .line-highlight .line-code {
      background-color: var(--vscode-editor-selectionBackground);
    }
    
    .line-highlight .line-annotation {
      color: var(--vscode-list-activeSelectionForeground);
      background-color: var(--vscode-list-activeSelectionBackground);
      font-weight: bold;
    }
    
    /* --- Enhanced Syntax Highlighting --- */
    /* Main sections */
    .section-keyword {
      color: var(--vscode-charts-purple);
      font-weight: bold;
    }
    
    /* Interface types */
    .interface-type {
      color: var(--vscode-charts-purple);
      font-weight: bold;
    }
    
    /* Properties */
    .property {
      color: var(--vscode-charts-blue);
    }
    
    /* Interface names */
    .interface-name {
      color: var(--vscode-charts-green);
      font-weight: bold;
    }
    
    /* Brackets */
    .bracket {
      color: var(--vscode-editor-foreground);
    }
    
    /* Values */
    .value {
      color: var(--vscode-charts-yellow);
    }
    
    /* Boolean values */
    .boolean {
      color: var(--vscode-charts-purple);
      font-weight: bold;
    }
    
    /* Numbers */
    .number {
      color: var(--vscode-charts-red);
    }
    
    /* Strings */
    .string {
      color: var(--vscode-charts-yellow);
    }
    
    /* Special values (like IP addresses) */
    .ip-address {
      color: var(--vscode-charts-orange);
    }
    
    /* Config parameters */
    .parameter {
      color: var(--vscode-charts-blue);
    }
    
    /* Network specific keywords */
    .network-keyword {
      color: var(--vscode-charts-purple);
    }
    
    /* VLAN related */
    .vlan {
      color: var(--vscode-charts-purple);
    }
    
    /* Protocol related */
    .protocol {
      color: var(--vscode-charts-green);
    }
    
    /* BGP specific */
    .bgp {
      color: var(--vscode-charts-red);
    }
    
    /* Route related */
    .route {
      color: var(--vscode-charts-orange);
    }
    
    /* Comments */
    .comment {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    
    /* Indentation guide */
    .indentation-guide {
      display: inline-block;
      width: 8px;
      border-left: 1px solid var(--vscode-editorIndentGuide-background);
      height: 100%;
      position: absolute;
      left: 0;
      top: 0;
    }
    
    /* --- Toast Notification --- */
    .toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background-color: var(--vscode-notificationToast-background);
      color: var(--vscode-notificationToast-foreground);
      padding: 10px 16px;
      border-radius: 4px;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
      z-index: 9999;
      display: flex;
      align-items: center;
      gap: 8px;
      opacity: 0;
      transform: translateY(20px);
      transition: opacity 0.3s ease, transform 0.3s ease;
    }
    
    .toast.show {
      opacity: 1;
      transform: translateY(0);
    }
    
    /* Divider for sections */
    .divider {
      border-bottom: 1px solid var(--vscode-textSeparator-foreground);
      margin: 10px 0;
    }
  </style>
</head>

<body>
  <div class="container">
    <div class="toolbar">
      <button id="toggleAnnotations" class="button">
        <span class="button-icon">⊞</span>
        <span>Hide Annotations</span>
      </button>
      <button id="copyConfig" class="button">
        <span class="button-icon">⧉</span>
        <span>Copy Config</span>
      </button>
    </div>
    
    <div id="configView" class="config-view annotations-visible">
      <!-- Dynamic Content -->
    </div>
  </div>
  
  <div id="toast" class="toast">
    <span class="button-icon">✓</span>
    <span id="toastMessage">Config copied to clipboard</span>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const configView = document.getElementById('configView');
    const toggleBtn = document.getElementById('toggleAnnotations');
    const copyBtn = document.getElementById('copyConfig');
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    
    const annotationLineMap = new Map();
    const annotationInfoMap = new Map();
    let isAnnotationsVisible = true;
    let configText = '';
    
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.command === 'loadData') {
        configText = message.config;
        render(message.config, message.annotations);
      }
    });
    
    toggleBtn.addEventListener('click', () => {
      isAnnotationsVisible = !isAnnotationsVisible;
      
      if (isAnnotationsVisible) {
        configView.classList.remove('annotations-hidden');
        configView.classList.add('annotations-visible');
        toggleBtn.innerHTML = '<span class="button-icon">⊞</span><span>Hide Annotations</span>';
      } else {
        configView.classList.remove('annotations-visible');
        configView.classList.add('annotations-hidden');
        toggleBtn.innerHTML = '<span class="button-icon">⊞</span><span>Show Annotations</span>';
      }
    });
    
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(configText).then(() => {
        showToast('Config copied to clipboard');
        copyBtn.classList.add('copy-success');
        
        setTimeout(() => {
          copyBtn.classList.remove('copy-success');
        }, 1000);
      });
    });
    
    function showToast(message) {
      toastMessage.textContent = message;
      toast.classList.add('show');
      
      setTimeout(() => {
        toast.classList.remove('show');
      }, 3000);
    }
    
    function render(config, annotations) {
      const lines = config.split('\\n');
      const annotationMap = buildAnnotationMap(lines.length, annotations);
      
      configView.innerHTML = '';
      const fragment = document.createDocumentFragment();
      
      // Track the current context to improve highlighting
      let currentContext = {
        section: '',
        interface: '',
        subBlock: '',
        level: 0
      };
      
      // Track the previous annotation for section dividers
      let lastAnnotation = '';
      let previousAnnotation = '';

      lines.forEach((line, index) => {
        const lineNum = index + 1;
        const annotationName = annotationMap[index] || '';
        const showLabel = annotationName && annotationName !== previousAnnotation;

        // Add section divider when annotation changes
        if (showLabel && lastAnnotation) {
          const divider = document.createElement('div');
          divider.className = 'divider';
          divider.style.gridColumn = '1 / -1';
          fragment.appendChild(divider);
        }

        previousAnnotation = annotationName;
        if (annotationName) {
          lastAnnotation = annotationName;
        }
        
        // Update context tracking
        updateContext(line, currentContext);
        
        const lineEl = document.createElement('div');
        lineEl.className = 'line';
        lineEl.dataset.line = lineNum;
        
        if (annotationName) {
          lineEl.dataset.annotation = annotationName;
        }
        
        const annotationEl = document.createElement('div');
        annotationEl.className = 'line-annotation';
        if (showLabel) {
          const info = annotationInfoMap.get(annotationName);
          annotationEl.textContent = annotationName;
          if (info) {
            annotationEl.title = \`\${info.name}\\n\${info.group}\\n\${info.version}\\n\${info.kind}\`;
          }
        } else {
          annotationEl.textContent = '';
        }
        annotationEl.dataset.annotation = annotationName;
        
        const numEl = document.createElement('div');
        numEl.className = 'line-num';
        numEl.textContent = lineNum;
        
        const codeEl = document.createElement('div');
        codeEl.className = 'line-code';
        codeEl.innerHTML = applySyntaxHighlighting(line, currentContext);
        
        lineEl.appendChild(annotationEl);
        lineEl.appendChild(numEl);
        lineEl.appendChild(codeEl);
        
        fragment.appendChild(lineEl);
      });
      
      configView.appendChild(fragment);
      setupEventListeners();
    }
    
    function updateContext(line, context) {
      const trimmedLine = line.trim();
      const indentLevel = line.search(/\\S|$/);
      
      // Calculate the nesting level based on indentation
      context.level = Math.floor(indentLevel / 4);
      
      // Check for main section declarations
      if (context.level === 0 && trimmedLine.match(/^\\w+.*\\{$/)) {
        context.section = trimmedLine.split(' ')[0];
        context.interface = '';
        context.subBlock = '';
      } 
      // Check for interface declarations
      else if (context.level === 0 && trimmedLine.startsWith('interface ')) {
        context.section = 'interface';
        context.interface = trimmedLine.split(' ')[1];
        context.subBlock = '';
      }
      // Check for sub-blocks
      else if (context.level === 1 && trimmedLine.endsWith('{')) {
        context.subBlock = trimmedLine.split(' ')[0];
      }
      // Reset contexts at closing braces
      else if (trimmedLine === '}') {
        if (context.level === 0) {
          context.section = '';
          context.interface = '';
          context.subBlock = '';
        } else if (context.level === 1) {
          context.subBlock = '';
        }
      }
    }
    
    function applySyntaxHighlighting(line, context) {
      // Check for empty lines
      if (line.trim() === '') {
        return '';
      }
      
      // Create indentation guides based on indentation level
      const indentLevel = line.search(/\\S|$/);
      let indentGuides = '';
      for (let i = 0; i < indentLevel; i += 4) {
        indentGuides += '<span class="indentation-guide" style="left:' + i + 'px"></span>';
      }
      
      // Escape HTML for safety
      let processedLine = escapeHtml(line);
      
      // Handle comments
      if (processedLine.trim().startsWith('#')) {
        return indentGuides + '<span class="comment">' + processedLine + '</span>';
      }
      
      // First identify the line type
      if (context.level === 0) {
        // Main section declarations (bfd, interface, network-instance, etc.)
        if (processedLine.match(/^(\\s*)(\\w+)\\s+([\\w\\-\\/]+)\\s*\\{/)) {
          processedLine = processedLine.replace(/^(\\s*)(\\w+)\\s+([\\w\\-\\/\\.]+)\\s*\\{/, function(match, space, keyword, name) {
            if (keyword === 'interface') {
              return space + '<span class="section-keyword">' + keyword + '</span> <span class="interface-name">' + name + '</span> <span class="bracket">{</span>';
            } else if (keyword === 'network-instance') {
              return space + '<span class="section-keyword">' + keyword + '</span> <span class="interface-name">' + name + '</span> <span class="bracket">{</span>';
            } else {
              return space + '<span class="section-keyword">' + keyword + '</span> <span class="interface-name">' + name + '</span> <span class="bracket">{</span>';
            }
          });
        } 
        // Main section with no identifier
        else if (processedLine.match(/^(\\s*)(\\w+)\\s*\\{/)) {
          processedLine = processedLine.replace(/^(\\s*)(\\w+)\\s*\\{/, '$1<span class="section-keyword">$2</span> <span class="bracket">{</span>');
        }
      } else {
        // Subsections with blocks
        if (processedLine.match(/^(\\s*)(\\w[\\w\\-]+)\\s*\\{/)) {
          // Different styling based on the context
          if (context.section === 'interface' || context.section === 'bfd') {
            processedLine = processedLine.replace(/^(\\s*)(\\w[\\w\\-]+)\\s*\\{/, '$1<span class="property">$2</span> <span class="bracket">{</span>');
          } else if (context.section === 'network-instance') {
            processedLine = processedLine.replace(/^(\\s*)(\\w[\\w\\-]+)\\s*\\{/, '$1<span class="network-keyword">$2</span> <span class="bracket">{</span>');
          } else {
            processedLine = processedLine.replace(/^(\\s*)(\\w[\\w\\-]+)\\s*\\{/, '$1<span class="property">$2</span> <span class="bracket">{</span>');
          }
        }
        // Special handling for specific subsections
        else if (processedLine.match(/^(\\s*)(\\w[\\w\\-\\/\\.]+)\\s+(.+)\\s*\\{/)) {
          processedLine = processedLine.replace(/^(\\s*)(\\w[\\w\\-\\/\\.]+)\\s+(.+)\\s*\\{/, function(match, space, keyword, rest) {
            // Special coloring for specific properties
            if (keyword === 'subinterface') {
              return space + '<span class="property">' + keyword + '</span> <span class="value">' + rest.replace(/\\{$/, '') + '</span> <span class="bracket">{</span>';
            } else if (keyword === 'address') {
              return space + '<span class="property">' + keyword + '</span> <span class="ip-address">' + rest.replace(/\\{$/, '') + '</span> <span class="bracket">{</span>';
            } else {
              return space + '<span class="property">' + keyword + '</span> <span class="value">' + rest.replace(/\\{$/, '') + '</span> <span class="bracket">{</span>';
            }
          });
        }
        // Key-value pairs (no nested block)
        else if (processedLine.match(/^(\\s*)(\\w[\\w\\-]+)\\s+(.+)$/)) {
          processedLine = processedLine.replace(/^(\\s*)(\\w[\\w\\-]+)\\s+(.+)$/, function(match, space, property, value) {
            // Format based on value type
            if (value === 'true' || value === 'false') {
              return space + '<span class="property">' + property + '</span> <span class="boolean">' + value + '</span>';
            } else if (value.match(/^\\d+$/)) {
              return space + '<span class="property">' + property + '</span> <span class="number">' + value + '</span>';
            } else if (value.match(/^".*"$/)) {
              return space + '<span class="property">' + property + '</span> <span class="string">' + value + '</span>';
            } else if (value.match(/^\\d+\\.\\d+\\.\\d+\\.\\d+\\/\\d+$/)) {
              return space + '<span class="property">' + property + '</span> <span class="ip-address">' + value + '</span>';
            } else if (context.section === 'bfd' || property === 'admin-state') {
              return space + '<span class="parameter">' + property + '</span> <span class="value">' + value + '</span>';
            } else if (property === 'description') {
              return space + '<span class="property">' + property + '</span> <span class="string">' + value + '</span>';
            } else if (property.includes('vlan')) {
              return space + '<span class="vlan">' + property + '</span> <span class="value">' + value + '</span>';
            } else if (context.section === 'network-instance' && context.subBlock === 'protocols') {
              return space + '<span class="protocol">' + property + '</span> <span class="value">' + value + '</span>';
            } else if (property.includes('bgp')) {
              return space + '<span class="bgp">' + property + '</span> <span class="value">' + value + '</span>';
            } else if (property.includes('route')) {
              return space + '<span class="route">' + property + '</span> <span class="value">' + value + '</span>';
            } else {
              return space + '<span class="property">' + property + '</span> <span class="value">' + value + '</span>';
            }
          });
        }
        // Arrays in the config
        else if (processedLine.match(/^(\\s*)\\[$/)) {
          processedLine = processedLine.replace(/^(\\s*)\\[$/, '$1<span class="bracket">[</span>');
        }
        else if (processedLine.match(/^(\\s*)\\]$/)) {
          processedLine = processedLine.replace(/^(\\s*)\\]$/, '$1<span class="bracket">]</span>');
        }
        else if (processedLine.match(/^(\\s*)(\\w.*)$/)) {
          if (processedLine.trim().match(/^\\d+$/)) {
            processedLine = processedLine.replace(/^(\\s*)(\\w.*)$/, '$1<span class="number">$2</span>');
          } else if (processedLine.trim().match(/^\\d+\\.\\d+\\.\\d+\\.\\d+$/)) {
            processedLine = processedLine.replace(/^(\\s*)(\\w.*)$/, '$1<span class="ip-address">$2</span>');
          } else {
            processedLine = processedLine.replace(/^(\\s*)(\\w.*)$/, '$1<span class="value">$2</span>');
          }
        }
      }
      
      // Handle closing braces
      if (processedLine.trim() === '}') {
        processedLine = processedLine.replace(/^(\\s*)\\}$/, '$1<span class="bracket">}</span>');
      }
      
      return indentGuides + processedLine;
    }
    
    function escapeHtml(text) {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
    
    function buildAnnotationMap(numLines, annotations) {
      const annMap = Array(numLines)
        .fill(null)
        .map(() => ({ label: '', size: Infinity }));
      annotationLineMap.clear();
      annotationInfoMap.clear();

      for (const ann of annotations) {
        const label = ann.cr?.name || 'unknown';
        const info = {
          name: ann.cr?.name || 'unknown',
          group: ann.cr?.gvk?.group || '',
          version: ann.cr?.gvk?.version || '',
          kind: ann.cr?.gvk?.kind || '',
        };

        if (!annotationLineMap.has(label)) {
          annotationLineMap.set(label, []);
          annotationInfoMap.set(label, info);
        }

        for (const range of ann.lines) {
          let start = range.startLine;
          let end = range.endLine;

          if (start === undefined && end !== undefined) {
            // API uses zero-based indexing
            start = 0;
          }

          if (end === undefined && start !== undefined) {
            end = start;
          }

          if (start === undefined || end === undefined) {
            continue;
          }

          if (start > end) {
            const tmp = start;
            start = end;
            end = tmp;
          }

          const size = end - start + 1;

          for (
            let i = Math.max(0, start);
            i <= Math.min(numLines - 1, end);
            i++
          ) {
            if (size <= annMap[i].size) {
              annMap[i] = { label, size };
            }
          }
        }
      }

      const finalMap = Array(numLines).fill('');
      annMap.forEach((entry, idx) => {
        if (entry.label) {
          finalMap[idx] = entry.label;
          annotationLineMap.get(entry.label).push(idx + 1);
        }
      });

      return finalMap;
    }
    
    function setupEventListeners() {
      configView.addEventListener('mouseover', e => {
        if (e.target.classList.contains('line-annotation')) {
          const annotationName = e.target.dataset.annotation;
          if (annotationName) {
            highlightLines(annotationName, true);
          }
        }
      });
      
      configView.addEventListener('mouseout', e => {
        if (e.target.classList.contains('line-annotation')) {
          const annotationName = e.target.dataset.annotation;
          if (annotationName) {
            highlightLines(annotationName, false);
          }
        }
      });
    }
    
    function highlightLines(annotationName, shouldHighlight) {
      const lineNumbers = annotationLineMap.get(annotationName);
      if (!lineNumbers) return;
      
      lineNumbers.forEach(lineNum => {
        const lineEl = configView.querySelector(\`.line[data-line="\${lineNum}"]\`);
        if (lineEl) {
          lineEl.classList.toggle('line-highlight', shouldHighlight);
        }
      });
    }
  </script>
</body>
</html>`;
  }

  static show(config: string, annotations: Annotation[], node: string): void {
    new NodeConfigPanel(config, annotations, node);
  }
}