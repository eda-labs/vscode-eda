import * as vscode from 'vscode';

import { serviceManager } from '../../services/serviceManager';
import type { EdaClient } from '../../clients/edaClient';
import type { ResourceStatusService } from '../../services/resourceStatusService';
import { log, LogLevel } from '../../extension';

import { TreeItemBase } from './treeItem';
import { FilteredTreeProvider } from './filteredTreeProvider';

export class TransactionBasketProvider extends FilteredTreeProvider<TransactionBasketItem> {
  private edaClient: EdaClient;
  private statusService: ResourceStatusService;
  private items: any[] = [];
  private _onBasketCountChanged = new vscode.EventEmitter<number>();
  readonly onBasketCountChanged = this._onBasketCountChanged.event;

  public get count(): number {
    return this.items.length;
  }

  constructor() {
    super();
    this.edaClient = serviceManager.getClient<EdaClient>('eda');
    this.statusService = serviceManager.getService<ResourceStatusService>('resource-status');
    this.setupStreamListener();

    // Emit initial count
    this._onBasketCountChanged.fire(this.count);
  }

  /**
   * Initialize async operations. Call this after construction.
   */
  public async initialize(): Promise<void> {
    await this.loadBasket();
    await this.edaClient.streamUserStorageFile('Transactions');
  }

  /** Set up the stream message listener for basket updates */
  private setupStreamListener(): void {
    this.edaClient.onStreamMessage((stream, msg) => {
      if (stream === 'file') {
        const fileName = (msg['file-name'] ?? msg.msg?.['file-name'])?.replace(/^\//, '');
        if (fileName === 'Transactions') {
          this.processStreamUpdate(msg);
        }
      }
    });
  }

  public dispose(): void {
    // no periodic polling to clear
  }

  private async loadBasket(): Promise<void> {
    try {
      const content = await this.edaClient.getUserStorageFile('Transactions');
      if (content) {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          this.items = parsed;
        } else if (typeof parsed === 'object' && Object.keys(parsed).length === 0) {
          this.items = [];
        } else {
          this.items = [parsed];
        }
      } else {
        this.items = [];
      }
      this.refresh();
      this._onBasketCountChanged.fire(this.count);
    } catch (err) {
      log(`Failed to load transaction basket: ${err}`, LogLevel.ERROR);
    }
  }

  public async addTransaction(tx: any): Promise<void> {
    this.items.push(tx);
    await this.saveBasket();
    this.refresh();
    this._onBasketCountChanged.fire(this.count);
  }

  private async saveBasket(): Promise<void> {
    try {
      await this.edaClient.putUserStorageFile('Transactions', JSON.stringify(this.items));
    } catch (err) {
      log(`Failed to save transaction basket: ${err}`, LogLevel.ERROR);
    }
  }

  public getTransactions(): any[] {
    return this.items.slice();
  }

  public getTransaction(index: number): any | undefined {
    return this.items[index];
  }

  public async updateTransaction(index: number, tx: any): Promise<void> {
    if (index < 0 || index >= this.items.length) {
      return;
    }
    this.items[index] = tx;
    await this.saveBasket();
    this.refresh();
  }

  public async clearBasket(): Promise<void> {
    this.items = [];
    await this.saveBasket();
    this.refresh();
    this._onBasketCountChanged.fire(this.count);
  }

  public async removeTransaction(index: number): Promise<void> {
    if (index < 0 || index >= this.items.length) {
      return;
    }
    this.items.splice(index, 1);
    await this.saveBasket();
    this.refresh();
    this._onBasketCountChanged.fire(this.count);
  }

  getTreeItem(element: TransactionBasketItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TransactionBasketItem): TransactionBasketItem[] {
    if (element) {
      return [];
    }
    if (this.items.length === 0) {
      return [this.emptyItem()];
    }

    const items: TransactionBasketItem[] = [];

    this.items.forEach((tx, txIdx) => {
      if (Array.isArray(tx.crs) && tx.crs.length > 0) {
        tx.crs.forEach((cr: any) => {
          items.push(this.createCrItem(cr, txIdx));
        });
      } else {
        items.push(this.createTxItem(tx, txIdx));
      }
    });

    return items;
  }

  private emptyItem(): TransactionBasketItem {
    const item = new TransactionBasketItem('No items in basket', vscode.TreeItemCollapsibleState.None, 'info');
    item.iconPath = this.statusService.getThemeStatusIcon('gray');
    return item;
  }

  private createTxItem(tx: any, idx: number): TransactionBasketItem {
    const label = tx.description || `Transaction ${idx + 1}`;
    const item = new TransactionBasketItem(
      label,
      vscode.TreeItemCollapsibleState.None,
      'basket-item',
      tx,
      idx
    );
    item.description = tx.crs && Array.isArray(tx.crs) ? `${tx.crs.length} resource(s)` : '';
    item.tooltip = JSON.stringify(tx, null, 2);
    item.iconPath = this.statusService.getThemeStatusIcon('blue');
    item.command = {
      command: 'vscode-eda.showBasketTransaction',
      title: 'Show Basket Transaction',
      arguments: [tx]
    };
    return item;
  }

  /** Extract the value object from a CR type (create, replace, modify, update, or patch) */
  private extractCrValue(cr: any): any {
    const type = cr.type;
    if (!type) {
      return undefined;
    }
    return type.create?.value ?? type.replace?.value ?? type.modify?.value ?? type.update?.value ?? type.patch?.value;
  }

  /** Extract the kind from a CR, falling back through value, delete gvk, basketInfo, or default */
  private extractCrKind(cr: any, value: any): string {
    if (value?.kind) {
      return value.kind;
    }
    if (cr.type?.delete?.gvk?.kind) {
      return cr.type.delete.gvk.kind;
    }
    if (cr.basketInfo?.model?.modelName) {
      return cr.basketInfo.model.modelName;
    }
    return 'resource';
  }

  /** Extract the name from a CR value or delete operation */
  private extractCrName(cr: any, value: any): string | undefined {
    return value?.metadata?.name ?? cr.type?.delete?.name;
  }

  private createCrItem(cr: any, idx: number): TransactionBasketItem {
    const value = this.extractCrValue(cr);
    const kind = this.extractCrKind(cr, value);
    const name = this.extractCrName(cr, value);
    const label = name ? `${kind}/${name}` : kind;
    const op = Object.keys(cr.type || {})[0] || '';

    const item = new TransactionBasketItem(
      label,
      vscode.TreeItemCollapsibleState.None,
      'basket-item',
      cr,
      idx
    );
    item.description = op;
    item.tooltip = JSON.stringify(cr, null, 2);
    item.iconPath = this.statusService.getThemeStatusIcon('blue');
    item.command = {
      command: 'vscode-eda.showBasketTransaction',
      title: 'Show Basket Transaction',
      arguments: [cr]
    };
    return item;
  }

  /** Process updates from the user-storage stream */
  private processStreamUpdate(msg: any): void {
    const content = msg['file-content'] ?? msg.msg?.['file-content'];
    if (!content) return;
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        this.items = parsed;
      } else if (typeof parsed === 'object' && Object.keys(parsed).length === 0) {
        this.items = [];
      } else {
        this.items = [parsed];
      }
      this.refresh();
      this._onBasketCountChanged.fire(this.count);
    } catch (err) {
      log(`Failed to process basket stream: ${err}`, LogLevel.ERROR);
    }
  }
}

export class TransactionBasketItem extends TreeItemBase {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    contextValue: string,
    resource?: any,
    public basketIndex?: number
  ) {
    super(label, collapsibleState, contextValue, resource);
  }
}
