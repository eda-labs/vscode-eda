import * as vscode from 'vscode';

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
  const idx = context.globalState.get<number>('selectedEdaTarget', 0) ?? 0;
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
      const edaTargetsCfg = config.get<Record<string, unknown>>('edaTargets');
      const targetEntries = edaTargetsCfg ? Object.entries(edaTargetsCfg) : [];
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
    const targetsMap = config.get<Record<string, unknown>>('edaTargets') ?? {};
    const entries = Object.entries(targetsMap);
    if (entries.length === 0) {
      vscode.window.showInformationMessage('No EDA targets configured.');
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
