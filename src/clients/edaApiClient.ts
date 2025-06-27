import { fetch } from 'undici';
import { LogLevel, log } from '../extension';
import type { EdaAuthClient } from './edaAuthClient';
import type { EdaSpecManager } from './edaSpecManager';

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
        log('Access token expired, refreshing...', LogLevel.INFO);
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
        log('Access token expired, refreshing...', LogLevel.INFO);
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
        log('Access token expired, refreshing...', LogLevel.INFO);
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
  public async getEdaResourceYaml(kind: string, name: string, namespace: string): Promise<string> {
    const plural = kind.toLowerCase() + 's';
    const data = await this.fetchJSON<any>(`/apps/core.eda.nokia.com/v1/namespaces/${namespace}/${plural}/${name}`);
    return JSON.stringify(data, null, 2);
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
    const path = `/core/transaction/v2/restore/${transactionId}`;
    return this.requestJSON('POST', path);
  }

  /**
   * Revert the specified transaction
   */
  public async revertTransaction(transactionId: string | number): Promise<any> {
    const path = `/core/transaction/v2/revert/${transactionId}`;
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
    const path = '/core/transaction/v2/result/summary';
    const data = await this.fetchJSON<any>(`${path}?size=${size}`);
    return Array.isArray(data?.results) ? data.results : [];
  }

  /**
   * Fetch summary information for a single transaction
   */
  public async getTransactionSummary(transactionId: string | number): Promise<any> {
    const path = `/core/transaction/v2/result/summary/${transactionId}`;
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
    const path = `/core/alltransaction/v1/details/${transactionId}`;
    const params: string[] = [];
    if (waitForComplete) {
      params.push('waitForComplete=true');
    }
    if (failOnErrors) {
      params.push('failOnErrors=true');
    }
    const url = params.length > 0 ? `${path}?${params.join('&')}` : path;
    return this.fetchJSON<any>(url);
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
      throw new Error('Spec manager not initialized');
    }
    const template = await this.specManager.getPathByOperationId('toolsGetNodeConfig');
    const path = template
      .replace('{nsName}', namespace)
      .replace('{namespace}', namespace)
      .replace('{nodeName}', node)
      .replace('{node}', node);
    return this.fetchJSON<any>(path);
  }
}