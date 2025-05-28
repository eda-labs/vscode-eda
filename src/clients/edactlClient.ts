import { fetch } from 'undici';
import { LogLevel, log } from '../extension';
import type { paths, components } from '../openapi/core';

/**
 * Client for interacting with the EDA REST API
 */
export interface EdactlOptions {
  edaUsername?: string;
  edaPassword?: string;
  kcUsername?: string;
  kcPassword?: string;
  clientId?: string;
  clientSecret?: string;
}

export class EdactlClient {
  private baseUrl: string;
  private kcUrl: string;
  private headers: Record<string, string> = {};
  private token = '';
  private edaUsername: string;
  private edaPassword: string;
  private kcUsername: string;
  private kcPassword: string;
  private clientId: string;
  private clientSecret?: string;

  constructor(baseUrl: string, opts: EdactlOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.kcUrl = `${this.baseUrl}/core/httpproxy/v1/keycloak`;
    this.edaUsername = opts.edaUsername || process.env.EDA_USERNAME || 'admin';
    this.edaPassword = opts.edaPassword || process.env.EDA_PASSWORD || 'admin';
    this.kcUsername = opts.kcUsername || process.env.EDA_KC_USERNAME || 'admin';
    this.kcPassword = opts.kcPassword || process.env.EDA_KC_PASSWORD || 'admin';
    this.clientId = opts.clientId || process.env.EDA_CLIENT_ID || 'eda';
    this.clientSecret = opts.clientSecret || process.env.EDA_CLIENT_SECRET;
    log(
      `EdactlClient initialized for ${this.baseUrl} (clientId=${this.clientId})`,
      LogLevel.DEBUG,
    );
    void this.auth();
  }

  private async fetchAdminToken(): Promise<string> {
    const url = `${this.kcUrl}/realms/master/protocol/openid-connect/token`;
    log(`Requesting Keycloak admin token from ${url}`, LogLevel.DEBUG);
    const params = new URLSearchParams();
    params.set('grant_type', 'password');
    params.set('client_id', 'admin-cli');
    params.set('username', this.kcUsername);
    params.set('password', this.kcPassword);

    const res = await fetch(url, {
      method: 'POST',
      body: params,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    log(`Admin token response status ${res.status}`, LogLevel.DEBUG);

    if (!res.ok) {
      throw new Error(`Failed Keycloak admin login: HTTP ${res.status}`);
    }

    const data = (await res.json()) as any;
    return data.access_token || '';
  }

  private async fetchClientSecret(adminToken: string): Promise<string> {
    const listUrl = `${this.kcUrl}/admin/realms/eda/clients`;
    log(`Listing clients from ${listUrl}`, LogLevel.DEBUG);
    const res = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }
    });
    log(`List clients response status ${res.status}`, LogLevel.DEBUG);
    if (!res.ok) {
      throw new Error(`Failed to list clients: HTTP ${res.status}`);
    }
    const clients = (await res.json()) as any[];
    const client = clients.find(c => c.clientId === this.clientId);
    if (!client) {
      throw new Error(`Client '${this.clientId}' not found in realm 'eda'`);
    }
    const secretUrl = `${listUrl}/${client.id}/client-secret`;
    log(`Fetching client secret from ${secretUrl}`, LogLevel.DEBUG);
    const secretRes = await fetch(secretUrl, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }
    });
    log(`Client secret response status ${secretRes.status}`, LogLevel.DEBUG);
    if (!secretRes.ok) {
      throw new Error(`Failed to fetch client secret: HTTP ${secretRes.status}`);
    }
    const secretJson = (await secretRes.json()) as any;
    return secretJson.value || '';
  }

  private async auth(): Promise<void> {
    log('Authenticating with EDA API server', LogLevel.INFO);
    log(`Token endpoint ${this.kcUrl}/realms/eda/protocol/openid-connect/token`, LogLevel.DEBUG);
    if (!this.clientSecret) {
      try {
        const adminToken = await this.fetchAdminToken();
        this.clientSecret = await this.fetchClientSecret(adminToken);
      } catch (err) {
        log(`Failed to auto-fetch client secret: ${err}`, LogLevel.WARN, true);
      }
    }
    const url = `${this.kcUrl}/realms/eda/protocol/openid-connect/token`;
    const params = new URLSearchParams();
    params.set('grant_type', 'password');
    params.set('client_id', this.clientId);
    params.set('username', this.edaUsername);
    params.set('password', this.edaPassword);
    if (this.clientSecret) {
      params.set('client_secret', this.clientSecret);
    }

    const res = await fetch(url, {
      method: 'POST',
      body: params,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    log(`Auth response status ${res.status}`, LogLevel.DEBUG);

    if (!res.ok) {
      throw new Error(`Failed to authenticate: HTTP ${res.status}`);
    }

    const data = (await res.json()) as any;
    this.token = data.access_token || '';
    this.headers = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json'
    };
  }

  private async fetchJSON<T>(path: keyof paths): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    log(`GET ${url}`, LogLevel.DEBUG);
    const res = await fetch(url, { headers: this.headers });
    log(`GET ${url} -> ${res.status}`, LogLevel.DEBUG);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  }

  /** Get accessible EDA namespaces */
  public async getEdaNamespaces(): Promise<string[]> {
    const data = await this.fetchJSON<components['schemas']['NamespaceGetResponse']>('/core/access/v1/namespaces');
    const list = data.namespaces || [];
    return list.map(n => n.name || '').filter(n => n);
  }

  /** Get recent transactions */
  public async getEdaTransactions(): Promise<any[]> {
    const data = await this.fetchJSON<components['schemas']['TransactionSummaryResults']>('/core/transaction/v1/resultsummary');
    return (data.results as any[]) || [];
  }

  /** Get details for a transaction */
  public async getTransactionDetails(id: string): Promise<string> {
    const data = await this.fetchJSON<components['schemas']['TransactionDetails']>(`/core/transaction/v1/details/${id}` as keyof paths);
    return JSON.stringify(data, null, 2);
  }

  /** Get current alarms */
  public async getEdaAlarms(): Promise<any[]> {
    const data = await this.fetchJSON<any[]>('/core/alarm/v2/alarms');
    return data as any[];
  }

  /** Get alarm details by id */
  public async getAlarmDetails(id: string): Promise<string> {
    const alarm = (await this.getEdaAlarms()).find(a => a.name === id);
    return alarm ? JSON.stringify(alarm, null, 2) : 'Not found';
  }

  /** Get deviations within a namespace */
  public async getEdaDeviations(namespace = 'default'): Promise<any[]> {
    const data = await this.fetchJSON<any>(`/apps/core.eda.nokia.com/v1/namespaces/${namespace}/deviations` as keyof paths);
    return data.items || [];
  }

  /** Fetch a resource YAML using EDA API */
  public async getEdaResourceYaml(kind: string, name: string, namespace: string): Promise<string> {
    const plural = kind.toLowerCase() + 's';
    const data = await this.fetchJSON<any>(`/apps/core.eda.nokia.com/v1/namespaces/${namespace}/${plural}/${name}` as keyof paths);
    return JSON.stringify(data, null, 2);
  }

  /** Execute a limited set of edactl-style commands for compatibility */
  public async executeEdactl(command: string): Promise<string> {
    const getMatch = command.match(/^get\s+deviation\s+(\S+)\s+-n\s+(\S+)\s+-o\s+yaml$/);
    if (getMatch) {
      const [, name, ns] = getMatch;
      return this.getEdaResourceYaml('deviation', name, ns);
    }
    throw new Error('executeEdactl not supported in API mode');
  }

  /** Placeholder for compatibility */
  public clearCache(): void {
    // no-op in API mode
  }
}
