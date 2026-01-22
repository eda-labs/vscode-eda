import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

import { log, LogLevel } from '../extension';
import { ResourceViewDocumentProvider } from '../providers/documents/resourceViewProvider';
import { ResourceEditDocumentProvider } from '../providers/documents/resourceEditProvider';
import type { EdaCrd } from '../types';
import type { KubernetesClient } from '../clients/kubernetesClient';

import { serviceManager } from './serviceManager';
import { CoreService } from './coreService';

// Constants for duplicate strings
const UTF8 = 'utf8' as const;
const SCHEME_K8S_VIEW = 'k8s-view' as const;
const SCHEME_K8S = 'k8s' as const;

// Regex patterns for OpenAPI spec parsing
const PATH_PATTERN = /^\/apps\/([^/]+)\/([^/]+)(?:\/namespaces\/{namespace\})?\/([^/]+)$/;
const REF_PATTERN = /\.([^./]+)$/;

// Type definitions for JSON Schema
interface JsonSchemaProperty {
  default?: string;
  enum?: string[];
  description?: string;
}

interface JsonSchema {
  description?: string;
  properties?: Record<string, JsonSchemaProperty | JsonSchema>;
}

// Type definitions for OpenAPI spec
interface OpenApiRequestBody {
  content?: {
    'application/json'?: {
      schema?: {
        $ref?: string;
      };
    };
  };
}

interface OpenApiOperation {
  description?: string;
  summary?: string;
  requestBody?: OpenApiRequestBody;
}

interface OpenApiPathItem {
  post?: OpenApiOperation;
}

interface OpenApiComponents {
  schemas?: Record<string, JsonSchema>;
}

interface OpenApiSpec {
  paths?: Record<string, OpenApiPathItem>;
  components?: OpenApiComponents;
}

// Type definitions for Kubernetes CRD
interface K8sCrdVersion {
  name?: string;
  storage?: boolean;
  schema?: {
    openAPIV3Schema?: JsonSchema;
  };
}

interface K8sCrdSpec {
  group?: string;
  version?: string;
  scope?: string;
  names?: {
    kind?: string;
    plural?: string;
  };
  versions?: K8sCrdVersion[];
}

interface K8sCrd {
  spec?: K8sCrdSpec;
}

// Type definition for parsed YAML document with kind
interface ParsedYamlDocument {
  kind?: string;
}

// Type definition for Red Hat YAML extension API
interface YamlExtensionApi {
  registerContributor?: (
    name: string,
    requestSchema: (resource: string) => string | undefined,
    requestSchemaContent: (schemaUri: string) => string | undefined
  ) => void;
}

export class SchemaProviderService extends CoreService {
  private schemaCacheDir: string;
  private disposables: vscode.Disposable[] = [];
  private schemaCache = new Map<string, string>();
  private yamlApi: YamlExtensionApi | null = null;

  constructor() {
    super();
    this.schemaCacheDir = path.join(os.homedir(), '.eda', 'vscode', 'schemas');
    if (!fs.existsSync(this.schemaCacheDir)) {
      fs.mkdirSync(this.schemaCacheDir, { recursive: true });
    }
  }

  /**
   * Calculate the priority of a schema based on whether it has metadata/spec properties.
   * Schemas with these properties are considered more complete.
   */
  private getSchemaQualityPriority(schema: JsonSchema): number {
    return schema?.properties?.metadata || schema?.properties?.spec ? 1 : 0;
  }

  /**
   * Read the priority of an existing cached schema file.
   * Returns -1 if the file doesn't exist.
   */
  private async getExistingSchemaPriority(schemaPath: string): Promise<number> {
    if (!fs.existsSync(schemaPath)) {
      return -1;
    }
    try {
      const existing = JSON.parse(await fs.promises.readFile(schemaPath, UTF8)) as JsonSchema;
      return this.getSchemaQualityPriority(existing);
    } catch {
      return 0;
    }
  }

  private async cacheSchema(kind: string, schema: JsonSchema): Promise<void> {
    const schemaPath = path.join(this.schemaCacheDir, `${kind.toLowerCase()}.json`);
    const existingPriority = await this.getExistingSchemaPriority(schemaPath);
    const newPriority = this.getSchemaQualityPriority(schema);
    if (newPriority >= existingPriority) {
      await fs.promises.writeFile(schemaPath, JSON.stringify(schema, null, 2));
      this.schemaCache.set(kind, schemaPath);
    }
  }

  public async initialize(context: vscode.ExtensionContext): Promise<void> {
    this.disposables.push(
      vscode.commands.registerCommand('vscode-eda.refreshSchemas', async () => {
        await this.loadSchemas();
        vscode.workspace.textDocuments.forEach(d => this.handleDocument(d));
      }),
      vscode.workspace.onDidOpenTextDocument(doc => this.handleDocument(doc)),
      vscode.workspace.onDidSaveTextDocument(doc => this.handleDocument(doc))
    );

    await this.loadSchemas();
    await this.activateYamlExtension();
    vscode.workspace.textDocuments.forEach(d => this.handleDocument(d));
    context.subscriptions.push(...this.disposables);
    log('Registered schema provider for YAML validation', LogLevel.INFO, true);
  }

  private async findSpecDir(): Promise<string> {
    const baseDir = path.join(os.homedir(), '.eda', 'vscode');
    try {
      const entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
      if (dirs.length > 0) {
        return path.join(baseDir, dirs[dirs.length - 1]);
      }
    } catch {
      // ignore
    }
    throw new Error(`No EDA specifications found in ${baseDir}`);
  }

  private async loadSchemas(): Promise<void> {
    this.schemaCache.clear();
    if (!fs.existsSync(this.schemaCacheDir)) {
      fs.mkdirSync(this.schemaCacheDir, { recursive: true });
    }
    const specDir = await this.findSpecDir();
    await this.scanSpecDir(specDir);
  }

  private async scanSpecDir(dir: string): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.scanSpecDir(full);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        await this.processSpecFile(full);
      }
    }
  }

  private async processSpecFile(file: string): Promise<void> {
    try {
      const content = await fs.promises.readFile(file, UTF8);
      const json = JSON.parse(content) as OpenApiSpec;
      const schemas: Record<string, JsonSchema> = json.components?.schemas ?? {};
      for (const [name, schema] of Object.entries(schemas)) {
        const kindProperty = schema?.properties?.kind as JsonSchemaProperty | undefined;
        const kind =
          kindProperty?.default ||
          (Array.isArray(kindProperty?.enum) ? kindProperty.enum[0] : undefined) ||
          name.split('.').pop();
        if (typeof kind === 'string') {
          await this.cacheSchema(kind, schema);
        }
      }
    } catch (err) {
      log(`Failed to load schema from ${file}: ${err}`, LogLevel.WARN);
    }
  }

  private handleDocument(document: vscode.TextDocument): void {
    if (document.languageId !== 'yaml') {
      return;
    }
    try {
      let kind: string | undefined;
      if (document.uri.scheme === SCHEME_K8S_VIEW) {
        kind = ResourceViewDocumentProvider.parseUri(document.uri).kind;
      } else if (document.uri.scheme === SCHEME_K8S) {
        kind = ResourceEditDocumentProvider.parseUri(document.uri).kind;
      } else {
        const parsed = yaml.load(document.getText()) as ParsedYamlDocument | null;
        if (parsed && typeof parsed === 'object') {
          kind = parsed.kind;
        }
      }
      if (kind) {
        this.getOrCreateSchemaForKind(kind);
      }
    } catch (err) {
      log(`Error handling document: ${err}`, LogLevel.ERROR);
    }
  }

  private getOrCreateSchemaForKind(kind: string): string | null {
    if (this.schemaCache.has(kind)) {
      return this.schemaCache.get(kind) || null;
    }
    return null;
  }

  private async activateYamlExtension(): Promise<void> {
    try {
      const ext = vscode.extensions.getExtension('redhat.vscode-yaml');
      if (!ext) {
        log('YAML extension not found; schema validation disabled', LogLevel.WARN);
        return;
      }
      this.yamlApi = (await ext.activate()) as YamlExtensionApi;
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
    } catch (err) {
      log(`Failed to activate YAML extension API: ${err}`, LogLevel.ERROR);
    }
  }

  private getSchemaUriForResource(resource: string): string | undefined {
    try {
      const uri = vscode.Uri.parse(resource);
      let kind: string | undefined;
      if (uri.scheme === SCHEME_K8S_VIEW) {
        kind = ResourceViewDocumentProvider.parseUri(uri).kind;
      } else if (uri.scheme === SCHEME_K8S) {
        kind = ResourceEditDocumentProvider.parseUri(uri).kind;
      } else {
        const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === resource);
        if (doc) {
          const parsed = yaml.load(doc.getText()) as ParsedYamlDocument | null;
          if (parsed?.kind) {
            kind = parsed.kind;
          }
        }
      }
      if (kind && this.schemaCache.has(kind)) {
        return vscode.Uri.file(this.schemaCache.get(kind) as string).toString();
      }
    } catch (err) {
      log(`Error determining schema for ${resource}: ${err}`, LogLevel.ERROR);
    }
    return undefined;
  }

  private getSchemaContent(schemaUri: string): string | undefined {
    try {
      const filePath = vscode.Uri.parse(schemaUri).fsPath;
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, UTF8);
      }
    } catch (err) {
      log(`Error loading schema content ${schemaUri}: ${err}`, LogLevel.ERROR);
    }
    return undefined;
  }

  /** Extract CRD from an OpenAPI spec path entry */
  private extractCrdFromPath(
    p: string,
    methods: OpenApiPathItem,
    spec: OpenApiSpec
  ): EdaCrd | null {
    const post = methods.post;
    if (!post?.requestBody) {
      return null;
    }
    const match = PATH_PATTERN.exec(p);
    if (!match) {
      return null;
    }
    const [, group, version, plural] = match;
    const namespaced = p.includes('/namespaces/{namespace}/');
    let kind: string | undefined;
    let description: string | undefined = post.description ?? post.summary;
    const ref = post.requestBody.content?.['application/json']?.schema?.$ref;
    if (typeof ref === 'string') {
      const m = REF_PATTERN.exec(ref);
      if (m) {
        kind = m[1];
        description = description ?? spec.components?.schemas?.[m[1]]?.description;
      }
    }
    if (!kind) {
      kind = plural.replace(/s$/, '').replace(/(^|[-_])(\w)/g, (_, __, ch: string) => ch.toUpperCase());
    }
    return { kind, group, version, plural, namespaced, description };
  }

  /** Load CRDs from a single spec file */
  private async loadCrdsFromSpecFile(specPath: string): Promise<EdaCrd[]> {
    const results: EdaCrd[] = [];
    try {
      const raw = await fs.promises.readFile(specPath, UTF8);
      const spec = JSON.parse(raw) as OpenApiSpec;
      const paths: Record<string, OpenApiPathItem> = spec.paths ?? {};
      for (const [p, methods] of Object.entries(paths)) {
        const crd = this.extractCrdFromPath(p, methods, spec);
        if (crd) {
          results.push(crd);
        }
      }
    } catch (err) {
      log(`Failed to parse spec ${specPath}: ${err}`, LogLevel.WARN);
    }
    return results;
  }

  /** Load CRDs from local OpenAPI spec files */
  private async loadCrdsFromSpecs(specDir: string): Promise<EdaCrd[]> {
    const results: EdaCrd[] = [];
    try {
      const categories = await fs.promises.readdir(specDir, { withFileTypes: true });
      for (const cat of categories) {
        if (!cat.isDirectory()) continue;
        const catDir = path.join(specDir, cat.name);
        const files = await fs.promises.readdir(catDir);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          const specPath = path.join(catDir, file);
          const crds = await this.loadCrdsFromSpecFile(specPath);
          results.push(...crds);
        }
      }
    } catch (err) {
      log(`Failed to load CRD definitions: ${err}`, LogLevel.WARN);
    }
    return results;
  }

  /**
   * Get the active version object from a CRD spec.
   * Prefers the storage version, falls back to first version.
   */
  private getCrdVersionObject(crd: K8sCrd): K8sCrdVersion | undefined {
    const versions = crd?.spec?.versions;
    if (!Array.isArray(versions)) {
      return undefined;
    }
    return versions.find((v: K8sCrdVersion) => v.storage) ?? versions[0];
  }

  /**
   * Extract the version string from a CRD spec.
   * Checks versioned spec first, then falls back to legacy spec.version.
   */
  private getCrdVersion(crd: K8sCrd, versionObj: K8sCrdVersion | undefined): string | undefined {
    return versionObj?.name ?? crd?.spec?.version;
  }

  /**
   * Extract core naming fields from a CRD spec.
   */
  private getCrdNamingFields(crd: K8sCrd): { kind?: string; group?: string; plural?: string } {
    return {
      kind: crd?.spec?.names?.kind,
      group: crd?.spec?.group,
      plural: crd?.spec?.names?.plural,
    };
  }

  /** Extract CRD metadata from a Kubernetes CRD object */
  private extractCrdFromK8s(crd: K8sCrd): (EdaCrd & { schema?: JsonSchema }) | null {
    const { kind, group, plural } = this.getCrdNamingFields(crd);
    const versionObj = this.getCrdVersionObject(crd);
    const version = this.getCrdVersion(crd, versionObj);

    if (!kind || !group || !version || !plural) {
      return null;
    }

    const namespaced = crd?.spec?.scope === 'Namespaced';
    const schema = versionObj?.schema?.openAPIV3Schema;
    const description = schema?.description;

    return { kind, group, version, plural, namespaced, description, schema };
  }

  /** Load CRDs from Kubernetes cluster */
  private async loadCrdsFromCluster(existing: Set<string>): Promise<EdaCrd[]> {
    const results: EdaCrd[] = [];
    try {
      const k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');
      const crds = (await k8sClient.listCrds()) as K8sCrd[];
      for (const crd of crds) {
        const extracted = this.extractCrdFromK8s(crd);
        if (!extracted) continue;
        const { schema, ...crdData } = extracted;
        const key = `${crdData.group}/${crdData.kind}`;
        if (existing.has(key)) continue;
        existing.add(key);
        if (schema) {
          await this.cacheSchema(crdData.kind, schema);
        }
        results.push(crdData);
      }
    } catch (err) {
      log(`Failed to load Kubernetes CRDs: ${err}`, LogLevel.DEBUG);
    }
    return results;
  }

  /** Return CRD metadata discovered from cached OpenAPI specs */
  public async getCustomResourceDefinitions(): Promise<EdaCrd[]> {
    const specDir = await this.findSpecDir();
    const results = await this.loadCrdsFromSpecs(specDir);
    const existing = new Set(results.map(r => `${r.group}/${r.kind}`));
    const clusterCrds = await this.loadCrdsFromCluster(existing);
    results.push(...clusterCrds);
    results.sort((a, b) => a.kind.localeCompare(b.kind));
    return results;
  }

  /** Get JSON schema for a given resource kind */
  public async getSchemaForKind(kind: string): Promise<JsonSchema | null> {
    if (!this.schemaCache.has(kind)) {
      return null;
    }
    const schemaPath = this.schemaCache.get(kind) as string;
    try {
      const raw = await fs.promises.readFile(schemaPath, UTF8);
      return JSON.parse(raw) as JsonSchema;
    } catch {
      return null;
    }
  }

  public dispose(): void {
    super.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
