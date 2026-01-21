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
  public async fetchJSON<T = any>(path: string): Promise<T> {
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
  public async requestJSON<T = any>(
    method: string,
    path: string,
    body?: any
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
  public async fetchJsonUrl(url: string): Promise<any> {
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
    return JSON.parse(text);
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

    const data = await this.fetchJSON<any>(path);
    const sanitized = sanitizeResource(data);
    return yaml.dump(sanitized, { indent: 2 });
  }

  /**
   * Create a DeviationAction resource
   */
  public async createDeviationAction(namespace: string, action: any): Promise<any> {
    return this.requestJSON('POST', `/apps/core.eda.nokia.com/v1/namespaces/${namespace}/deviationactions`, action);
  }

  /**
   * Restore system configuration to the specified transaction
   */
  public async restoreTransaction(transactionId: string | number): Promise<any> {
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
  public async revertTransaction(transactionId: string | number): Promise<any> {
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
  public async runTransaction(transaction: any): Promise<number> {
    log('POST /core/transaction/v2', LogLevel.INFO, true);
    log(JSON.stringify(transaction, null, 2), LogLevel.DEBUG);
    const result = await this.requestJSON<{ id: number }>(
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
    body: any,
    namespaced = true,
    dryRun = false
  ): Promise<any> {
    const nsPart = namespaced ? `/namespaces/${namespace}` : '';
    const path = `/apps/${group}/${version}${nsPart}/${plural}`;
    const url = dryRun ? `${path}?dryRun=true` : path;
    return this.requestJSON('POST', url, body);
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
    body: any,
    namespaced = true,
    dryRun = false
  ): Promise<any> {
    const nsPart = namespaced ? `/namespaces/${namespace}` : '';
    const path = `/apps/${group}/${version}${nsPart}/${plural}/${name}`;
    const url = dryRun ? `${path}?dryRun=true` : path;
    return this.requestJSON('PUT', url, body);
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
  ): Promise<any> {
    const nsPart = namespaced ? `/namespaces/${namespace}` : '';
    const path = `/apps/${group}/${version}${nsPart}/${plural}/${name}`;
    return this.requestJSON('DELETE', path);
  }

  /**
   * Validate custom resources
   */
  public async validateCustomResources(resources: any[]): Promise<void> {
    await this.requestJSON('POST', '/core/transaction/v2/validate', resources);
  }

  /**
   * Fetch transaction summary results
   */
  public async getEdaTransactions(size = 50): Promise<any[]> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const path = await this.specManager.getPathByOperationId('transGetSummaryResultList');
    const data = await this.fetchJSON<any>(`${path}?size=${size}`);
    return Array.isArray(data?.results) ? data.results : [];
  }

  /**
   * Fetch summary information for a single transaction
   */
  public async getTransactionSummary(transactionId: string | number): Promise<any> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const template = await this.specManager.getPathByOperationId('transGetSummaryResult');
    const path = template.replace(PARAM_TRANSACTION_ID, String(transactionId));
    return this.fetchJSON<any>(path);
  }

  /**
   * Fetch detailed information for a single transaction
   */
  public async getTransactionDetails(
    transactionId: string | number,
    waitForComplete = false,
    failOnErrors = false
  ): Promise<any> {
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
      this.fetchJSON<any>(summaryPath),
      this.fetchJSON<any>(execUrl),
      this.fetchJSON<any>(inputPath)
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
  ): Promise<any> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const template = await this.specManager.getPathByOperationId('transGetResourceDiff');
    const path = template.replace(PARAM_TRANSACTION_ID, String(transactionId));
    const params = new URLSearchParams({ group, version, kind, name, namespace });
    return this.fetchJSON<any>(`${path}?${params.toString()}`);
  }

  /**
   * Fetch the diff for a node configuration in a transaction
   */
  public async getNodeConfigDiff(
    transactionId: string | number,
    node: string,
    namespace: string
  ): Promise<any> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const template = await this.specManager.getPathByOperationId('transGetNodeConfigDiff');
    const path = template.replace(PARAM_TRANSACTION_ID, String(transactionId));
    const params = new URLSearchParams({ node, namespace });
    return this.fetchJSON<any>(`${path}?${params.toString()}`);
  }

  /**
   * Retrieve a file from the user storage API
   */
  public async getUserStorageFile(path: string): Promise<string | undefined> {
    const res = await this.fetchJSON<any>(`/core/user-storage/v2/file?path=${encodeURIComponent(path)}`);
    if (typeof res?.['file-content'] === 'string') {
      return res['file-content'] as string;
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
  public async getNodeConfig(namespace: string, node: string): Promise<any> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const template = await this.specManager.getPathByOperationId('toolsGetNodeConfig');
    const path = template
      .replace('{nsName}', namespace)
      .replace(PARAM_NAMESPACE, namespace)
      .replace('{nodeName}', node)
      .replace('{node}', node);
    return this.fetchJSON<any>(path);
  }

  /**
   * List TopoNodes in a namespace
   */
  public async listTopoNodes(namespace: string): Promise<any[]> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const template = await this.specManager.getPathByOperationId(
      'listCoreEdaNokiaComV1NamespaceToponodes'
    );
    const path = template.replace(PARAM_NAMESPACE, namespace);
    const data = await this.fetchJSON<any>(path);
    return Array.isArray(data?.items) ? data.items : [];
  }

  /**
   * Get a specific TopoNode in a namespace
   */
  public async getTopoNode(namespace: string, name: string): Promise<any> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const template = await this.specManager.getPathByOperationId(
      'readCoreEdaNokiaComV1NamespaceToponodes'
    );
    const path = template
      .replace(PARAM_NAMESPACE, namespace)
      .replace(PARAM_NAME, name);
    return this.fetchJSON<any>(path);
  }

  /**
   * List NodeUsers in a namespace
   */
  public async listNodeUsers(namespace: string): Promise<any[]> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const template = await this.specManager.getPathByOperationId(
      'listCoreEdaNokiaComV1NamespaceNodeusers'
    );
    const path = template.replace(PARAM_NAMESPACE, namespace);
    const data = await this.fetchJSON<any>(path);
    return Array.isArray(data?.items) ? data.items : [];
  }

  /**
   * List Interfaces in a namespace
   */
  public async listInterfaces(namespace: string): Promise<any[]> {
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
    const data = await this.fetchJSON<any>(path);
    return Array.isArray(data?.items) ? data.items : [];
  }

  /**
   * List TopoLinks in a namespace
   */
  public async listTopoLinks(namespace: string): Promise<any[]> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const template = await this.specManager.getPathByOperationId(
      'listCoreEdaNokiaComV1NamespaceTopolinks'
    );
    const path = template.replace(PARAM_NAMESPACE, namespace);
    const data = await this.fetchJSON<any>(path);
    return Array.isArray(data?.items) ? data.items : [];
  }

  /**
   * List Topologies
   */
  public async listTopologies(): Promise<any[]> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const path = await this.specManager.getPathByOperationId('topologies');
    const data = await this.fetchJSON<any>(path);
    return Array.isArray(data) ? data : [];
  }

  /**
   * List TopologyGroupings for a specific topology
   */
  public async listTopologyGroupings(topologyName: string): Promise<any[]> {
    if (!this.specManager) {
      throw new Error(MSG_SPEC_NOT_INIT);
    }
    const template = await this.specManager.getPathByOperationId(
      'getTopologyGroupings'
    );
    const path = template.replace('{topologyName}', topologyName);
    const data = await this.fetchJSON<any>(path);
    return Array.isArray(data?.items) ? data.items : [];
  }

  /**
   * Execute an EQL query
   */
  public async queryEql(query: string, namespaces?: string): Promise<any> {
    let path = `/core/query/v1/eql?query=${encodeURIComponent(query)}`;
    if (namespaces) {
      path += `&namespaces=${encodeURIComponent(namespaces)}`;
    }
    return this.fetchJSON<any>(path);
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
    const data = await this.fetchJSON<any>(path);
    const completions = Array.isArray(data?.completions)
      ? data.completions
          .map((c: any) => {
            if (typeof c?.token === 'string') {
              return c.token as string;
            }
            if (typeof c?.completion === 'string') {
              return `${query}${c.completion}`;
            }
            return undefined;
          })
          .filter((c: any) => typeof c === 'string')
      : [];
    return completions as string[];
  }
}