import * as vscode from 'vscode';
import { KubernetesService } from '../services/kubernetes/kubernetes';
import { edaOutputChannel } from '../extension.js';
import { log, LogLevel } from '../extension.js';

/**
 * Registers commands for managing EDA transactions (revert and restore)
 */
export function registerTransactionCommands(
  context: vscode.ExtensionContext,
  k8sService: KubernetesService
) {
  // Command to revert a transaction (undoing changes)
  const revertTransactionCmd = vscode.commands.registerCommand(
    'vscode-eda.revertTransaction',
    async (treeItem) => {
      if (!treeItem?.resource?.id) {
        vscode.window.showErrorMessage('No transaction ID available.');
        return;
      }

      const transactionId = treeItem.resource.id;

      // Fetch transaction details to get commit hash
      try {
        const details = await k8sService.getEdaTransactionDetails(transactionId);

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
          `Are you sure you want to revert transaction ${transactionId}?\nThis will undo changes from commit ${commitHash.substring(0, 8)}`,
          { modal: true },
          'Yes', 'No'
        );

        if (confirmed === 'Yes') {
          try {
            log(`Executing revert for transaction ${transactionId} (${commitHash})`, LogLevel.INFO, true);

            // Execute revert command via edactl
            const output = await k8sService.revertTransaction(commitHash);

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
      if (!treeItem?.resource?.id) {
        vscode.window.showErrorMessage('No transaction ID available.');
        return;
      }

      const transactionId = treeItem.resource.id;

      // Fetch transaction details to get commit hash
      try {
        const details = await k8sService.getEdaTransactionDetails(transactionId);

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
            const output = await k8sService.restoreTransaction(commitHash);

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