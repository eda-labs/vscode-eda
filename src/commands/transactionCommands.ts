import * as vscode from 'vscode';

import { serviceManager } from '../services/serviceManager';
import type { EdaClient } from '../clients/edaClient';
import { edaOutputChannel, log, LogLevel, edaTransactionProvider } from '../extension';
import { MSG_NO_TRANSACTION_ID } from './constants';

function extractTransactionId(treeItem: any): string | undefined {
  if (treeItem?.resource?.raw?.id) {
    return String(treeItem.resource.raw.id);
  }
  if (treeItem?.label) {
    const tid = treeItem.label.toString().split(' - ')[0];
    return tid || undefined;
  }
  return undefined;
}

export function registerTransactionCommands(context: vscode.ExtensionContext): void {
  const edaClient = serviceManager.getClient<EdaClient>('eda');

  const revertCmd = vscode.commands.registerCommand('vscode-eda.revertTransaction', async (treeItem) => {
    const transactionId = extractTransactionId(treeItem);
    if (!transactionId) {
      vscode.window.showErrorMessage(MSG_NO_TRANSACTION_ID);
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Revert transaction ${transactionId}?`,
      { modal: true },
      'Yes',
      'No'
    );
    if (confirmed !== 'Yes') {
      return;
    }
    try {
      log(`Executing revert for transaction ${transactionId}`, LogLevel.INFO, true);
      const result = await edaClient.revertTransaction(transactionId);
      vscode.window.showInformationMessage(`Transaction ${transactionId} revert submitted.`);
      edaOutputChannel.appendLine(`Revert Transaction ${transactionId} -> ${JSON.stringify(result)}`);
    } catch (err: any) {
      const errMsg = `Failed to revert transaction: ${err.message || err}`;
      vscode.window.showErrorMessage(errMsg);
      log(errMsg, LogLevel.ERROR, true);
    }
  });

  const restoreCmd = vscode.commands.registerCommand('vscode-eda.restoreTransaction', async (treeItem) => {
    const transactionId = extractTransactionId(treeItem);
    if (!transactionId) {
      vscode.window.showErrorMessage(MSG_NO_TRANSACTION_ID);
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Restore configuration to transaction ${transactionId}?`,
      { modal: true },
      'Yes',
      'No'
    );
    if (confirmed !== 'Yes') {
      return;
    }
    try {
      log(`Executing restore for transaction ${transactionId}`, LogLevel.INFO, true);
      const result = await edaClient.restoreTransaction(transactionId);
      vscode.window.showInformationMessage(`Transaction ${transactionId} restore submitted.`);
      edaOutputChannel.appendLine(`Restore Transaction ${transactionId} -> ${JSON.stringify(result)}`);
    } catch (err: any) {
      const errMsg = `Failed to restore transaction: ${err.message || err}`;
      vscode.window.showErrorMessage(errMsg);
      log(errMsg, LogLevel.ERROR, true);
    }
  });

  const setLimitCmd = vscode.commands.registerCommand('vscode-eda.setTransactionLimit', async () => {
    const current = edaTransactionProvider.getTransactionLimit();
    const input = await vscode.window.showInputBox({
      prompt: 'Number of transactions to display',
      placeHolder: current.toString(),
      validateInput: (value) => {
        const n = parseInt(value, 10);
        return n > 0 ? null : 'Enter a positive number';
      }
    });
    if (input) {
      const n = parseInt(input, 10);
      await edaTransactionProvider.setTransactionLimit(n);
      vscode.window.showInformationMessage(`Streaming last ${n} transactions.`);
    }
  });

  context.subscriptions.push(revertCmd, restoreCmd, setLimitCmd);
}
