import * as vscode from 'vscode';

import { serviceManager } from '../../services/serviceManager';
import type { EdaClient } from '../../clients/edaClient';
import type { ResourceStatusService } from '../../services/resourceStatusService';
import { log, LogLevel } from '../../extension';

import { TreeItemBase } from './treeItem';
import { FilteredTreeProvider } from './filteredTreeProvider';

/** K8s-style resource metadata */
interface ResourceMetadata {
  name?: string;
  namespace?: string;
  uid?: string;
  [key: string]: unknown;
}

/** K8s-style resource value containing kind and metadata */
interface ResourceValue {
  kind?: string;
  metadata?: ResourceMetadata;
  [key: string]: unknown;
}

/** Operation types for a change request (create, replace, modify, update, patch, delete) */
interface CrOperation {
  value?: ResourceValue;
  name?: string;
  gvk?: { kind?: string };
  [key: string]: unknown;
}

/** The type field of a change request containing exactly one operation */
interface CrType {
  create?: CrOperation;
  replace?: CrOperation;
  modify?: CrOperation;
  update?: CrOperation;
  patch?: CrOperation;
  delete?: CrOperation;
  [key: string]: unknown;
}

/** Model info stored in basket */
interface BasketModel {
  modelName?: string;
  [key: string]: unknown;
}

/** Additional basket metadata attached to a CR */
interface BasketInfo {
  model?: BasketModel;
  [key: string]: unknown;
}

/** A single change request within a transaction */
export interface ChangeRequest {
  type?: CrType;
  basketInfo?: BasketInfo;
  [key: string]: unknown;
}

/** A transaction containing multiple change requests */
export interface Transaction {
  description?: string;
  crs?: ChangeRequest[];
  [key: string]: unknown;
}

/** Stream message for user storage file updates */
interface FileStreamMessage {
  'file-name'?: string;
  'file-content'?: string;
  msg?: {
    'file-name'?: string;
    'file-content'?: string;
  };
}

export class TransactionBasketProvider extends FilteredTreeProvider<TransactionBasketItem> {
  private edaClient: EdaClient;
  private statusService: ResourceStatusService;
  private items: Transaction[] = [];
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

  public async reloadForTargetSwitch(): Promise<void> {
    this.items = [];
    this.refresh();
    this._onBasketCountChanged.fire(this.count);
    await this.loadBasket();
  }

  /** Set up the stream message listener for basket updates */
  private setupStreamListener(): void {
    this.edaClient.onStreamMessage((stream, msg: unknown) => {
      if (stream === 'file') {
        const fileMsg = msg as FileStreamMessage;
        const fileName = (fileMsg['file-name'] ?? fileMsg.msg?.['file-name'])?.replace(/^\//, '');
        if (fileName === 'Transactions') {
          this.processStreamUpdate(fileMsg);
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
        const parsed: unknown = JSON.parse(content);
        if (Array.isArray(parsed)) {
          this.items = parsed as Transaction[];
        } else if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length === 0) {
          this.items = [];
        } else {
          this.items = [parsed as Transaction];
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

  public async addTransaction(tx: Transaction): Promise<void> {
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

  public getTransactions(): Transaction[] {
    return this.items.slice();
  }

  public getTransaction(index: number): Transaction | undefined {
    return this.items[index];
  }

  public async updateTransaction(index: number, tx: Transaction): Promise<void> {
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
        tx.crs.forEach((cr: ChangeRequest) => {
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

  private createTxItem(tx: Transaction, idx: number): TransactionBasketItem {
    const label = tx.description ?? `Transaction ${idx + 1}`;
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
  private extractCrValue(cr: ChangeRequest): ResourceValue | undefined {
    const type = cr.type;
    if (!type) {
      return undefined;
    }
    return type.create?.value ?? type.replace?.value ?? type.modify?.value ?? type.update?.value ?? type.patch?.value;
  }

  /** Extract the kind from a CR, falling back through value, delete gvk, basketInfo, or default */
  private extractCrKind(cr: ChangeRequest, value: ResourceValue | undefined): string {
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
  private extractCrName(cr: ChangeRequest, value: ResourceValue | undefined): string | undefined {
    return value?.metadata?.name ?? cr.type?.delete?.name;
  }

  private createCrItem(cr: ChangeRequest, idx: number): TransactionBasketItem {
    const value = this.extractCrValue(cr);
    const kind = this.extractCrKind(cr, value);
    const name = this.extractCrName(cr, value);
    const label = name ? `${kind}/${name}` : kind;
    const op = Object.keys(cr.type ?? {})[0] ?? '';

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
  private processStreamUpdate(msg: FileStreamMessage): void {
    const content = msg['file-content'] ?? msg.msg?.['file-content'];
    if (!content) return;
    try {
      const parsed: unknown = JSON.parse(content);
      if (Array.isArray(parsed)) {
        this.items = parsed as Transaction[];
      } else if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length === 0) {
        this.items = [];
      } else {
        this.items = [parsed as Transaction];
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
    resource?: Transaction | ChangeRequest,
    public basketIndex?: number
  ) {
    super(label, collapsibleState, contextValue, resource);
  }
}
