import * as vscode from 'vscode';
import { FilteredTreeProvider } from './filteredTreeProvider';
import { TreeItemBase } from './treeItem';
import { serviceManager } from '../../services/serviceManager';
import { EdaClient } from '../../clients/edaClient';
import { ResourceStatusService } from '../../services/resourceStatusService';
import { log, LogLevel } from '../../extension';

export class TransactionBasketProvider extends FilteredTreeProvider<TransactionBasketItem> {
  private edaClient: EdaClient;
  private statusService: ResourceStatusService;
  private items: any[] = [];
  private pollTimer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    super();
    this.edaClient = serviceManager.getClient<EdaClient>('eda');
    this.statusService = serviceManager.getService<ResourceStatusService>('resource-status');
    void this.loadBasket();
    this.pollTimer = setInterval(() => {
      void this.loadBasket();
    }, 5000);
  }

  public dispose(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
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
    } catch (err) {
      log(`Failed to load transaction basket: ${err}`, LogLevel.ERROR);
    }
  }

  public async addTransaction(tx: any): Promise<void> {
    this.items.push(tx);
    await this.saveBasket();
    this.refresh();
  }

  private async saveBasket(): Promise<void> {
    try {
      await this.edaClient.putUserStorageFile('Transactions', JSON.stringify(this.items));
    } catch (err) {
      log(`Failed to save transaction basket: ${err}`, LogLevel.ERROR);
    }
  }

  getTreeItem(element: TransactionBasketItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TransactionBasketItem): Promise<TransactionBasketItem[]> {
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
          items.push(this.createCrItem(cr));
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
      tx
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

  private createCrItem(cr: any): TransactionBasketItem {
    const value =
      cr.type?.create?.value ||
      cr.type?.replace?.value ||
      cr.type?.update?.value ||
      cr.type?.delete?.value;
    const kind = value?.kind || cr.basketInfo?.model?.modelName || 'resource';
    const name = value?.metadata?.name;
    const label = name ? `${kind}/${name}` : kind;
    const op = Object.keys(cr.type || {})[0] || '';
    const item = new TransactionBasketItem(
      label,
      vscode.TreeItemCollapsibleState.None,
      'basket-item',
      cr
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
}

export class TransactionBasketItem extends TreeItemBase {
  constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState, contextValue: string, resource?: any) {
    super(label, collapsibleState, contextValue, resource);
  }
}
