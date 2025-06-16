// src/commands/resourceCreateCommand.ts
import * as vscode from 'vscode';
import { serviceManager } from '../services/serviceManager';
import { EdaClient } from '../clients/edaClient';
import { ResourceEditDocumentProvider } from '../providers/documents/resourceEditProvider';
import { SchemaProviderService } from '../services/schemaProviderService';
import * as yaml from 'js-yaml';
import { log, LogLevel } from '../extension';

export function registerResourceCreateCommand(
  context: vscode.ExtensionContext,
  resourceEditProvider: ResourceEditDocumentProvider,
): void {
  const cmd = vscode.commands.registerCommand('vscode-eda.createResource', async () => {
    try {
      const edaClient = serviceManager.getClient<EdaClient>('edactl');

      const crds = await edaClient.getCustomResourceDefinitions();
      if (!crds || crds.length === 0) {
        vscode.window.showErrorMessage('No Custom Resources available.');
        return;
      }

      const items = crds.map(crd => ({
        label: crd.kind,
        description: crd.description,
        detail: `${crd.group}/${crd.version}`,
        crd
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select resource kind',
        matchOnDescription: true,
      });
      if (!selected) {
        return;
      }

      let namespace: string | undefined;
      if (selected.crd.namespaced) {
        const namespaces = edaClient.getCachedNamespaces();
        if (namespaces.length === 0) {
          vscode.window.showErrorMessage('No EDA namespaces available.');
          return;
        }
        namespace = await vscode.window.showQuickPick(namespaces, { placeHolder: 'Select namespace' });
        if (!namespace) {
          return;
        }
      }

      const name = await vscode.window.showInputBox({ placeHolder: 'Enter resource name' });
      if (!name) {
        return;
      }

      const { group, version, namespaced } = selected.crd;

      const resource: any = {
        apiVersion: `${group}/${version}`,
        kind: selected.crd.kind,
        metadata: { name },
        spec: {},
      };

      if (namespaced) {
        resource.metadata.namespace = namespace;
      }

      const yamlContent = yaml.dump(resource, { indent: 2 });
      const nsSegment = namespace ?? 'cluster';
      const uri = ResourceEditDocumentProvider.createUri(nsSegment, selected.crd.kind, name);
      resourceEditProvider.setOriginalResource(uri, resource);
      resourceEditProvider.setResourceContent(uri, yamlContent);

      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.languages.setTextDocumentLanguage(document, 'yaml');
      await vscode.window.showTextDocument(document);

      const schemaProvider = serviceManager.getService<SchemaProviderService>('schema-provider');
      void schemaProvider; // ensure service loaded so schema will be associated
    } catch (err: any) {
      log(`Error creating resource: ${err}`, LogLevel.ERROR);
      vscode.window.showErrorMessage(`Failed to create resource: ${err.message || err}`);
    }
  });

  context.subscriptions.push(cmd);
}
