import * as vscode from 'vscode';
import { DashboardPanel } from '../panels/dashboardPanel';

export function registerDashboardCommands(context: vscode.ExtensionContext): void {
  const cmd = vscode.commands.registerCommand('vscode-eda.showDashboard', (name: string) => {
    DashboardPanel.show(context, name || 'Dashboard');
  });
  context.subscriptions.push(cmd);
}
