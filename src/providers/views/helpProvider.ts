import * as vscode from 'vscode';

import { TreeItemBase } from './treeItem';
import { FilteredTreeProvider } from './filteredTreeProvider';

interface HelpLink {
  label: string;
  url: string;
}

export class HelpProvider extends FilteredTreeProvider<TreeItemBase> {
  private readonly links: HelpLink[] = [
    { label: 'EDA Documentation', url: 'https://docs.eda.dev/' },
    { label: 'Product Page', url: 'https://www.nokia.com/data-center-networks/data-center-fabric/event-driven-automation/' },
    { label: 'Discord', url: 'https://eda.dev/discord' },
    { label: 'Github', url: 'https://github.com/nokia-eda' },
    { label: 'EDA Labs', url: 'https://github.com/eda-labs/' }
  ];

  getTreeItem(element: TreeItemBase): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItemBase): TreeItemBase[] {
    if (element) {
      return [];
    }
    let links = this.links;
    if (this.treeFilter) {
      links = links.filter(l => this.matchesFilter(l.label));
    }
    if (links.length === 0) {
      return [new TreeItemBase('No Help Links Found', vscode.TreeItemCollapsibleState.None, 'help-empty')];
    }
    return links.map(link => {
      const item = new TreeItemBase(link.label, vscode.TreeItemCollapsibleState.None, 'help-link');
      item.command = {
        command: 'vscode.open',
        title: 'Open Link',
        arguments: [vscode.Uri.parse(link.url)]
      };
      item.iconPath = new vscode.ThemeIcon('link-external');
      return item;
    });
  }
}
