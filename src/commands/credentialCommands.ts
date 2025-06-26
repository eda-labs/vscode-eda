import * as vscode from 'vscode';

export function registerCredentialCommands(context: vscode.ExtensionContext) {
  const updateCredsCmd = vscode.commands.registerCommand(
    'vscode-eda.updateCredentials',
    async () => {
      const config = vscode.workspace.getConfiguration('vscode-eda');
      let edaUrl = 'https://eda-api';
      let edaUsername = config.get<string>('edaUsername', 'admin');
      let kcUsername = config.get<string>('kcUsername', 'admin');
      const edaTargetsCfg = config.get<Record<string, any>>('edaTargets');
      const targetEntries = edaTargetsCfg ? Object.entries(edaTargetsCfg) : [];
      if (targetEntries.length > 0) {
        const idx =
          context.globalState.get<number>('selectedEdaTarget', 0) ?? 0;
        const [url, val] =
          targetEntries[Math.min(idx, targetEntries.length - 1)];
        edaUrl = url;
        if (typeof val === 'object' && val) {
          if (val.edaUsername) {
            edaUsername = val.edaUsername;
          }
          if (val.kcUsername) {
            kcUsername = val.kcUsername;
          }
        }
      }
      const hostKey = (() => {
        try {
          return new URL(edaUrl).host;
        } catch {
          return edaUrl;
        }
      })();
      const edaPassword = await vscode.window.showInputBox({
        prompt: `Enter new EDA password for ${edaUsername} at ${edaUrl}`,
        password: true,
        ignoreFocusOut: true,
      });
      const kcPassword = await vscode.window.showInputBox({
        prompt: `Enter new Keycloak admin password for ${kcUsername} at ${edaUrl}`,
        password: true,
        ignoreFocusOut: true,
      });

    if (edaPassword) {
      await context.secrets.store(`edaPassword:${hostKey}`, edaPassword);
    }
    if (kcPassword) {
      await context.secrets.store(`kcPassword:${hostKey}`, kcPassword);
    }

    vscode.window.showInformationMessage('Credentials updated. Reload window to apply.', 'Reload').then(value => {
      if (value === 'Reload') {
        void vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    });
  });

  const updateTargetCredsCmd = vscode.commands.registerCommand('vscode-eda.updateTargetCredentials', async () => {
    const config = vscode.workspace.getConfiguration('vscode-eda');
    const targetsMap = config.get<Record<string, any>>('edaTargets') || {};
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

    const targetCfg = targetsMap[choice.label];
    let edaUsername = config.get<string>('edaUsername', 'admin');
    let kcUsername = config.get<string>('kcUsername', 'admin');
    if (typeof targetCfg === 'object' && targetCfg) {
      if (targetCfg.edaUsername) {
        edaUsername = targetCfg.edaUsername;
      }
      if (targetCfg.kcUsername) {
        kcUsername = targetCfg.kcUsername;
      }
    }

    const edaPassword = await vscode.window.showInputBox({
      prompt: `Enter new EDA password for ${edaUsername} at ${choice.label}`,
      password: true,
      ignoreFocusOut: true,
    });
    const kcPassword = await vscode.window.showInputBox({
      prompt: `Enter new Keycloak admin password for ${kcUsername} at ${choice.label}`,
      password: true,
      ignoreFocusOut: true,
    });

    if (edaPassword) {
      await context.secrets.store(`edaPassword:${host}`, edaPassword);
    }
    if (kcPassword) {
      await context.secrets.store(`kcPassword:${host}`, kcPassword);
    }

    vscode.window.showInformationMessage('Credentials updated. Reload window to apply.', 'Reload').then(value => {
      if (value === 'Reload') {
        void vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    });
  });

  context.subscriptions.push(updateCredsCmd, updateTargetCredsCmd);
}

