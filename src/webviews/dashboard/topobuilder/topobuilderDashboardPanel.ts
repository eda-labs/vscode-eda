import * as vscode from 'vscode';

import { BasePanel } from '../../basePanel';

export class TopoBuilderDashboardPanel extends BasePanel {
  private static currentPanel: TopoBuilderDashboardPanel | undefined;

  private constructor(context: vscode.ExtensionContext, title: string) {
    super(context, 'topobuilderDashboard', title, undefined, BasePanel.getEdaIconPath(context));
    this.panel.webview.html = this.buildHtml();
  }

  protected getCustomStyles(): string {
    return this.readWebviewFile('dashboard', 'topobuilder', 'topobuilderDashboard.css');
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'topobuilderDashboard.js');
    return `<script type="module" nonce="${nonce}" src="${scriptUri}"></script>`;
  }

  protected buildHtml(): string {
    const nonce = this.getNonce();
    const csp = this.panel.webview.cspSource;
    const scriptTags = this.getScriptTags(nonce);
    const styles = this.getCustomStyles();
    const packageStylesUri = this.getResourceUri('dist', 'topobuilderDashboard.css');
    const logoUri = this.getResourceUri('resources', 'eda.svg').toString();
    const bootstrapScript = `<script nonce="${nonce}">window.__TOPOBUILDER_LOGO_URI__ = ${JSON.stringify(logoUri)};</script>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} https: data:; style-src ${csp} 'unsafe-inline'; font-src ${csp} https: data:; script-src 'nonce-${nonce}' ${csp};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${packageStylesUri}" rel="stylesheet">
  <style>${styles}</style>
</head>
<body>
  <div id="root"></div>
  ${bootstrapScript}
  ${scriptTags}
</body>
</html>`;
  }

  static show(context: vscode.ExtensionContext, title: string): TopoBuilderDashboardPanel {
    if (TopoBuilderDashboardPanel.currentPanel) {
      TopoBuilderDashboardPanel.currentPanel.panel.title = title;
      TopoBuilderDashboardPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
      return TopoBuilderDashboardPanel.currentPanel;
    }

    const panel = new TopoBuilderDashboardPanel(context, title);
    TopoBuilderDashboardPanel.currentPanel = panel;
    panel.panel.onDidDispose(() => {
      if (TopoBuilderDashboardPanel.currentPanel === panel) {
        TopoBuilderDashboardPanel.currentPanel = undefined;
      }
    });
    return panel;
  }
}
