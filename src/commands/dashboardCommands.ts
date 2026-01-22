import * as vscode from 'vscode';

import { FabricDashboardPanel } from '../webviews/dashboard/fabric/fabricDashboardPanel';
import { QueriesDashboardPanel } from '../webviews/dashboard/queries/queriesDashboardPanel';
import { ToponodesDashboardPanel } from '../webviews/dashboard/toponodes/toponodesDashboard';
import { SimnodesDashboardPanel } from '../webviews/dashboard/simnodes/simnodesDashboard';
import { TopologyDashboardPanel } from '../webviews/dashboard/topology/topologyDashboardPanel';
import { ResourceBrowserPanel } from '../webviews/dashboard/resource/resourceBrowserPanel';

export function registerDashboardCommands(context: vscode.ExtensionContext): void {
  const cmd = vscode.commands.registerCommand('vscode-eda.showDashboard', (name: string) => {
    if (name === 'Queries') {
      QueriesDashboardPanel.show(context, name);
    } else if (name === 'Nodes') {
      ToponodesDashboardPanel.show(context, name);
    } else if (name === 'Simnodes') {
      SimnodesDashboardPanel.show(context, name);
    } else if (name === 'Topology') {
      TopologyDashboardPanel.show(context, name);
    } else if (name === 'Resource Browser') {
      ResourceBrowserPanel.show(context, name);
    } else {
      FabricDashboardPanel.show(context, name || 'Fabric').catch((error: unknown) => {
        console.error('Failed to show Fabric Dashboard:', error);
      });
    }
  });
  context.subscriptions.push(cmd);
}
