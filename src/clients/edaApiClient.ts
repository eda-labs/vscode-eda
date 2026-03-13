import { fetch } from 'undici';
import * as yaml from 'js-yaml';

import { LogLevel, log } from '../extension';
import { sanitizeResource } from '../utils/yamlUtils';
import { kindToPlural } from '../utils/pluralUtils';

import type { EdaAuthClient } from './edaAuthClient';
import type { EdaSpecManager } from './edaSpecManager';
import type { StreamEndpoint } from './edaStreamClient';

// Constants for duplicate strings
const MSG_TOKEN_EXPIRED = 'Access token expired, refreshing...';
const MSG_SPEC_NOT_INIT = 'Spec manager not initialized';
const PARAM_NAMESPACE = '{namespace}';
const PARAM_TRANSACTION_ID = '{transactionId}';
const PARAM_NAME = '{name}';
const DB_DATA_PATH = '/core/db/v2/data';
const INDEXER_RESOURCES_PATH = '/core/httpproxy/v1/indexer/resources.txt';
const INDEXER_LABELS_DELIMITER = ' labels=';
const STREAM_NAMESPACE_SEPARATOR = ':';
const DEFAULT_CORE_NAMESPACE = 'eda-system';
const DEFAULT_BOOTSTRAP_PARALLELISM = 8;
const DEFAULT_BOOTSTRAP_NAMESPACE_PARALLELISM = 2;
const CRD_PATH_PATTERN = /^\/apps\/([^/]+)\/([^/]+)(?:\/namespaces\/\{[^}]+\})?\/([^/]+)$/;
const DB_KEY_NAME_PATTERN = /\{\.name=="([^"]+)"\}/g;
const DB_MINIMAL_RESOURCE_FIELDS = 'apiVersion,kind,metadata.name,metadata.namespace';
const CORE_API_GROUP = 'core';

// Type definitions for API responses

/** Kubernetes-style resource with standard metadata */
export interface K8sResource {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    uid?: string;
    resourceVersion?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    [key: string]: unknown;
  };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  [key: string]: unknown;
}

/** List response containing K8s resources */
export interface K8sResourceList<T = K8sResource> {
  apiVersion?: string;
  kind?: string;
  items: T[];
  metadata?: {
    continue?: string;
    resourceVersion?: string;
    [key: string]: unknown;
  };
}

/** Transaction summary result list */
export interface TransactionResultList {
  results?: TransactionSummary[];
}

/** Transaction summary */
export interface TransactionSummary {
  id: number;
  [key: string]: unknown;
}

/** Transaction execution details */
export interface TransactionExecution {
  [key: string]: unknown;
}

/** Transaction input resources */
export interface TransactionInputResources {
  [key: string]: unknown;
}

/** Transaction run result */
export interface TransactionRunResult {
  id: number;
}

/** User storage file response */
export interface UserStorageFileResponse {
  'file-content'?: string;
}

/** EQL completion item */
export interface EqlCompletionItem {
  token?: string;
  completion?: string;
}

/** EQL autocomplete response */
export interface EqlAutocompleteResponse {
  completions?: EqlCompletionItem[];
}

/** Deviation action resource */
export interface DeviationAction extends K8sResource {
  spec?: {
    action?: string;
    [key: string]: unknown;
  };
}

/** Workflow identifier object used by workflow input APIs */
export interface WorkflowIdentifier {
  group: string;
  kind: string;
  name: string;
  namespace?: string;
  version: string;
}

/** Workflow input request returned by workflow _input GET endpoints */
export interface WorkflowGetInputsRespElem extends WorkflowIdentifier {
  ackPrompt?: string;
  schemaPrompt?: Record<string, unknown>;
}

/** Workflow input payload element for workflow _input PUT endpoints */
export interface WorkflowInputDataElem {
  ack?: boolean;
  input?: Record<string, unknown>;
  subflow?: WorkflowIdentifier;
}

export type BootstrapSnapshot = Map<string, Map<string, K8sResource>>;

export interface BootstrapStreamItemsOptions {
  excludeStreams?: Set<string>;
  includeStreams?: Set<string>;
  namesOnly?: boolean;
  namesOnlyStreams?: Set<string>;
}

export interface FastBootstrapStreamItemsOptions {
  excludeStreams?: Set<string>;
  minimumResources?: number;
  additionalBatchSize?: number;
  onBatchSnapshot?: (snapshot: BootstrapSnapshot) => void;
}

export interface FastBootstrapStreamItemsResult {
  snapshot: BootstrapSnapshot;
  loadedStreams: Set<string>;
  namesOnlyStreams: Set<string>;
}

interface IndexerResourceRef {
  namespace: string;
  group: string;
  version: string;
  kind: string;
  name: string;
}

interface IndexerSnapshotResult {
  snapshot: BootstrapSnapshot;
  loadedStreams: Set<string>;
}

/**
 * Client for EDA REST API operations
 */
export class EdaApiClient {
  private authClient: EdaAuthClient;
  private specManager?: EdaSpecManager;
  private dbTableByStream = new Map<string, string>();

  private static readonly FAST_BOOTSTRAP_STREAMS: readonly string[] = [
    'alarms',
    'components',
    'nodeprofiles',
    'defaultbgppeers',
    'fans',
    'queues',
    'forwardingclasss',
    'indexallocationpools',
    'interfaces',
    'defaultinterfaces',
    'powersupplies',
    'topolinks',
    'workflowdefinitions',
    'isls',
    'toponodes',
    'exports',
    'policys',
    'chassis',
    'controlmodules',
    'interfacemodules',
    'defaultrouters',
    'systeminterfaces',
    'ipallocationpools',
    'ipinsubnetallocationpools',
    'subnetallocationpools',
    'httpproxies',
    'defaultroutereflectorclients',
  ];

  constructor(authClient: EdaAuthClient) {
    this.authClient = authClient;
    log('EdaApiClient initialized', LogLevel.DEBUG);
  }

  public setSpecManager(specManager: EdaSpecManager): void {
    this.specManager = specManager;
  }

  /**
   * Fetch JSON from API endpoint
   */
  public async fetchJSON<T = unknown>(path: string): Promise<T> {
    await this.authClient.waitForAuth();
    const url = `${this.authClient.getBaseUrl()}${path}`;
    log(`GET ${url}`, LogLevel.DEBUG);

    let res = await fetch(url, {
      headers: this.authClient.getHeaders(),
      dispatcher: this.authClient.getAgent()
    });

    log(`GET ${url} -> ${res.status}`, LogLevel.DEBUG);

    if (!res.ok) {
      const text = await res.text();
      if (this.authClient.isTokenExpiredResponse(res.status, text)) {
        log(MSG_TOKEN_EXPIRED, LogLevel.INFO);
        await this.authClient.refreshAuth();
        res = await fetch(url, {
          headers: this.authClient.getHeaders(),
          dispatcher: this.authClient.getAgent()
        });
        log(`GET ${url} retry -> ${res.status}`, LogLevel.DEBUG);
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
    }
    return (await res.json()) as T;
  }

  /**
   * Make API request with method and optional body
   */
  public async requestJSON<T = unknown>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    await this.authClient.waitForAuth();
    const url = `${this.authClient.getBaseUrl()}${path}`;
    log(`${method} ${url}`, LogLevel.DEBUG);

    let res = await fetch(url, {
      method,
      headers: this.authClient.getHeaders(),
      dispatcher: this.authClient.getAgent(),
      body: body ? JSON.stringify(body) : undefined,
    });

    log(`${method} ${url} -> ${res.status}`, LogLevel.DEBUG);

    if (!res.ok) {
      const text = await res.text();
      if (this.authClient.isTokenExpiredResponse(res.status, text)) {
        log(MSG_TOKEN_EXPIRED, LogLevel.INFO);
        await this.authClient.refreshAuth();
        res = await fetch(url, {
          method,
          headers: this.authClient.getHeaders(),
          dispatcher: this.authClient.getAgent(),
          body: body ? JSON.stringify(body) : undefined,
        });
        log(`${method} ${url} retry -> ${res.status}`, LogLevel.DEBUG);
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
    }

    if (res.status === 204) {
      return undefined as T;
    }

    const text = await res.text();
    if (!text) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
  }

  /**
   * Fetch plain text from API endpoint
   */
  private async fetchText(path: string): Promise<string> {
    await this.authClient.waitForAuth();
    const url = `${this.authClient.getBaseUrl()}${path}`;
    log(`GET ${url}`, LogLevel.DEBUG);

    let res = await fetch(url, {
      headers: this.authClient.getHeaders(),
      dispatcher: this.authClient.getAgent()
    });
    let text = await res.text();
    log(`GET ${url} -> ${res.status}`, LogLevel.DEBUG);

    if (!res.ok) {
      if (this.authClient.isTokenExpiredResponse(res.status, text)) {
        log(MSG_TOKEN_EXPIRED, LogLevel.INFO);
        await this.authClient.refreshAuth();
        res = await fetch(url, {
          headers: this.authClient.getHeaders(),
          dispatcher: this.authClient.getAgent()
        });
        text = await res.text();
        log(`GET ${url} retry -> ${res.status}`, LogLevel.DEBUG);
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
    }

    return text;
  }

  /**
   * Fetch JSON from a full URL
   */
  public async fetchJsonUrl(url: string): Promise<unknown> {
    await this.authClient.waitForAuth();
    let res = await fetch(url, {
      headers: this.authClient.getHeaders(),
      dispatcher: this.authClient.getAgent()
    });
    let text = await res.text();
    if (!res.ok) {
      if (this.authClient.isTokenExpiredResponse(res.status, text)) {
        log(MSG_TOKEN_EXPIRED, LogLevel.INFO);
        await this.authClient.refreshAuth();
        res = await fetch(url, {
          headers: this.authClient.getHeaders(),
          dispatcher: this.authClient.getAgent()
        });
        text = await res.text();
        log(`GET ${url} retry -> ${res.status}`, LogLevel.DEBUG);
      }
      if (!res.ok) {
        throw new Error(`Failed to fetch ${url}: HTTP ${res.status} ${text}`);
      }
    }
    return JSON.parse(text) as unknown;
  }

  /**
   * Resolve an API path by trying operation IDs in order.
   * Returns undefined if no operation ID matches in the current spec.
   */
  private async resolvePathFromOperationIds(
    operationIds: readonly string[],
    replacements: Record<string, string> = {}
  ): Promise<string | undefined> {
    if (!this.specManager) {
      return undefined;
    }

    for (const operationId of operationIds) {
      try {
        const template = await this.specManager.getPathByOperationId(operationId);
        if (typeof template !== 'string' || template.length === 0) {
          continue;
        }
        let path = template;
        for (const [token, value] of Object.entries(replacements)) {
          path = path.split(token).join(value);
        }
        return path;
      } catch {
        // Try the next operation ID variant.
      }
    }
    return undefined;
  }

  private toPascalIdentifier(input: string): string {
    return input
      .split(/[.-]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }

  private uniqueOperationIds(ids: string[]): string[] {
    const filtered = ids.filter((id) => typeof id === 'string' && id.length > 0);
    return Array.from(new Set(filtered));
  }

  private buildOperationIds(group: string, version: string, kind: string): {
    listNamespaced: string[];
    listAll: string[];
    createNamespaced: string[];
    createAll: string[];
    readNamespaced: string[];
    readAll: string[];
  } {
    const plural = kindToPlural(kind);
    const groupPascal = this.toPascalIdentifier(group);
    const versionPascal = this.toPascalIdentifier(version);
    const kindPascal = this.toPascalIdentifier(kind);
    const pluralPascal = this.toPascalIdentifier(plural);
    return {
      listNamespaced: this.uniqueOperationIds([
        `wfList${groupPascal}${versionPascal}Namespace${pluralPascal}`,
        `list${groupPascal}${versionPascal}Namespaced${kindPascal}`,
        `list${groupPascal}${versionPascal}Namespace${pluralPascal}`
      ]),
      listAll: this.uniqueOperationIds([
        `wfList${groupPascal}${versionPascal}${pluralPascal}`,
        `list${groupPascal}${versionPascal}${kindPascal}ForAllNamespaces`,
        `list${groupPascal}${versionPascal}${pluralPascal}`
      ]),
      createNamespaced: this.uniqueOperationIds([
        `wfCreate${groupPascal}${versionPascal}Namespace${pluralPascal}`,
        `create${groupPascal}${versionPascal}Namespaced${kindPascal}`,
        `create${groupPascal}${versionPascal}Namespace${pluralPascal}`
      ]),
      createAll: this.uniqueOperationIds([
        `wfCreate${groupPascal}${versionPascal}${pluralPascal}`,
        `create${groupPascal}${versionPascal}${kindPascal}`,
        `create${groupPascal}${versionPascal}${pluralPascal}`
      ]),
      readNamespaced: this.uniqueOperationIds([
        `wfRead${groupPascal}${versionPascal}Namespace${pluralPascal}`,
        `read${groupPascal}${versionPascal}Namespaced${kindPascal}`,
        `read${groupPascal}${versionPascal}Namespace${pluralPascal}`
      ]),
      readAll: this.uniqueOperationIds([
        `wfRead${groupPascal}${versionPascal}${pluralPascal}`,
        `read${groupPascal}${versionPascal}${kindPascal}`,
        `read${groupPascal}${versionPascal}${pluralPascal}`
      ])
    };
  }

  private buildResourceKey(resource: K8sResource, source: string, index: number): string {
    const name = resource.metadata?.name;
    const namespace = resource.metadata?.namespace ?? '';
    const uid = resource.metadata?.uid;
    const apiVersion = resource.apiVersion ?? '';
    const kind = resource.kind ?? '';

    if (typeof name === 'string' && name.length > 0) {
      return `${apiVersion}/${kind}/${namespace}/${name}`;
    }
    if (typeof uid === 'string' && uid.length > 0) {
      return `uid:${uid}`;
    }
    return `anon:${source}:${index}`;
  }

  private mergeResourceList(
    merged: Map<string, K8sResource>,
    resources: K8sResource[],
    source: string
  ): void {
    resources.forEach((resource, index) => {
      merged.set(this.buildResourceKey(resource, source, index), resource);
    });
  }

  private async getKnownNamespaces(): Promise<string[]> {
    const namespaces = new Set<string>();

    if (this.specManager) {
      namespaces.add(this.specManager.getCoreNamespace());
      for (const namespace of this.specManager.getCachedNamespaces()) {
        namespaces.add(namespace);
      }
    }

    if (namespaces.size <= 1) {
      try {
        for (const namespace of await this.listNamespaces()) {
          namespaces.add(namespace);
        }
      } catch {
        // Ignore namespace list failures and keep what we have.
      }
    }

    return Array.from(namespaces).sort((a, b) => a.localeCompare(b));
  }

  private async listWithNamespacedSupplement(
    allNamespacesFetcher: () => Promise<K8sResource[]>,
    namespacedFetcher: (namespace: string) => Promise<K8sResource[]>
  ): Promise<K8sResource[]> {
    const merged = new Map<string, K8sResource>();
    let allNamespaces: K8sResource[] = [];

    try {
      allNamespaces = await allNamespacesFetcher();
      this.mergeResourceList(merged, allNamespaces, 'all');
    } catch {
      // Ignore all-namespaces failures and continue with per-namespace reads.
    }

    const namespaces = await this.getKnownNamespaces();
    if (namespaces.length === 0) {
      return allNamespaces;
    }

    const namespacesFromAll = new Set<string>();
    for (const resource of allNamespaces) {
      const namespace = resource.metadata?.namespace;
      if (typeof namespace === 'string' && namespace.length > 0) {
        namespacesFromAll.add(namespace);
      }
    }

    const namespacesToFetch =
      allNamespaces.length === 0
        ? namespaces
        : namespaces.filter((namespace) => !namespacesFromAll.has(namespace));

    for (const namespace of namespacesToFetch) {
      try {
        const resources = await namespacedFetcher(namespace);
        this.mergeResourceList(merged, resources, namespace);
      } catch {
        // Ignore per-namespace failures.
      }
    }

    return Array.from(merged.values());
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private toRecordArray(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is Record<string, unknown> => this.isRecord(item));
  }

  private getCoreNamespace(): string {
    return this.specManager?.getCoreNamespace() || DEFAULT_CORE_NAMESPACE;
  }

  private getStreamEndpoints(): StreamEndpoint[] {
    return this.specManager?.getStreamEndpoints() ?? [];
  }

  private createStreamNamespaceKey(stream: string, namespace: string): string {
    return `${stream}${STREAM_NAMESPACE_SEPARATOR}${namespace}`;
  }

  private getOrCreateSnapshotBucket(
    snapshot: BootstrapSnapshot,
    stream: string,
    namespace: string
  ): Map<string, K8sResource> {
    const key = this.createStreamNamespaceKey(stream, namespace);
    const existing = snapshot.get(key);
    if (existing) {
      return existing;
    }
    const created = new Map<string, K8sResource>();
    snapshot.set(key, created);
    return created;
  }

  private extractResourceName(
    item: K8sResource,
    metadata: Record<string, unknown> | undefined
  ): string {
    if (typeof metadata?.name === 'string' && metadata.name.length > 0) {
      return metadata.name;
    }
    if (typeof item.name === 'string' && item.name.length > 0) {
      return item.name;
    }
    return '';
  }

  private mergeBootstrapSnapshot(target: BootstrapSnapshot, incoming: BootstrapSnapshot): void {
    for (const [key, bucket] of incoming.entries()) {
      let mergedBucket = target.get(key);
      if (!mergedBucket) {
        mergedBucket = new Map<string, K8sResource>();
        target.set(key, mergedBucket);
      }
      for (const [name, resource] of bucket.entries()) {
        mergedBucket.set(name, resource);
      }
    }
  }

  private snapshotResourceCount(snapshot: BootstrapSnapshot): number {
    let total = 0;
    for (const bucket of snapshot.values()) {
      total += bucket.size;
    }
    return total;
  }

  private getBootstrapParallelism(): number {
    const configured = Number(process.env.EDA_BOOTSTRAP_PARALLELISM);
    if (!Number.isNaN(configured) && configured > 0) {
      return Math.floor(configured);
    }
    return DEFAULT_BOOTSTRAP_PARALLELISM;
  }

  private getBootstrapNamespaceParallelism(): number {
    const configured = Number(process.env.EDA_BOOTSTRAP_NAMESPACE_PARALLELISM);
    if (!Number.isNaN(configured) && configured > 0) {
      return Math.floor(configured);
    }
    return DEFAULT_BOOTSTRAP_NAMESPACE_PARALLELISM;
  }

  private resourceNounCandidatesFromPlural(plural: string): string[] {
    const noun = plural.trim().toLowerCase();
    if (!noun) {
      return [];
    }

    const candidates: string[] = [];
    const add = (candidate: string): void => {
      if (candidate.length > 0 && !candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    };

    if (noun.endsWith('sis')) {
      add(noun);
    } else if (noun.endsWith('ies') && noun.length > 3) {
      add(`${noun.slice(0, -3)}y`);
    } else if (
      (noun.endsWith('xes') || noun.endsWith('zes') || noun.endsWith('ches') || noun.endsWith('shes'))
      && noun.length > 2
    ) {
      add(noun.slice(0, -2));
    } else if (noun.endsWith('ses') && noun.length > 3) {
      add(noun.slice(0, -1));
      add(noun.slice(0, -2));
    } else if (noun.endsWith('s') && noun.length > 1) {
      add(noun.slice(0, -1));
    }
    add(noun);
    return candidates;
  }

  private kindFromPlural(plural: string): string {
    const [candidate] = this.resourceNounCandidatesFromPlural(plural);
    const noun = candidate || plural;
    return noun
      .split(/[._-]/)
      .filter((segment) => segment.length > 0)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join('');
  }

  private dbTableCandidatesForEndpoint(endpoint: StreamEndpoint): string[] {
    const match = endpoint.path.match(CRD_PATH_PATTERN);
    if (!match) {
      return [];
    }

    const [, group, version, plural] = match;
    const groupToken = group.replace(/\./g, '_');
    return this.resourceNounCandidatesFromPlural(plural).map(
      (noun) => `.namespace.resources.cr.${groupToken}.${version}.${noun}`
    );
  }

  private nonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private dbFallbackIdentity(endpoint: StreamEndpoint): { apiVersion: string; kind: string } {
    const pathMatch = endpoint.path.match(CRD_PATH_PATTERN);
    if (!pathMatch) {
      return { apiVersion: '', kind: '' };
    }
    return {
      apiVersion: `${pathMatch[1]}/${pathMatch[2]}`,
      kind: this.kindFromPlural(pathMatch[3]),
    };
  }

  private dbEntryKeyNames(entryKey: string): string[] {
    return Array.from(entryKey.matchAll(DB_KEY_NAME_PATTERN))
      .map((match) => match[1])
      .filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0);
  }

  private dbEntryName(
    metadata: Record<string, unknown>,
    entryValue: Record<string, unknown>,
    keyNames: string[]
  ): string | undefined {
    const metadataName = this.nonEmptyString(metadata.name);
    if (metadataName) {
      return metadataName;
    }

    const entryName = this.nonEmptyString(entryValue.name);
    if (entryName) {
      return entryName;
    }

    return keyNames.length > 0 ? keyNames[keyNames.length - 1] : undefined;
  }

  private dbEntryNamespace(
    metadata: Record<string, unknown>,
    entryValue: Record<string, unknown>,
    keyNames: string[]
  ): string | undefined {
    const metadataNamespace = this.nonEmptyString(metadata.namespace);
    if (metadataNamespace) {
      return metadataNamespace;
    }

    const flatNamespace = this.nonEmptyString(entryValue['namespace.name']);
    if (flatNamespace) {
      return flatNamespace;
    }

    const entryNamespace = this.nonEmptyString(entryValue.namespace);
    if (entryNamespace) {
      return entryNamespace;
    }

    return keyNames.length >= 2 ? keyNames[0] : undefined;
  }

  private resourceFromDbEntry(
    endpoint: StreamEndpoint,
    entryKey: string,
    entryValue: Record<string, unknown>
  ): K8sResource | undefined {
    const { apiVersion: fallbackApiVersion, kind: fallbackKind } = this.dbFallbackIdentity(endpoint);
    const metadata = this.isRecord(entryValue.metadata) ? entryValue.metadata : {};
    const keyNames = this.dbEntryKeyNames(entryKey);
    const name = this.dbEntryName(metadata, entryValue, keyNames);
    if (!name) {
      return undefined;
    }
    const namespace = this.dbEntryNamespace(metadata, entryValue, keyNames) ?? this.getCoreNamespace();
    const apiVersion = this.nonEmptyString(entryValue.apiVersion) ?? fallbackApiVersion;
    const kind = this.nonEmptyString(entryValue.kind) ?? fallbackKind;

    const resource: K8sResource = {
      metadata: {
        name,
        namespace,
      }
    };
    if (apiVersion) {
      resource.apiVersion = apiVersion;
    }
    if (kind) {
      resource.kind = kind;
    }
    return resource;
  }

  private normalizeQueryRows(rows: unknown[]): Record<string, unknown>[] {
    const normalized: Record<string, unknown>[] = [];
    for (const row of rows) {
      if (!this.isRecord(row)) {
        continue;
      }
      const data = row.data;
      if (this.isRecord(data)) {
        normalized.push(data);
      } else {
        normalized.push(row);
      }
    }
    return normalized;
  }

  private hasInsertOrModify(holder: Record<string, unknown>): boolean {
    return (
      this.isRecord(holder.insert_or_modify)
      || this.isRecord(holder.Insert_or_modify)
      || this.isRecord(holder.insertOrModify)
      || this.isRecord(holder.InsertOrModify)
    );
  }

  private opCandidates(holder: Record<string, unknown>): Record<string, unknown>[] {
    const opsValue = holder.op ?? holder.Op;
    if (Array.isArray(opsValue)) {
      return this.toRecordArray(opsValue);
    }
    if (this.hasInsertOrModify(holder)) {
      return [holder];
    }
    return [];
  }

  private opInsertOrModify(candidate: Record<string, unknown>): Record<string, unknown> | undefined {
    const value = candidate.insert_or_modify
      ?? candidate.Insert_or_modify
      ?? candidate.insertOrModify
      ?? candidate.InsertOrModify;
    return this.isRecord(value) ? value : undefined;
  }

  private queryRowsFromOpCandidate(candidate: Record<string, unknown>): Record<string, unknown>[] {
    const insertOrModify = this.opInsertOrModify(candidate);
    if (!insertOrModify) {
      return [];
    }
    const opRows = insertOrModify.rows ?? insertOrModify.Rows;
    if (!Array.isArray(opRows)) {
      return [];
    }
    return this.normalizeQueryRows(opRows);
  }

  private queryRowsFromOps(holder: Record<string, unknown>): Record<string, unknown>[] {
    const rows: Record<string, unknown>[] = [];
    for (const candidate of this.opCandidates(holder)) {
      rows.push(...this.queryRowsFromOpCandidate(candidate));
    }
    return rows;
  }

  private queryRowsFromUpdates(holder: Record<string, unknown>): Record<string, unknown>[] {
    const updates = holder.updates ?? holder.Updates;
    if (!Array.isArray(updates)) {
      return [];
    }
    const rows: Record<string, unknown>[] = [];
    for (const update of updates) {
      if (!this.isRecord(update)) {
        continue;
      }
      const data = update.data;
      if (this.isRecord(data)) {
        rows.push(data);
      } else {
        rows.push(update);
      }
    }
    return rows;
  }

  private queryRowsFromPayload(payload: unknown): Record<string, unknown>[] {
    if (Array.isArray(payload)) {
      return this.toRecordArray(payload);
    }
    if (!this.isRecord(payload)) {
      return [];
    }

    const holders = [payload.msg, payload];
    for (const holder of holders) {
      if (!this.isRecord(holder)) {
        continue;
      }

      const directRows = holder.data ?? holder.Data;
      if (Array.isArray(directRows)) {
        const normalized = this.normalizeQueryRows(directRows);
        if (normalized.length > 0) {
          return normalized;
        }
      } else if (this.isRecord(directRows)) {
        return [directRows];
      }

      const opRows = this.queryRowsFromOps(holder);
      if (opRows.length > 0) {
        return opRows;
      }

      const updateRows = this.queryRowsFromUpdates(holder);
      if (updateRows.length > 0) {
        return updateRows;
      }
    }

    return [];
  }

  private payloadMayContainRows(payload: Record<string, unknown>): boolean {
    return (
      'items' in payload
      || 'results' in payload
      || 'Results' in payload
      || 'updates' in payload
      || 'Updates' in payload
      || 'msg' in payload
      || 'op' in payload
      || 'Op' in payload
    );
  }

  private itemsFromPayload(payload: unknown): K8sResource[] {
    if (this.isRecord(payload)) {
      const items = payload.items;
      if (Array.isArray(items)) {
        return items.filter((item): item is K8sResource => this.isRecord(item));
      }
      const rows = payload.results ?? payload.Results;
      if (Array.isArray(rows)) {
        const out: K8sResource[] = [];
        for (const row of rows) {
          if (!this.isRecord(row)) {
            continue;
          }
          const data = row.data;
          if (this.isRecord(data)) {
            out.push(data as K8sResource);
          } else {
            out.push(row as K8sResource);
          }
        }
        return out;
      }
    }

    if (Array.isArray(payload)) {
      return payload.filter((item): item is K8sResource => this.isRecord(item));
    }

    return [];
  }

  private async safeFetchStreamItems(path: string): Promise<K8sResource[]> {
    try {
      const payload = await this.fetchJSON<unknown>(path);
      return this.itemsFromPayload(payload);
    } catch {
      return [];
    }
  }

  private dbTableCandidatesForSnapshot(endpoint: StreamEndpoint): string[] {
    const candidates: string[] = [];
    const cachedTable = this.dbTableByStream.get(endpoint.stream);
    if (cachedTable) {
      candidates.push(cachedTable);
    }
    for (const candidate of this.dbTableCandidatesForEndpoint(endpoint)) {
      if (!candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    }
    return candidates;
  }

  private dbEntriesFromPayload(payload: unknown): Array<[string, Record<string, unknown>]> {
    if (this.isRecord(payload)) {
      const entries = Object.entries(payload)
        .filter(([, entryValue]) => this.isRecord(entryValue))
        .map(([entryKey, entryValue]) => [entryKey, entryValue as Record<string, unknown>] as [string, Record<string, unknown>]);
      if (entries.length > 0 || !this.payloadMayContainRows(payload)) {
        return entries;
      }
      return this.queryRowsFromPayload(payload).map((row) => ['', row]);
    }
    if (Array.isArray(payload)) {
      return this.toRecordArray(payload).map((entry) => ['', entry]);
    }
    return [];
  }

  private snapshotFromDbEntries(
    endpoint: StreamEndpoint,
    entries: Array<[string, Record<string, unknown>]>
  ): BootstrapSnapshot {
    const snapshot: BootstrapSnapshot = new Map();
    for (const [entryKey, entryValue] of entries) {
      const resource = this.resourceFromDbEntry(endpoint, entryKey, entryValue);
      if (!resource?.metadata?.name || !resource.metadata.namespace) {
        continue;
      }
      const bucket = this.getOrCreateSnapshotBucket(
        snapshot,
        endpoint.stream,
        resource.metadata.namespace
      );
      bucket.set(resource.metadata.name, resource);
    }
    return snapshot;
  }

  private async safeFetchDbSnapshotForTable(
    endpoint: StreamEndpoint,
    tableName: string
  ): Promise<BootstrapSnapshot | undefined> {
    try {
      const query = new URLSearchParams({
        fields: DB_MINIMAL_RESOURCE_FIELDS,
        jsPath: tableName,
      });
      const payload = await this.fetchJSON<unknown>(`${DB_DATA_PATH}?${query.toString()}`);
      const entries = this.dbEntriesFromPayload(payload);
      return this.snapshotFromDbEntries(endpoint, entries);
    } catch {
      return undefined;
    }
  }

  private async safeFetchDbStreamSnapshot(
    endpoint: StreamEndpoint
  ): Promise<BootstrapSnapshot | undefined> {
    const cachedTable = this.dbTableByStream.get(endpoint.stream);
    const tableCandidates = this.dbTableCandidatesForSnapshot(endpoint);
    if (tableCandidates.length === 0) {
      return undefined;
    }

    for (const tableName of tableCandidates) {
      const snapshot = await this.safeFetchDbSnapshotForTable(endpoint, tableName);
      if (snapshot) {
        this.dbTableByStream.set(endpoint.stream, tableName);
        return snapshot;
      }
    }

    if (cachedTable) {
      this.dbTableByStream.delete(endpoint.stream);
    }
    return undefined;
  }

  private indexerIdentityKey(group: string, version: string, kind: string): string {
    return `${group}/${version}/${kind}`.toLowerCase();
  }

  private indexerIdentityFromEndpoint(endpoint: StreamEndpoint): {
    key: string;
    stream: string;
  } | undefined {
    const match = endpoint.path.match(CRD_PATH_PATTERN);
    if (!match) {
      return undefined;
    }
    const [, group, version, plural] = match;
    const kindLower = this.kindFromPlural(plural).toLowerCase();
    return {
      key: this.indexerIdentityKey(group, version, kindLower),
      stream: endpoint.stream
    };
  }

  private parseIndexerResourceLine(line: string): IndexerResourceRef | undefined {
    const trimmed = line.trim();
    if (!trimmed) {
      return undefined;
    }

    const identity = trimmed.split(INDEXER_LABELS_DELIMITER, 1)[0];
    const parts = identity.split('/');
    if (parts.length < 4) {
      return undefined;
    }

    const namespace = parts[0];
    let group: string;
    let version: string;
    let kind: string;
    let name: string;

    if (parts.length === 4) {
      group = CORE_API_GROUP;
      version = parts[1];
      kind = parts[2];
      name = parts[3];
    } else {
      group = parts[1];
      version = parts[2];
      kind = parts[3];
      name = parts.slice(4).join('/');
    }

    if (!namespace || !group || !version || !kind || !name) {
      return undefined;
    }

    return {
      namespace,
      group,
      version,
      kind,
      name
    };
  }

  private resolveIndexerStream(
    ref: IndexerResourceRef,
    streamByIdentity: Map<string, string>,
    allowedStreams: Set<string>
  ): string | undefined {
    const identityKey = this.indexerIdentityKey(ref.group, ref.version, ref.kind);
    const mappedStream = streamByIdentity.get(identityKey);
    if (mappedStream) {
      return mappedStream;
    }
    const inferredStream = kindToPlural(ref.kind);
    return allowedStreams.has(inferredStream) ? inferredStream : undefined;
  }

  private async safeFetchIndexerSnapshot(
    excluded: Set<string>,
    includeStreams?: Set<string>
  ): Promise<IndexerSnapshotResult | undefined> {
    const endpoints = this.resolveBootstrapEndpoints(excluded, includeStreams);
    if (endpoints.length === 0) {
      return undefined;
    }

    const allowedStreams = new Set<string>();
    const streamByIdentity = new Map<string, string>();
    for (const endpoint of endpoints) {
      if (!endpoint.stream) {
        continue;
      }
      allowedStreams.add(endpoint.stream);
      const identity = this.indexerIdentityFromEndpoint(endpoint);
      if (!identity || streamByIdentity.has(identity.key)) {
        continue;
      }
      streamByIdentity.set(identity.key, identity.stream);
    }

    if (allowedStreams.size === 0) {
      return undefined;
    }

    try {
      const payload = await this.fetchText(INDEXER_RESOURCES_PATH);
      if (!payload) {
        return undefined;
      }

      const snapshot: BootstrapSnapshot = new Map();
      const loadedStreams = new Set<string>();
      for (const line of payload.split(/\r?\n/)) {
        const ref = this.parseIndexerResourceLine(line);
        if (!ref) {
          continue;
        }

        const stream = this.resolveIndexerStream(ref, streamByIdentity, allowedStreams);
        if (!stream) {
          continue;
        }

        const apiVersion = ref.group === CORE_API_GROUP
          ? ref.version
          : `${ref.group}/${ref.version}`;
        const bucket = this.getOrCreateSnapshotBucket(snapshot, stream, ref.namespace);
        bucket.set(ref.name, {
          apiVersion,
          kind: ref.kind,
          metadata: {
            name: ref.name,
            namespace: ref.namespace,
          }
        });
        loadedStreams.add(stream);
      }

      if (loadedStreams.size === 0) {
        return undefined;
      }

      log(
        `Indexer bootstrap loaded ${this.snapshotResourceCount(snapshot)} resources `
        + `from ${loadedStreams.size} streams.`,
        LogLevel.DEBUG
      );
      return { snapshot, loadedStreams };
    } catch (err) {
      log(`Indexer bootstrap unavailable: ${err}`, LogLevel.DEBUG);
      return undefined;
    }
  }

  public availableBootstrapStreams(
    options: { excludeStreams?: Set<string> } = {}
  ): string[] {
    const excluded = options.excludeStreams ?? new Set<string>();
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const endpoint of this.getStreamEndpoints()) {
      const stream = endpoint.stream;
      if (!stream || excluded.has(stream) || stream.startsWith('_')) {
        continue;
      }
      if (seen.has(stream)) {
        continue;
      }
      seen.add(stream);
      ordered.push(stream);
    }
    return ordered;
  }

  private resolveBootstrapEndpoints(
    excluded: Set<string>,
    includeStreams?: Set<string>
  ): StreamEndpoint[] {
    const endpoints = this.getStreamEndpoints();
    if (!includeStreams || includeStreams.size === 0) {
      return endpoints.filter((endpoint) => {
        const stream = endpoint.stream;
        return Boolean(stream) && !excluded.has(stream) && !stream.startsWith('_');
      });
    }

    const endpointByStream = new Map<string, StreamEndpoint>();
    for (const endpoint of endpoints) {
      const stream = endpoint.stream;
      if (!stream || excluded.has(stream) || stream.startsWith('_')) {
        continue;
      }
      if (!endpointByStream.has(stream)) {
        endpointByStream.set(stream, endpoint);
      }
    }

    const ordered: StreamEndpoint[] = [];
    for (const stream of includeStreams) {
      const endpoint = endpointByStream.get(stream);
      if (endpoint) {
        ordered.push(endpoint);
      }
    }
    return ordered;
  }

  private namespaceRequestsForEndpoint(
    endpoint: StreamEndpoint,
    namespaces: string[]
  ): Array<{ namespace: string; path: string }> {
    const namespaceToken = `{${endpoint.namespaceParam || 'namespace'}}`;
    return namespaces
      .map((namespace) => ({
        namespace,
        path: endpoint.path.replace(namespaceToken, encodeURIComponent(namespace))
      }))
      .filter((request) => !request.path.includes('{'));
  }

  private appendNamespacedItemsToSnapshot(
    snapshot: BootstrapSnapshot,
    stream: string,
    namespace: string,
    items: K8sResource[]
  ): void {
    if (items.length === 0) {
      return;
    }
    const bucket = this.getOrCreateSnapshotBucket(snapshot, stream, namespace);
    for (const item of items) {
      const metadata = this.isRecord(item.metadata)
        ? item.metadata
        : undefined;
      const name = this.extractResourceName(item, metadata);
      if (name) {
        bucket.set(name, item);
      }
    }
  }

  private itemNamespace(metadata: Record<string, unknown> | undefined): string {
    const namespace = this.nonEmptyString(metadata?.namespace);
    return namespace ?? this.getCoreNamespace();
  }

  private appendClusterItemsToSnapshot(
    snapshot: BootstrapSnapshot,
    stream: string,
    items: K8sResource[]
  ): void {
    for (const item of items) {
      const metadata = this.isRecord(item.metadata)
        ? item.metadata
        : undefined;
      const name = this.extractResourceName(item, metadata);
      if (!name) {
        continue;
      }
      const namespace = this.itemNamespace(metadata);
      const bucket = this.getOrCreateSnapshotBucket(snapshot, stream, namespace);
      bucket.set(name, item);
    }
  }

  private async appendEndpointNamespaceBatches(
    endpoint: StreamEndpoint,
    stream: string,
    namespaces: string[],
    snapshot: BootstrapSnapshot
  ): Promise<void> {
    const namespaceRequests = this.namespaceRequestsForEndpoint(endpoint, namespaces);
    const namespaceParallelism = this.getBootstrapNamespaceParallelism();

    for (let index = 0; index < namespaceRequests.length; index += namespaceParallelism) {
      const batch = namespaceRequests.slice(index, index + namespaceParallelism);
      const batchResults = await Promise.all(batch.map(async (request) => ({
        namespace: request.namespace,
        items: await this.safeFetchStreamItems(request.path)
      })));

      for (const { namespace, items } of batchResults) {
        this.appendNamespacedItemsToSnapshot(snapshot, stream, namespace, items);
      }
    }
  }

  private async bootstrapEndpointSnapshot(
    endpoint: StreamEndpoint,
    namespaces: string[],
    namesOnly: boolean
  ): Promise<{ snapshot: BootstrapSnapshot; usedNamesOnly: boolean }> {
    const stream = endpoint.stream;
    if (!stream) {
      return { snapshot: new Map(), usedNamesOnly: false };
    }

    if (namesOnly) {
      const dbSnapshot = await this.safeFetchDbStreamSnapshot(endpoint);
      if (dbSnapshot) {
        return { snapshot: dbSnapshot, usedNamesOnly: true };
      }
    }

    const snapshot: BootstrapSnapshot = new Map();

    if (endpoint.namespaced) {
      await this.appendEndpointNamespaceBatches(endpoint, stream, namespaces, snapshot);
      return { snapshot, usedNamesOnly: false };
    }

    const items = await this.safeFetchStreamItems(endpoint.path);
    this.appendClusterItemsToSnapshot(snapshot, stream, items);
    return { snapshot, usedNamesOnly: false };
  }

  public async bootstrapStreamItems(
    namespaces: string[],
    options: BootstrapStreamItemsOptions = {}
  ): Promise<BootstrapSnapshot> {
    const excluded = options.excludeStreams ?? new Set<string>();
    const includeStreams = options.includeStreams;
    const namesOnly = options.namesOnly === true;
    const namesOnlyStreams = options.namesOnlyStreams;
    const snapshot: BootstrapSnapshot = new Map();
    const endpoints = this.resolveBootstrapEndpoints(excluded, includeStreams);
    const parallelism = this.getBootstrapParallelism();

    for (let index = 0; index < endpoints.length; index += parallelism) {
      const batch = endpoints.slice(index, index + parallelism);
      const batchResults = await Promise.all(batch.map(async (endpoint) => ({
        endpoint,
        result: await this.bootstrapEndpointSnapshot(endpoint, namespaces, namesOnly)
      })));

      for (const { endpoint, result } of batchResults) {
        this.mergeBootstrapSnapshot(snapshot, result.snapshot);
        if (namesOnly && result.usedNamesOnly && namesOnlyStreams) {
          namesOnlyStreams.add(endpoint.stream);
        }
      }
    }

    return snapshot;
  }

  public async fastBootstrapStreamItems(
    namespaces: string[],
    options: FastBootstrapStreamItemsOptions = {}
  ): Promise<FastBootstrapStreamItemsResult> {
    const excluded = options.excludeStreams ?? new Set<string>();
    const minimumResources = options.minimumResources ?? 900;
    const additionalBatchSize = Math.max(
      1,
      options.additionalBatchSize
        ?? Math.max(this.getBootstrapParallelism(), 6)
    );
    const available = this.availableBootstrapStreams({ excludeStreams: excluded });
    const availableSet = new Set(available);
    const loadedStreams = new Set<string>();
    const namesOnlyStreams = new Set<string>();
    const snapshot: BootstrapSnapshot = new Map();
    const bootstrapParallelism = this.getBootstrapParallelism();
    const reportBatch = (batchSnapshot: BootstrapSnapshot): void => {
      if (batchSnapshot.size === 0) {
        return;
      }
      options.onBatchSnapshot?.(batchSnapshot);
    };

    const indexerSnapshot = await this.safeFetchIndexerSnapshot(excluded);
    if (indexerSnapshot) {
      this.mergeBootstrapSnapshot(snapshot, indexerSnapshot.snapshot);
      reportBatch(indexerSnapshot.snapshot);
      for (const stream of indexerSnapshot.loadedStreams) {
        loadedStreams.add(stream);
        namesOnlyStreams.add(stream);
      }
      if (this.snapshotResourceCount(snapshot) >= minimumResources) {
        return { snapshot, loadedStreams, namesOnlyStreams };
      }
    }

    const prioritized = EdaApiClient.FAST_BOOTSTRAP_STREAMS.filter(
      (stream) => availableSet.has(stream) && !loadedStreams.has(stream)
    );
    if (prioritized.length > 0) {
      const prioritizedBatchSize = Math.max(1, Math.min(additionalBatchSize, bootstrapParallelism));
      for (let index = 0; index < prioritized.length; index += prioritizedBatchSize) {
        const batch = prioritized.slice(index, index + prioritizedBatchSize);
        const prioritizedSnapshot = await this.bootstrapStreamItems(namespaces, {
          excludeStreams: excluded,
          includeStreams: new Set(batch),
          namesOnly: true,
          namesOnlyStreams,
        });
        this.mergeBootstrapSnapshot(snapshot, prioritizedSnapshot);
        reportBatch(prioritizedSnapshot);
        for (const stream of batch) {
          loadedStreams.add(stream);
        }
        if (this.snapshotResourceCount(snapshot) >= minimumResources) {
          return { snapshot, loadedStreams, namesOnlyStreams };
        }
      }
    }

    const remaining = available.filter((stream) => !loadedStreams.has(stream));
    for (let index = 0; index < remaining.length; index += additionalBatchSize) {
      const batch = remaining.slice(index, index + additionalBatchSize);
      const batchSnapshot = await this.bootstrapStreamItems(namespaces, {
        excludeStreams: excluded,
        includeStreams: new Set(batch),
        namesOnly: true,
        namesOnlyStreams,
      });
      this.mergeBootstrapSnapshot(snapshot, batchSnapshot);
      reportBatch(batchSnapshot);
      for (const stream of batch) {
        loadedStreams.add(stream);
      }
      if (this.snapshotResourceCount(snapshot) >= minimumResources) {
        break;
      }
    }

    return { snapshot, loadedStreams, namesOnlyStreams };
  }

  public async isIndexerAvailable(): Promise<boolean> {
    try {
      await this.fetchText(`${INDEXER_RESOURCES_PATH}?limit=1`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get EDA resource YAML
   */
  public async getEdaResourceYaml(
    kind: string,
    name: string,
    namespace: string,
    apiVersion?: string
  ): Promise<string> {
    const plural = kindToPlural(kind);
    let group = 'core.eda.nokia.com';
    let version = 'v1';
    if (apiVersion && apiVersion.includes('/')) {
      const parts = apiVersion.split('/');
      group = parts[0];
      version = parts[1];
    }

    const groupPascal = group
      .split(/[.-]/)
      .map(p => p.charAt(0).toUpperCase() + p.slice(1))
      .join('');
    const versionPascal = version.charAt(0).toUpperCase() + version.slice(1);
    const pluralPascal = plural
      .split(/[.-]/)
      .map(p => p.charAt(0).toUpperCase() + p.slice(1))
      .join('');

    let path = '';
    if (this.specManager) {
      // First try namespaced operationId
      const namespacedOpId = `read${groupPascal}${versionPascal}Namespace${pluralPascal}`;
      try {
        const template = await this.specManager.getPathByOperationId(namespacedOpId);
        path = template
          .replace(PARAM_NAMESPACE, namespace)
          .replace(PARAM_NAME, name);
      } catch {
        // If not found, try cluster scoped operation
        const clusterOpId = `read${groupPascal}${versionPascal}${pluralPascal}`;
        try {
          const template = await this.specManager.getPathByOperationId(clusterOpId);
          path = template.replace(PARAM_NAME, name);
        } catch {
          // fall back to manual path below
        }
      }
    }

    if (!path) {
      // Default to namespaced path, but allow for cluster scoped resources
      const nsPart = namespace ? `/namespaces/${namespace}` : '';
      path = `/apps/${group}/${version}${nsPart}/${plural}/${name}`;
    }

    const data = await this.fetchJSON<K8sResource>(path);
    const sanitized = sanitizeResource(data);
    return yaml.dump(sanitized, { indent: 2 });
  }

  /**
   * Create a DeviationAction resource
   */
  public async createDeviationAction(namespace: string, action: DeviationAction): Promise<K8sResource> {
    return this.requestJSON<K8sResource>('POST', `/apps/core.eda.nokia.com/v1/namespaces/${namespace}/deviationactions`, action);
  }

  /**
   * Restore system configuration to the specified transaction
   */
  public async restoreTransaction(transactionId: string | number): Promise<unknown> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const template = await this.specManager.getPathByOperationId('transRestoreTransaction');
    const path = template.replace(PARAM_TRANSACTION_ID, String(transactionId));
    return this.requestJSON('POST', path);
  }

  /**
   * Revert the specified transaction
   */
  public async revertTransaction(transactionId: string | number): Promise<unknown> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const template = await this.specManager.getPathByOperationId('transRevertTransaction');
    const path = template.replace(PARAM_TRANSACTION_ID, String(transactionId));
    return this.requestJSON('POST', path);
  }

  /**
   * Run a transaction
   */
  public async runTransaction(transaction: unknown): Promise<number> {
    log('POST /core/transaction/v2', LogLevel.INFO, true);
    log(JSON.stringify(transaction, null, 2), LogLevel.DEBUG);
    const result = await this.requestJSON<TransactionRunResult>(
      'POST',
      '/core/transaction/v2',
      transaction,
    );
    log(`POST /core/transaction/v2 -> ${result.id}`, LogLevel.INFO, true);
    return result.id;
  }

  /**
   * Create a custom resource
   */
  public async createCustomResource(
    group: string,
    version: string,
    namespace: string | undefined,
    plural: string,
    body: K8sResource,
    namespaced = true,
    dryRun = false
  ): Promise<K8sResource> {
    const nsPart = namespaced ? `/namespaces/${namespace}` : '';
    const path = `/apps/${group}/${version}${nsPart}/${plural}`;
    const url = dryRun ? `${path}?dryRun=true` : path;
    return this.requestJSON<K8sResource>('POST', url, body);
  }

  /**
   * Update an existing custom resource
   */
  public async updateCustomResource(
    group: string,
    version: string,
    namespace: string | undefined,
    plural: string,
    name: string,
    body: K8sResource,
    namespaced = true,
    dryRun = false
  ): Promise<K8sResource> {
    const nsPart = namespaced ? `/namespaces/${namespace}` : '';
    const path = `/apps/${group}/${version}${nsPart}/${plural}/${name}`;
    const url = dryRun ? `${path}?dryRun=true` : path;
    return this.requestJSON<K8sResource>('PUT', url, body);
  }

  /**
   * Delete a custom resource
   */
  public async deleteCustomResource(
    group: string,
    version: string,
    namespace: string | undefined,
    plural: string,
    name: string,
    namespaced = true
  ): Promise<unknown> {
    const nsPart = namespaced ? `/namespaces/${namespace}` : '';
    const path = `/apps/${group}/${version}${nsPart}/${plural}/${name}`;
    return this.requestJSON('DELETE', path);
  }

  /**
   * Validate custom resources
   */
  public async validateCustomResources(resources: K8sResource[]): Promise<void> {
    await this.requestJSON('POST', '/core/transaction/v2/validate', resources);
  }

  /**
   * Fetch transaction summary results
   */
  public async getEdaTransactions(size = 50): Promise<TransactionSummary[]> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const path = await this.specManager.getPathByOperationId('transGetSummaryResultList');
    const data = await this.fetchJSON<TransactionResultList>(`${path}?size=${size}`);
    return Array.isArray(data.results) ? data.results : [];
  }

  /**
   * Fetch summary information for a single transaction
   */
  public async getTransactionSummary(transactionId: string | number): Promise<TransactionSummary> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const template = await this.specManager.getPathByOperationId('transGetSummaryResult');
    const path = template.replace(PARAM_TRANSACTION_ID, String(transactionId));
    return this.fetchJSON<TransactionSummary>(path);
  }

  /**
   * Fetch detailed information for a single transaction
   */
  public async getTransactionDetails(
    transactionId: string | number,
    waitForComplete = false,
    failOnErrors = false
  ): Promise<TransactionSummary & TransactionExecution & TransactionInputResources> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const summaryTemplate = await this.specManager.getPathByOperationId(
      'transGetSummaryResult'
    );
    const summaryPath = summaryTemplate.replace(
      PARAM_TRANSACTION_ID,
      String(transactionId)
    );

    const execTemplate = await this.specManager.getPathByOperationId(
      'transGetResultExecution'
    );
    const execPath = execTemplate.replace(
      PARAM_TRANSACTION_ID,
      String(transactionId)
    );
    const params: string[] = [];
    if (waitForComplete) {
      params.push('waitForComplete=true');
    }
    if (failOnErrors) {
      params.push('failOnErrors=true');
    }
    const execUrl = params.length > 0 ? `${execPath}?${params.join('&')}` : execPath;

    const inputTemplate = await this.specManager.getPathByOperationId(
      'transGetResultInputResources'
    );
    const inputPath = inputTemplate.replace(PARAM_TRANSACTION_ID, String(transactionId));

    const [summary, execution, inputResources] = await Promise.all([
      this.fetchJSON<TransactionSummary>(summaryPath),
      this.fetchJSON<TransactionExecution>(execUrl),
      this.fetchJSON<TransactionInputResources>(inputPath)
    ]);

    return { ...summary, ...execution, ...inputResources };
  }

  /**
   * Fetch the diff for a resource in a transaction
   */
  public async getResourceDiff(
    transactionId: string | number,
    group: string,
    version: string,
    kind: string,
    name: string,
    namespace: string
  ): Promise<unknown> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const template = await this.specManager.getPathByOperationId('transGetResourceDiff');
    const path = template.replace(PARAM_TRANSACTION_ID, String(transactionId));
    const params = new URLSearchParams({ group, version, kind, name, namespace });
    return this.fetchJSON(path + '?' + params.toString());
  }

  /**
   * Fetch the diff for a node configuration in a transaction
   */
  public async getNodeConfigDiff(
    transactionId: string | number,
    node: string,
    namespace: string
  ): Promise<unknown> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const template = await this.specManager.getPathByOperationId('transGetNodeConfigDiff');
    const path = template.replace(PARAM_TRANSACTION_ID, String(transactionId));
    const params = new URLSearchParams({ node, namespace });
    return this.fetchJSON(path + '?' + params.toString());
  }

  /**
   * Retrieve a file from the user storage API
   */
  public async getUserStorageFile(path: string): Promise<string | undefined> {
    const res = await this.fetchJSON<UserStorageFileResponse>(`/core/user-storage/v2/file?path=${encodeURIComponent(path)}`);
    if (typeof res['file-content'] === 'string') {
      return res['file-content'];
    }
    return undefined;
  }

  /**
   * Save a file via the user storage API
   */
  public async putUserStorageFile(path: string, content: string): Promise<void> {
    await this.requestJSON('PUT', `/core/user-storage/v2/file?path=${encodeURIComponent(path)}`, {
      'file-content': content
    });
  }

  /**
   * Fetch the running configuration for a node
   */
  public async getNodeConfig(namespace: string, node: string): Promise<unknown> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const template = await this.specManager.getPathByOperationId('toolsGetNodeConfig');
    const path = template
      .replace('{nsName}', namespace)
      .replace(PARAM_NAMESPACE, namespace)
      .replace('{nodeName}', node)
      .replace('{node}', node);
    return this.fetchJSON(path);
  }

  /**
   * List TopoNodes in a namespace
   */
  public async listTopoNodes(namespace: string): Promise<K8sResource[]> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const template = await this.specManager.getPathByOperationId(
      'listCoreEdaNokiaComV1NamespaceToponodes'
    );
    const path = template.replace(PARAM_NAMESPACE, namespace);
    const data = await this.fetchJSON<K8sResourceList>(path);
    return Array.isArray(data.items) ? data.items : [];
  }

  /**
   * Get a specific TopoNode in a namespace
   */
  public async getTopoNode(namespace: string, name: string): Promise<K8sResource> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const template = await this.specManager.getPathByOperationId(
      'readCoreEdaNokiaComV1NamespaceToponodes'
    );
    const path = template
      .replace(PARAM_NAMESPACE, namespace)
      .replace(PARAM_NAME, name);
    return this.fetchJSON<K8sResource>(path);
  }

  /**
   * List NodeUsers in a namespace
   */
  public async listNodeUsers(namespace: string): Promise<K8sResource[]> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const template = await this.specManager.getPathByOperationId(
      'listCoreEdaNokiaComV1NamespaceNodeusers'
    );
    const path = template.replace(PARAM_NAMESPACE, namespace);
    const data = await this.fetchJSON<K8sResourceList>(path);
    return Array.isArray(data.items) ? data.items : [];
  }

  /**
   * List Interfaces in a namespace
   */
  public async listInterfaces(namespace: string): Promise<K8sResource[]> {
    let path = '';
    if (this.specManager) {
      try {
        const template = await this.specManager.getPathByOperationId(
          'listInterfacesEdaNokiaComV1alpha1NamespaceInterfaces'
        );
        path = template.replace(PARAM_NAMESPACE, namespace);
      } catch {
        // fallback to manual path below
      }
    }
    if (!path) {
      path = `/apps/interfaces.eda.nokia.com/v1alpha1/namespaces/${namespace}/interfaces`;
    }
    const data = await this.fetchJSON<K8sResourceList>(path);
    return Array.isArray(data.items) ? data.items : [];
  }

  /**
   * List TopoLinks in a namespace
   */
  public async listTopoLinks(namespace: string): Promise<K8sResource[]> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const template = await this.specManager.getPathByOperationId(
      'listCoreEdaNokiaComV1NamespaceTopolinks'
    );
    const path = template.replace(PARAM_NAMESPACE, namespace);
    const data = await this.fetchJSON<K8sResourceList>(path);
    return Array.isArray(data.items) ? data.items : [];
  }

  /**
   * List available namespaces from the API server.
   */
  public async listNamespaces(): Promise<string[]> {
    const data = await this.fetchJSON<K8sResourceList>('/api/v1/namespaces');
    const items = Array.isArray(data.items) ? data.items : [];
    const namespaces = new Set<string>();
    for (const item of items) {
      const name = item.metadata?.name;
      if (typeof name === 'string' && name.length > 0) {
        namespaces.add(name);
      }
    }
    return Array.from(namespaces).sort((a, b) => a.localeCompare(b));
  }

  /**
   * List resources for the given G/V/K.
   * Discovers endpoints via operation IDs and supplements with per-namespace reads.
   */
  public async listResources(
    group: string,
    version: string,
    kind: string,
    namespace?: string
  ): Promise<K8sResource[]> {
    const plural = kindToPlural(kind);
    const ids = this.buildOperationIds(group, version, kind);
    const namespaced = typeof namespace === 'string' && namespace.length > 0;

    if (namespaced) {
      const path = await this.resolvePathFromOperationIds(
        [...ids.listNamespaced, ...ids.listAll],
        { [PARAM_NAMESPACE]: namespace }
      );

      const resolvedPath = path ?? `/apps/${group}/${version}/namespaces/${namespace}/${plural}`;
      const data = await this.fetchJSON<K8sResourceList>(resolvedPath);
      return Array.isArray(data.items) ? data.items : [];
    }

    return this.listWithNamespacedSupplement(
      async () => {
        const path = await this.resolvePathFromOperationIds(ids.listAll);
        const resolvedPath = path ?? `/apps/${group}/${version}/${plural}`;
        const data = await this.fetchJSON<K8sResourceList>(resolvedPath);
        return Array.isArray(data.items) ? data.items : [];
      },
      async (targetNamespace) => this.listResources(group, version, kind, targetNamespace)
    );
  }

  /**
   * Create a resource for the given G/V/K.
   * Discovers endpoints via operation IDs.
   */
  public async createResource(
    group: string,
    version: string,
    kind: string,
    resource: K8sResource,
    namespace?: string
  ): Promise<K8sResource> {
    const plural = kindToPlural(kind);
    const ids = this.buildOperationIds(group, version, kind);
    const namespaced = typeof namespace === 'string' && namespace.length > 0;

    const path = await this.resolvePathFromOperationIds(
      namespaced
        ? [...ids.createNamespaced, ...ids.createAll]
        : ids.createAll,
      namespaced ? { [PARAM_NAMESPACE]: namespace } : {}
    );

    const resolvedPath = path ?? (
      namespaced
        ? `/apps/${group}/${version}/namespaces/${namespace}/${plural}`
        : `/apps/${group}/${version}/${plural}`
    );

    return this.requestJSON<K8sResource>('POST', resolvedPath, resource);
  }

  /**
   * Read requested workflow inputs from a workflow _input endpoint.
   */
  public async getWorkflowInputs(path: string): Promise<WorkflowGetInputsRespElem[]> {
    const response = await this.requestJSON<unknown>('GET', path);
    return Array.isArray(response) ? response as WorkflowGetInputsRespElem[] : [];
  }

  /**
   * Submit workflow input to a workflow _input endpoint.
   */
  public async submitWorkflowInput(path: string, data: WorkflowInputDataElem[]): Promise<void> {
    await this.requestJSON('PUT', path, data);
  }

  /**
   * Get resource YAML for the given G/V/K and name.
   */
  public async getResourceYaml(
    group: string,
    version: string,
    kind: string,
    name: string,
    namespace?: string
  ): Promise<string> {
    const plural = kindToPlural(kind);
    const ids = this.buildOperationIds(group, version, kind);
    const namespaced = typeof namespace === 'string' && namespace.length > 0;

    const path = await this.resolvePathFromOperationIds(
      namespaced
        ? [...ids.readNamespaced, ...ids.readAll]
        : ids.readAll,
      namespaced
        ? { [PARAM_NAMESPACE]: namespace, [PARAM_NAME]: name }
        : { [PARAM_NAME]: name }
    );

    const resolvedPath = path ?? (
      namespaced
        ? `/apps/${group}/${version}/namespaces/${namespace}/${plural}/${name}`
        : `/apps/${group}/${version}/${plural}/${name}`
    );

    const data = await this.fetchJSON<K8sResource>(resolvedPath);
    const sanitized = sanitizeResource(data);
    return yaml.dump(sanitized, { indent: 2 });
  }

  /**
   * List Topologies
   */
  public async listTopologies(): Promise<unknown[]> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const path = await this.specManager.getPathByOperationId('topologies');
    const data = await this.fetchJSON<unknown[]>(path);
    return Array.isArray(data) ? data : [];
  }

  /**
   * List TopologyGroupings for a specific topology
   */
  public async listTopologyGroupings(topologyName: string): Promise<K8sResource[]> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const template = await this.specManager.getPathByOperationId(
      'getTopologyGroupings'
    );
    const path = template.replace('{topologyName}', topologyName);
    const data = await this.fetchJSON<K8sResourceList>(path);
    return Array.isArray(data.items) ? data.items : [];
  }

  /**
   * Execute an EQL query
   */
  public async queryEql(query: string, namespaces?: string): Promise<unknown> {
    let path = `/core/query/v1/eql?query=${encodeURIComponent(query)}`;
    if (namespaces) {
      path += `&namespaces=${encodeURIComponent(namespaces)}`;
    }
    return this.fetchJSON(path);
  }

  /**
   * Get EQL autocomplete suggestions
   */
  public async autocompleteEql(
    query: string,
    limit = 20
  ): Promise<string[]> {
    const base = `/core/query/v1/eql/autocomplete?query=${encodeURIComponent(query)}`;
    const path = `${base}&completion_limit=${limit}`;
    const data = await this.fetchJSON<EqlAutocompleteResponse>(path);
    return Array.isArray(data.completions)
      ? data.completions
          .map((c: EqlCompletionItem) => {
            if (typeof c.token === 'string') {
              return c.token;
            }
            if (typeof c.completion === 'string') {
              return `${query}${c.completion}`;
            }
            return undefined;
          })
          .filter((c: string | undefined): c is string => typeof c === 'string')
      : [];
  }
}
