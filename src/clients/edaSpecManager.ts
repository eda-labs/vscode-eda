import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { LogLevel, log } from '../extension';

import type { EdaApiClient } from './edaApiClient';
import type { StreamEndpoint } from './edaStreamClient';

// Constants for repeated strings
const SERVER_RELATIVE_URL = 'serverRelativeURL';
const OPERATION_ID = 'operationId';
const X_EDA_NOKIA_COM = 'x-eda-nokia-com';
const NAMESPACE_PARAM_PATTERN = /^(namespace|nsname)$/i;
const CRD_PATH_PATTERN = /^\/apps\/([^/]+)\/([^/]+)(?:\/namespaces\/\{[^}]+\})?\/([^/]+)$/;
const GENERATE_SPEC_TYPES = process.env.EDA_GENERATE_SPEC_TYPES === 'true';
const JSON_CONTENT_TYPE = 'application/json';

type OpenApiTypescriptRuntime = {
  default: (source: never) => Promise<unknown>;
  COMMENT_HEADER: string;
  astToString: (ast: unknown) => string;
};

/**
 * Resolve the on-disk spec cache directory for an EDA endpoint. Specs are keyed
 * by endpoint host so that two endpoints running the same EDA version cannot
 * pollute each other's cached specs.
 */
export function specCacheBaseDirForUrl(baseUrl?: string): string {
  const root = path.join(os.homedir(), '.eda', 'vscode');
  if (!baseUrl) {
    return root;
  }
  try {
    const host = new URL(baseUrl).host.replace(/[^a-zA-Z0-9.-]/g, '_');
    return host ? path.join(root, host) : root;
  } catch {
    return root;
  }
}

export interface EdaResourceRoute {
  group: string;
  version: string;
  kind: string;
  plural: string;
  namespaced: boolean;
  collectionPath?: string;
  namespacedCollectionPath?: string;
  readPath?: string;
  namespacedReadPath?: string;
  createPath?: string;
  namespacedCreatePath?: string;
  updatePath?: string;
  namespacedUpdatePath?: string;
  deletePath?: string;
  namespacedDeletePath?: string;
  workflowCollectionPath?: string;
  workflowNamespacedCollectionPath?: string;
  workflowReadPath?: string;
  workflowNamespacedReadPath?: string;
  workflowCreatePath?: string;
  workflowNamespacedCreatePath?: string;
  workflowInputPath?: string;
  workflowNamespacedInputPath?: string;
}

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

interface OpenApiMediaType {
  schema?: unknown;
}

interface OpenApiRequestBody {
  content?: Record<string, OpenApiMediaType | undefined>;
}

interface OpenApiResponse {
  content?: Record<string, OpenApiMediaType | undefined>;
}

interface OpenApiOperation {
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiResponse | undefined>;
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
  components?: {
    schemas?: Record<string, unknown>;
  };
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

interface ResourcePathInfo {
  source: 'app' | 'workflow';
  group: string;
  version: string;
  plural: string;
  namespaced: boolean;
  collection: boolean;
  item: boolean;
  input: boolean;
}

interface ResourceIdentity {
  group: string;
  version: string;
  kind: string;
  plural: string;
}

interface ResourceRouteCandidate {
  pathTemplate: string;
  pathInfo: ResourcePathInfo;
  method: string;
}

/**
 * Manager for EDA OpenAPI specifications
 */
export class EdaSpecManager {
  private apiVersion = 'unknown';
  private streamEndpoints: StreamEndpoint[] = [];
  private streamUiCategories: Record<string, string> = {};
  private namespaceSet: Set<string> = new Set();
  private operationMap: Map<string, string> = new Map();
  private resourceRoutes: Map<string, EdaResourceRoute> = new Map();
  private resourceRoutesByPlural: Map<string, EdaResourceRoute> = new Map();
  private resourceRoutesByGroupKind: Map<string, EdaResourceRoute> = new Map();
  private cacheBaseDir: string;
  private initPromise: Promise<void> = Promise.resolve();
  private apiClient: EdaApiClient;
  private coreNamespace: string;
  private backgroundSpecRefreshInFlight = false;

  constructor(apiClient: EdaApiClient, coreNamespace = 'eda-system', baseUrl?: string) {
    this.apiClient = apiClient;
    this.coreNamespace = coreNamespace;
    this.cacheBaseDir = specCacheBaseDirForUrl(baseUrl);
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
   * Get stream names mapped to UI categories.
   */
  public async getStreamUiCategories(): Promise<Record<string, string>> {
    await this.initPromise;
    return { ...this.streamUiCategories };
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

  public async getResourceRoute(group: string, version: string, kind: string): Promise<EdaResourceRoute | undefined> {
    await this.initPromise;
    return this.cloneRoute(this.resourceRoutes.get(this.resourceRouteKey(group, version, kind)));
  }

  public async getResourceRouteByPlural(
    group: string,
    version: string,
    plural: string
  ): Promise<EdaResourceRoute | undefined> {
    await this.initPromise;
    return this.cloneRoute(this.resourceRoutesByPlural.get(this.resourcePluralKey(group, version, plural)));
  }

  public async getResourceRouteByGroupKind(group: string, kind: string): Promise<EdaResourceRoute | undefined> {
    await this.initPromise;
    return this.cloneRoute(this.resourceRoutesByGroupKind.get(this.resourceGroupKindKey(group, kind)));
  }

  private cloneRoute(route: EdaResourceRoute | undefined): EdaResourceRoute | undefined {
    return route ? { ...route } : undefined;
  }

  private resourceRouteKey(group: string, version: string, kind: string): string {
    return `${group}/${version}/${kind}`.toLowerCase();
  }

  private resourcePluralKey(group: string, version: string, plural: string): string {
    return `${group}/${version}/${plural}`.toLowerCase();
  }

  private resourceGroupKindKey(group: string, kind: string): string {
    return `${group}/${kind}`.toLowerCase();
  }

  private compareVersions(left: string, right: string): number {
    const parse = (value: string): { numbers: number[]; qualifier: string } => {
      const normalized = value.trim().replace(/^v/i, '');
      const match = /^(\d+(?:\.\d+)*)(.*)$/.exec(normalized);
      if (!match) {
        return { numbers: [], qualifier: normalized.toLowerCase() };
      }
      return {
        numbers: match[1].split('.').map(part => Number.parseInt(part, 10)),
        qualifier: match[2].toLowerCase()
      };
    };

    const leftVersion = parse(left);
    const rightVersion = parse(right);
    const maxLength = Math.max(leftVersion.numbers.length, rightVersion.numbers.length);
    for (let index = 0; index < maxLength; index += 1) {
      const leftPart = leftVersion.numbers[index] ?? 0;
      const rightPart = rightVersion.numbers[index] ?? 0;
      if (leftPart !== rightPart) {
        return leftPart - rightPart;
      }
    }
    if (leftVersion.qualifier !== rightVersion.qualifier) {
      if (!leftVersion.qualifier) {
        return 1;
      }
      if (!rightVersion.qualifier) {
        return -1;
      }
      return leftVersion.qualifier.localeCompare(rightVersion.qualifier);
    }
    return left.localeCompare(right);
  }

  private async initializeSpecs(): Promise<void> {
    log('Initializing API specs...', LogLevel.INFO);
    try {
      this.operationMap.clear();
      this.resourceRoutes.clear();
      this.resourceRoutesByPlural.clear();
      this.resourceRoutesByGroupKind.clear();
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
      this.collectSpecMetadata(coreSpec);
      const nsPath = this.findPathByOperationId(coreSpec, 'accessGetNamespaces');
      const versionPath = this.findPathByOperationId(coreSpec, 'versionGet');
      this.apiVersion = await this.fetchVersion(versionPath);

      const namespaceFetch = this.apiClient.fetchJsonUrl(`${baseUrl}${nsPath}`) as Promise<NamespaceGetResponse>;
      let endpoints = await this.loadCachedEndpointsAndOperations(this.apiVersion);
      if (endpoints.length > 0) {
        log(`Loaded API specs for version ${this.apiVersion} from local cache`, LogLevel.INFO);
        void this.refreshSpecsInBackground(apiRoot, this.apiVersion);
      } else {
        endpoints = await this.fetchAndWriteAllSpecs(apiRoot, this.apiVersion);
        log(`Fetched API specs for version ${this.apiVersion}`, LogLevel.INFO);
      }
      this.streamEndpoints = this.deduplicateEndpoints(endpoints);
      this.streamUiCategories = await this.loadStreamUiCategories(this.streamEndpoints);
      log(`Discovered ${this.streamEndpoints.length} stream endpoints`, LogLevel.DEBUG);

      // Prime namespace set
      const ns = await namespaceFetch;
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

  private parseUiCategoryResource(resource: unknown): { nameKey: string; category: string } | undefined {
    if (!resource || typeof resource !== 'object') {
      return undefined;
    }
    const typedResource = resource as Record<string, unknown>;
    const name = typeof typedResource.name === 'string' ? typedResource.name.trim() : '';
    if (!name) {
      return undefined;
    }
    const uiCategory =
      (typeof typedResource.uiCategory === 'string' && typedResource.uiCategory.trim())
      || (typeof typedResource['ui-category'] === 'string' && typedResource['ui-category'].trim())
      || '';
    if (!uiCategory) {
      return undefined;
    }
    return {
      nameKey: name.toLowerCase(),
      category: uiCategory
    };
  }

  private extractUiCategoriesFromResources(resources: unknown): Record<string, string> {
    if (!Array.isArray(resources)) {
      return {};
    }
    const categories: Record<string, string> = {};
    for (const resource of resources) {
      const entry = this.parseUiCategoryResource(resource);
      if (!entry) {
        continue;
      }
      categories[entry.nameKey] = entry.category;
    }
    return categories;
  }

  private async fetchAppResourceUiCategories(group: string, version: string): Promise<Record<string, string>> {
    const paths = [
      `/apps/${group}/${version}`,
      `/apis/${group}/${version}`
    ];

    for (const pathCandidate of paths) {
      try {
        const payload = await this.apiClient.fetchJSON<{ resources?: unknown }>(pathCandidate);
        const categories = this.extractUiCategoriesFromResources(payload?.resources);
        if (Object.keys(categories).length > 0) {
          return categories;
        }
      } catch {
        // Ignore category lookup failures and continue best-effort.
      }
    }

    return {};
  }

  private async loadStreamUiCategories(endpoints: StreamEndpoint[]): Promise<Record<string, string>> {
    const appVersions = new Set<string>();
    for (const endpoint of endpoints) {
      const match = CRD_PATH_PATTERN.exec(endpoint.path);
      if (!match) {
        continue;
      }
      const [, group, version] = match;
      appVersions.add(`${group}|${version}`);
    }

    const categoriesByPlural = new Map<string, string>();
    const sortedAppVersions = Array.from(appVersions).sort((a, b) => a.localeCompare(b));
    for (const value of sortedAppVersions) {
      const separator = value.indexOf('|');
      if (separator <= 0 || separator >= value.length - 1) {
        continue;
      }
      const group = value.slice(0, separator);
      const version = value.slice(separator + 1);
      const fetched = await this.fetchAppResourceUiCategories(group, version);
      for (const [nameKey, category] of Object.entries(fetched)) {
        if (!categoriesByPlural.has(nameKey)) {
          categoriesByPlural.set(nameKey, category);
        }
      }
    }

    const streamCategories: Record<string, string> = {};
    for (const endpoint of endpoints) {
      const match = CRD_PATH_PATTERN.exec(endpoint.path);
      const plural = match?.[3];
      const candidateName = typeof plural === 'string' && plural.length > 0 ? plural : endpoint.stream;
      const category = categoriesByPlural.get(candidateName.toLowerCase());
      if (typeof category === 'string' && category.length > 0) {
        streamCategories[endpoint.stream] = category;
      }
    }
    return streamCategories;
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

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private refName(ref: string | undefined): string | undefined {
    if (!ref) {
      return undefined;
    }
    const marker = '#/components/schemas/';
    const markerIndex = ref.indexOf(marker);
    return markerIndex >= 0 ? ref.slice(markerIndex + marker.length) : ref.split('/').pop();
  }

  private schemaRef(schema: unknown): string | undefined {
    return this.isRecord(schema) && typeof schema.$ref === 'string' ? schema.$ref : undefined;
  }

  private schemaByRef(spec: OpenApiSpec, ref: string | undefined): Record<string, unknown> | undefined {
    const name = this.refName(ref);
    const schemas = this.isRecord(spec.components?.schemas)
      ? spec.components.schemas as Record<string, unknown>
      : {};
    const schema = name ? schemas[name] : undefined;
    return this.isRecord(schema) ? schema : undefined;
  }

  private schemaPropertyString(schema: Record<string, unknown>, propertyName: string): string | undefined {
    const properties = this.isRecord(schema.properties) ? schema.properties : {};
    const property = properties[propertyName];
    if (!this.isRecord(property)) {
      return undefined;
    }
    if (typeof property.default === 'string') {
      return property.default;
    }
    if (Array.isArray(property.enum) && typeof property.enum[0] === 'string') {
      return property.enum[0];
    }
    return undefined;
  }

  private listItemRef(schema: Record<string, unknown>): string | undefined {
    const properties = this.isRecord(schema.properties) ? schema.properties : {};
    const itemsProperty = properties.items;
    if (!this.isRecord(itemsProperty)) {
      return undefined;
    }
    const items = itemsProperty.items;
    return this.schemaRef(items);
  }

  private identityFromSchema(
    spec: OpenApiSpec,
    group: string,
    version: string,
    plural: string,
    schemaRef: string | undefined
  ): ResourceIdentity | undefined {
    let schema = this.schemaByRef(spec, schemaRef);
    if (!schema) {
      return undefined;
    }

    const itemRef = this.listItemRef(schema);
    if (itemRef) {
      schema = this.schemaByRef(spec, itemRef);
    }
    if (!schema) {
      return undefined;
    }

    const kind = this.schemaPropertyString(schema, 'kind');
    const apiVersion = this.schemaPropertyString(schema, 'apiVersion');
    if (!kind || apiVersion !== `${group}/${version}`) {
      return undefined;
    }

    return { group, version, kind, plural };
  }

  private requestBodyRef(operation: OpenApiOperation | undefined): string | undefined {
    const content = operation?.requestBody?.content;
    return this.schemaRef(content?.[JSON_CONTENT_TYPE]?.schema);
  }

  private responseRef(operation: OpenApiOperation | undefined): string | undefined {
    const responses = operation?.responses;
    if (!responses) {
      return undefined;
    }
    const preferredResponses = [
      responses['200'],
      responses['201'],
      responses.default,
      ...Object.values(responses)
    ];
    for (const response of preferredResponses) {
      const ref = this.schemaRef(response?.content?.[JSON_CONTENT_TYPE]?.schema);
      if (ref) {
        return ref;
      }
    }
    return undefined;
  }

  private identityFromOperation(
    spec: OpenApiSpec,
    pathInfo: ResourcePathInfo,
    operation: OpenApiOperation | undefined
  ): ResourceIdentity | undefined {
    const refs = [
      this.requestBodyRef(operation),
      this.responseRef(operation)
    ];
    for (const ref of refs) {
      const identity = this.identityFromSchema(
        spec,
        pathInfo.group,
        pathInfo.version,
        pathInfo.plural,
        ref
      );
      if (identity) {
        return identity;
      }
    }
    return undefined;
  }

  private isPlaceholder(segment: string | undefined): boolean {
    return typeof segment === 'string' && segment.startsWith('{') && segment.endsWith('}');
  }

  private parseResourcePath(pathTemplate: string): ResourcePathInfo | undefined {
    const parts = pathTemplate.split('/').filter(Boolean);
    if (parts[0] === 'apps') {
      return this.parseResourcePathTail('app', parts.slice(1));
    }
    if (parts[0] === 'workflows' && parts[1] === 'v1') {
      return this.parseResourcePathTail('workflow', parts.slice(2));
    }
    return undefined;
  }

  private parseResourcePathTail(
    source: 'app' | 'workflow',
    parts: string[]
  ): ResourcePathInfo | undefined {
    const [group, version] = parts;
    if (!group || !version) {
      return undefined;
    }

    let rest = parts.slice(2);
    let namespaced = false;
    if (rest[0] === 'namespaces' && this.isPlaceholder(rest[1]) && rest.length >= 3) {
      namespaced = true;
      rest = rest.slice(2);
    }

    const [plural, ...tail] = rest;
    if (!plural || plural.startsWith('_')) {
      return undefined;
    }

    if (tail.length === 0) {
      return { source, group, version, plural, namespaced, collection: true, item: false, input: false };
    }

    if (tail.length === 1 && this.isPlaceholder(tail[0])) {
      return { source, group, version, plural, namespaced, collection: false, item: true, input: false };
    }

    if (source === 'workflow' && tail.length === 2 && this.isPlaceholder(tail[0]) && tail[1] === '_input') {
      return { source, group, version, plural, namespaced, collection: false, item: false, input: true };
    }

    return undefined;
  }

  private routeForIdentity(identity: ResourceIdentity): EdaResourceRoute {
    const key = this.resourceRouteKey(identity.group, identity.version, identity.kind);
    let route = this.resourceRoutes.get(key);
    if (!route) {
      route = {
        group: identity.group,
        version: identity.version,
        kind: identity.kind,
        plural: identity.plural,
        namespaced: false
      };
      this.resourceRoutes.set(key, route);
    }

    route.plural = identity.plural;
    this.resourceRoutesByPlural.set(
      this.resourcePluralKey(identity.group, identity.version, identity.plural),
      route
    );

    const groupKindKey = this.resourceGroupKindKey(identity.group, identity.kind);
    const existingGroupKind = this.resourceRoutesByGroupKind.get(groupKindKey);
    if (!existingGroupKind || this.compareVersions(route.version, existingGroupKind.version) >= 0) {
      this.resourceRoutesByGroupKind.set(groupKindKey, route);
    }

    return route;
  }

  private updateResourceRoute(
    identity: ResourceIdentity,
    pathInfo: ResourcePathInfo,
    method: string,
    pathTemplate: string
  ): void {
    const route = this.routeForIdentity(identity);
    route.namespaced = route.namespaced || pathInfo.namespaced;

    if (pathInfo.source === 'workflow') {
      this.updateWorkflowRoute(route, pathInfo, method, pathTemplate);
      return;
    }

    this.updateAppRoute(route, pathInfo, method, pathTemplate);
  }

  private updateAppRoute(
    route: EdaResourceRoute,
    pathInfo: ResourcePathInfo,
    method: string,
    pathTemplate: string
  ): void {
    if (pathInfo.collection) {
      if (method === 'get') {
        if (pathInfo.namespaced) route.namespacedCollectionPath = pathTemplate;
        else route.collectionPath = pathTemplate;
      } else if (method === 'post') {
        if (pathInfo.namespaced) route.namespacedCreatePath = pathTemplate;
        else route.createPath = pathTemplate;
      }
      return;
    }

    if (!pathInfo.item) {
      return;
    }
    if (method === 'get') {
      if (pathInfo.namespaced) route.namespacedReadPath = pathTemplate;
      else route.readPath = pathTemplate;
    } else if (method === 'put' || method === 'patch') {
      if (pathInfo.namespaced) route.namespacedUpdatePath = pathTemplate;
      else route.updatePath = pathTemplate;
    } else if (method === 'delete') {
      if (pathInfo.namespaced) route.namespacedDeletePath = pathTemplate;
      else route.deletePath = pathTemplate;
    }
  }

  private updateWorkflowRoute(
    route: EdaResourceRoute,
    pathInfo: ResourcePathInfo,
    method: string,
    pathTemplate: string
  ): void {
    if (pathInfo.collection) {
      if (method === 'get') {
        if (pathInfo.namespaced) route.workflowNamespacedCollectionPath = pathTemplate;
        else route.workflowCollectionPath = pathTemplate;
      } else if (method === 'post') {
        if (pathInfo.namespaced) route.workflowNamespacedCreatePath = pathTemplate;
        else route.workflowCreatePath = pathTemplate;
      }
      return;
    }

    if (pathInfo.item && method === 'get') {
      if (pathInfo.namespaced) route.workflowNamespacedReadPath = pathTemplate;
      else route.workflowReadPath = pathTemplate;
      return;
    }

    if (pathInfo.input && (method === 'get' || method === 'put')) {
      if (pathInfo.namespaced) route.workflowNamespacedInputPath = pathTemplate;
      else route.workflowInputPath = pathTemplate;
    }
  }

  private collectResourceRoutes(spec: OpenApiSpec): void {
    const deferred: ResourceRouteCandidate[] = [];
    const paths = spec.paths ?? {};
    for (const [pathTemplate, methods] of Object.entries(paths)) {
      const pathInfo = this.parseResourcePath(pathTemplate);
      if (!pathInfo) {
        continue;
      }

      for (const [method, operation] of Object.entries(methods)) {
        if (!operation) {
          continue;
        }
        const identity = this.identityFromOperation(spec, pathInfo, operation);
        if (!identity) {
          deferred.push({ pathTemplate, pathInfo, method });
          continue;
        }
        this.updateResourceRoute(identity, pathInfo, method, pathTemplate);
      }
    }

    for (const { pathTemplate, pathInfo, method } of deferred) {
      const identity = this.identityFromExistingRoute(pathInfo);
      if (!identity) {
        continue;
      }
      this.updateResourceRoute(identity, pathInfo, method, pathTemplate);
    }
  }

  private identityFromExistingRoute(pathInfo: ResourcePathInfo): ResourceIdentity | undefined {
    const route = this.resourceRoutesByPlural.get(
      this.resourcePluralKey(pathInfo.group, pathInfo.version, pathInfo.plural)
    );
    if (!route) {
      return undefined;
    }
    return {
      group: route.group,
      version: route.version,
      kind: route.kind,
      plural: route.plural
    };
  }

  private collectSpecMetadata(spec: OpenApiSpec): StreamEndpoint[] {
    this.collectOperationPaths(spec);
    this.collectResourceRoutes(spec);
    return this.collectStreamEndpoints(spec);
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

    if (!GENERATE_SPEC_TYPES) {
      return;
    }

    try {
      const openapiModule = await import('openapi-typescript') as unknown as OpenApiTypescriptRuntime;
      const tsAst = await openapiModule.default(spec as never);
      const ts = openapiModule.COMMENT_HEADER + openapiModule.astToString(tsAst);
      const dtsPath = path.join(versionDir, `${name}.d.ts`);
      await fs.promises.writeFile(dtsPath, ts);
    } catch (err) {
      log(`Failed to generate type definitions for spec '${name}': ${err}`, LogLevel.DEBUG);
    }
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
      all.push(...this.collectSpecMetadata(spec));
    }
    return all;
  }

  private async collectCachedSpecFiles(version: string): Promise<string[]> {
    const versionDir = path.join(this.cacheBaseDir, version);
    if (!fs.existsSync(versionDir)) {
      return [];
    }

    const files: string[] = [];
    const stack: string[] = [versionDir];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      let entries: fs.Dirent[] = [];
      try {
        entries = await fs.promises.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (entry.isFile() && entry.name.endsWith('.json')) {
          files.push(fullPath);
        }
      }
    }
    return files;
  }

  private async loadCachedEndpointsAndOperations(version: string): Promise<StreamEndpoint[]> {
    const cachedSpecFiles = await this.collectCachedSpecFiles(version);
    if (cachedSpecFiles.length === 0) {
      return [];
    }

    const all: StreamEndpoint[] = [];
    for (const cachedSpec of cachedSpecFiles) {
      try {
        const raw = await fs.promises.readFile(cachedSpec, 'utf8');
        const spec = JSON.parse(raw) as OpenApiSpec;
        all.push(...this.collectSpecMetadata(spec));
      } catch (err) {
        log(`Skipping unreadable cached spec '${cachedSpec}': ${err}`, LogLevel.DEBUG);
      }
    }
    return all;
  }

  private async refreshSpecsInBackground(apiRoot: ApiRootSpec, version: string): Promise<void> {
    if (this.backgroundSpecRefreshInFlight) {
      return;
    }
    this.backgroundSpecRefreshInFlight = true;
    try {
      const endpoints = await this.fetchAndWriteAllSpecs(apiRoot, version);
      if (endpoints.length > 0) {
        this.streamEndpoints = this.deduplicateEndpoints(endpoints);
        this.streamUiCategories = await this.loadStreamUiCategories(this.streamEndpoints);
      }
      log(`Background API spec refresh complete for version ${version}`, LogLevel.DEBUG);
    } catch (err) {
      log(`Background API spec refresh failed: ${err}`, LogLevel.DEBUG);
    } finally {
      this.backgroundSpecRefreshInFlight = false;
    }
  }
}
