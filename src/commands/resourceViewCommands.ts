import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

import { log, LogLevel } from '../extension';
import { serviceManager } from '../services/serviceManager';
import type { KubernetesClient } from '../clients/kubernetesClient';
import type { EdaClient } from '../clients/edaClient';
import { ResourceViewDocumentProvider } from '../providers/documents/resourceViewProvider';
import { stripManagedFieldsFromYaml, sanitizeResource } from '../utils/yamlUtils';
import { isEdaResource } from '../utils/edaGroupUtils';
import { setViewIsEda, setResourceOrigin } from '../utils/resourceOriginStore';

interface ResourceInfo {
  namespace: string;
  kind: string;
  name: string;
  useEda: boolean;
  apiVersion?: string;
}

/** Extracts namespace from raw resource or arg with fallback to 'default'. */
function getNamespace(arg: any, raw: any): string {
  return raw?.metadata?.namespace ?? arg?.namespace ?? 'default';
}

/** Extracts kind from raw resource or arg with fallback to 'Resource'. */
function getKind(arg: any, raw: any): string {
  return raw?.kind ?? arg?.kind ?? arg?.resourceType ?? 'Resource';
}

/** Extracts name from raw resource or arg with fallback to 'unknown'. */
function getName(arg: any, raw: any): string {
  return raw?.metadata?.name ?? arg?.name ?? arg?.label ?? 'unknown';
}

/**
 * Extracts resource information from a tree item argument.
 */
function extractResourceInfo(arg: any, raw: any): ResourceInfo {
  return {
    namespace: getNamespace(arg, raw),
    kind: getKind(arg, raw),
    name: getName(arg, raw),
    useEda: isEdaResource(arg, raw?.apiVersion),
    apiVersion: raw?.apiVersion
  };
}

/**
 * Fetches YAML content for a resource from either EDA or Kubernetes API.
 */
async function fetchResourceYaml(info: ResourceInfo): Promise<string> {
  if (info.useEda) {
    const eda = serviceManager.getClient<EdaClient>('eda');
    return eda.getEdaResourceYaml(info.kind, info.name, info.namespace, info.apiVersion);
  }
  const k8s = serviceManager.getClient<KubernetesClient>('kubernetes');
  return k8s.getResourceYaml(info.kind, info.name, info.namespace);
}

/**
 * Opens a resource document in VS Code with YAML highlighting.
 */
async function openResourceDocument(
  provider: ResourceViewDocumentProvider,
  info: ResourceInfo,
  yamlText: string,
  logPrefix: string
): Promise<void> {
  const uri = ResourceViewDocumentProvider.createUri(
    info.namespace,
    info.kind,
    info.name,
    info.useEda ? 'eda' : 'k8s'
  );
  provider.setResourceContent(uri, yamlText);
  setViewIsEda(uri, info.useEda);
  setResourceOrigin(info.namespace, info.kind, info.name, info.useEda);
  log(
    `${logPrefix}: origin=${info.useEda ? 'eda' : 'k8s'} for ${info.namespace}/${info.kind}/${info.name}`,
    LogLevel.DEBUG
  );

  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.languages.setTextDocumentLanguage(doc, 'yaml');
  await vscode.window.showTextDocument(doc, { preview: true });
}

export function registerResourceViewCommands(
  context: vscode.ExtensionContext,
  provider: ResourceViewDocumentProvider
): void {
  const viewCmd = vscode.commands.registerCommand('vscode-eda.viewResource', async (arg: any) => {
    try {
      const raw = arg?.raw || arg?.rawResource || arg?.resource?.raw;
      const info = extractResourceInfo(arg, raw);
      let yamlText = await fetchResourceYaml(info);
      yamlText = stripManagedFieldsFromYaml(yamlText);
      await openResourceDocument(provider, info, yamlText, 'viewResource');
    } catch (err: any) {
      log(`Failed to open resource in YAML view: ${err}`, LogLevel.ERROR, true);
      vscode.window.showErrorMessage(`Error viewing resource: ${err}`);
    }
  });

  const streamCmd = vscode.commands.registerCommand('vscode-eda.viewStreamItem', async (arg: any) => {
    try {
      const resource = arg?.raw || arg?.rawResource || arg?.resource?.raw;
      if (!resource) {
        vscode.window.showErrorMessage('No data available for this item');
        return;
      }
      const info = extractResourceInfo(arg, resource);
      const yamlText = yaml.dump(sanitizeResource(resource), { indent: 2 });
      await openResourceDocument(provider, info, yamlText, 'viewStreamItem');
    } catch (err: any) {
      log(`Failed to open stream item: ${err}`, LogLevel.ERROR, true);
      vscode.window.showErrorMessage(`Error viewing stream item: ${err}`);
    }
  });

  context.subscriptions.push(viewCmd, streamCmd);
}
