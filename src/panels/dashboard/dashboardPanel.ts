import * as vscode from 'vscode';
import { BasePanel } from '../basePanel';
import { dashboardStyles } from './dashboardPanel.styles';
import { dashboardHtml } from './dashboardPanel.html';
import { dashboardScripts } from './dashboardPanel.scripts';

export class DashboardPanel extends BasePanel {
  constructor(context: vscode.ExtensionContext, title: string) {
    super(context, 'edaDashboard', title);
    this.panel.webview.html = this.buildHtml();
  }

  protected getHtml(): string {
    return dashboardHtml;
  }

  protected getCustomStyles(): string {
    return dashboardStyles;
  }

  protected getScripts(): string {
    const echartsJs = this.getResourceUri('resources', 'echarts.min.js');

    return `
      const echartsJsUri = "${echartsJs}";
      ${dashboardScripts}
    `;
  }

  static show(context: vscode.ExtensionContext, title: string): void {
    new DashboardPanel(context, title);
  }
}