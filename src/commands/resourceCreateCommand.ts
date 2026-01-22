// src/commands/resourceCreateCommand.ts
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

import { serviceManager } from '../services/serviceManager';
import { ResourceEditDocumentProvider } from '../providers/documents/resourceEditProvider';
import type { SchemaProviderService } from '../services/schemaProviderService';
import { log, LogLevel } from '../extension';

/** JSON Schema property definition */
interface JsonSchemaProperty {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  items?: JsonSchemaProperty;
  default?: unknown;
  readOnly?: boolean;
}

/** Kubernetes resource metadata */
interface KubernetesMetadata {
  name: string;
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

/** JSON-compatible value that can be serialized to YAML */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

/** Default values for primitive JSON schema types */
const PRIMITIVE_DEFAULTS: JsonObject = {
  string: '',
  integer: 0,
  number: 0,
  boolean: false,
};

/**
 * Build object skeleton from properties.
 */
function buildObjectSkeleton(properties: Record<string, JsonSchemaProperty>): JsonObject {
  const obj: JsonObject = {};
  for (const [key, prop] of Object.entries(properties)) {
    if (!prop.readOnly) {
      obj[key] = buildSkeletonFromSchema(prop);
    }
  }
  return obj;
}

/**
 * Builds a skeleton structure from a JSON schema.
 * Returns appropriate default values based on schema type.
 *
 * Note: This function intentionally returns different structural types (objects, arrays,
 * primitives) based on the input schema type. This is the correct behavior for building
 * JSON skeletons from JSON Schema definitions.
 */
// eslint-disable-next-line sonarjs/function-return-type -- intentionally polymorphic return
function buildSkeletonFromSchema(schema: JsonSchemaProperty | null | undefined): JsonValue {
  if (!schema) {
    return {};
  }

  // Object type with properties
  if (schema.properties !== undefined || schema.type === 'object') {
    return buildObjectSkeleton(schema.properties ?? {});
  }

  // Array type
  if (schema.type === 'array') {
    return [buildSkeletonFromSchema(schema.items)];
  }

  // Has explicit default value
  if (Object.prototype.hasOwnProperty.call(schema, 'default')) {
    return schema.default as JsonValue;
  }

  // Primitive type - return appropriate default
  const schemaType = schema.type ?? '';
  return schemaType in PRIMITIVE_DEFAULTS ? PRIMITIVE_DEFAULTS[schemaType] : null;
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

      const schema = (await schemaService.getSchemaForKind(selected.crd.kind)) as JsonSchemaProperty | null;
      const specSkeleton: JsonValue = schema?.properties?.spec
        ? buildSkeletonFromSchema(schema.properties.spec)
        : {};

      const resource: KubernetesResource = {
        apiVersion: `${group}/${version}`,
        kind: selected.crd.kind,
        metadata: {
          name: '',
          ...(namespaced ? { namespace: '' } : {}),
        },
        spec: specSkeleton as Record<string, unknown>,
      };

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
