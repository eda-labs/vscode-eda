import * as vscode from 'vscode';
import { log, LogLevel } from '../extension';
import { serviceManager } from '../services/serviceManager';
import { KubernetesClient } from '../clients/kubernetesClient';
import { EdaClient } from '../clients/edaClient';
import { ResourceViewDocumentProvider } from '../providers/documents/resourceViewProvider';
import * as yaml from 'js-yaml';
import { stripManagedFieldsFromYaml, sanitizeResource } from '../utils/yamlUtils';
import { isEdaResource } from '../utils/edaGroupUtils';
import { setViewIsEda } from '../utils/resourceOriginStore';

export function registerResourceViewCommands(
  context: vscode.ExtensionContext,
  provider: ResourceViewDocumentProvider
): void {
  const viewCmd = vscode.commands.registerCommand('vscode-eda.viewResource', async (arg: any) => {
    try {
      const raw = arg?.raw || arg?.rawResource || arg?.resource?.raw;
      const namespace = raw?.metadata?.namespace || arg.namespace || 'default';
      const kind = raw?.kind || arg.kind || arg.resourceType || 'Resource';
      const name = raw?.metadata?.name || arg.name || arg.label || 'unknown';
      const useEda = isEdaResource(arg, raw?.apiVersion);

      let yamlText = '';
      if (useEda) {
        const eda = serviceManager.getClient<EdaClient>('eda');
        yamlText = await eda.getEdaResourceYaml(
          kind,
          name,
          namespace,
          raw?.apiVersion
        );
      } else {
        const k8s = serviceManager.getClient<KubernetesClient>('kubernetes');
        yamlText = await k8s.getResourceYaml(kind, name, namespace);
      }

      yamlText = stripManagedFieldsFromYaml(yamlText);
      const uri = ResourceViewDocumentProvider.createUri(namespace, kind, name);
      provider.setResourceContent(uri, yamlText);
      setViewIsEda(uri, useEda);

      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.languages.setTextDocumentLanguage(doc, 'yaml');
      await vscode.window.showTextDocument(doc, { preview: true });
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
      const namespace = resource.metadata?.namespace || arg.namespace || 'default';
      const kind = resource.kind || arg.resourceType || arg.kind || 'Resource';
      const name = resource.metadata?.name || arg.name || arg.label || 'unknown';
      const yamlText = yaml.dump(sanitizeResource(resource), { indent: 2 });
      const uri = ResourceViewDocumentProvider.createUri(namespace, kind, name);
      provider.setResourceContent(uri, yamlText);
      setViewIsEda(uri, isEdaResource(arg, resource.apiVersion));
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.languages.setTextDocumentLanguage(doc, 'yaml');
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch (err: any) {
      log(`Failed to open stream item: ${err}`, LogLevel.ERROR, true);
      vscode.window.showErrorMessage(`Error viewing stream item: ${err}`);
    }
  });

  context.subscriptions.push(viewCmd, streamCmd);
}
