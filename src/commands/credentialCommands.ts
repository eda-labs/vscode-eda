import * as vscode from 'vscode';

export function registerCredentialCommands(context: vscode.ExtensionContext) {
  const updateCredsCmd = vscode.commands.registerCommand(
    'vscode-eda.updateCredentials',
    async () => {
      const config = vscode.workspace.getConfiguration('vscode-eda');
      let edaUrl = 'https://eda-api';
      const edaTargetsCfg = config.get<Record<string, unknown>>('edaTargets');
      const targetEntries = edaTargetsCfg ? Object.entries(edaTargetsCfg) : [];
      if (targetEntries.length > 0) {
        const idx =
          context.globalState.get<number>('selectedEdaTarget', 0) ?? 0;
        const [url] =
          targetEntries[Math.min(idx, targetEntries.length - 1)];
        edaUrl = url;
      }
      const hostKey = (() => {
        try {
          return new URL(edaUrl).host;
        } catch {
          return edaUrl;
        }
      })();
      const clientSecret = await vscode.window.showInputBox({
        prompt: `Enter new client secret for ${edaUrl}`,
        password: true,
        ignoreFocusOut: true,
      });

    if (clientSecret) {
      await context.secrets.store(`clientSecret:${hostKey}`, clientSecret);
    }

    vscode.window.showInformationMessage('Credentials updated. Reload window to apply.', 'Reload').then(value => {
      if (value === 'Reload') {
        Promise.resolve(vscode.commands.executeCommand('workbench.action.reloadWindow')).catch((error: unknown) => {
          console.error('Failed to reload window:', error);
        });
      }
    });
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
    const host = (() => {
      try {
        return new URL(choice.label).host;
      } catch {
        return choice.label;
      }
    })();

    const clientSecret = await vscode.window.showInputBox({
      prompt: `Enter new client secret for ${choice.label}`,
      password: true,
      ignoreFocusOut: true,
    });

    if (clientSecret) {
      await context.secrets.store(`clientSecret:${host}`, clientSecret);
    }

    vscode.window.showInformationMessage('Credentials updated. Reload window to apply.', 'Reload').then(value => {
      if (value === 'Reload') {
        Promise.resolve(vscode.commands.executeCommand('workbench.action.reloadWindow')).catch((error: unknown) => {
          console.error('Failed to reload window:', error);
        });
      }
    });
  });

  context.subscriptions.push(updateCredsCmd, updateTargetCredsCmd);
}

