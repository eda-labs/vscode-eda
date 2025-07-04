import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { serviceManager } from '../services/serviceManager';
import { EdaClient } from '../clients/edaClient';
import { log, LogLevel, edaOutputChannel, edaTransactionBasketProvider } from '../extension';

export function registerApplyYamlFileCommand(context: vscode.ExtensionContext): void {
  const applyCmd = vscode.commands.registerCommand('vscode-eda.applyYamlFile', async (uri?: vscode.Uri) => {
    await handleYaml(uri, false, false);
  });

  const dryRunCmd = vscode.commands.registerCommand('vscode-eda.applyYamlFile.dryRun', async (uri?: vscode.Uri) => {
    await handleYaml(uri, true, false);
  });

  const basketCmd = vscode.commands.registerCommand('vscode-eda.addYamlToBasket', async (uri?: vscode.Uri) => {
    await handleYaml(uri, false, true);
  });

  context.subscriptions.push(applyCmd, dryRunCmd, basketCmd);
}

async function handleYaml(uri: vscode.Uri | undefined, dryRun = false, addToBasket = false): Promise<void> {
  let document: vscode.TextDocument;
  if (uri) {
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to open ${uri.fsPath}: ${err}`);
      return;
    }
  } else {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active editor');
      return;
    }
    document = editor.document;
  }

  if (document.languageId !== 'yaml') {
    vscode.window.showErrorMessage('Not a YAML document');
    return;
  }

  const text = document.getText();

  try {
    const resource: any = yaml.load(text);
    if (!resource || typeof resource !== 'object') {
      vscode.window.showErrorMessage('Invalid YAML content');
      return;
    }
    if (!resource.apiVersion || !/eda\.nokia\.com/.test(resource.apiVersion)) {
      vscode.window.showErrorMessage('YAML is not an EDA resource');
      return;
    }

    if (addToBasket) {
      const tx = {
        crs: [
          { type: { replace: { value: resource } } }
        ],
        description: `vscode basket ${resource.kind}/${resource.metadata?.name}`,
        retain: true,
        dryRun: false
      };
      await edaTransactionBasketProvider.addTransaction(tx);
      vscode.window.showInformationMessage(`Added ${resource.kind} "${resource.metadata?.name}" to transaction basket`);
      return;
    }

    const edaClient = serviceManager.getClient<EdaClient>('eda');
    const tx = {
      crs: [
        { type: { replace: { value: resource } } }
      ],
      description: `vscode apply ${resource.kind}/${resource.metadata?.name}${dryRun ? ' (dry run)' : ''}`,
      dryRun
    };

    const id = await edaClient.runTransaction(tx);
    vscode.window.showInformationMessage(
      `Transaction ${id} created for ${resource.kind} "${resource.metadata?.name}"`
    );
    log(`Transaction ${id} created for ${resource.kind}/${resource.metadata?.name}`, LogLevel.INFO, true);
  } catch (err: any) {
    const msg = `Failed to ${addToBasket ? 'add YAML to basket' : dryRun ? 'validate YAML' : 'apply YAML'}: ${err.message || err}`;
    vscode.window.showErrorMessage(msg);
    log(msg, LogLevel.ERROR, true);
    edaOutputChannel.show();
  }
}
