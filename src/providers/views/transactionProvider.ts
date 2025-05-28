import * as vscode from 'vscode';
import { TreeItemBase } from './treeItem';
import { serviceManager } from '../../services/serviceManager';
import { EdaClient } from '../../clients/edaClient';
import { ResourceStatusService } from '../../services/resourceStatusService';
import { log, LogLevel } from '../../extension';

export class EdaTransactionProvider implements vscode.TreeDataProvider<TransactionTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TransactionTreeItem | undefined | null | void> = new vscode.EventEmitter<TransactionTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TransactionTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private edactlClient: EdaClient;
  private statusService: ResourceStatusService;
  private refreshInterval = 10000;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private _refreshDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  private cachedTransactions: any[] = [];

  constructor() {
    this.edactlClient = serviceManager.getClient<EdaClient>('edactl');
    this.statusService = serviceManager.getService<ResourceStatusService>('resource-status');
    this.startRefreshTimer();
    void this.edactlClient.streamEdaTransactions(txs => {
      log(`Transaction stream provided ${txs.length} results`, LogLevel.DEBUG);
      this.cachedTransactions = txs;
      this.refresh();
    });
  }

  private startRefreshTimer(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    this.refreshTimer = setInterval(() => {
      this.refresh();
    }, this.refreshInterval);
    log(`Transaction polling started, refresh interval: ${this.refreshInterval}ms`, LogLevel.INFO);
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
      log('Transaction polling stopped', LogLevel.INFO);
    }

    this.edactlClient.closeTransactionStream();

    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer);
      this._refreshDebounceTimer = undefined;
    }
  }

  refresh(): void {
    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer);
    }
    this._refreshDebounceTimer = setTimeout(() => {
      this._onDidChangeTreeData.fire();
      this._refreshDebounceTimer = undefined;
    }, 100);
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
      this.cachedTransactions = await this.edactlClient.getEdaTransactions();
    }
    const transactions = this.cachedTransactions;

    // Sort transactions by ID (assuming higher ID = newer transaction)
    // This will display the newest transactions at the top
    transactions.sort((a, b) => {
      // Try numeric comparison first (most reliable if IDs are numeric)
      const idA = parseInt(a.id, 10);
      const idB = parseInt(b.id, 10);

      if (!isNaN(idA) && !isNaN(idB)) {
        return idB - idA; // Sort in descending order (newest first)
      }

      // If parsing as numbers fails, compare as strings
      return b.id.localeCompare(a.id);
    });

    return transactions.map(t => {
      const label = `${t.id} - ${t.username}`;
      const item = new TransactionTreeItem(
        label,
        vscode.TreeItemCollapsibleState.None,
        'transaction',
        t
      );
      if (t.result === 'OK') {
        item.description = `${t.age} - ${t.description || 'No description'}`;
      } else {
        item.description = `FAILED - ${t.age}`;
      }
      item.tooltip =
        `ID: ${t.id}\n` +
        `Result: ${t.result}\n` +
        `Age: ${t.age}\n` +
        `Detail Level: ${t.detail}\n` +
        `Dry Run: ${t.dryRun || 'No'}\n` +
        `Username: ${t.username}\n` +
        `Description: ${t.description || 'No description'}`;

      const success = t.result === 'OK';

      // Use transaction icon from statusService
      item.iconPath = this.statusService.getTransactionIcon(success);

      item.command = {
        command: 'vscode-eda.showTransactionDetails',
        title: 'Show Transaction Details',
        arguments: [t.id]
      };
      return item;
    });
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