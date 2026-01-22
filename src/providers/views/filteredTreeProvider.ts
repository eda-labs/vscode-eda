import * as vscode from 'vscode';

import type { TreeItemBase } from './treeItem';

export abstract class FilteredTreeProvider<T extends TreeItemBase> implements vscode.TreeDataProvider<T> {
  protected _onDidChangeTreeData = new vscode.EventEmitter<T | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  protected treeFilter = '';
  protected regexFilter: RegExp | null = null;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  setTreeFilter(filter: string): void {
    this.treeFilter = filter;
    try {
      this.regexFilter = new RegExp(filter, 'i');
    } catch (err: unknown) {
      this.regexFilter = null;
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Invalid filter regex: ${message}`);
    }
    this.refresh();
  }

  clearTreeFilter(): void {
    this.treeFilter = '';
    this.regexFilter = null;
    this.refresh();
  }

  protected matchesFilter(text: string): boolean {
    if (!this.treeFilter) {
      return true;
    }
    if (this.regexFilter) {
      return this.regexFilter.test(text);
    }
    return text.toLowerCase().includes(this.treeFilter.toLowerCase());
  }

  abstract getTreeItem(element: T): vscode.TreeItem | Promise<vscode.TreeItem>;
  abstract getChildren(element?: T): vscode.ProviderResult<T[]>;
}
