// src/commands/resourceCreateCommand.ts
import * as vscode from 'vscode';
import { serviceManager } from '../services/serviceManager';
import { ResourceEditDocumentProvider } from '../providers/documents/resourceEditProvider';
import { SchemaProviderService } from '../services/schemaProviderService';
import * as yaml from 'js-yaml';
import { log, LogLevel } from '../extension';

function buildSkeletonFromSchema(schema: any): any {
  if (!schema) {
    return {};
  }
  if (schema.type === 'object' || schema.properties) {
    const obj: any = {};
    const props = schema.properties || {};
    for (const [key, prop] of Object.entries<any>(props)) {
      if ((prop as any)['readOnly']) {
        continue;
      }
      obj[key] = buildSkeletonFromSchema(prop);
    }
    return obj;
  }
  if (schema.type === 'array') {
    return [buildSkeletonFromSchema(schema.items)];
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'default')) {
    return schema.default;
  }
  switch (schema.type) {
    case 'string':
      return '';
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}

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

      // No pre-filled name or namespace so the user can freely edit the manifest
      const { group, version, namespaced } = selected.crd;

      const schema = await schemaService.getSchemaForKind(selected.crd.kind);
      const specSkeleton = schema?.properties?.spec
        ? buildSkeletonFromSchema(schema.properties.spec)
        : {};

      const resource: any = {
        apiVersion: `${group}/${version}`,
        kind: selected.crd.kind,
        metadata: {},
        spec: specSkeleton,
      };

      // Provide empty placeholders for required fields
      resource.metadata.name = '';
      if (namespaced) {
        resource.metadata.namespace = '';
      }

      const yamlContent = yaml.dump(resource, { indent: 2 });
      const tempId = `new-${Date.now()}`;
      const nsSegment = namespaced ? 'new' : 'cluster';
      const uri = ResourceEditDocumentProvider.createUri(nsSegment, selected.crd.kind, tempId);
      resourceEditProvider.setOriginalResource(uri, resource);
      resourceEditProvider.setResourceContent(uri, yamlContent);
      resourceEditProvider.setCrdInfo(uri, selected.crd);
      resourceEditProvider.markNewResource(uri);

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
