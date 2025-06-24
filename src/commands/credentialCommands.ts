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

  context.subscriptions.push(updateCredsCmd);
}

