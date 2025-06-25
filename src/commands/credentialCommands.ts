import * as vscode from 'vscode';

export function registerCredentialCommands(context: vscode.ExtensionContext) {
  const updateCredsCmd = vscode.commands.registerCommand('vscode-eda.updateCredentials', async () => {
    const edaPassword = await vscode.window.showInputBox({
      prompt: 'Enter new EDA password',
      password: true,
      ignoreFocusOut: true
    });
    const kcPassword = await vscode.window.showInputBox({
      prompt: 'Enter new Keycloak admin password',
      password: true,
      ignoreFocusOut: true
    });

    if (edaPassword) {
      await context.secrets.store('edaPassword', edaPassword);
    }
    if (kcPassword) {
      await context.secrets.store('kcPassword', kcPassword);
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

    const edaPassword = await vscode.window.showInputBox({
      prompt: 'Enter new EDA password',
      password: true,
      ignoreFocusOut: true
    });
    const kcPassword = await vscode.window.showInputBox({
      prompt: 'Enter new Keycloak admin password',
      password: true,
      ignoreFocusOut: true
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

