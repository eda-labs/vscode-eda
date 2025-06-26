import * as vscode from 'vscode';
import { serviceManager } from '../services/serviceManager';
import { EdaClient } from '../clients/edaClient';
import { edaOutputChannel, log, LogLevel, edaTransactionBasketProvider } from '../extension';

export function registerBasketCommands(context: vscode.ExtensionContext): void {
  const edaClient = serviceManager.getClient<EdaClient>('eda');

  const discardCmd = vscode.commands.registerCommand('vscode-eda.discardBasket', async () => {
    const items = edaTransactionBasketProvider.getTransactions();
    if (items.length === 0) {
      vscode.window.showInformationMessage('Transaction basket is already empty.');
      return;
    }
    const confirmed = await vscode.window.showWarningMessage('Discard all items in the transaction basket?', { modal: true }, 'Yes', 'No');
    if (confirmed !== 'Yes') {
      return;
    }
    await edaTransactionBasketProvider.clearBasket();
    vscode.window.showInformationMessage('Transaction basket cleared.');
  });

  async function runBasket(dryRun: boolean): Promise<void> {
    const items = edaTransactionBasketProvider.getTransactions();
    if (items.length === 0) {
      vscode.window.showInformationMessage('Transaction basket is empty.');
      return;
    }
    const crs: any[] = [];
    for (const item of items) {
      if (Array.isArray(item.crs)) {
        for (const cr of item.crs) {
          if (cr?.type) {
            crs.push({ type: cr.type });
          }
        }
      } else if (item?.type) {
        crs.push({ type: item.type });
      }
    }
    const tx = {
      description: `vscode basket ${dryRun ? 'dry run' : 'commit'}`,
      crs,
      retain: true,
      resultType: 'normal',
      dryRun
    };
    try {
      const id = await edaClient.runTransaction(tx);
      vscode.window.showInformationMessage(`Basket transaction ${id} submitted.`);
      edaOutputChannel.appendLine(`Basket transaction ${id}: ${dryRun ? 'dry run' : 'commit'}`);
      edaOutputChannel.show();
      if (!dryRun) {
        await edaTransactionBasketProvider.clearBasket();
      }
    } catch (err: any) {
      const errMsg = `Failed to run basket transaction: ${err.message || err}`;
      vscode.window.showErrorMessage(errMsg);
      log(errMsg, LogLevel.ERROR, true);
    }
  }

  const commitCmd = vscode.commands.registerCommand('vscode-eda.commitBasket', async () => {
    await runBasket(false);
  });

  const dryRunCmd = vscode.commands.registerCommand('vscode-eda.dryRunBasket', async () => {
    await runBasket(true);
  });

  context.subscriptions.push(discardCmd, commitCmd, dryRunCmd);
}
