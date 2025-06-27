import * as vscode from 'vscode';

interface LineRange { startLine?: number; endLine?: number; }
export interface Annotation { cr: { name: string; gvk: { group: string; version: string; kind: string } }; lines: LineRange[]; }

function annotateConfig(running: string, annotations: Annotation[] = []): string {
  const lines = running.split('\n');
  const annMap: string[][] = lines.map(() => []);
  for (const ann of annotations) {
    const label = ann.cr?.name || '';
    for (const range of ann.lines) {
      const start = range.startLine ?? range.endLine ?? 0;
      const end = range.endLine ?? range.startLine ?? start;
      for (let i = Math.max(0, start - 1); i < Math.min(lines.length, end); i++) {
        annMap[i].push(label);
      }
    }
  }
  const annStrings = annMap.map(a => a.join(', '));
  const width = Math.max(0, ...annStrings.map(a => a.length));
  return lines
    .map((line, idx) => {
      const num = String(idx + 1).padStart(4);
      const ann = annStrings[idx].padEnd(width);
      return `${num} ${ann ? ann + ' | ' : '  '} ${line}`.trimEnd();
    })
    .join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export class NodeConfigPanel {
  private panel: vscode.WebviewPanel;
  private showAnnotations = true;
  private readonly annotated: string;
  private readonly plain: string;

  constructor(config: string, annotations: Annotation[], title: string) {
    this.plain = config;
    this.annotated = annotateConfig(config, annotations);

    this.panel = vscode.window.createWebviewPanel(
      'nodeConfig',
      `Node Config: ${title}`,
      vscode.ViewColumn.Active,
      { enableScripts: true }
    );

    this.panel.webview.onDidReceiveMessage(msg => {
      if (msg.command === 'toggle') {
        this.showAnnotations = !this.showAnnotations;
        this.update();
      }
    });
    this.update();
  }

  private update() {
    const text = this.showAnnotations ? this.annotated : this.plain;
    this.panel.webview.html = this.getHtml(text, this.showAnnotations);
  }

  private getHtml(text: string, showing: boolean): string {
    const buttonLabel = showing ? 'Hide Blame' : 'Show Blame';
    const escaped = escapeHtml(text);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
<style>
body { font-family: monospace; padding: 10px; }
button { margin-bottom: 10px; }
pre { white-space: pre; }
</style>
</head>
<body>
<button id="toggle">${buttonLabel}</button>
<pre>${escaped}</pre>
<script>
const vscode = acquireVsCodeApi();
const btn = document.getElementById('toggle');
btn.addEventListener('click', () => vscode.postMessage({ command: 'toggle' }));
</script>
</body>
</html>`;
  }

  static show(config: string, annotations: Annotation[], node: string): void {
    new NodeConfigPanel(config, annotations, node);
  }
}
