import * as vscode from 'vscode';
import { TreeItemBase } from './treeItem';

export abstract class FilteredTreeProvider<T extends TreeItemBase> implements vscode.TreeDataProvider<T> {
  protected _onDidChangeTreeData = new vscode.EventEmitter<T | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  protected treeFilter = '';
  protected _refreshDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  refresh(delay = 100): void {
    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer);
    }
    this._refreshDebounceTimer = setTimeout(() => {
      this._onDidChangeTreeData.fire(undefined);
      this._refreshDebounceTimer = undefined;
    }, delay);
  }

  setTreeFilter(filter: string): void {
    this.treeFilter = filter.toLowerCase();
    this.refresh();
  }

  clearTreeFilter(): void {
    this.treeFilter = '';
    this.refresh();
  }

  // eslint-disable-next-line no-unused-vars
  abstract getTreeItem(element: T): vscode.TreeItem | Promise<vscode.TreeItem>;
  // eslint-disable-next-line no-unused-vars
  abstract getChildren(element?: T): vscode.ProviderResult<T[]>;
}
