import { fetch, Agent } from 'undici';
import { io, Socket } from 'socket.io-client';
import { LogLevel, log } from '../extension';
import type { paths, components } from '../openapi/core';

// eslint-disable-next-line no-unused-vars
export type NamespaceCallback = (arg: string[]) => void;
// eslint-disable-next-line no-unused-vars
export type DeviationCallback = (_: any[]) => void;
// eslint-disable-next-line no-unused-vars
export type TransactionCallback = (_: any[]) => void;
// eslint-disable-next-line no-unused-vars
export type AlarmCallback = (_: any[]) => void;

/**
 * Client for interacting with the EDA REST API
 */
export interface EdaClientOptions {
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
  /** Interval in milliseconds between keep alive messages */
  messageIntervalMs?: number;
}

export class EdaClient {
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
  private eventSocket: Socket | undefined;
  private keepAliveTimer: ReturnType<typeof setInterval> | undefined;
  private activeStreams: Set<string> = new Set();
  private callbacks: {
    namespaces?: NamespaceCallback;
    alarms?: AlarmCallback;
    deviations?: DeviationCallback;
    transactions?: TransactionCallback;
  } = {};
  private messageIntervalMs = 500;

  private get wsHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }

  constructor(baseUrl: string, opts: EdaClientOptions = {}) {
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
      `EdaClient initialized for ${this.baseUrl} (clientId=${this.clientId})`,
      LogLevel.DEBUG,
    );
    this.messageIntervalMs = opts.messageIntervalMs ?? 500;
    this.authPromise = this.auth();
    void this.connectEventSocket();
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
    params.set('scope', 'openid');
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

  private async connectEventSocket(): Promise<void> {
    await this.authPromise;
    if (this.eventSocket && this.eventSocket.connected) {
      return;
    }

    const url = new URL(this.baseUrl);
    const socketUrl = `${url.protocol}//${url.host}`;
    const path = '/events';
    log(`GET ${socketUrl}${path}`, LogLevel.INFO);

    const socket = io(socketUrl, {
      path,
      transports: ['websocket'],
      extraHeaders: this.wsHeaders,
    });
    this.eventSocket = socket;

    socket.on('connect', () => {
      log('Event socket.io connected', LogLevel.DEBUG);
    });

    socket.on('message', (data: any) => {
      this.handleEventMessage(typeof data === 'string' ? data : JSON.stringify(data));
    });

    socket.on('error', err => {
      log(`Event socket.io error: ${err}`, LogLevel.ERROR);
    });

    socket.on('disconnect', reason => {
      log(`Event socket.io disconnected (${reason})`, LogLevel.INFO);
      this.eventSocket = undefined;
      if (this.keepAliveTimer) {
        clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = undefined;
      }
      setTimeout(() => {
        void this.connectEventSocket();
      }, 2000);
    });

    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
    }
    this.keepAliveTimer = setInterval(() => {
      if (!this.eventSocket || !this.eventSocket.connected) {
        return;
      }
      for (const stream of this.activeStreams) {
        try {
          this.eventSocket.emit('message', { type: 'next', stream });
        } catch (err) {
          log(`Failed to send keep-alive: ${err}`, LogLevel.DEBUG);
        }
      }
    }, this.messageIntervalMs);
  }

  private handleEventMessage(data: string): void {
    try {
      const msg = JSON.parse(data);
      if ('namespaces' in msg && this.callbacks.namespaces) {
        const list = msg.namespaces || [];
        const names = list.map((n: any) => n.name || '').filter((n: string) => n);
        log(`Namespaces stream message: ${JSON.stringify(names)}`, LogLevel.INFO);
        this.callbacks.namespaces(names);
      } else if ('results' in msg && this.callbacks.transactions) {
        const results = Array.isArray(msg.results) ? msg.results : [];
        this.callbacks.transactions(results);
      } else if ('items' in msg && this.callbacks.deviations) {
        const items = Array.isArray(msg.items) ? msg.items : [];
        this.callbacks.deviations(items);
      } else if (Array.isArray(msg) && this.callbacks.alarms) {
        this.callbacks.alarms(msg);
      }
    } catch (err) {
      log(`Failed to parse event message: ${err}`, LogLevel.ERROR);
    }
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
    this.callbacks.namespaces = onNamespaces;
    this.activeStreams.add('namespaces');
    await this.connectEventSocket();
  }

  /**
   * Stream alarms over WebSocket.
   * @param onAlarms Callback invoked with the list of alarms.
   */
  // eslint-disable-next-line no-unused-vars
  public async streamEdaAlarms(onAlarms: (_list: any[]) => void): Promise<void> {
    this.callbacks.alarms = onAlarms;
    this.activeStreams.add('alarms');
    await this.connectEventSocket();
  }

  /** Close any open alarm stream */
  public closeAlarmStream(): void {
    delete this.callbacks.alarms;
    this.activeStreams.delete('alarms');
  }

  /** Stream deviations over WebSocket */
  public async streamEdaDeviations(
    onDeviations: DeviationCallback,
    _namespace = 'default'
  ): Promise<void> {
    void _namespace;
    this.callbacks.deviations = onDeviations;
    this.activeStreams.add('deviations');
    await this.connectEventSocket();
  }

  /** Close any open deviation stream */
  public closeDeviationStream(): void {
    delete this.callbacks.deviations;
    this.activeStreams.delete('deviations');
  }

  /** Stream transactions over WebSocket */
  public async streamEdaTransactions(
    onTransactions: TransactionCallback
  ): Promise<void> {
    this.callbacks.transactions = onTransactions;
    this.activeStreams.add('transactions');
    await this.connectEventSocket();
  }

  /** Close any open transaction stream */
  public closeTransactionStream(): void {
    delete this.callbacks.transactions;
    this.activeStreams.delete('transactions');
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
