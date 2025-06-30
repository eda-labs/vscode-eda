import * as vscode from 'vscode';
import { FabricDashboardPanel } from '../panels/dashboard/fabric/fabricDashboardPanel';
import { QueriesDashboardPanel } from '../panels/dashboard/queries/queriesDashboardPanel';

export function registerDashboardCommands(context: vscode.ExtensionContext): void {
  const cmd = vscode.commands.registerCommand('vscode-eda.showDashboard', (name: string) => {
    if (name === 'Queries') {
      QueriesDashboardPanel.show(context, name);
    } else {
      FabricDashboardPanel.show(context, name || 'Fabric Dashboard');
    }
  });
  context.subscriptions.push(cmd);
}
