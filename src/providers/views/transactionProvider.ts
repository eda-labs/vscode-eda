import * as vscode from 'vscode';
import { serviceManager } from '../../services/serviceManager';
import { EdaService } from '../../services/edaService';
import { StatusService } from '../../services/statusService';
import { edaOutputChannel, LogLevel, log } from '../../extension.js';
import { TreeItemBase } from './common/treeItem';
import { resourceStatusService } from '../../extension.js';

export class EdaTransactionProvider implements vscode.TreeDataProvider<TransactionTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TransactionTreeItem | undefined | null | void> = new vscode.EventEmitter<TransactionTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TransactionTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;


  private k8sService: EdaService;
  constructor(
    private context: vscode.ExtensionContext
  ) {
    this.k8sService = serviceManager.getService<EdaService>('eda');
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
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
    const transactions = await this.k8sService.getEdaTransactions();

    // Sort transactions by ID (assuming higher ID = newer transaction)
    // This will display the newest transactions at the top
    transactions.sort((a: any, b: any) => {
      // Try numeric comparison first (most reliable if IDs are numeric)
      const idA = parseInt(a.id, 10);
      const idB = parseInt(b.id, 10);

      if (!isNaN(idA) && !isNaN(idB)) {
        return idB - idA; // Sort in descending order (newest first)
      }

      // If parsing as numbers fails, compare as strings
      return b.id.localeCompare(a.id);
    });

    return transactions.map((t: any) => {
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

      // Use transaction icon from statusUtils
      item.iconPath = resourceStatusService.getTransactionIcon(success);

      item.command = {
        command: 'vscode-eda.showTransactionDetails',
        title: 'Show Transaction Details',
        arguments: [t.id]
      };
      return item;
    });
  }
}

export class TransactionTreeItem extends TreeItemBase {}