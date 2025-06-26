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

  constructor() {
    super();
    this.edaClient = serviceManager.getClient<EdaClient>('eda');
    this.statusService = serviceManager.getService<ResourceStatusService>('resource-status');
    void this.loadBasket();
  }

  public dispose(): void {
    // no-op for now
  }

  private async loadBasket(): Promise<void> {
    try {
      const content = await this.edaClient.getUserStorageFile('Transactions');
      if (content) {
        const parsed = JSON.parse(content);
        this.items = Array.isArray(parsed) ? parsed : [parsed];
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
    return this.items.map((tx, idx) => {
      const label = tx.description || `Transaction ${idx + 1}`;
      const item = new TransactionBasketItem(label, vscode.TreeItemCollapsibleState.None, 'basket-item', tx);
      item.description = tx.crs && Array.isArray(tx.crs) ? `${tx.crs.length} resource(s)` : '';
      item.tooltip = JSON.stringify(tx, null, 2);
      item.iconPath = this.statusService.getThemeStatusIcon('blue');
      return item;
    });
  }

  private emptyItem(): TransactionBasketItem {
    const item = new TransactionBasketItem('No items in basket', vscode.TreeItemCollapsibleState.None, 'info');
    item.iconPath = this.statusService.getThemeStatusIcon('gray');
    return item;
  }
}

export class TransactionBasketItem extends TreeItemBase {
  constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState, contextValue: string, resource?: any) {
    super(label, collapsibleState, contextValue, resource);
  }
}
