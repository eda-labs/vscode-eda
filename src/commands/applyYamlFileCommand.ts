import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

import { serviceManager } from '../services/serviceManager';
import type { EdaClient } from '../clients/edaClient';
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

async function getDocument(uri: vscode.Uri | undefined): Promise<vscode.TextDocument | undefined> {
  if (uri) {
    try {
      return await vscode.workspace.openTextDocument(uri);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to open ${uri.fsPath}: ${err}`);
      return undefined;
    }
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor');
    return undefined;
  }
  return editor.document;
}

function parseEdaResource(text: string): any | undefined {
  const resource: any = yaml.load(text);
  if (!resource || typeof resource !== 'object') {
    vscode.window.showErrorMessage('Invalid YAML content');
    return undefined;
  }
  if (!resource.apiVersion || !/eda\.nokia\.com/.test(resource.apiVersion)) {
    vscode.window.showErrorMessage('YAML is not an EDA resource');
    return undefined;
  }
  return resource;
}

function getActionName(addToBasket: boolean, dryRun: boolean): string {
  if (addToBasket) {
    return 'add YAML to basket';
  }
  if (dryRun) {
    return 'validate YAML';
  }
  return 'apply YAML';
}

async function addToBasketTransaction(resource: any): Promise<void> {
  const tx = {
    crs: [{ type: { replace: { value: resource } } }],
    description: `vscode basket ${resource.kind}/${resource.metadata?.name}`,
    retain: true,
    dryRun: false
  };
  await edaTransactionBasketProvider.addTransaction(tx);
  vscode.window.showInformationMessage(
    `Added ${resource.kind} "${resource.metadata?.name}" to transaction basket`
  );
}

async function applyTransaction(resource: any, dryRun: boolean): Promise<void> {
  const edaClient = serviceManager.getClient<EdaClient>('eda');
  const tx = {
    crs: [{ type: { replace: { value: resource } } }],
    description: `vscode apply ${resource.kind}/${resource.metadata?.name}${dryRun ? ' (dry run)' : ''}`,
    dryRun,
    retain: true,
    resultType: 'normal'
  };

  const id = await edaClient.runTransaction(tx);
  vscode.window.showInformationMessage(
    `Transaction ${id} created for ${resource.kind} "${resource.metadata?.name}"`
  );
  log(`Transaction ${id} created for ${resource.kind}/${resource.metadata?.name}`, LogLevel.INFO, true);
}

async function handleYaml(uri: vscode.Uri | undefined, dryRun = false, addToBasket = false): Promise<void> {
  const document = await getDocument(uri);
  if (!document) {
    return;
  }

  if (document.languageId !== 'yaml') {
    vscode.window.showErrorMessage('Not a YAML document');
    return;
  }

  try {
    const resource = parseEdaResource(document.getText());
    if (!resource) {
      return;
    }

    if (addToBasket) {
      await addToBasketTransaction(resource);
    } else {
      await applyTransaction(resource, dryRun);
    }
  } catch (err: any) {
    const action = getActionName(addToBasket, dryRun);
    const msg = `Failed to ${action}: ${err.message || err}`;
    vscode.window.showErrorMessage(msg);
    log(msg, LogLevel.ERROR, true);
    edaOutputChannel.show();
  }
}
