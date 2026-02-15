import * as vscode from 'vscode';

export function registerDashboardCommands(context: vscode.ExtensionContext): void {
  const cmd = vscode.commands.registerCommand('vscode-eda.showDashboard', async (name: string) => {
    try {
      if (name === 'Queries') {
        const { QueriesDashboardPanel } = await import('../webviews/dashboard/queries/queriesDashboardPanel');
        QueriesDashboardPanel.show(context, name);
      } else if (name === 'Nodes') {
        const { ToponodesDashboardPanel } = await import('../webviews/dashboard/toponodes/toponodesDashboard');
        ToponodesDashboardPanel.show(context, name);
      } else if (name === 'Simnodes') {
        const { SimnodesDashboardPanel } = await import('../webviews/dashboard/simnodes/simnodesDashboard');
        SimnodesDashboardPanel.show(context, name);
      } else if (name === 'Topology') {
        const { TopologyFlowDashboardPanel } = await import('../webviews/dashboard/topologyFlow/topologyFlowDashboardPanel');
        TopologyFlowDashboardPanel.show(context, name);
      } else if (name === 'Topo Builder') {
        const { TopoBuilderDashboardPanel } = await import('../webviews/dashboard/topobuilder/topobuilderDashboardPanel');
        TopoBuilderDashboardPanel.show(context, name);
      } else if (name === 'Resource Browser') {
        const { ResourceBrowserPanel } = await import('../webviews/dashboard/resource/resourceBrowserPanel');
        ResourceBrowserPanel.show(context, name);
      } else if (name === 'Workflows') {
        const { WorkflowsDashboardPanel } = await import('../webviews/dashboard/workflows/workflowsDashboard');
        WorkflowsDashboardPanel.show(context, name);
      } else {
        const { FabricDashboardPanel } = await import('../webviews/dashboard/fabric/fabricDashboardPanel');
        await FabricDashboardPanel.show(context, name || 'Fabric');
      }
    } catch (error: unknown) {
      console.error('Failed to show dashboard:', error);
    }
  });
  context.subscriptions.push(cmd);
}
