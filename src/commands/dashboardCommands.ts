import * as vscode from 'vscode';
import { FabricDashboardPanel } from '../panels/dashboard/fabric/fabricDashboardPanel';
import { QueriesDashboardPanel } from '../panels/dashboard/queries/queriesDashboardPanel';
import { ToponodesDashboardPanel } from '../panels/dashboard/toponodes/toponodesDashboardPanel';
import { TopologyDashboardPanel } from '../panels/dashboard/topology/topologyDashboardPanel';
import { CrdBrowserPanel } from '../panels/dashboard/crd/crdBrowserPanel';

export function registerDashboardCommands(context: vscode.ExtensionContext): void {
  const cmd = vscode.commands.registerCommand('vscode-eda.showDashboard', (name: string) => {
    if (name === 'Queries') {
      QueriesDashboardPanel.show(context, name);
    } else if (name === 'Nodes') {
      ToponodesDashboardPanel.show(context, name);
    } else if (name === 'Topology') {
      TopologyDashboardPanel.show(context, name);
    } else if (name === 'CRD Browser') {
      CrdBrowserPanel.show(context, name);
    } else {
      FabricDashboardPanel.show(context, name || 'Fabric');
    }
  });
  context.subscriptions.push(cmd);
}
