// src/services/schemaProviderService.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { CoreService } from './coreService';
import { KubernetesClient } from '../clients/kubernetesClient';
import { log, LogLevel } from '../extension';
import { ResourceViewDocumentProvider } from '../providers/documents/resourceViewProvider';
import { ResourceEditDocumentProvider } from '../providers/documents/resourceEditProvider';

/**
 * Service providing JSON schema support for Kubernetes CRDs
 */
export class SchemaProviderService extends CoreService {
  private schemaCacheDir: string;
  private disposables: vscode.Disposable[] = [];
  private schemaCache = new Map<string, string>(); // Maps kind to schema file path

  private yamlApi: any | null = null;

  private k8sClient: KubernetesClient;

  constructor(k8sClient: KubernetesClient) {
    super();
    this.k8sClient = k8sClient;
    // Create a directory for storing CRD schemas
    this.schemaCacheDir = path.join(os.tmpdir(), 'vscode-eda-schemas');
    if (!fs.existsSync(this.schemaCacheDir)) {
      fs.mkdirSync(this.schemaCacheDir, { recursive: true });
    }
  }

  /**
   * Initialize the schema provider service
   */
  public async initialize(context: vscode.ExtensionContext): Promise<void> {
    // Register command to refresh schemas
    this.disposables.push(
      vscode.commands.registerCommand('vscode-eda.refreshSchemas', async () => {
        await this.updateSchemas();
      })
    );

    // Register document events
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument(this.handleDocument.bind(this)),
      vscode.workspace.onDidSaveTextDocument(this.handleDocument.bind(this))
    );

    // Initially update schemas
    await this.updateSchemas();

    // Activate YAML extension integration
    await this.activateYamlExtension();

    // Apply schemas to all currently open documents
    vscode.workspace.textDocuments.forEach(this.handleDocument.bind(this));

    // Add all disposables to context
    context.subscriptions.push(...this.disposables);

    log('Registered schema provider for YAML validation', LogLevel.INFO, true);
  }

  /**
   * Handle document events
   */
  private async handleDocument(document: vscode.TextDocument): Promise<void> {
    if (document.languageId !== 'yaml') {
      return;
    }

    try {
      // Check if this is a k8s-view document
      if (document.uri.scheme === 'k8s-view') {
        // Parse the k8s-view URI to get kind
        const parts = ResourceViewDocumentProvider.parseUri(document.uri);
        if (parts.kind) {
          await this.associateSchemaWithKind(document, parts.kind);
          return;
        }
      }

      // Otherwise try to parse the YAML to find kind
      const content = document.getText();
      try {
        const parsed = yaml.load(content) as any;
        if (parsed && parsed.kind) {
          log(`Found kind ${parsed.kind} in document ${document.uri.toString()}`, LogLevel.DEBUG);
          await this.associateSchemaWithKind(document, parsed.kind);
        } else {
          log(`No 'kind' field found in document ${document.uri.toString()}`, LogLevel.DEBUG);
        }
      } catch {
        // Silently ignore YAML parsing errors
      }
    } catch (error) {
      log(`Error handling document: ${error}`, LogLevel.ERROR);
    }
  }

  /**
   * Associate schema with a document for a specific kind
   */
  private async associateSchemaWithKind(document: vscode.TextDocument, kind: string): Promise<void> {
    // Check if we have a schema for this kind
    if (!this.schemaCache.has(kind)) {
      // Try to get and cache the schema
      const schema = await this.getOrCreateSchemaForKind(kind);
      if (!schema) {
        log(`No schema available for kind: ${kind}`, LogLevel.WARN);
        return;
      }
    }

    // Get the schema file path
    const schemaPath = this.schemaCache.get(kind);
    if (!schemaPath) {
      return;
    }

    log(`Cached schema for ${kind} (used by YAML extension)`, LogLevel.DEBUG);
  }



  /**
   * Activate the YAML extension and register schema contributor
   */
  private async activateYamlExtension(): Promise<void> {
    try {
      const ext = vscode.extensions.getExtension('redhat.vscode-yaml');
      if (!ext) {
        log('YAML extension not found; schema validation disabled', LogLevel.WARN);
        return;
      }

      this.yamlApi = await ext.activate();
      if (!this.yamlApi?.registerContributor) {
        log('YAML extension API missing registerContributor', LogLevel.WARN);
        return;
      }

      this.yamlApi.registerContributor(
        'vscode-eda',
        (resource: string) => this.getSchemaUriForResource(resource),
        (schemaUri: string) => this.getSchemaContent(schemaUri)
      );

      log('Registered YAML schema contributor', LogLevel.INFO);
    } catch (error) {
      log(`Failed to activate YAML extension API: ${error}`, LogLevel.ERROR);
    }
  }

  private getSchemaUriForResource(resource: string): string | undefined {
    try {
      const uri = vscode.Uri.parse(resource);
      let kind: string | undefined;
      if (uri.scheme === 'k8s-view') {
        const parts = ResourceViewDocumentProvider.parseUri(uri);
        kind = parts.kind;
      } else if (uri.scheme === 'k8s') {
        const parts = ResourceEditDocumentProvider.parseUri(uri);
        kind = parts.kind;
      } else {
        const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === resource);
        if (doc) {
          const parsed = yaml.load(doc.getText()) as any;
          if (parsed?.kind) {
            kind = parsed.kind;
          }
        }
      }

      if (kind && this.schemaCache.has(kind)) {
        return vscode.Uri.file(this.schemaCache.get(kind) as string).toString();
      }
    } catch (error) {
      log(`Error determining schema for ${resource}: ${error}`, LogLevel.ERROR);
    }
    return undefined;
  }

  private getSchemaContent(schemaUri: string): string | undefined {
    try {
      const filePath = vscode.Uri.parse(schemaUri).fsPath;
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8');
      }
    } catch (error) {
      log(`Error loading schema content ${schemaUri}: ${error}`, LogLevel.ERROR);
    }
    return undefined;
  }

  /**
   * Get or create schema for a kind
   */
  private async getOrCreateSchemaForKind(kind: string): Promise<string | null> {
    try {
      // Check if we already have this schema
      if (this.schemaCache.has(kind)) {
        return this.schemaCache.get(kind) || null;
      }

      // Get schema by finding CRD with matching kind
      const schema = this.getCrdSchemaForKind(kind);
      if (!schema) {
        log(`Could not find schema for kind ${kind}`, LogLevel.WARN);
        return null;
      }

      // Find the matching CRD to pass to convertToJsonSchema
      const crd = this.k8sClient.getCachedCrds().find(crd =>
        crd.spec?.names?.kind.toLowerCase() === kind.toLowerCase()
      );

      if (!crd) {
        log(`Could not find CRD for kind ${kind}`, LogLevel.WARN);
        return null;
      }

      // Convert to proper JSON Schema
      const jsonSchema = this.convertToJsonSchema(schema, kind, crd);

      // Save to file
      const schemaFileName = `${kind.toLowerCase()}.json`;
      const schemaFilePath = path.join(this.schemaCacheDir, schemaFileName);

      fs.writeFileSync(schemaFilePath, JSON.stringify(jsonSchema, null, 2));

      // Cache the schema file path
      this.schemaCache.set(kind, schemaFilePath);
      log(`Created schema for kind ${kind} at ${schemaFilePath}`, LogLevel.INFO);

      return schemaFilePath;
    } catch (error) {
      log(`Error getting schema for kind ${kind}: ${error}`, LogLevel.ERROR);
      return null;
    }
  }

  /**
   * Get CRD schema for a specific kind
   */
  private getCrdSchemaForKind(kind: string): any {
    // Find CRD with matching kind
    const crds = this.k8sClient.getCachedCrds();
    const matchingCrd = crds.find(crd =>
      crd.spec?.names?.kind.toLowerCase() === kind.toLowerCase()
    );

    if (!matchingCrd) {
      log(`No CRD found for kind ${kind}`, LogLevel.WARN);
      return null;
    }

    log(`Found CRD for kind ${kind}: ${matchingCrd.metadata?.name}`, LogLevel.DEBUG);

    // Extract schema from CRD
    const schema = this.extractSchemaFromCRD(matchingCrd);
    if (!schema) {
      log(`Could not extract schema from CRD for kind ${kind}`, LogLevel.WARN);
    }

    return schema;
  }

  /**
   * Convert CRD schema to proper JSON Schema
   */
  private convertToJsonSchema(crdSchema: any, kind: string, crd: any): any {

    const originalKind = crd.spec?.names?.kind || kind;
    // Create a proper JSON Schema
    const jsonSchema = {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "title": `Schema for ${kind}`,
      "description": crdSchema.description || `Schema for Kubernetes ${kind} resource`,
      "required": ["apiVersion", "kind", "metadata"],
      "additionalProperties": false, // Disallow unknown top-level fields
      "properties": {
        "apiVersion": {
          "type": "string",
          "description": "The API version for this resource"
        },
        "kind": {
          "type": "string",
          "enum": [originalKind],
          "description": "The resource kind"
        },
        "metadata": {
          "type": "object",
          "required": ["name"],
          "properties": {
            "name": {
              "type": "string",
              "description": "Name of the resource"
            },
            "namespace": {
              "type": "string",
              "description": "Namespace of the resource"
            },
            "labels": {
              "type": "object",
              "additionalProperties": {
                "type": "string"
              },
              "description": "Labels attached to the resource"
            },
            "annotations": {
              "type": "object",
              "additionalProperties": {
                "type": "string"
              },
              "description": "Annotations attached to the resource"
            }
          }
        },
        "spec": this.strictifySchema(crdSchema.properties?.spec || {}),
        "status": this.strictifySchema(crdSchema.properties?.status || {})
      }
    };

    return jsonSchema;
  }

  /**
   * Make schema strict by disallowing additional properties recursively
   */
  private strictifySchema(schema: any): any {
    if (!schema || typeof schema !== 'object') {
      return schema;
    }

    // If this is an object schema, add additionalProperties: false
    if (schema.type === 'object') {
      const result = { ...schema, additionalProperties: false };

      // Process properties recursively
      if (result.properties && typeof result.properties === 'object') {
        const newProperties: any = {};

        for (const key in result.properties) {
          newProperties[key] = this.strictifySchema(result.properties[key]);
        }

        result.properties = newProperties;
      }

      return result;
    }

    // If this is an array schema, process the items
    if (schema.type === 'array' && schema.items) {
      return {
        ...schema,
        items: this.strictifySchema(schema.items)
      };
    }

    // Handle anyOf, allOf, oneOf
    for (const key of ['anyOf', 'allOf', 'oneOf']) {
      if (schema[key] && Array.isArray(schema[key])) {
        const newSchema = { ...schema };
        newSchema[key] = schema[key].map((s: any) => this.strictifySchema(s));
        return newSchema;
      }
    }

    // For other types, just return as is
    return schema;
  }

  /**
   * Update all schemas from cluster
   */
  public async updateSchemas(): Promise<void> {
    try {
      log('Updating CRD schemas...', LogLevel.INFO);

      // Get all CRDs
      const crds = this.k8sClient.getCachedCrds();
      if (!crds || crds.length === 0) {
        log('No CRDs found in the cluster', LogLevel.WARN);
        return;
      }

      log(`Found ${crds.length} CRDs in the cluster`, LogLevel.INFO);
      this.schemaCache.clear(); // Clear cache to force regeneration

      // Process each CRD
      for (const crd of crds) {
        try {
          const kind = crd.spec?.names?.kind;
          if (!kind) {
            continue;
          }

          // Extract schema
          const schema = this.extractSchemaFromCRD(crd);
          if (!schema) {
            log(`Could not extract schema for CRD ${crd.metadata?.name} (kind: ${kind})`, LogLevel.WARN);
            continue;
          }

          // Convert to JSON Schema - pass the CRD as third argument
          const jsonSchema = this.convertToJsonSchema(schema, kind, crd);

          // Save to file
          const schemaFileName = `${kind.toLowerCase()}.json`;
          const schemaFilePath = path.join(this.schemaCacheDir, schemaFileName);

          fs.writeFileSync(schemaFilePath, JSON.stringify(jsonSchema, null, 2));

          // Cache the schema file path
          this.schemaCache.set(kind, schemaFilePath);

          log(`Cached schema for ${kind}`, LogLevel.DEBUG);
        } catch (error) {
          log(`Error processing CRD ${crd.metadata?.name}: ${error}`, LogLevel.ERROR);
        }
      }

      // Update all open documents
      vscode.workspace.textDocuments.forEach(this.handleDocument.bind(this));

      log('CRD schemas updated successfully', LogLevel.INFO);
    } catch (error) {
      log(`Error updating schemas: ${error}`, LogLevel.ERROR);
    }
  }

  /**
   * Extract schema from CRD
   */
  private extractSchemaFromCRD(crd: any): any {
    try {
      // Find the schema
      let schema = null;
      const crdName = crd.metadata?.name || 'unknown';
      const kind = crd.spec?.names?.kind || 'unknown';

      log(`Extracting schema from CRD: ${crdName} (kind: ${kind})`, LogLevel.DEBUG);

      // Approach 1: Current K8s API format (v1)
      if (crd.spec?.versions && Array.isArray(crd.spec.versions)) {
        // Find the version marked as storage or the first one
        const version = crd.spec.versions.find((v: any) => v.storage === true) ||
                        crd.spec.versions[0];

        if (version?.schema?.openAPIV3Schema) {
          log(`Found schema in version.schema.openAPIV3Schema for ${crdName}`, LogLevel.DEBUG);
          schema = version.schema.openAPIV3Schema;
        } else if (version?.openAPIV3Schema) {
          // Some CRDs have openAPIV3Schema directly in the version
          log(`Found schema in version.openAPIV3Schema for ${crdName}`, LogLevel.DEBUG);
          schema = version.openAPIV3Schema;
        }
      }

      // Approach 2: Legacy format
      if (!schema && crd.spec?.validation?.openAPIV3Schema) {
        log(`Found schema in spec.validation.openAPIV3Schema for ${crdName}`, LogLevel.DEBUG);
        schema = crd.spec.validation.openAPIV3Schema;
      }

      // Approach 3: Sometimes schemas are directly in the spec
      if (!schema && crd.spec?.openAPIV3Schema) {
        log(`Found schema in spec.openAPIV3Schema for ${crdName}`, LogLevel.DEBUG);
        schema = crd.spec.openAPIV3Schema;
      }

      // Generate minimal schema if one wasn't found
      if (!schema) {
        log(`No schema found for CRD ${crdName}, generating minimal schema`, LogLevel.WARN);

        // Create a minimal schema with just basic structure
        schema = {
          type: "object",
          description: `Auto-generated schema for ${kind}`,
          properties: {
            apiVersion: {
              type: "string",
              description: `API version (${crd.spec?.group}/v1)`
            },
            kind: {
              type: "string",
              description: `Kind (${kind})`
            },
            metadata: {
              type: "object",
              description: "Standard Kubernetes metadata",
              properties: {
                name: { type: "string" },
                namespace: { type: "string" }
              }
            },
            spec: {
              type: "object",
              description: `Specification for ${kind}`
            }
          }
        };
      }

      return schema;
    } catch (error) {
      log(`Error extracting schema from CRD: ${error}`, LogLevel.ERROR);
      return null;
    }
  }

  /**
   * Public method to associate schema with a document for a specific kind
   * This can be called manually via command
   */
  public async associateSchemaWithDocument(document: vscode.TextDocument, kind: string): Promise<void> {
    return this.associateSchemaWithKind(document, kind);
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    super.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}