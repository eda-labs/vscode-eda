import * as vscode from 'vscode';
import { FabricDashboardPanel } from '../panels/dashboard/fabric/fabricDashboardPanel';
import { QueriesDashboardPanel } from '../panels/dashboard/queries/queriesDashboardPanel';
import { ToponodesDashboardPanel } from '../panels/dashboard/toponodes/toponodesDashboardPanel';

export function registerDashboardCommands(context: vscode.ExtensionContext): void {
  const cmd = vscode.commands.registerCommand('vscode-eda.showDashboard', (name: string) => {
    if (name === 'Queries') {
      QueriesDashboardPanel.show(context, name);
    } else if (name === 'Toponodes') {
      ToponodesDashboardPanel.show(context, name);
    } else {
      FabricDashboardPanel.show(context, name || 'Fabric Dashboard');
    }
  });
  context.subscriptions.push(cmd);
}
