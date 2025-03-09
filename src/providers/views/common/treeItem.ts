import * as vscode from 'vscode';

export class TreeItemBase extends vscode.TreeItem {
  public namespace?: string;
  public resourceType?: string;
  public resourceCategory?: string;
  public resource?: any;
  public crdInfo?: any;

  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string,
    resource?: any
  ) {
    super(label, collapsibleState);
    this.tooltip = label;
    this.resource = resource;
  }
}