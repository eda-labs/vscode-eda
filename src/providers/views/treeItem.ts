import * as vscode from 'vscode';

// Create a separate interface for resource data to avoid circular references
export interface ResourceData {
  name: string;
  namespace?: string;
  resourceType?: string;
  kind?: string;
  uid?: string;
  apiGroup?: string;
  apiVersion?: string;
  plural?: string;
  raw?: any; // The raw resource data
}

export class TreeItemBase extends vscode.TreeItem {
  public namespace?: string;
  public resourceType?: string;
  public resourceCategory?: string;
  public crdInfo?: any;

  // Store resource data separately from the tree item
  private _resourceData?: ResourceData;

  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string,
    resource?: any
  ) {
    super(label, collapsibleState);
    this.tooltip = label;

    if (resource) {
      this._resourceData = {
        name: resource.metadata?.name || label,
        namespace: resource.metadata?.namespace,
        uid: resource.metadata?.uid,
        kind: resource.kind,
        raw: resource // Store raw data separately
      };
    }
  }

  /**
   * Get resource data in a way that avoids circular references
   */
  public get resource(): ResourceData | undefined {
    return this._resourceData;
  }

  /**
   * Set resource data safely
   */
  public set resource(data: any) {
    if (data) {
      this._resourceData = {
        name: data.metadata?.name || this.label,
        namespace: data.metadata?.namespace || this.namespace,
        uid: data.metadata?.uid,
        kind: data.kind,
        raw: data
      };
    } else {
      this._resourceData = undefined;
    }
  }

  /**
   * Create command arguments that avoid circular references
   */
  public getCommandArguments(): ResourceData {
    return {
      name: this.label.toString(),
      namespace: this.namespace,
      resourceType: this.resourceType,
      kind: this._resourceData?.kind || this.resourceType,
      uid: this._resourceData?.uid,
      raw: this._resourceData?.raw
    };
  }
}