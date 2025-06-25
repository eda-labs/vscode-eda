import * as vscode from 'vscode';
import { TreeItemBase } from './treeItem';
import { FilteredTreeProvider } from './filteredTreeProvider';
import { serviceManager } from '../../services/serviceManager';
import { EdaClient } from '../../clients/edaClient';
import { ResourceStatusService } from '../../services/resourceStatusService';
import { log, LogLevel } from '../../extension';

export class EdaTransactionProvider extends FilteredTreeProvider<TransactionTreeItem> {
  private edaClient: EdaClient;
  private statusService: ResourceStatusService;
  private cachedTransactions: any[] = [];
  private transactionLimit = 50;

  /**
   * Merge new transaction updates into the cached list while
   * maintaining at most 50 entries.
   */
  private mergeTransactions(txs: any[]): void {
    const byId = new Map<string, any>();
    for (const tx of this.cachedTransactions) {
      if (tx && tx.id !== undefined) {
        byId.set(String(tx.id), tx);
      }
    }
    for (const tx of txs) {
      if (tx && tx.id !== undefined) {
        byId.set(String(tx.id), tx);
      }
    }
    const merged = Array.from(byId.values());
    merged.sort((a, b) => {
      const idA = parseInt(String(a.id), 10);
      const idB = parseInt(String(b.id), 10);
      if (!isNaN(idA) && !isNaN(idB)) {
        return idB - idA;
      }
      return String(b.id).localeCompare(String(a.id));
    });
    this.cachedTransactions = merged.slice(0, this.transactionLimit);
  }

  constructor() {
    super();
    this.edaClient = serviceManager.getClient<EdaClient>('eda');
    this.statusService = serviceManager.getService<ResourceStatusService>('resource-status');
    void this.edaClient.streamEdaTransactions(this.transactionLimit);
    this.edaClient.onStreamMessage((stream, msg) => {
      if (stream === 'summary') {
        this.processTransactionMessage(msg);
      }
    });
  }

  public getTransactionLimit(): number {
    return this.transactionLimit;
  }

  public async setTransactionLimit(limit: number): Promise<void> {
    if (limit <= 0) {
      return;
    }
    this.transactionLimit = limit;
    this.cachedTransactions = this.cachedTransactions.slice(0, limit);
    await this.edaClient.streamEdaTransactions(limit);
    this.refresh();
  }

  public dispose(): void {
    this.edaClient.closeTransactionStream();
  }


  getTreeItem(element: TransactionTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TransactionTreeItem): Promise<TransactionTreeItem[]> {
    if (element) {
      return [];
    }
    return this.getTransactionItems();
  }

  private async getTransactionItems(): Promise<TransactionTreeItem[]> {
    log(`Loading transactions for the transaction tree...`, LogLevel.DEBUG);
    if (this.cachedTransactions.length === 0) {
      return [this.noTransactionsItem()];
    }
    let transactions = this.cachedTransactions.slice();

    if (this.treeFilter) {
      const filter = this.treeFilter;
      transactions = transactions.filter(t => {
        return (
          String(t.id).toLowerCase().includes(filter) ||
          String(t.username || '').toLowerCase().includes(filter) ||
          String(t.state || '').toLowerCase().includes(filter) ||
          String(t.description || '').toLowerCase().includes(filter)
        );
      });
    }

    if (transactions.length === 0) {
      return [this.noTransactionsItem(` (no matches for "${this.treeFilter}")`)];
    }

    transactions.sort((a, b) => {
      const idA = parseInt(String(a.id), 10);
      const idB = parseInt(String(b.id), 10);

      if (!isNaN(idA) && !isNaN(idB)) {
        return idB - idA;
      }
      return String(b.id).localeCompare(String(a.id));
    });

    return transactions.map(t => {
      const label = `${t.id} - ${t.username}`;
      const item = new TransactionTreeItem(
        label,
        vscode.TreeItemCollapsibleState.None,
        'transaction',
        t
      );
      item.description = `${t.state} - ${t.lastChangeTimestamp || ''}`;
      item.tooltip =
        `ID: ${t.id}\n` +
        `User: ${t.username}\n` +
        `State: ${t.state}\n` +
        `Dry Run: ${t.dryRun ? 'Yes' : 'No'}\n` +
        `Description: ${t.description || 'No description'}`;

      const success = !!t.success;
      item.iconPath = this.statusService.getTransactionStatusIcon(t.state, success);
      item.command = {
        command: 'vscode-eda.showTransactionDetails',
        title: 'Show Transaction Details',
        arguments: [String(t.id)],
      };
      return item;
    });
  }

  private noTransactionsItem(extra?: string): TransactionTreeItem {
    const label = extra ? `No Transactions Found ${extra}` : 'No Transactions Found';
    const item = new TransactionTreeItem(
      label,
      vscode.TreeItemCollapsibleState.None,
      'info',
    );
    item.iconPath = this.statusService.getThemeStatusIcon('gray');
    return item;
  }

  /** Process transaction summary stream updates */
  private processTransactionMessage(msg: any): void {
    let results: any[] = [];
    if (Array.isArray(msg.results)) {
      results = msg.results;
    } else if (Array.isArray(msg.msg?.results)) {
      results = msg.msg.results;
    }
    if (results.length > 0) {
      this.mergeTransactions(results);
      this.refresh();
    }
  }
}

export class TransactionTreeItem extends TreeItemBase {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    contextValue: string,
    resource?: any
  ) {
    super(label, collapsibleState, contextValue, resource);
  }
}
