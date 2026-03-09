import * as vscode from 'vscode';

import type { EdaAlarmProvider } from './alarmProvider';
import type { EdaDeviationProvider } from './deviationProvider';
import type { TransactionBasketProvider } from './transactionBasketProvider';
import type { EdaTransactionProvider } from './transactionProvider';
import { TreeItemBase } from './treeItem';
import { FilteredTreeProvider } from './filteredTreeProvider';

interface DashboardEntry {
  name: string;
  countResolver?: () => number;
}

interface DashboardCountProviders {
  alarmProvider: EdaAlarmProvider;
  deviationProvider: EdaDeviationProvider;
  basketProvider: TransactionBasketProvider;
  transactionProvider: EdaTransactionProvider;
}

export class DashboardProvider extends FilteredTreeProvider<TreeItemBase> implements vscode.Disposable {
  private readonly dashboards: DashboardEntry[];
  private readonly disposables: vscode.Disposable[] = [];

  constructor(providers?: DashboardCountProviders) {
    super();
    this.dashboards = [
      { name: 'Fabric' },
      { name: 'Nodes' },
      { name: 'Queries' },
      { name: 'Resource Browser' },
      { name: 'Simnodes' },
      { name: 'Topology' },
      { name: 'Topo Builder' },
      { name: 'Workflows' },
      { name: 'Alarms', countResolver: () => providers?.alarmProvider.count ?? 0 },
      { name: 'Deviations', countResolver: () => providers?.deviationProvider.count ?? 0 },
      { name: 'Basket', countResolver: () => providers?.basketProvider.count ?? 0 },
      { name: 'Transactions', countResolver: () => providers?.transactionProvider.count ?? 0 }
    ];

    if (!providers) {
      return;
    }

    const refreshOnChange = () => {
      this.refresh();
    };

    this.disposables.push(
      providers.alarmProvider.onAlarmCountChanged(refreshOnChange),
      providers.deviationProvider.onDeviationCountChanged(refreshOnChange),
      providers.basketProvider.onBasketCountChanged(refreshOnChange),
      providers.transactionProvider.onDidChangeTreeData(refreshOnChange)
    );
  }

  private getDisplayLabel(entry: DashboardEntry): string {
    if (!entry.countResolver) {
      return entry.name;
    }

    const count = entry.countResolver();
    return `${entry.name} (${count})`;
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  getTreeItem(element: TreeItemBase): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItemBase): TreeItemBase[] {
    if (element) {
      return [];
    }
    let entries = this.dashboards;
    if (this.treeFilter) {
      entries = entries.filter(entry => this.matchesFilter(entry.name) || this.matchesFilter(this.getDisplayLabel(entry)));
    }
    if (entries.length === 0) {
      return [new TreeItemBase('No Dashboards Found', vscode.TreeItemCollapsibleState.None, 'dashboard-empty')];
    }
    return entries.map(entry => {
      const item = new TreeItemBase(this.getDisplayLabel(entry), vscode.TreeItemCollapsibleState.None, 'eda-dashboard');
      item.command = {
        command: 'vscode-eda.showDashboard',
        title: 'Open Dashboard',
        arguments: [entry.name],
      };
      item.iconPath = new vscode.ThemeIcon('dashboard');
      return item;
    });
  }
}
