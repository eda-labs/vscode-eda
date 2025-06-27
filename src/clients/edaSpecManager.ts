import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript';
import { LogLevel, log } from '../extension';
import type { EdaApiClient } from './edaApiClient';
import { StreamEndpoint } from './edaStreamClient';

interface NamespaceData {
  name?: string;
  description?: string;
}

interface NamespaceGetResponse {
  allNamesapces?: boolean;
  namespaces?: NamespaceData[];
}

/**
 * Manager for EDA OpenAPI specifications
 */
export class EdaSpecManager {
  private apiVersion = 'unknown';
  private streamEndpoints: StreamEndpoint[] = [];
  private namespaceSet: Set<string> = new Set();
  private operationMap: Map<string, string> = new Map();
  private initPromise: Promise<void> = Promise.resolve();
  private apiClient: EdaApiClient;

  constructor(apiClient: EdaApiClient) {
    this.apiClient = apiClient;
    log('EdaSpecManager initialized', LogLevel.DEBUG);
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
      throw new Error(`operationId '${opId}' not found`);
    }
    return path;
  }

  private async initializeSpecs(): Promise<void> {
    log('Initializing API specs...', LogLevel.INFO);
    try {
      const baseUrl = this.apiClient['authClient'].getBaseUrl();
      const apiRoot = await this.apiClient.fetchJsonUrl(`${baseUrl}/openapi/v3`);
      const coreEntry = Object.entries<any>(apiRoot.paths ?? {}).find(([p]) => /\/core$/.test(p));
      if (!coreEntry) {
        log('core API path not found in root spec', LogLevel.WARN);
        return;
      }
      const coreUrl = `${baseUrl}${(coreEntry[1] as any).serverRelativeURL}`;
      const coreSpec = await this.apiClient.fetchJsonUrl(coreUrl);
      this.collectOperationPaths(coreSpec);
      const nsPath = this.findPathByOperationId(coreSpec, 'accessGetNamespaces');
      const versionPath = this.findPathByOperationId(coreSpec, 'versionGet');
      this.apiVersion = await this.fetchVersion(versionPath);
      let endpoints = await this.loadCachedSpecs(this.apiVersion);
      if (endpoints.length > 0) {
        log(`Loaded cached API specs for version ${this.apiVersion}`, LogLevel.INFO);
      } else {
        endpoints = await this.fetchAndWriteAllSpecs(apiRoot, this.apiVersion);
      }
      this.streamEndpoints = this.deduplicateEndpoints(endpoints);
      log(`Discovered ${this.streamEndpoints.length} stream endpoints`, LogLevel.DEBUG);

      // Prime namespace set
      const ns = await this.apiClient.fetchJsonUrl(`${baseUrl}${nsPath}`) as NamespaceGetResponse;
      this.namespaceSet = new Set((ns.namespaces || []).map(n => n.name || '').filter(n => n));
      // Always include system namespace
      this.namespaceSet.add('eda-system');
      log('Spec initialization complete', LogLevel.INFO);
    } catch (err) {
      log(`Failed to initialize specs: ${err}`, LogLevel.WARN);
    }
  }

  private findPathByOperationId(spec: any, opId: string): string {
    for (const [p, methods] of Object.entries<any>(spec.paths ?? {})) {
      for (const m of Object.values<any>(methods as any)) {
        if (m && typeof m === 'object' && m.operationId === opId) {
          return p;
        }
      }
    }
    throw new Error(`operationId '${opId}' not found`);
  }

  private parseApiPath(apiPath: string): { category: string; name: string } {
    const parts = apiPath.split('/').filter(Boolean);
    const category = parts[0] || 'core';
    const nameSeg = category === 'apps' ? parts[1] : category;
    const name = (nameSeg ?? 'core').split('.')[0];
    return { category, name };
  }

  private collectStreamEndpoints(spec: any): StreamEndpoint[] {
    const eps: StreamEndpoint[] = [];
    for (const [p, methods] of Object.entries<any>(spec.paths ?? {})) {
      const get = (methods as any).get;
      if (!get) continue;
      const params = Array.isArray(get.parameters) ? get.parameters : [];
      const names = params.map((prm: any) => prm.name);
      if (names.includes('eventclient') && names.includes('stream') && !p.includes('{')) {
        const stream = p.split('/').filter(Boolean).pop() ?? 'unknown';
        eps.push({ path: p, stream });
      }
    }
    return eps;
  }

  /** Collect operationId to path mappings */
  private collectOperationPaths(spec: any): void {
    for (const [p, methods] of Object.entries<any>(spec.paths ?? {})) {
      for (const m of Object.values<any>(methods as any)) {
        if (m && typeof m === 'object' && m.operationId) {
          this.operationMap.set(m.operationId as string, p);
        }
      }
    }
  }

  /** Deduplicate endpoints, preferring '/apps' paths when duplicates exist */
  private deduplicateEndpoints(endpoints: StreamEndpoint[]): StreamEndpoint[] {
    const result = new Map<string, StreamEndpoint>();
    for (const ep of endpoints) {
      const existing = result.get(ep.stream);
      if (!existing) {
        result.set(ep.stream, ep);
        continue;
      }
      if (!existing.path.startsWith('/apps') && ep.path.startsWith('/apps')) {
        result.set(ep.stream, ep);
      }
    }
    return Array.from(result.values());
  }

  private async loadCachedSpecs(version: string): Promise<StreamEndpoint[]> {
    const versionDir = path.join(os.homedir(), '.eda', version);
    const endpoints: StreamEndpoint[] = [];
    try {
      const categories = await fs.promises.readdir(versionDir, { withFileTypes: true });
      for (const cat of categories) {
        if (!cat.isDirectory()) continue;
        const catDir = path.join(versionDir, cat.name);
        const files = await fs.promises.readdir(catDir);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          const specPath = path.join(catDir, file);
          try {
            const raw = await fs.promises.readFile(specPath, 'utf8');
            const spec = JSON.parse(raw);
            this.collectOperationPaths(spec);
            endpoints.push(...this.collectStreamEndpoints(spec));
          } catch (err) {
            log(`Failed to read cached spec ${specPath}: ${err}`, LogLevel.WARN);
          }
        }
      }
    } catch (err) {
      log(`No cached specs found for version ${version}: ${err}`, LogLevel.DEBUG);
    }
    return endpoints;
  }

  private async writeSpecAndTypes(spec: any, name: string, version: string, category: string): Promise<void> {
    const versionDir = path.join(os.homedir(), '.eda', version, category);
    await fs.promises.mkdir(versionDir, { recursive: true });
    const jsonPath = path.join(versionDir, `${name}.json`);
    await fs.promises.writeFile(jsonPath, JSON.stringify(spec, null, 2));

    const tsAst = await openapiTS(spec);
    const ts = COMMENT_HEADER + astToString(tsAst);
    const dtsPath = path.join(versionDir, `${name}.d.ts`);
    await fs.promises.writeFile(dtsPath, ts);
  }

  private async fetchVersion(path: string): Promise<string> {
    const baseUrl = this.apiClient['authClient'].getBaseUrl();
    const url = `${baseUrl}${path}`;
    const data = await this.apiClient.fetchJsonUrl(url);
    const full = (data?.eda?.version as string | undefined) ?? 'unknown';
    const match = full.match(/^([^-]+)/);
    return match ? match[1] : full;
  }

  private async fetchAndWriteAllSpecs(apiRoot: any, version: string): Promise<StreamEndpoint[]> {
    const all: StreamEndpoint[] = [];
    const baseUrl = this.apiClient['authClient'].getBaseUrl();
    for (const [apiPath, info] of Object.entries<any>(apiRoot.paths ?? {})) {
      const url = `${baseUrl}${info.serverRelativeURL}`;
      log(`Fetching spec ${apiPath} from ${url}`, LogLevel.DEBUG);
      const spec = await this.apiClient.fetchJsonUrl(url);
      const { category, name } = this.parseApiPath(apiPath);
      await this.writeSpecAndTypes(spec, name, version, category);
      this.collectOperationPaths(spec);
      all.push(...this.collectStreamEndpoints(spec));
    }
    return all;
  }
}