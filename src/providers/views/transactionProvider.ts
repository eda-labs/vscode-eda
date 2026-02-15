import * as vscode from 'vscode';

import { serviceManager } from '../../services/serviceManager';
import type { EdaClient } from '../../clients/edaClient';
import type { ResourceStatusService } from '../../services/resourceStatusService';
import { log, LogLevel } from '../../extension';
import { getResults } from '../../utils/streamMessageUtils';

import { FilteredTreeProvider } from './filteredTreeProvider';
import { TreeItemBase } from './treeItem';

/** Represents transaction data from the EDA stream */
interface Transaction {
  id?: string | number;
  username?: string;
  state?: string;
  description?: string;
  lastChangeTimestamp?: string;
  dryRun?: boolean;
  success?: boolean;
  [key: string]: unknown;
}

/** Stream message envelope */
interface StreamMessageEnvelope {
  msg?: {
    results?: Transaction[];
    Results?: Transaction[];
  };
  results?: Transaction[];
  Results?: Transaction[];
}

export class EdaTransactionProvider extends FilteredTreeProvider<TransactionTreeItem> {
  private edaClient: EdaClient;
  private statusService: ResourceStatusService;
  private cachedTransactions: Transaction[] = [];
  private transactionLimit = 50;

  /**
   * Merge new transaction updates into the cached list while
   * maintaining at most 50 entries.
   */
  private mergeTransactions(txs: Transaction[]): void {
    const byId = new Map<string, Transaction>();
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
    this.edaClient.onStreamMessage((stream, msg) => {
      if (stream === 'summary') {
        this.processTransactionMessage(msg as StreamMessageEnvelope);
      }
    });
  }

  /**
   * Initialize the transaction stream. Call this after construction.
   */
  public async initialize(): Promise<void> {
    await this.edaClient.streamEdaTransactions(this.transactionLimit);
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
    await this.edaClient.updateTransactionStreamSize(limit);
    this.refresh();
  }

  public dispose(): void {
    this.edaClient.closeTransactionStream();
  }


  getTreeItem(element: TransactionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TransactionTreeItem): TransactionTreeItem[] {
    if (element) {
      return [];
    }
    return this.getTransactionItems();
  }

  private getTransactionItems(): TransactionTreeItem[] {
    log(`Loading transactions for the transaction tree...`, LogLevel.DEBUG);
    if (this.cachedTransactions.length === 0) {
      return [this.noTransactionsItem()];
    }
    let transactions = this.cachedTransactions.slice();

    if (this.treeFilter) {
      transactions = transactions.filter(t => {
        return (
          this.matchesFilter(String(t.id)) ||
          this.matchesFilter(String(t.username || '')) ||
          this.matchesFilter(String(t.state || '')) ||
          this.matchesFilter(String(t.description || ''))
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
        `Time: ${t.lastChangeTimestamp || 'N/A'}\n` +
        `Dry Run: ${t.dryRun ? 'Yes' : 'No'}\n` +
        `Description: ${t.description || 'No description'}`;

      const success = !!t.success;
      item.iconPath = this.statusService.getTransactionStatusIcon(t.state, success);
      item.status = {
        indicator: this.statusService.getTransactionStatusIndicator(t.state, success),
        description: t.state || ''
      };
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
  private processTransactionMessage(msg: StreamMessageEnvelope): void {
    let results = getResults(msg) as Transaction[];
    if (results.length === 0) {
      results = getResults(msg.msg) as Transaction[];
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
    resource?: Transaction
  ) {
    super(label, collapsibleState, contextValue, resource);
  }
}
