import * as vscode from 'vscode';

import { loadCurrentScopeTargets } from '../extension';
import {
  getCurrentScope,
  getSelectedTargetIndex as getScopedSelectedTargetIndex
} from '../utils/hostScope';

function getHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function getSelectedTargetIndex(
  context: vscode.ExtensionContext,
  entryCount: number
): number {
  if (entryCount === 0) {
    return 0;
  }
  const idx = getScopedSelectedTargetIndex(context, getCurrentScope());
  return Math.min(idx, entryCount - 1);
}

/**
 * Apply updated credentials at runtime when they belong to the active target:
 * switching to the same target re-authenticates and reconnects all streams.
 * Credentials for other targets simply take effect on the next switch.
 */
async function applyUpdatedCredentials(
  context: vscode.ExtensionContext,
  updatedHost: string,
  entries: [string, unknown][]
): Promise<void> {
  const selectedIndex = getSelectedTargetIndex(context, entries.length);
  const [activeUrl] = entries[selectedIndex];
  if (getHost(activeUrl) !== updatedHost) {
    vscode.window.showInformationMessage(
      'Credentials updated. They will be used the next time you switch to this target.'
    );
    return;
  }
  const { switchToTarget } = await import('../services/targetSwitchService');
  await switchToTarget(context, selectedIndex);
}

export function registerCredentialCommands(context: vscode.ExtensionContext) {
  const updateCredsCmd = vscode.commands.registerCommand(
    'vscode-eda.updateCredentials',
    async () => {
      const config = vscode.workspace.getConfiguration('vscode-eda');
      let edaUrl = 'https://eda-api';
      const targetEntries = await loadCurrentScopeTargets(config);
      if (targetEntries.length > 0) {
        const idx = getSelectedTargetIndex(context, targetEntries.length);
        const [url] = targetEntries[idx];
        edaUrl = url;
      }
      const hostKey = getHost(edaUrl);
      const clientSecret = await vscode.window.showInputBox({
        prompt: `Enter new client secret for ${edaUrl}`,
        password: true,
        ignoreFocusOut: true,
      });

      if (!clientSecret) {
        return;
      }
      await context.secrets.store(`clientSecret:${hostKey}`, clientSecret);
      if (targetEntries.length > 0) {
        await applyUpdatedCredentials(context, hostKey, targetEntries);
      }
    });

  const updateTargetCredsCmd = vscode.commands.registerCommand('vscode-eda.updateTargetCredentials', async () => {
    const config = vscode.workspace.getConfiguration('vscode-eda');
    const entries = await loadCurrentScopeTargets(config);
    if (entries.length === 0) {
      vscode.window.showInformationMessage('No EDA targets configured for the current host scope.');
      return;
    }
    const items = entries.map(([url]) => ({ label: url }));
    const choice = await vscode.window.showQuickPick(items, { placeHolder: 'Select target to update credentials' });
    if (!choice) {
      return;
    }
    const host = getHost(choice.label);

    const clientSecret = await vscode.window.showInputBox({
      prompt: `Enter new client secret for ${choice.label}`,
      password: true,
      ignoreFocusOut: true,
    });

    if (!clientSecret) {
      return;
    }
    await context.secrets.store(`clientSecret:${host}`, clientSecret);
    await applyUpdatedCredentials(context, host, entries);
  });

  context.subscriptions.push(updateCredsCmd, updateTargetCredsCmd);
}
