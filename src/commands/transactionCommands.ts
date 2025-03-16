import * as vscode from 'vscode';
import { serviceManager } from '../services/serviceManager';
import { EdactlClient } from '../clients/edactlClient';
import { edaOutputChannel } from '../extension';
import { log, LogLevel } from '../extension';

/**
 * Registers commands for managing EDA transactions (revert and restore)
 */
export function registerTransactionCommands(
  context: vscode.ExtensionContext
) {
  // Command to revert a transaction (undoing changes)
  const revertTransactionCmd = vscode.commands.registerCommand(
    'vscode-eda.revertTransaction',
    async (treeItem) => {
      if (!treeItem?.resource?.raw?.id) {
        // Also try alternative access path
        if (!treeItem?.label) {
          vscode.window.showErrorMessage('No transaction ID available.');
          return;
        }

        // The label format is "ID - Username", so extract the ID
        const transactionId = treeItem.label.toString().split(' - ')[0];
        if (!transactionId) {
          vscode.window.showErrorMessage('Could not extract transaction ID from label.');
          return;
        }
      }
      const transactionId = treeItem?.resource?.raw?.id || treeItem.label.toString().split(' - ')[0];
      const edactlClient = serviceManager.getClient<EdactlClient>('edactl');

      // Fetch transaction details to get commit hash
      try {
        const details = await edactlClient.getTransactionDetails(transactionId);

        // Extract commit hash using regex
        const match = details.match(/commit-hash:\s*([a-f0-9]+)/i);
        if (!match || !match[1]) {
          vscode.window.showErrorMessage(`Could not find commit hash for transaction ${transactionId}`);
          return;
        }

        const commitHash = match[1];
        log(`Found commit hash ${commitHash} for transaction ${transactionId}`, LogLevel.DEBUG);

        // Confirm with user
        const confirmed = await vscode.window.showWarningMessage(
          `Are you sure you want to revert transaction ${transactionId}?\nThis will undo changes from commit ${commitHash.substring(0, 8)}`,
          { modal: true },
          'Yes', 'No'
        );

        if (confirmed === 'Yes') {
          try {
            log(`Executing revert for transaction ${transactionId} (${commitHash})`, LogLevel.INFO, true);

            // Execute revert command via edactl
            const output = await edactlClient.executeEdactl(`git revert ${commitHash}`);

            vscode.window.showInformationMessage(`Transaction ${transactionId} reverted successfully.`);
            edaOutputChannel.appendLine(`Revert Transaction ${transactionId} (${commitHash}) output:\n${output}`);
            edaOutputChannel.show();
          } catch (err: any) {
            const errMsg = `Failed to revert transaction: ${err.message || err}`;
            vscode.window.showErrorMessage(errMsg);
            log(errMsg, LogLevel.ERROR, true);
          }
        }
      } catch (err: any) {
        const errMsg = `Failed to fetch transaction details: ${err.message || err}`;
        vscode.window.showErrorMessage(errMsg);
        log(errMsg, LogLevel.ERROR, true);
      }
    }
  );

  // Command to restore a transaction (reapplying changes)
  const restoreTransactionCmd = vscode.commands.registerCommand(
    'vscode-eda.restoreTransaction',
    async (treeItem) => {
      if (!treeItem?.resource?.raw?.id) {
        // Also try alternative access path
        if (!treeItem?.label) {
          vscode.window.showErrorMessage('No transaction ID available.');
          return;
        }

        // The label format is "ID - Username", so extract the ID
        const transactionId = treeItem.label.toString().split(' - ')[0];
        if (!transactionId) {
          vscode.window.showErrorMessage('Could not extract transaction ID from label.');
          return;
        }
      }
      const transactionId = treeItem?.resource?.raw?.id || treeItem.label.toString().split(' - ')[0];
      const edactlClient = serviceManager.getClient<EdactlClient>('edactl');

      // Fetch transaction details to get commit hash
      try {
        const details = await edactlClient.getTransactionDetails(transactionId);

        // Extract commit hash using regex
        const match = details.match(/commit-hash:\s*([a-f0-9]+)/i);
        if (!match || !match[1]) {
          vscode.window.showErrorMessage(`Could not find commit hash for transaction ${transactionId}`);
          return;
        }

        const commitHash = match[1];
        log(`Found commit hash ${commitHash} for transaction ${transactionId}`, LogLevel.INFO);

        // Confirm with user
        const confirmed = await vscode.window.showWarningMessage(
          `Are you sure you want to restore transaction ${transactionId}?\nThis will reapply changes from commit ${commitHash.substring(0, 8)}`,
          { modal: true },
          'Yes', 'No'
        );

        if (confirmed === 'Yes') {
          try {
            log(`Executing restore for transaction ${transactionId} (${commitHash})`, LogLevel.INFO, true);

            // Execute restore command via edactl
            const output = await edactlClient.executeEdactl(`git restore ${commitHash}`);

            vscode.window.showInformationMessage(`Transaction ${transactionId} restored successfully.`);
            edaOutputChannel.appendLine(`Restore Transaction ${transactionId} (${commitHash}) output:\n${output}`);
            edaOutputChannel.show();
          } catch (err: any) {
            const errMsg = `Failed to restore transaction: ${err.message || err}`;
            vscode.window.showErrorMessage(errMsg);
            log(errMsg, LogLevel.ERROR, true);
          }
        }
      } catch (err: any) {
        const errMsg = `Failed to fetch transaction details: ${err.message || err}`;
        vscode.window.showErrorMessage(errMsg);
        log(errMsg, LogLevel.ERROR, true);
      }
    }
  );

  // Add commands to subscriptions for cleanup
  context.subscriptions.push(revertTransactionCmd, restoreTransactionCmd);
}