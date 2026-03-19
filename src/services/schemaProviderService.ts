import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import * as vscode from 'vscode';

import { log, LogLevel } from '../extension';
import type { EdaCrd } from '../types';
import type { KubernetesClient } from '../clients/kubernetesClient';
import type { EdaClient } from '../clients/edaClient';
import type { ResolvedJsonSchema } from '../providers/yaml/types';

import { serviceManager } from './serviceManager';
import { CoreService } from './coreService';

// Constants for duplicate strings
const UTF8 = 'utf8' as const;

// Regex patterns for OpenAPI spec parsing
const PATH_PATTERN = /^\/apps\/([^/]+)\/([^/]+)(?:\/namespaces\/{namespace\})?\/([^/]+)$/;
const REF_PATTERN = /\.([^./]+)$/;
const VERSION_DIR_PATTERN = /^v?(\d+(?:\.\d+)*)$/;

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
export class SchemaProviderService extends CoreService {
  private readonly schemaChangedEmitter = new vscode.EventEmitter<void>();
  private schemaCacheDir: string;
  private disposables: vscode.Disposable[] = [];
  private schemaCache = new Map<string, string>();
  private clusterSchemaCache = new Map<string, JsonSchema>();
  private customResourceDefinitionsCache: EdaCrd[] | undefined;
  private customResourceDefinitionsPromise: Promise<EdaCrd[]> | undefined;

  /** In-memory cache of fully resolved schemas (no $ref pointers) for sync access */
  private resolvedSchemaCache = new Map<string, ResolvedJsonSchema>();
  /** In-memory cache of resolved schemas keyed by apiVersion+kind */
  private resolvedSchemaByResourceCache = new Map<string, ResolvedJsonSchema>();
  /** Priority map to prevent lower-quality schemas from overriding better kind-level schemas */
  private resolvedSchemaPriority = new Map<string, number>();
  /** Priority map for apiVersion+kind schemas */
  private resolvedSchemaByResourcePriority = new Map<string, number>();
  /** Map of kind -> apiVersion extracted during schema loading */
  private kindApiVersionMap = new Map<string, string>();
  public readonly onDidSchemasChanged = this.schemaChangedEmitter.event;

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
      })
    );

    await this.loadSchemas();
    context.subscriptions.push(...this.disposables);
    log('Initialized EDA schema provider', LogLevel.INFO, true);
  }

  private async findSpecDir(preferredVersion?: string): Promise<string> {
    const baseDir = path.join(os.homedir(), '.eda', 'vscode');
    try {
      const entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
      const selectedDir = SchemaProviderService.selectSpecDirName(dirs, preferredVersion);
      if (selectedDir) {
        return path.join(baseDir, selectedDir);
      }
    } catch {
      // ignore
    }
    throw new Error(`No EDA specifications found in ${baseDir}`);
  }

  private static selectSpecDirName(dirNames: string[]): string | undefined;
  private static selectSpecDirName(dirNames: string[], preferredVersion: string | undefined): string | undefined;
  private static selectSpecDirName(dirNames: string[], preferredVersion?: string): string | undefined {
    if (dirNames.length === 0) {
      return undefined;
    }

    const candidateNames = SchemaProviderService.versionCandidates(preferredVersion);
    if (candidateNames.length > 0) {
      for (const candidate of candidateNames) {
        if (dirNames.includes(candidate)) {
          return candidate;
        }
      }
    }

    const versionDirs = dirNames
      .map(name => {
        const match = VERSION_DIR_PATTERN.exec(name);
        if (!match) {
          return null;
        }
        const parsed = match[1]
          .split('.')
          .map(part => Number.parseInt(part, 10))
          .filter(part => Number.isFinite(part));
        if (parsed.length === 0) {
          return null;
        }
        return { name, parsed };
      })
      .filter((entry): entry is { name: string; parsed: number[] } => entry !== null);

    if (versionDirs.length > 0) {
      versionDirs.sort((left, right) => {
        const maxLength = Math.max(left.parsed.length, right.parsed.length);
        for (let index = 0; index < maxLength; index += 1) {
          const leftPart = left.parsed[index] ?? 0;
          const rightPart = right.parsed[index] ?? 0;
          if (leftPart !== rightPart) {
            return rightPart - leftPart;
          }
        }
        return right.name.localeCompare(left.name);
      });
      return versionDirs[0].name;
    }

    const fallbackDirs = [...dirNames].sort();
    if (fallbackDirs.length > 0) {
      return fallbackDirs[fallbackDirs.length - 1];
    }
    return undefined;
  }

  private static versionCandidates(version: string | undefined): string[] {
    const trimmed = typeof version === 'string' ? version.trim() : '';
    if (!trimmed || trimmed.toLowerCase() === 'unknown') {
      return [];
    }
    const normalized = trimmed.startsWith('v') ? trimmed.slice(1) : trimmed;
    const candidates = [trimmed, `v${normalized}`, normalized];
    return [...new Set(candidates.filter(candidate => candidate.length > 0))];
  }

  private async resolveConnectedApiVersion(): Promise<string | undefined> {
    try {
      const edaClient = serviceManager.getClient<EdaClient>('eda');
      if (typeof (edaClient as unknown as { waitForInit?: () => Promise<void> }).waitForInit === 'function') {
        await (edaClient as unknown as { waitForInit: () => Promise<void> }).waitForInit();
      }
      const version = typeof edaClient.getApiVersion === 'function'
        ? edaClient.getApiVersion()
        : undefined;
      if (typeof version === 'string' && version.trim().length > 0 && version !== 'unknown') {
        return version.trim();
      }
    } catch {
      // ignore and use fallback selection
    }
    return undefined;
  }

  private async loadSchemas(): Promise<void> {
    this.schemaCache.clear();
    this.clusterSchemaCache.clear();
    this.resolvedSchemaCache.clear();
    this.resolvedSchemaByResourceCache.clear();
    this.resolvedSchemaPriority.clear();
    this.resolvedSchemaByResourcePriority.clear();
    this.kindApiVersionMap.clear();
    this.customResourceDefinitionsCache = undefined;
    this.customResourceDefinitionsPromise = undefined;
    if (!fs.existsSync(this.schemaCacheDir)) {
      fs.mkdirSync(this.schemaCacheDir, { recursive: true });
    }
    const connectedVersion = await this.resolveConnectedApiVersion();
    const specDir = await this.findSpecDir(connectedVersion);
    await this.scanSpecDir(specDir);
    this.schemaChangedEmitter.fire();
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

  /** Extract kind string from a schema entry */
  private static extractKind(name: string, schema: JsonSchema): string | undefined {
    const kindProperty = schema?.properties?.kind as JsonSchemaProperty | undefined;
    const kind =
      kindProperty?.default ||
      (Array.isArray(kindProperty?.enum) ? kindProperty.enum[0] : undefined) ||
      name.split('.').pop();
    return typeof kind === 'string' ? kind : undefined;
  }

  /** Extract apiVersion string from a schema entry */
  private static extractApiVersion(schema: JsonSchema): string | undefined {
    const prop = schema?.properties?.apiVersion as JsonSchemaProperty | undefined;
    const version = prop?.default ?? (Array.isArray(prop?.enum) ? prop.enum[0] : undefined);
    return typeof version === 'string' ? version : undefined;
  }

  private static makeResourceSchemaKey(apiVersion: string, kind: string): string {
    return `${apiVersion}::${kind}`;
  }

  private cacheResolvedSchema(
    kind: string,
    apiVersion: string | undefined,
    schema: ResolvedJsonSchema,
    priority: number
  ): void {
    const currentKindPriority = this.resolvedSchemaPriority.get(kind);
    if (currentKindPriority === undefined || priority >= currentKindPriority) {
      this.resolvedSchemaCache.set(kind, schema);
      this.resolvedSchemaPriority.set(kind, priority);
    }

    if (!apiVersion) {
      return;
    }

    const resourceKey = SchemaProviderService.makeResourceSchemaKey(apiVersion, kind);
    const currentResourcePriority = this.resolvedSchemaByResourcePriority.get(resourceKey);
    if (currentResourcePriority === undefined || priority >= currentResourcePriority) {
      this.resolvedSchemaByResourceCache.set(resourceKey, schema);
      this.resolvedSchemaByResourcePriority.set(resourceKey, priority);
    }
  }

  private async processSpecFile(file: string): Promise<void> {
    try {
      const content = await fs.promises.readFile(file, UTF8);
      const json = JSON.parse(content) as OpenApiSpec;
      const schemas: Record<string, JsonSchema> = json.components?.schemas ?? {};
      for (const [name, schema] of Object.entries(schemas)) {
        const kind = SchemaProviderService.extractKind(name, schema);
        if (!kind) continue;
        const apiVersion = SchemaProviderService.extractApiVersion(schema);
        const schemaPriority = this.getSchemaQualityPriority(schema);

        await this.cacheSchema(kind, schema);

        // Resolve $refs and cache the resolved schema in memory for sync access
        const resolved = SchemaProviderService.resolveSchemaRefs(
          schema as Record<string, unknown>,
          schemas as Record<string, Record<string, unknown>>
        ) as ResolvedJsonSchema;
        this.cacheResolvedSchema(kind, apiVersion, resolved, schemaPriority);

        // Track apiVersion from schema
        if (apiVersion) {
          this.kindApiVersionMap.set(kind, apiVersion);
        }
      }
    } catch (err) {
      log(`Failed to load schema from ${file}: ${err}`, LogLevel.WARN);
    }
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
    const specFiles: string[] = [];
    try {
      const categories = await fs.promises.readdir(specDir, { withFileTypes: true });
      for (const cat of categories) {
        if (!cat.isDirectory()) continue;
        const catDir = path.join(specDir, cat.name);
        const files = await fs.promises.readdir(catDir);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          specFiles.push(path.join(catDir, file));
        }
      }
      const batches = await Promise.all(specFiles.map(specPath => this.loadCrdsFromSpecFile(specPath)));
      return batches.flat();
    } catch (err) {
      log(`Failed to load CRD definitions: ${err}`, LogLevel.WARN);
    }
    return [];
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
      const cached = k8sClient.getCachedCrds();
      const crds = (
        cached.length > 0
          ? cached
          : await k8sClient.listCrds()
      ) as K8sCrd[];
      for (const crd of crds) {
        const extracted = this.extractCrdFromK8s(crd);
        if (!extracted) continue;
        const { schema, ...crdData } = extracted;
        const key = `${crdData.group}/${crdData.kind}`;
        if (existing.has(key)) continue;
        existing.add(key);
        if (schema) {
          this.clusterSchemaCache.set(crdData.kind, schema);
        }
        results.push(crdData);
      }
    } catch (err) {
      log(`Failed to load Kubernetes CRDs: ${err}`, LogLevel.DEBUG);
    }
    return results;
  }

  private static cloneCrdDefinitions(definitions: EdaCrd[]): EdaCrd[] {
    return definitions.map(def => ({ ...def }));
  }

  /** Return CRD metadata discovered from cached OpenAPI specs */
  public async getCustomResourceDefinitions(forceRefresh = false): Promise<EdaCrd[]> {
    if (!forceRefresh && this.customResourceDefinitionsCache) {
      return SchemaProviderService.cloneCrdDefinitions(this.customResourceDefinitionsCache);
    }
    if (!forceRefresh && this.customResourceDefinitionsPromise) {
      const shared = await this.customResourceDefinitionsPromise;
      return SchemaProviderService.cloneCrdDefinitions(shared);
    }

    const loader = (async (): Promise<EdaCrd[]> => {
      const specDir = await this.findSpecDir();
      const results = await this.loadCrdsFromSpecs(specDir);
      const existing = new Set(results.map(r => `${r.group}/${r.kind}`));
      const clusterCrds = await this.loadCrdsFromCluster(existing);
      results.push(...clusterCrds);
      results.sort((a, b) => a.kind.localeCompare(b.kind));
      return results;
    })();
    this.customResourceDefinitionsPromise = loader;

    try {
      const loaded = await loader;
      this.customResourceDefinitionsCache = loaded;
      return SchemaProviderService.cloneCrdDefinitions(loaded);
    } finally {
      this.customResourceDefinitionsPromise = undefined;
    }
  }

  private getClusterSchemaForKind(kind: string): JsonSchema | null {
    return this.clusterSchemaCache.get(kind) ?? null;
  }

  /** Get JSON schema for a given resource kind */
  public async getSchemaForKind(kind: string): Promise<JsonSchema | null> {
    const clusterSchema = this.getClusterSchemaForKind(kind);
    if (clusterSchema) {
      return clusterSchema;
    }

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

  /**
   * Get a fully-resolved schema for a kind (sync, from in-memory cache).
   * Returns null if the kind is not known.
   */
  public getResolvedSchemaForKindSync(kind: string): ResolvedJsonSchema | null {
    return this.resolvedSchemaCache.get(kind) ?? null;
  }

  /**
   * Get a fully-resolved schema for an apiVersion+kind resource.
   * Falls back to kind-only lookup if no exact apiVersion match exists.
   */
  public getResolvedSchemaForResourceSync(
    kind: string,
    apiVersion: string | undefined
  ): ResolvedJsonSchema | null {
    const normalizedApiVersion = apiVersion?.trim();
    if (normalizedApiVersion) {
      const resourceKey = SchemaProviderService.makeResourceSchemaKey(normalizedApiVersion, kind);
      const exact = this.resolvedSchemaByResourceCache.get(resourceKey);
      if (exact) {
        return exact;
      }
    }
    return this.getResolvedSchemaForKindSync(kind);
  }

  /** Get all known resource kind names (sorted) */
  public getAvailableKinds(): string[] {
    return Array.from(this.resolvedSchemaCache.keys()).sort();
  }

  /** Get all known apiVersion strings (deduplicated, sorted) */
  public getAvailableApiVersions(): string[] {
    return [...new Set(this.kindApiVersionMap.values())].sort();
  }

  /**
   * Recursively resolve $ref pointers in a schema object.
   * Uses cycle detection via a visited Set to prevent infinite loops.
   */
  private static resolveSchemaRefs(
    schema: Record<string, unknown>,
    allSchemas: Record<string, Record<string, unknown>>,
    visited?: Set<string>
  ): Record<string, unknown> {
    const seen = visited ?? new Set<string>();

    // Handle $ref
    if (typeof schema.$ref === 'string') {
      const refPath = schema.$ref as string;
      // Extract schema name from "#/components/schemas/Name"
      const refName = refPath.replace('#/components/schemas/', '');
      if (seen.has(refName)) {
        // Cycle detected - return empty object to break the loop
        return {};
      }
      const target = allSchemas[refName];
      if (target) {
        seen.add(refName);
        const resolved = SchemaProviderService.resolveSchemaRefs(target, allSchemas, seen);
        seen.delete(refName);
        return resolved;
      }
      return {};
    }

    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(schema)) {
      if (key === '$ref') continue;

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = SchemaProviderService.resolveSchemaRefs(
          value as Record<string, unknown>,
          allSchemas,
          seen
        );
      } else if (Array.isArray(value)) {
        result[key] = value.map(item => {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            return SchemaProviderService.resolveSchemaRefs(
              item as Record<string, unknown>,
              allSchemas,
              seen
            );
          }
          return item;
        });
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  public override dispose(): void {
    this.schemaChangedEmitter.dispose();
    super.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
