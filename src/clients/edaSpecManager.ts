import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import openapiTS, { astToString, COMMENT_HEADER, type OpenAPI3 } from 'openapi-typescript';

import { LogLevel, log } from '../extension';

import type { EdaApiClient } from './edaApiClient';
import type { StreamEndpoint } from './edaStreamClient';

// Constants for repeated strings
const SERVER_RELATIVE_URL = 'serverRelativeURL';
const OPERATION_ID = 'operationId';
const X_EDA_NOKIA_COM = 'x-eda-nokia-com';
const NAMESPACE_PARAM_PATTERN = /^(namespace|nsname)$/i;

interface NamespaceData {
  name?: string;
  description?: string;
}

interface NamespaceGetResponse {
  allNamesapces?: boolean;
  namespaces?: NamespaceData[];
}

// OpenAPI spec types
interface OpenApiParameter {
  name: string;
  required?: boolean;
  in?: string;
  schema?: unknown;
}

interface OpenApiOperation {
  operationId?: string;
  parameters?: OpenApiParameter[];
  responses?: Record<string, unknown>;
  tags?: string[];
}

interface OpenApiPathItem {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  delete?: OpenApiOperation;
  patch?: OpenApiOperation;
  [key: string]: OpenApiOperation | undefined;
}

interface OpenApiSpec {
  paths?: Record<string, OpenApiPathItem>;
  components?: Record<string, unknown>;
  info?: {
    title?: string;
    version?: string;
  };
}

// API root path info (with optional serverRelativeURL or x-eda-nokia-com extension)
interface ApiRootPathInfo {
  serverRelativeURL?: string;
  [X_EDA_NOKIA_COM]?: {
    serverRelativeURL?: string;
  };
}

interface ApiRootSpec {
  paths?: Record<string, ApiRootPathInfo>;
}

interface VersionResponse {
  eda?: {
    version?: string;
  };
}

/**
 * Manager for EDA OpenAPI specifications
 */
export class EdaSpecManager {
  private apiVersion = 'unknown';
  private streamEndpoints: StreamEndpoint[] = [];
  private namespaceSet: Set<string> = new Set();
  private operationMap: Map<string, string> = new Map();
  private cacheBaseDir = path.join(os.homedir(), '.eda', 'vscode');
  private initPromise: Promise<void> = Promise.resolve();
  private apiClient: EdaApiClient;
  private coreNamespace: string;

  constructor(apiClient: EdaApiClient, coreNamespace = 'eda-system') {
    this.apiClient = apiClient;
    this.coreNamespace = coreNamespace;
    log('EdaSpecManager initialized', LogLevel.DEBUG);
  }

  /**
   * Start async initialization. Call this after construction.
   */
  public startInitialization(): void {
    this.initPromise = this.initializeSpecs();
  }

  /**
   * Wait for spec initialization to complete
   */
  public async waitForInit(): Promise<void> {
    await this.initPromise;
  }

  /**
   * Get discovered stream endpoints
   */
  public getStreamEndpoints(): StreamEndpoint[] {
    return this.streamEndpoints;
  }

  /**
   * Get API version
   */
  public getApiVersion(): string {
    return this.apiVersion;
  }

  public getCoreNamespace(): string {
    return this.coreNamespace;
  }

  /**
   * Get cached namespaces
   */
  public getCachedNamespaces(): string[] {
    return Array.from(this.namespaceSet);
  }

  /**
   * Update cached namespaces
   */
  public setCachedNamespaces(names: string[]): void {
    this.namespaceSet = new Set(names);
  }

  /**
   * Get unique stream names
   */
  public async getStreamNames(): Promise<string[]> {
    await this.initPromise;
    const names = Array.from(new Set(this.streamEndpoints.map(e => e.stream)));
    names.sort();
    return names;
  }

  /**
   * Get stream names grouped by API source
   */
  public async getStreamGroups(): Promise<Record<string, string[]>> {
    await this.initPromise;
    const groups: Record<string, Set<string>> = {};
    for (const ep of this.streamEndpoints) {
      const { name } = this.parseApiPath(ep.path);
      if (!groups[name]) {
        groups[name] = new Set();
      }
      groups[name].add(ep.stream);
    }
    const result: Record<string, string[]> = {};
    for (const [name, set] of Object.entries(groups)) {
      result[name] = Array.from(set).sort();
    }
    return result;
  }

  /**
   * Look up the API path for the given operationId
   */
  public async getPathByOperationId(opId: string): Promise<string> {
    await this.initPromise;
    const path = this.operationMap.get(opId);
    if (!path) {
      throw new Error(`${OPERATION_ID} '${opId}' not found`);
    }
    return path;
  }

  private async initializeSpecs(): Promise<void> {
    log('Initializing API specs...', LogLevel.INFO);
    try {
      const baseUrl = this.apiClient['authClient'].getBaseUrl();
      const apiRoot = await this.apiClient.fetchJsonUrl(`${baseUrl}/openapi/v3`) as ApiRootSpec;
      const paths = apiRoot.paths ?? {};
      const coreEntry = Object.entries(paths).find(([p]) => /\/core$/.test(p));
      if (!coreEntry) {
        log('core API path not found in root spec', LogLevel.WARN);
        return;
      }
      const relUrl = this.extractServerRelativeURL(coreEntry[1]);
      if (!relUrl) {
        log('core serverRelativeURL not found in root spec', LogLevel.WARN);
        return;
      }
      const coreUrl = `${baseUrl}${relUrl}`;
      const coreSpec = await this.apiClient.fetchJsonUrl(coreUrl) as OpenApiSpec;
      this.collectOperationPaths(coreSpec);
      const nsPath = this.findPathByOperationId(coreSpec, 'accessGetNamespaces');
      const versionPath = this.findPathByOperationId(coreSpec, 'versionGet');
      this.apiVersion = await this.fetchVersion(versionPath);
      const endpoints = await this.fetchAndWriteAllSpecs(apiRoot, this.apiVersion);
      log(`Fetched API specs for version ${this.apiVersion}`, LogLevel.INFO);
      this.streamEndpoints = this.deduplicateEndpoints(endpoints);
      log(`Discovered ${this.streamEndpoints.length} stream endpoints`, LogLevel.DEBUG);

      // Prime namespace set
      const ns = await this.apiClient.fetchJsonUrl(`${baseUrl}${nsPath}`) as NamespaceGetResponse;
      this.namespaceSet = new Set((ns.namespaces || []).map(n => n.name || '').filter(n => n));
      // Always include core namespace
      this.namespaceSet.add(this.coreNamespace);
      log('Spec initialization complete', LogLevel.INFO);
    } catch (err) {
      log(`Failed to initialize specs: ${err}`, LogLevel.WARN);
    }
  }

  private findPathByOperationId(spec: OpenApiSpec, opId: string): string {
    const paths = spec.paths ?? {};
    for (const [p, methods] of Object.entries(paths)) {
      for (const m of Object.values(methods)) {
        if (m && typeof m === 'object' && m.operationId === opId) {
          return p;
        }
      }
    }
    throw new Error(`${OPERATION_ID} '${opId}' not found`);
  }

  private parseApiPath(apiPath: string): { category: string; name: string } {
    const parts = apiPath.split('/').filter(Boolean);
    const category = parts[0] || 'core';
    const nameSeg = category === 'apps' ? parts[1] : category;
    const name = (nameSeg ?? 'core').split('.')[0];
    return { category, name };
  }

  /**
   * Extract serverRelativeURL from an API root path entry.
   * Supports both old and new spec formats.
   */
  private extractServerRelativeURL(info: ApiRootPathInfo): string | undefined {
    if (info && typeof info === 'object') {
      if (typeof info[SERVER_RELATIVE_URL] === 'string') {
        return info[SERVER_RELATIVE_URL];
      }
      const ext = info[X_EDA_NOKIA_COM];
      if (ext && typeof ext[SERVER_RELATIVE_URL] === 'string') {
        return ext[SERVER_RELATIVE_URL];
      }
    }
    return undefined;
  }

  private collectStreamEndpoints(spec: OpenApiSpec): StreamEndpoint[] {
    const eps: StreamEndpoint[] = [];
    const paths = spec.paths ?? {};
    for (const [p, methods] of Object.entries(paths)) {
      const get = methods.get;
      if (!get) continue;
      const params: OpenApiParameter[] = Array.isArray(get.parameters) ? get.parameters : [];
      const names = params.map((prm) => prm.name);
      const requiredParamNames = params
        .filter(prm => prm.required)
        .map(prm => prm.name);
      // Skip endpoints with required parameters (other than eventclient/stream/namespace)
      const hasUnsupportedRequiredParams = requiredParamNames.some((name) =>
        name !== 'eventclient' && name !== 'stream' && !NAMESPACE_PARAM_PATTERN.test(name)
      );
      if (hasUnsupportedRequiredParams) continue;

      const placeholders = this.extractPathPlaceholders(p);
      const hasUnsupportedPlaceholders = placeholders.some((name) => !NAMESPACE_PARAM_PATTERN.test(name));
      if (hasUnsupportedPlaceholders) continue;

      if (names.includes('eventclient') && names.includes('stream')) {
        const stream = p.split('/').filter(Boolean).pop() ?? 'unknown';
        const namespaceParam = placeholders.find(name => NAMESPACE_PARAM_PATTERN.test(name));
        eps.push({
          path: p,
          stream,
          namespaced: placeholders.length > 0,
          namespaceParam
        });
      }
    }
    return eps;
  }

  private extractPathPlaceholders(pathTemplate: string): string[] {
    const placeholders: string[] = [];
    let searchFrom = 0;

    while (searchFrom < pathTemplate.length) {
      const open = pathTemplate.indexOf('{', searchFrom);
      if (open === -1) {
        break;
      }
      const close = pathTemplate.indexOf('}', open + 1);
      if (close === -1) {
        break;
      }
      const name = pathTemplate.slice(open + 1, close).trim();
      if (name) {
        placeholders.push(name);
      }
      searchFrom = close + 1;
    }

    return placeholders;
  }

  /** Collect operationId to path mappings */
  private collectOperationPaths(spec: OpenApiSpec): void {
    const paths = spec.paths ?? {};
    for (const [p, methods] of Object.entries(paths)) {
      for (const m of Object.values(methods)) {
        if (m && typeof m === 'object' && m.operationId) {
          this.operationMap.set(m.operationId, p);
        }
      }
    }
  }

  /** Deduplicate endpoints, preferring namespaced and '/apps' paths */
  private deduplicateEndpoints(endpoints: StreamEndpoint[]): StreamEndpoint[] {
    const result = new Map<string, StreamEndpoint>();
    for (const ep of endpoints) {
      const existing = result.get(ep.stream);
      if (!existing) {
        result.set(ep.stream, ep);
        continue;
      }
      const existingHasPathParams = existing.path.includes('{');
      const endpointHasPathParams = ep.path.includes('{');

      // Prefer namespaced (path-param) variants as all-namespaces
      // endpoints may not return data for all API groups.
      if (!existingHasPathParams && endpointHasPathParams) {
        result.set(ep.stream, ep);
        continue;
      }
      if (existingHasPathParams === endpointHasPathParams
        && !existing.path.startsWith('/apps')
        && ep.path.startsWith('/apps')) {
        result.set(ep.stream, ep);
      }
    }
    return Array.from(result.values());
  }


  private async writeSpecAndTypes(spec: OpenApiSpec, name: string, version: string, category: string): Promise<void> {
    const versionDir = path.join(this.cacheBaseDir, version, category);
    await fs.promises.mkdir(versionDir, { recursive: true });
    const jsonPath = path.join(versionDir, `${name}.json`);
    await fs.promises.writeFile(jsonPath, JSON.stringify(spec, null, 2));

    // Cast to OpenAPI3 since the spec is dynamically fetched and conforms to OpenAPI format
    const tsAst = await openapiTS(spec as unknown as OpenAPI3);
    const ts = COMMENT_HEADER + astToString(tsAst);
    const dtsPath = path.join(versionDir, `${name}.d.ts`);
    await fs.promises.writeFile(dtsPath, ts);
  }

  private async fetchVersion(path: string): Promise<string> {
    const baseUrl = this.apiClient['authClient'].getBaseUrl();
    const url = `${baseUrl}${path}`;
    const data = await this.apiClient.fetchJsonUrl(url) as VersionResponse;
    const full = data?.eda?.version ?? 'unknown';
    const match = /^([^-]+)/.exec(full);
    return match ? match[1] : full;
  }

  private async fetchAndWriteAllSpecs(apiRoot: ApiRootSpec, version: string): Promise<StreamEndpoint[]> {
    const all: StreamEndpoint[] = [];
    const baseUrl = this.apiClient['authClient'].getBaseUrl();
    const paths = apiRoot.paths ?? {};
    for (const [apiPath, info] of Object.entries(paths)) {
      const relUrl = this.extractServerRelativeURL(info);
      if (!relUrl) {
        log(`serverRelativeURL not found for ${apiPath}`, LogLevel.WARN);
        continue;
      }
      const url = `${baseUrl}${relUrl}`;
      log(`Fetching spec ${apiPath} from ${url}`, LogLevel.DEBUG);
      const spec = await this.apiClient.fetchJsonUrl(url) as OpenApiSpec;
      const { category, name } = this.parseApiPath(apiPath);
      await this.writeSpecAndTypes(spec, name, version, category);
      this.collectOperationPaths(spec);
      all.push(...this.collectStreamEndpoints(spec));
    }
    return all;
  }
}
