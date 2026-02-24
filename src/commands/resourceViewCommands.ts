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

/**
 * Represents a raw Kubernetes resource object with standard metadata
 */
interface KubernetesResource {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    uid?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Command argument passed from tree items or webview messages
 */
interface CommandArgument {
  name?: string;
  namespace?: string;
  kind?: string;
  apiVersion?: string;
  resourceType?: string;
  label?: string;
  streamGroup?: string;
  raw?: KubernetesResource;
  rawResource?: KubernetesResource;
  resource?: {
    raw?: KubernetesResource;
    apiVersion?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface ResourceInfo {
  namespace: string;
  kind: string;
  name: string;
  useEda: boolean;
  apiVersion?: string;
}

/** Extracts namespace from raw resource or arg with fallback to 'default'. */
function getNamespace(arg: CommandArgument | undefined, raw: KubernetesResource | undefined): string {
  return raw?.metadata?.namespace ?? arg?.namespace ?? 'default';
}

/** Extracts kind from raw resource or arg with fallback to 'Resource'. */
function getKind(arg: CommandArgument | undefined, raw: KubernetesResource | undefined): string {
  return raw?.kind ?? arg?.kind ?? arg?.resourceType ?? 'Resource';
}

/** Extracts name from raw resource or arg with fallback to 'unknown'. */
function getName(arg: CommandArgument | undefined, raw: KubernetesResource | undefined): string {
  return raw?.metadata?.name ?? arg?.name ?? arg?.label ?? 'unknown';
}

/** Extracts apiVersion from raw resource, explicit command arg, or lightweight resource payload. */
function getApiVersion(arg: CommandArgument | undefined, raw: KubernetesResource | undefined): string | undefined {
  if (raw?.apiVersion) {
    return raw.apiVersion;
  }
  if (typeof arg?.apiVersion === 'string' && arg.apiVersion.length > 0) {
    return arg.apiVersion;
  }
  const resourceApiVersion = arg?.resource?.apiVersion;
  if (typeof resourceApiVersion === 'string' && resourceApiVersion.length > 0) {
    return resourceApiVersion;
  }
  return undefined;
}

/**
 * Extracts resource information from a tree item argument.
 */
function extractResourceInfo(arg: CommandArgument | undefined, raw: KubernetesResource | undefined): ResourceInfo {
  return {
    namespace: getNamespace(arg, raw),
    kind: getKind(arg, raw),
    name: getName(arg, raw),
    useEda: isEdaResource(arg, raw?.apiVersion),
    apiVersion: getApiVersion(arg, raw)
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
  const viewCmd = vscode.commands.registerCommand('vscode-eda.viewResource', async (arg: unknown) => {
    try {
      const cmdArg = arg as CommandArgument | undefined;
      const raw: KubernetesResource | undefined = cmdArg?.raw ?? cmdArg?.rawResource ?? cmdArg?.resource?.raw;
      const info = extractResourceInfo(cmdArg, raw);
      let yamlText = await fetchResourceYaml(info);
      yamlText = stripManagedFieldsFromYaml(yamlText);
      await openResourceDocument(provider, info, yamlText, 'viewResource');
    } catch (err: unknown) {
      log(`Failed to open resource in YAML view: ${String(err)}`, LogLevel.ERROR, true);
      vscode.window.showErrorMessage(`Error viewing resource: ${String(err)}`);
    }
  });

  const streamCmd = vscode.commands.registerCommand('vscode-eda.viewStreamItem', async (arg: unknown) => {
    try {
      const cmdArg = arg as CommandArgument | undefined;
      const resource: KubernetesResource | undefined = cmdArg?.raw ?? cmdArg?.rawResource ?? cmdArg?.resource?.raw;
      const info = extractResourceInfo(cmdArg, resource);
      let yamlText: string;
      if (resource) {
        yamlText = yaml.dump(sanitizeResource(resource), { indent: 2 });
      } else {
        yamlText = await fetchResourceYaml(info);
        yamlText = stripManagedFieldsFromYaml(yamlText);
      }
      await openResourceDocument(provider, info, yamlText, 'viewStreamItem');
    } catch (err: unknown) {
      log(`Failed to open stream item: ${String(err)}`, LogLevel.ERROR, true);
      vscode.window.showErrorMessage(`Error viewing stream item: ${String(err)}`);
    }
  });

  context.subscriptions.push(viewCmd, streamCmd);
}
