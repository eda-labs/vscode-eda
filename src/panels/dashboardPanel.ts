import * as vscode from 'vscode';

function getNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => possible.charAt(Math.floor(Math.random() * possible.length))).join('');
}

export class DashboardPanel {
  private panel: vscode.WebviewPanel;

  constructor(private context: vscode.ExtensionContext, title: string) {
    this.panel = vscode.window.createWebviewPanel(
      'edaDashboard',
      title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );
    this.panel.webview.html = this.getHtml();
  }

  private getHtml(): string {
    const nonce = getNonce();
    const csp = this.panel.webview.cspSource;
    const twJs = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'tailwind.js')
    );
    const twCss = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'tailwind.css')
    );
    const echartsJs = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'echarts.min.js')
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} https:; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}' ${csp};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${twCss}" rel="stylesheet">
</head>
<body class="p-4 bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)]">
  <div class="grid gap-4">
    <div id="health" class="h-64"></div>
    <div id="peers" class="h-64"></div>
  </div>
  <script nonce="${nonce}" src="${twJs}"></script>
  <script nonce="${nonce}" src="${echartsJs}"></script>
  <script nonce="${nonce}">
    const healthChart = echarts.init(document.getElementById('health'));
    healthChart.setOption({
      title: { text: 'Fabric Health' },
      series: [{ type: 'gauge', progress: { show: true }, data: [{ value: Math.round(Math.random() * 100) }] }]
    });

    const peerChart = echarts.init(document.getElementById('peers'));
    peerChart.setOption({
      title: { text: 'BGP Peers' },
      xAxis: { type: 'category', data: ['spine1', 'spine2', 'spine3', 'spine4'] },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: [0,1,2,3].map(() => Math.round(Math.random() * 100)) }]
    });
  </script>
</body>
</html>`;
  }

  static show(context: vscode.ExtensionContext, title: string): void {
    new DashboardPanel(context, title);
  }
}
