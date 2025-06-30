import * as vscode from 'vscode';
import { BasePanel } from '../../basePanel';
import { queriesDashboardHtml } from './queriesDashboardPanel.html';
import { queriesDashboardStyles } from './queriesDashboardPanel.styles';
import { queriesDashboardScripts } from './queriesDashboardPanel.scripts';

export class QueriesDashboardPanel extends BasePanel {
  constructor(context: vscode.ExtensionContext, title: string) {
    super(context, 'queriesDashboard', title);
    this.panel.webview.onDidReceiveMessage(() => {
      // Placeholder for future message handling
    });
    this.panel.webview.html = this.buildHtml();
  }

  protected getHtml(): string {
    return queriesDashboardHtml;
  }

  protected getCustomStyles(): string {
    return queriesDashboardStyles;
  }

  protected getScripts(): string {
    return queriesDashboardScripts;
  }

  static show(context: vscode.ExtensionContext, title: string): void {
    new QueriesDashboardPanel(context, title);
  }
}
