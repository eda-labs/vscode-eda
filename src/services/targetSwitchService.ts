// src/services/targetSwitchService.ts
import * as vscode from 'vscode';

import type { EdaClient } from '../clients/edaClient';
import type { KubernetesClient } from '../clients/kubernetesClient';
import type { EdaTargetValue } from '../extension';
import {
  LogLevel,
  getHostFromUrl,
  loadCredentials,
  loadTargetConfig,
  log,
  updateContextStatusBar,
  verifyKubernetesContext
} from '../extension';
import { resetResourceOrigins } from '../utils/resourceOriginStore';
import { BasePanel } from '../webviews/basePanel';

import { namespaceSelectionService } from './namespaceSelectionService';
import type { SchemaProviderService } from './schemaProviderService';
import { serviceManager } from './serviceManager';

export interface SwitchToTargetOptions {
  /** A panel to keep open (e.g. the target wizard that initiated the switch). */
  excludePanel?: BasePanel;
}

function promptReload(message: string): void {
  void vscode.window.showInformationMessage(message, 'Reload').then(value => {
    if (value === 'Reload') {
      void vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  });
}

/**
 * Switch the active EDA target at runtime without reloading the window.
 *
 * Closes open dashboard panels, swaps the EdaClient's endpoint in place
 * (provider stream subscriptions survive and are re-subscribed against the
 * new endpoint), switches or deactivates the Kubernetes context, and resets
 * endpoint-specific caches. On failure the previous target keeps working and
 * the selection is not changed.
 *
 * @returns true if the switch completed successfully.
 */
export async function switchToTarget(
  context: vscode.ExtensionContext,
  index: number,
  options: SwitchToTargetOptions = {}
): Promise<boolean> {
  const config = vscode.workspace.getConfiguration('vscode-eda');
  const targetsCfg = config.get<Record<string, EdaTargetValue>>('edaTargets') || {};
  const entries = Object.entries(targetsCfg);
  if (entries.length === 0) {
    vscode.window.showInformationMessage('No EDA targets configured.');
    return false;
  }

  const targetConfig = loadTargetConfig(config, entries, index);
  const { edaUrl, edaContext, edaUsername, skipTlsVerify, coreNamespace, clientId } = targetConfig;
  const hostKey = getHostFromUrl(edaUrl);

  const { edaPassword, clientSecret } = await loadCredentials(
    context,
    hostKey,
    edaUrl,
    targetConfig.edaPasswordFromSettings,
    targetConfig.kcUsername,
    targetConfig.kcPassword
  );

  if (!clientSecret || !edaPassword) {
    vscode.window.showErrorMessage(
      `Missing credentials for ${edaUrl}. Please configure the target first.`
    );
    await vscode.commands.executeCommand('vscode-eda.configureTargets');
    return false;
  }

  let edaClient: EdaClient;
  try {
    edaClient = serviceManager.getClient<EdaClient>('eda');
  } catch {
    // The service architecture was never initialized (first-run path where
    // activation bailed out before creating clients); only a reload can set
    // it up.
    await context.globalState.update('selectedEdaTarget', index);
    promptReload('EDA target updated. Reload window to apply.');
    return false;
  }

  BasePanel.closeAll(options.excludePanel);

  try {
    await edaClient.switchEndpoint(edaUrl, {
      clientId,
      clientSecret,
      edaUsername,
      edaPassword,
      skipTlsVerify,
      coreNamespace
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Failed to switch EDA endpoint to ${edaUrl}: ${message}`, LogLevel.ERROR, true);
    vscode.window.showErrorMessage(
      `Could not switch to ${edaUrl}: ${message}. The previous target stays active.`
    );
    return false;
  }

  await context.globalState.update('selectedEdaTarget', index);

  const k8sClient = applyKubernetesContext(edaContext);

  updateContextStatusBar(edaUrl, edaContext);
  resetResourceOrigins();
  namespaceSelectionService.setSelectedNamespace(undefined);
  reloadSchemasInBackground();

  if (k8sClient?.hasActiveContext()) {
    void verifyKubernetesContext(edaClient, k8sClient);
  }

  const ctxText = edaContext ? ` (context: ${edaContext})` : '';
  vscode.window.showInformationMessage(
    `Switched EDA target to ${edaUrl}${ctxText}. Already open resource documents still refer to the previous target.`
  );
  return true;
}

/**
 * Switch the KubernetesClient to the new target's context, or put it into
 * idle mode when the target has none (or the context is missing from the
 * kubeconfig).
 */
function applyKubernetesContext(edaContext: string | undefined): KubernetesClient | undefined {
  let k8sClient: KubernetesClient | undefined;
  try {
    k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');
  } catch {
    return undefined;
  }
  if (edaContext && k8sClient.getAvailableContexts().includes(edaContext)) {
    k8sClient.switchContext(edaContext);
    return k8sClient;
  }
  if (edaContext) {
    vscode.window.showWarningMessage(
      `Kubernetes context '${edaContext}' not found in kubeconfig; Kubernetes features are disabled for this target.`
    );
  }
  k8sClient.deactivate();
  return k8sClient;
}

function reloadSchemasInBackground(): void {
  try {
    const schemaService = serviceManager.getService<SchemaProviderService>('schema-provider');
    void schemaService.reload().catch((err: unknown) => {
      log(`Failed to reload schemas after endpoint switch: ${err}`, LogLevel.WARN);
    });
  } catch {
    // schema provider not registered; nothing to reload
  }
}
