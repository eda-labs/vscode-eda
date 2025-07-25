import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { serviceManager } from '../services/serviceManager';
import { EdaClient } from '../clients/edaClient';
import {
  edaOutputChannel,
  log,
  LogLevel,
  edaTransactionBasketProvider,
  basketEditProvider
} from '../extension';

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

  const removeItemCmd = vscode.commands.registerCommand('vscode-eda.removeBasketItem', async (item: any) => {
    if (!item || typeof item.basketIndex !== 'number') {
      return;
    }
    const confirmed = await vscode.window.showWarningMessage('Remove item from basket?', 'Yes', 'No');
    if (confirmed !== 'Yes') {
      return;
    }
    await edaTransactionBasketProvider.removeTransaction(item.basketIndex);
  });

  const editItemCmd = vscode.commands.registerCommand('vscode-eda.editBasketItem', async (item: any) => {
    if (!item || typeof item.basketIndex !== 'number') {
      return;
    }
    const tx = edaTransactionBasketProvider.getTransaction(item.basketIndex);
    if (!tx) {
      return;
    }
    if (!Array.isArray(tx.crs) || tx.crs.length !== 1) {
      vscode.window.showInformationMessage('Editing is only supported for single-resource transactions.');
      return;
    }
    const cr = tx.crs[0];
    const op = Object.keys(cr.type || {})[0];
    const value = cr.type?.[op]?.value;
    if (!value) {
      vscode.window.showInformationMessage('This basket item is not editable.');
      return;
    }
    const docUri = vscode.Uri.parse(`basket-edit:/${item.basketIndex}-${Date.now()}.yaml`);
    const yamlText = yaml.dump(value, { indent: 2 });
    basketEditProvider.setContentForUri(docUri, yamlText);
    const doc = await vscode.workspace.openTextDocument(docUri);
    await vscode.languages.setTextDocumentLanguage(doc, 'yaml');
    await vscode.window.showTextDocument(doc, { preview: false });

    const saveListener = vscode.workspace.onDidSaveTextDocument(async savedDoc => {
      if (savedDoc.uri.toString() === docUri.toString()) {
        saveListener.dispose();
        try {
          const updatedValue = yaml.load(savedDoc.getText());
          cr.type[op].value = updatedValue;
          await edaTransactionBasketProvider.updateTransaction(item.basketIndex, tx);
          vscode.window.showInformationMessage('Basket item updated.');
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to update basket item: ${err.message || err}`);
        }
      }
    });
  });

  context.subscriptions.push(discardCmd, commitCmd, dryRunCmd, removeItemCmd, editItemCmd);
}
