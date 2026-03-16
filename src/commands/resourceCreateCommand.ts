// src/commands/resourceCreateCommand.ts
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

import { serviceManager } from '../services/serviceManager';
import { ResourceEditDocumentProvider } from '../providers/documents/resourceEditProvider';
import type { SchemaProviderService } from '../services/schemaProviderService';
import { log, LogLevel } from '../extension';
import type { JsonSchemaNode } from '../webviews/resourceCreate/types';

/** Kubernetes resource metadata */
interface KubernetesMetadata {
  namespace?: string;
  [key: string]: unknown;
}

/** Kubernetes resource structure */
interface KubernetesResource {
  apiVersion: string;
  kind: string;
  metadata: KubernetesMetadata;
  spec: Record<string, unknown>;
  [key: string]: unknown;
}

const DEFAULT_CREATE_NAMESPACE = 'eda';

export function registerResourceCreateCommand(
  context: vscode.ExtensionContext,
  resourceEditProvider: ResourceEditDocumentProvider,
): void {
  const cmd = vscode.commands.registerCommand('vscode-eda.createResource', async () => {
    try {
      const schemaService = serviceManager.getService<SchemaProviderService>('schema-provider');

      const crds = await schemaService.getCustomResourceDefinitions();
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

      // Start with a minimal manifest so users can fill fields from the form or YAML.
      const { group, version, namespaced } = selected.crd;

      const schema = await schemaService.getSchemaForKind(selected.crd.kind);

      const resource: KubernetesResource = {
        apiVersion: `${group}/${version}`,
        kind: selected.crd.kind,
        metadata: {
          ...(namespaced ? { namespace: DEFAULT_CREATE_NAMESPACE } : {}),
        },
        spec: {},
      };

      const yamlContent = yaml.dump(resource, { indent: 2 });
      const tempId = `new-${Date.now()}`;
      const nsSegment = namespaced ? 'new' : 'cluster';
      const uri = ResourceEditDocumentProvider.createUri(nsSegment, selected.crd.kind, tempId);
      resourceEditProvider.setOriginalResource(uri, resource);
      resourceEditProvider.setResourceContent(uri, yamlContent);
      resourceEditProvider.setCrdInfo(uri, selected.crd);
      resourceEditProvider.markNewResource(uri);

      const { ResourceCreatePanel } = await import('../webviews/resourceCreate/resourceCreatePanel');
      await ResourceCreatePanel.show(context, {
        resourceUri: uri,
        crd: selected.crd,
        schema: schema as JsonSchemaNode | null,
        mode: 'create'
      });

      // Ensure schema provider service is loaded so schema will be associated
      serviceManager.getService<SchemaProviderService>('schema-provider');
    } catch (err: unknown) {
      log(`Error creating resource: ${err}`, LogLevel.ERROR);
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to create resource: ${message}`);
    }
  });

  context.subscriptions.push(cmd);
}
