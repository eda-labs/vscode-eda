import * as vscode from 'vscode';
import { TreeItemBase } from './treeItem';

export abstract class FilteredTreeProvider<T extends TreeItemBase> implements vscode.TreeDataProvider<T> {
  protected _onDidChangeTreeData = new vscode.EventEmitter<T | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  protected treeFilter = '';

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  setTreeFilter(filter: string): void {
    this.treeFilter = filter.toLowerCase();
    this.refresh();
  }

  clearTreeFilter(): void {
    this.treeFilter = '';
    this.refresh();
  }

  abstract getTreeItem(element: T): vscode.TreeItem | Promise<vscode.TreeItem>;
  abstract getChildren(element?: T): vscode.ProviderResult<T[]>;
}
