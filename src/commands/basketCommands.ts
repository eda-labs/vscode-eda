import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

import type { EdaClient } from '../clients/edaClient';
import {
  edaOutputChannel,
  log,
  LogLevel,
  edaTransactionBasketProvider,
  basketEditProvider
} from '../extension';
import { serviceManager } from '../services/serviceManager';
import type { Transaction, ChangeRequest } from '../providers/views/transactionBasketProvider';

import { MSG_TRANSACTION_BASKET_EMPTY } from './constants';

interface BasketItem {
  basketIndex: number;
}

function extractCrsFromItems(items: unknown[]): { type: unknown }[] {
  const crs: { type: unknown }[] = [];
  for (const item of items) {
    const typedItem = item as { crs?: unknown[]; type?: unknown };
    if (Array.isArray(typedItem.crs)) {
      for (const cr of typedItem.crs) {
        const typedCr = cr as { type?: unknown };
        if (typedCr?.type) {
          crs.push({ type: typedCr.type });
        }
      }
    } else if (typedItem?.type) {
      crs.push({ type: typedItem.type });
    }
  }
  return crs;
}

async function discardBasket(): Promise<void> {
  const items = edaTransactionBasketProvider.getTransactions();
  if (items.length === 0) {
    vscode.window.showInformationMessage('Transaction basket is already empty.');
    return;
  }
  const confirmed = await vscode.window.showWarningMessage(
    'Discard all items in the transaction basket?',
    { modal: true },
    'Yes',
    'No'
  );
  if (confirmed !== 'Yes') {
    return;
  }
  await edaTransactionBasketProvider.clearBasket();
  vscode.window.showInformationMessage('Transaction basket cleared.');
}

async function runBasket(edaClient: EdaClient, dryRun: boolean): Promise<void> {
  const items = edaTransactionBasketProvider.getTransactions();
  if (items.length === 0) {
    vscode.window.showInformationMessage(MSG_TRANSACTION_BASKET_EMPTY);
    return;
  }
  const crs = extractCrsFromItems(items);
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const errMsg = `Failed to run basket transaction: ${message}`;
    vscode.window.showErrorMessage(errMsg);
    log(errMsg, LogLevel.ERROR, true);
  }
}

async function removeBasketItem(item: unknown): Promise<void> {
  const typedItem = item as BasketItem | null;
  if (!typedItem || typeof typedItem.basketIndex !== 'number') {
    return;
  }
  const confirmed = await vscode.window.showWarningMessage('Remove item from basket?', 'Yes', 'No');
  if (confirmed !== 'Yes') {
    return;
  }
  await edaTransactionBasketProvider.removeTransaction(typedItem.basketIndex);
}

function getEditableValue(tx: Transaction): { cr: ChangeRequest; op: string; value: unknown } | null {
  if (!Array.isArray(tx.crs) || tx.crs.length !== 1) {
    vscode.window.showInformationMessage('Editing is only supported for single-resource transactions.');
    return null;
  }
  const cr = tx.crs[0];
  const op = Object.keys(cr.type ?? {})[0];
  const opData = cr.type?.[op] as { value?: unknown } | undefined;
  const value = opData?.value;
  if (!value) {
    vscode.window.showInformationMessage('This basket item is not editable.');
    return null;
  }
  return { cr, op, value };
}

function createSaveListener(
  docUri: vscode.Uri,
  cr: ChangeRequest,
  op: string,
  basketIndex: number,
  tx: Transaction
): vscode.Disposable {
  return vscode.workspace.onDidSaveTextDocument(async savedDoc => {
    if (savedDoc.uri.toString() !== docUri.toString()) {
      return;
    }
    try {
      const updatedValue = yaml.load(savedDoc.getText());
      if (cr.type) {
        (cr.type as Record<string, { value?: unknown }>)[op] = { value: updatedValue };
      }
      await edaTransactionBasketProvider.updateTransaction(basketIndex, tx);
      vscode.window.showInformationMessage('Basket item updated.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to update basket item: ${message}`);
    }
  });
}

async function editBasketItem(item: unknown): Promise<vscode.Disposable | undefined> {
  const typedItem = item as BasketItem | null;
  if (!typedItem || typeof typedItem.basketIndex !== 'number') {
    return;
  }
  const tx = edaTransactionBasketProvider.getTransaction(typedItem.basketIndex) as Transaction | undefined;
  if (!tx) {
    return;
  }
  const editable = getEditableValue(tx);
  if (!editable) {
    return;
  }
  const { cr, op, value } = editable;
  const docUri = vscode.Uri.parse(`basket-edit:/${typedItem.basketIndex}-${Date.now()}.yaml`);
  const yamlText = yaml.dump(value, { indent: 2 });
  basketEditProvider.setContentForUri(docUri, yamlText);
  const doc = await vscode.workspace.openTextDocument(docUri);
  await vscode.languages.setTextDocumentLanguage(doc, 'yaml');
  await vscode.window.showTextDocument(doc, { preview: false });
  return createSaveListener(docUri, cr, op, typedItem.basketIndex, tx);
}

export function registerBasketCommands(context: vscode.ExtensionContext): void {
  const discardCmd = vscode.commands.registerCommand('vscode-eda.discardBasket', () => {
    discardBasket().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      log(`Failed to discard basket: ${message}`, LogLevel.ERROR, true);
    });
  });
  const commitCmd = vscode.commands.registerCommand('vscode-eda.commitBasket', () => {
    const edaClient = serviceManager.getClient<EdaClient>('eda');
    runBasket(edaClient, false).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      log(`Failed to commit basket: ${message}`, LogLevel.ERROR, true);
    });
  });
  const dryRunCmd = vscode.commands.registerCommand('vscode-eda.dryRunBasket', () => {
    const edaClient = serviceManager.getClient<EdaClient>('eda');
    runBasket(edaClient, true).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      log(`Failed to dry run basket: ${message}`, LogLevel.ERROR, true);
    });
  });
  const removeItemCmd = vscode.commands.registerCommand('vscode-eda.removeBasketItem', (item: unknown) => {
    removeBasketItem(item).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      log(`Failed to remove basket item: ${message}`, LogLevel.ERROR, true);
    });
  });
  const editItemCmd = vscode.commands.registerCommand('vscode-eda.editBasketItem', (item: unknown) => {
    editBasketItem(item).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      log(`Failed to edit basket item: ${message}`, LogLevel.ERROR, true);
    });
  });

  context.subscriptions.push(discardCmd, commitCmd, dryRunCmd, removeItemCmd, editItemCmd);
}
