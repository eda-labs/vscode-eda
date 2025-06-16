import * as vscode from 'vscode';
import { serviceManager } from '../services/serviceManager';
import { EdaClient } from '../clients/edaClient';
import { edaOutputChannel, log, LogLevel } from '../extension';

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
  const edaClient = serviceManager.getClient<EdaClient>('edactl');

  const revertCmd = vscode.commands.registerCommand('vscode-eda.revertTransaction', async (treeItem) => {
    const transactionId = extractTransactionId(treeItem);
    if (!transactionId) {
      vscode.window.showErrorMessage('No transaction ID available.');
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
      edaOutputChannel.show();
    } catch (err: any) {
      const errMsg = `Failed to revert transaction: ${err.message || err}`;
      vscode.window.showErrorMessage(errMsg);
      log(errMsg, LogLevel.ERROR, true);
    }
  });

  const restoreCmd = vscode.commands.registerCommand('vscode-eda.restoreTransaction', async (treeItem) => {
    const transactionId = extractTransactionId(treeItem);
    if (!transactionId) {
      vscode.window.showErrorMessage('No transaction ID available.');
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
      edaOutputChannel.show();
    } catch (err: any) {
      const errMsg = `Failed to restore transaction: ${err.message || err}`;
      vscode.window.showErrorMessage(errMsg);
      log(errMsg, LogLevel.ERROR, true);
    }
  });

  context.subscriptions.push(revertCmd, restoreCmd);
}
