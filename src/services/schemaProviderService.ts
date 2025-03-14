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

/**
 * Service providing JSON schema support for Kubernetes CRDs
 */
export class SchemaProviderService extends CoreService {
  private schemaCacheDir: string;
  private disposables: vscode.Disposable[] = [];
  private schemaCache = new Map<string, string>(); // Maps kind to schema file path

  constructor(private k8sClient: KubernetesClient) {
    super();
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
          await this.associateSchemaWithKind(document, parsed.kind);
        }
      } catch (e) {
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

    // Convert to file URI
    const schemaUri = vscode.Uri.file(schemaPath).toString();

    // Add schema comment to the document - this is the most reliable way
    await this.addSchemaComment(document, schemaUri);

    log(`Associated schema for ${kind} with document ${document.uri.toString()}`, LogLevel.DEBUG);
  }

  /**
   * Add schema comment to document
   */
  private async addSchemaComment(document: vscode.TextDocument, schemaUri: string): Promise<void> {
    try {
      // Check if already has schema comment
      const firstLine = document.lineAt(0).text;
      if (firstLine.includes('# yaml-language-server:')) {
        // If already has schema comment, check if it needs to be updated
        if (firstLine.includes(schemaUri)) {
          return; // Already has correct schema
        }

        // Update existing schema comment
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          document.uri,
          new vscode.Range(0, 0, 0, firstLine.length),
          `# yaml-language-server: $schema=${schemaUri}`
        );
        await vscode.workspace.applyEdit(edit);
        return;
      }

      // Add schema comment at the beginning
      const edit = new vscode.WorkspaceEdit();
      edit.insert(
        document.uri,
        new vscode.Position(0, 0),
        `# yaml-language-server: $schema=${schemaUri}\n`
      );
      await vscode.workspace.applyEdit(edit);
    } catch (error) {
      log(`Error adding schema comment: ${error}`, LogLevel.ERROR);
    }
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
        return null;
      }

      // Convert to proper JSON Schema
      const jsonSchema = this.convertToJsonSchema(schema, kind);

      // Save to file
      const schemaFileName = `${kind.toLowerCase()}.json`;
      const schemaFilePath = path.join(this.schemaCacheDir, schemaFileName);

      fs.writeFileSync(schemaFilePath, JSON.stringify(jsonSchema, null, 2));

      // Cache the schema file path
      this.schemaCache.set(kind, schemaFilePath);

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
    const matchingCrd = crds.find(crd => crd.spec?.names?.kind === kind);
    
    if (!matchingCrd) {
      return null;
    }

    // Extract schema from CRD
    return this.extractSchemaFromCRD(matchingCrd);
  }

  /**
   * Convert CRD schema to proper JSON Schema
   */
  private convertToJsonSchema(crdSchema: any, kind: string): any {
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
          "enum": [kind],
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
            continue;
          }

          // Convert to JSON Schema
          const jsonSchema = this.convertToJsonSchema(schema, kind);

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

      if (crd.spec?.versions && Array.isArray(crd.spec.versions)) {
        // Find the version marked as storage or the first one
        const version = crd.spec.versions.find((v: any) => v.storage === true) ||
                        crd.spec.versions[0];

        if (version?.schema?.openAPIV3Schema) {
          schema = version.schema.openAPIV3Schema;
        }
      }

      if (!schema) {
        // Legacy format
        if (crd.spec?.validation?.openAPIV3Schema) {
          schema = crd.spec.validation.openAPIV3Schema;
        }
      }

      return schema;
    } catch (error) {
      log(`Error extracting schema from CRD: ${error}`, LogLevel.ERROR);
      return null;
    }
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