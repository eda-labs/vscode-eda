import { fetch } from 'undici';
import { LogLevel, log } from '../extension';
import type { paths, components } from '../openapi/core';

/**
 * Client for interacting with the EDA REST API
 */
export class EdactlClient {
  private baseUrl: string;
  private kcUrl: string;
  private headers: Record<string, string> = {};
  private token = '';

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.kcUrl = `${this.baseUrl}/core/httpproxy/v1/keycloak`;
    void this.auth();
  }

  private async auth(): Promise<void> {
    log('Authenticating with EDA API server', LogLevel.INFO);
    const url = `${this.kcUrl}/realms/eda/protocol/openid-connect/token`;
    const params = new URLSearchParams();
    params.set('grant_type', 'password');
    params.set('client_id', process.env.EDA_CLIENT_ID || 'eda');
    params.set('username', process.env.EDA_USERNAME || 'admin');
    params.set('password', process.env.EDA_PASSWORD || 'admin');
    if (process.env.EDA_CLIENT_SECRET) {
      params.set('client_secret', process.env.EDA_CLIENT_SECRET);
    }

    const res = await fetch(url, {
      method: 'POST',
      body: params,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

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
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers });
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
