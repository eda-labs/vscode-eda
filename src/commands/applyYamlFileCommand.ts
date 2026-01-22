import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

import { serviceManager } from '../services/serviceManager';
import type { EdaClient, TransactionRequest } from '../clients/edaClient';
import { log, LogLevel, edaOutputChannel, edaTransactionBasketProvider } from '../extension';
import type { Transaction } from '../providers/views/transactionBasketProvider';

/** Kubernetes resource metadata */
interface K8sMetadata {
  name?: string;
  namespace?: string;
  [key: string]: unknown;
}

/** EDA Resource structure (Kubernetes custom resource) */
interface EdaResource {
  apiVersion: string;
  kind: string;
  metadata?: K8sMetadata;
  spec?: unknown;
  status?: unknown;
  [key: string]: unknown;
}

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

function parseEdaResource(text: string): EdaResource | undefined {
  const parsed: unknown = yaml.load(text);
  if (!parsed || typeof parsed !== 'object') {
    vscode.window.showErrorMessage('Invalid YAML content');
    return undefined;
  }
  const resource = parsed as Record<string, unknown>;
  if (typeof resource.apiVersion !== 'string' || !/eda\.nokia\.com/.test(resource.apiVersion)) {
    vscode.window.showErrorMessage('YAML is not an EDA resource');
    return undefined;
  }
  if (typeof resource.kind !== 'string') {
    vscode.window.showErrorMessage('YAML is missing kind field');
    return undefined;
  }
  return resource as EdaResource;
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

async function addToBasketTransaction(resource: EdaResource): Promise<void> {
  const tx: Transaction = {
    crs: [{ type: { replace: { value: resource } } }],
    description: `vscode basket ${resource.kind}/${resource.metadata?.name ?? 'unknown'}`,
    retain: true,
    dryRun: false
  };
  await edaTransactionBasketProvider.addTransaction(tx);
  vscode.window.showInformationMessage(
    `Added ${resource.kind} "${resource.metadata?.name ?? 'unknown'}" to transaction basket`
  );
}

async function applyTransaction(resource: EdaResource, dryRun: boolean): Promise<void> {
  const edaClient = serviceManager.getClient<EdaClient>('eda');
  const tx: TransactionRequest = {
    crs: [{ type: { replace: { value: resource } } }],
    description: `vscode apply ${resource.kind}/${resource.metadata?.name ?? 'unknown'}${dryRun ? ' (dry run)' : ''}`,
    dryRun,
    retain: true,
    resultType: 'normal'
  };

  const id = await edaClient.runTransaction(tx);
  vscode.window.showInformationMessage(
    `Transaction ${id} created for ${resource.kind} "${resource.metadata?.name ?? 'unknown'}"`
  );
  log(`Transaction ${id} created for ${resource.kind}/${resource.metadata?.name ?? 'unknown'}`, LogLevel.INFO, true);
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
  } catch (err: unknown) {
    const action = getActionName(addToBasket, dryRun);
    const errorMessage = err instanceof Error ? err.message : String(err);
    const msg = `Failed to ${action}: ${errorMessage}`;
    vscode.window.showErrorMessage(msg);
    log(msg, LogLevel.ERROR, true);
    edaOutputChannel.show();
  }
}
