import * as vscode from 'vscode';
import { TreeItemBase } from './treeItem';
import { FilteredTreeProvider } from './filteredTreeProvider';

export class DashboardProvider extends FilteredTreeProvider<TreeItemBase> {
  private dashboards = ['Fabric Dashboard', 'Toponodes', 'Queries', 'CRD Browser'];

  getTreeItem(element: TreeItemBase): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeItemBase): Promise<TreeItemBase[]> {
    if (element) {
      return [];
    }
    let names = this.dashboards;
    if (this.treeFilter) {
      names = names.filter(n => this.matchesFilter(n));
    }
    if (names.length === 0) {
      return [new TreeItemBase('No Dashboards Found', vscode.TreeItemCollapsibleState.None, 'dashboard-empty')];
    }
    return names.map(name => {
      const item = new TreeItemBase(name, vscode.TreeItemCollapsibleState.None, 'eda-dashboard');
      item.command = {
        command: 'vscode-eda.showDashboard',
        title: 'Open Dashboard',
        arguments: [name],
      };
      item.iconPath = new vscode.ThemeIcon('dashboard');
      return item;
    });
  }
}
