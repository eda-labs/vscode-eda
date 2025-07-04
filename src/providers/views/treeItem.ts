import * as vscode from 'vscode';

export interface ResourceData {
  name: string;
  namespace?: string;
  resourceType?: string;
  kind?: string;
  uid?: string;
  apiGroup?: string;
  apiVersion?: string;
  plural?: string;
  raw?: any; // Add raw resource data
}

export class TreeItemBase extends vscode.TreeItem {
  public namespace?: string;
  public resourceType?: string;
  public resourceCategory?: string;
  public streamGroup?: string;
  public crdInfo?: any;
  public status?: {
    indicator: string;
    description: string;
  };
  private _resourceData?: ResourceData;

  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    contextValue: string,
    resource?: any
  ) {
    super(label, collapsibleState);
    this.contextValue = contextValue;
    this.tooltip = label;
    if (resource) {
      this._resourceData = {
        name: resource.metadata?.name || label,
        namespace: resource.metadata?.namespace,
        uid: resource.metadata?.uid,
        kind: resource.kind,
        raw: resource
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
   * Get the raw resource object if available
   */
  public get rawResource(): any | undefined {
    return this._resourceData?.raw;
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
   * Set the status information for this tree item
   */
  public setStatus(indicator: string, description: string) {
    this.status = { indicator, description };

    // Update the tooltip to include status information
    let tooltip = this.label.toString();
    if (description) {
      tooltip += `\nStatus: ${description}`;
    }
    this.tooltip = tooltip;

    // Update the description field in the tree item
    if (description) {
      this.description = description;
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