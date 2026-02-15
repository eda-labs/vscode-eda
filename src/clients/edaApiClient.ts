import { fetch } from 'undici';
import * as yaml from 'js-yaml';

import { LogLevel, log } from '../extension';
import { sanitizeResource } from '../utils/yamlUtils';
import { kindToPlural } from '../utils/pluralUtils';

import type { EdaAuthClient } from './edaAuthClient';
import type { EdaSpecManager } from './edaSpecManager';

// Constants for duplicate strings
const MSG_TOKEN_EXPIRED = 'Access token expired, refreshing...';
const MSG_SPEC_NOT_INIT = 'Spec manager not initialized';
const PARAM_NAMESPACE = '{namespace}';
const PARAM_TRANSACTION_ID = '{transactionId}';
const PARAM_NAME = '{name}';

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

/**
 * Client for EDA REST API operations
 */
export class EdaApiClient {
  private authClient: EdaAuthClient;
  private specManager?: EdaSpecManager;

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

    return (await res.json()) as T;
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
