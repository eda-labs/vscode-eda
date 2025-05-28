import { fetch, Agent, WebSocket } from 'undici';
import { LogLevel, log } from '../extension';
import type { paths, components } from '../openapi/core';

// eslint-disable-next-line no-unused-vars
export type NamespaceCallback = (arg: string[]) => void;
// eslint-disable-next-line no-unused-vars
export type DeviationCallback = (_: any[]) => void;
// eslint-disable-next-line no-unused-vars
export type TransactionCallback = (_: any[]) => void;

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
  /**
   * Skip TLS verification when connecting to the API. Useful for dev/test
   * environments with self-signed certificates.
   */
  skipTlsVerify?: boolean;
}

export class EdactlClient {
  private baseUrl: string;
  private kcUrl: string;
  private headers: Record<string, string> = {};
  private token = '';
  private authPromise: Promise<void> = Promise.resolve();
  private edaUsername: string;
  private edaPassword: string;
  private kcUsername: string;
  private kcPassword: string;
  private clientId: string;
  private clientSecret?: string;
  private agent: Agent | undefined;
  private namespaceSocket: WebSocket | undefined;
  private alarmSocket: WebSocket | undefined;
  private deviationSocket: WebSocket | undefined;
  private transactionSocket: WebSocket | undefined;

  constructor(baseUrl: string, opts: EdactlOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.kcUrl = `${this.baseUrl}/core/httpproxy/v1/keycloak`;
    this.edaUsername = opts.edaUsername || process.env.EDA_USERNAME || 'admin';
    this.edaPassword = opts.edaPassword || process.env.EDA_PASSWORD || 'admin';
    this.kcUsername = opts.kcUsername || process.env.EDA_KC_USERNAME || 'admin';
    this.kcPassword = opts.kcPassword || process.env.EDA_KC_PASSWORD || 'admin';
    this.clientId = opts.clientId || process.env.EDA_CLIENT_ID || 'eda';
    this.clientSecret = opts.clientSecret || process.env.EDA_CLIENT_SECRET;
    const skipTls = opts.skipTlsVerify || process.env.EDA_SKIP_TLS_VERIFY === 'true';
    this.agent = skipTls ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;
    log(
      `EdactlClient initialized for ${this.baseUrl} (clientId=${this.clientId})`,
      LogLevel.DEBUG,
    );
    this.authPromise = this.auth();
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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      dispatcher: this.agent,
    });

    log(`Admin token response status ${res.status}`, LogLevel.DEBUG);

    if (!res.ok) {
      throw new Error(`Failed Keycloak admin login: HTTP ${res.status}`);
    }

    const data = (await res.json()) as any;
    const token = data.access_token || '';
    log(`Admin token: ${token}`, LogLevel.DEBUG);
    return token;
  }

  private async fetchClientSecret(adminToken: string): Promise<string> {
    const listUrl = `${this.kcUrl}/admin/realms/eda/clients`;
    log(`Listing clients from ${listUrl}`, LogLevel.DEBUG);
    const res = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      dispatcher: this.agent,
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
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      dispatcher: this.agent,
    });
    log(`Client secret response status ${secretRes.status}`, LogLevel.DEBUG);
    if (!secretRes.ok) {
      throw new Error(`Failed to fetch client secret: HTTP ${secretRes.status}`);
    }
    const secretJson = (await secretRes.json()) as any;
    const secret = secretJson.value || '';
    log(`Client secret: ${secret}`, LogLevel.DEBUG);
    return secret;
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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      dispatcher: this.agent,
    });

    log(`Auth response status ${res.status}`, LogLevel.DEBUG);

    if (!res.ok) {
      throw new Error(`Failed to authenticate: HTTP ${res.status}`);
    }

    const data = (await res.json()) as any;
    this.token = data.access_token || '';
    log(`Access token: ${this.token}`, LogLevel.DEBUG);
    this.headers = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json'
    };
  }

  private async fetchJSON<T>(path: keyof paths): Promise<T> {
    await this.authPromise;
    const url = `${this.baseUrl}${path}`;
    log(`GET ${url}`, LogLevel.DEBUG);
    log(`Request headers: ${JSON.stringify(this.headers)}`, LogLevel.DEBUG);
    let res = await fetch(url, { headers: this.headers, dispatcher: this.agent });
    log(`GET ${url} -> ${res.status}`, LogLevel.DEBUG);
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401 && text.includes('Access token has expired')) {
        log('Access token expired, refreshing...', LogLevel.INFO);
        this.authPromise = this.auth();
        await this.authPromise;
        res = await fetch(url, { headers: this.headers, dispatcher: this.agent });
        log(`GET ${url} retry -> ${res.status}`, LogLevel.DEBUG);
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
    }
    return (await res.json()) as T;
  }

  /** Get accessible EDA namespaces */
  public async getEdaNamespaces(): Promise<string[]> {
    const data = await this.fetchJSON<components['schemas']['NamespaceGetResponse']>('/core/access/v1/namespaces');
    const list = data.namespaces || [];
    return list.map(n => n.name || '').filter(n => n);
  }

  /**
   * Stream accessible namespaces over WebSocket.
   * @param onNamespaces Callback invoked with the list of namespace names.
   */
  public async streamEdaNamespaces(onNamespaces: NamespaceCallback): Promise<void> {
    await this.authPromise;
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol.replace('http', 'ws');
    url.pathname = '/core/access/v1/namespaces';
    url.searchParams.set('stream', 'namespaces');
    url.searchParams.set('eventclient', 'vscode-eda');

    const ws = new WebSocket(url, { headers: this.headers, dispatcher: this.agent });
    this.namespaceSocket = ws;

    ws.addEventListener('message', evt => {
      try {
        const data = JSON.parse(String(evt.data));
        const list = data.namespaces || [];
        const names = list.map((n: any) => n.name || '').filter((n: string) => n);
        onNamespaces(names);
      } catch (err) {
        log(`Failed to parse namespace stream message: ${err}`, LogLevel.ERROR);
      }
    });

    ws.addEventListener('error', err => {
      log(`Namespace WebSocket error: ${err}`, LogLevel.ERROR);
    });

    ws.addEventListener('close', () => {
      log('Namespace WebSocket closed', LogLevel.INFO);
    });
  }

  /**
   * Stream alarms over WebSocket.
   * @param onAlarms Callback invoked with the list of alarms.
   */
  // eslint-disable-next-line no-unused-vars
  public async streamEdaAlarms(onAlarms: (_list: any[]) => void): Promise<void> {
    await this.authPromise;
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol.replace('http', 'ws');
    url.pathname = '/core/alarm/v2/alarms';
    url.searchParams.set('stream', 'alarms');
    url.searchParams.set('eventclient', 'vscode-eda');

    const ws = new WebSocket(url, { headers: this.headers, dispatcher: this.agent });
    this.alarmSocket = ws;

    ws.addEventListener('message', evt => {
      try {
        const alarms = JSON.parse(String(evt.data));
        onAlarms(Array.isArray(alarms) ? alarms : []);
      } catch (err) {
        log(`Failed to parse alarm stream message: ${err}`, LogLevel.ERROR);
      }
    });

    ws.addEventListener('error', err => {
      log(`Alarm WebSocket error: ${err}`, LogLevel.ERROR);
    });

    ws.addEventListener('close', () => {
      log('Alarm WebSocket closed', LogLevel.INFO);
    });
  }

  /** Close any open alarm stream */
  public closeAlarmStream(): void {
    this.alarmSocket?.close();
    this.alarmSocket = undefined;
  }

  /** Stream deviations over WebSocket */
  public async streamEdaDeviations(
    onDeviations: DeviationCallback,
    namespace = 'default'
  ): Promise<void> {
    await this.authPromise;
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol.replace('http', 'ws');
    url.pathname = `/apps/core.eda.nokia.com/v1/namespaces/${namespace}/deviations`;
    url.searchParams.set('stream', 'deviations');
    url.searchParams.set('eventclient', 'vscode-eda');

    const ws = new WebSocket(url, { headers: this.headers, dispatcher: this.agent });
    this.deviationSocket = ws;

    ws.addEventListener('message', evt => {
      try {
        const deviations = JSON.parse(String(evt.data));
        onDeviations(Array.isArray(deviations.items) ? deviations.items : []);
      } catch (err) {
        log(`Failed to parse deviation stream message: ${err}`, LogLevel.ERROR);
      }
    });

    ws.addEventListener('error', err => {
      log(`Deviation WebSocket error: ${err}`, LogLevel.ERROR);
    });

    ws.addEventListener('close', () => {
      log('Deviation WebSocket closed', LogLevel.INFO);
    });
  }

  /** Close any open deviation stream */
  public closeDeviationStream(): void {
    this.deviationSocket?.close();
    this.deviationSocket = undefined;
  }

  /** Stream transactions over WebSocket */
  public async streamEdaTransactions(
    onTransactions: TransactionCallback
  ): Promise<void> {
    await this.authPromise;
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol.replace('http', 'ws');
    url.pathname = '/core/transaction/v1/resultsummary';
    url.searchParams.set('size', '50');
    url.searchParams.set('stream', 'transactions');
    url.searchParams.set('eventclient', 'vscode-eda');

    const ws = new WebSocket(url, { headers: this.headers, dispatcher: this.agent });
    this.transactionSocket = ws;

    ws.addEventListener('message', evt => {
      try {
        const txs = JSON.parse(String(evt.data));
        onTransactions(Array.isArray(txs.results) ? txs.results : []);
      } catch (err) {
        log(`Failed to parse transaction stream message: ${err}`, LogLevel.ERROR);
      }
    });

    ws.addEventListener('error', err => {
      log(`Transaction WebSocket error: ${err}`, LogLevel.ERROR);
    });

    ws.addEventListener('close', () => {
      log('Transaction WebSocket closed', LogLevel.INFO);
    });
  }

  /** Close any open transaction stream */
  public closeTransactionStream(): void {
    this.transactionSocket?.close();
    this.transactionSocket = undefined;
  }

  /** Get recent transactions */
  public async getEdaTransactions(size = 50): Promise<any[]> {
    const path = `/core/transaction/v1/resultsummary?size=${size}` as keyof paths;
    const data = await this.fetchJSON<components['schemas']['TransactionSummaryResults']>(path);
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
