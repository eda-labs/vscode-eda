import * as vscode from 'vscode';
import { log, LogLevel, k8sService, resourceStore, edaAlarmProvider, edaDeviationProvider, edaTransactionProvider } from '../extension.js';


/**
 * Registers the refresh commands and sets up auto-refresh.
 * Both manual and automatic refresh routines use the same underlying logic:
 * - Get the list of EDA namespaces (using k8sService.getEdaNamespaces())
 * - Refresh each namespace's resources via resourceStore.loadNamespaceResources()
 * - Also refresh the system namespace ("eda-system")
 * - Refresh all providers (alarms, deviations, transactions)
 */
export function registerRefreshCommands(context: vscode.ExtensionContext) {
  // ---------- Manual Refresh Command ----------
  // Guard flag to prevent overlapping manual refreshes.
  let isManualRefreshInProgress = false;

  const refreshCommand = vscode.commands.registerCommand('vscode-eda.refreshResources', async () => {
    if (isManualRefreshInProgress) {
      log('Manual refresh already in progress, ignoring duplicate trigger.', LogLevel.DEBUG);
      return;
    }
    isManualRefreshInProgress = true;

    vscode.window.showInformationMessage('Manual refresh of resources triggered.');
    log('Manual refresh of resources triggered.', LogLevel.INFO, true);

    try {
      // Deduplicate namespaces in case there are duplicates.
      const namespaces = Array.from(new Set(await k8sService.getEdaNamespaces()));
      await Promise.all(namespaces.map(ns => resourceStore.loadNamespaceResources(ns)));
      
      // Clear any transaction cache to force fresh data
      k8sService.clearTransactionCache();
      
      // Refresh all providers
      edaAlarmProvider.refresh();
      edaDeviationProvider.refresh();
      edaTransactionProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Error during manual refresh: ${error}`);
      log(`Error during manual refresh: ${error}`, LogLevel.ERROR, true);
    } finally {
      isManualRefreshInProgress = false;
    }
  });

  context.subscriptions.push(refreshCommand);


  // ---------- Auto Refresh Setup ----------
  const config = vscode.workspace.getConfiguration('vscode-eda');
  const refreshInterval = config.get<number>('refreshInterval', 30000); // default to 30s if not set
  log(`Auto-refresh configured for every ${refreshInterval} ms`, LogLevel.INFO, true);

  const autoRefreshTimer = setInterval(async () => {
    log('Auto-refreshing resources...', LogLevel.DEBUG);
    try {
      const namespaces = await k8sService.getEdaNamespaces();
      await Promise.all(namespaces.map(ns => resourceStore.loadNamespaceResources(ns)));
      
      // Clear any transaction cache to force fresh data
      k8sService.clearTransactionCache();
      
      // Refresh all providers
      edaAlarmProvider.refresh();
      edaDeviationProvider.refresh();
      edaTransactionProvider.refresh();
    } catch (error) {
      log(`Error during auto-refresh: ${error}`, LogLevel.ERROR, true);
    }
  }, refreshInterval);

  // Dispose the timer when the extension is deactivated.
  context.subscriptions.push({
    dispose: () => clearInterval(autoRefreshTimer)
  });
}