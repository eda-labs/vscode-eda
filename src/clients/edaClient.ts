import { fetch, Agent } from 'undici';
import WebSocket from 'ws';
import { LogLevel, log } from '../extension';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TextDecoder } from 'util';
import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript';

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

interface NamespaceData {
  name?: string;
  description?: string;
}

interface NamespaceGetResponse {
  allNamesapces?: boolean;
  namespaces?: NamespaceData[];
}

interface TransactionSummaryResults {
  results?: any[];
}

interface TransactionDetails {
  [key: string]: any;
}

interface StreamEndpoint {
  path: string;
  stream: string;
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
  private eventSocket: WebSocket | undefined;
  private eventClient: string | undefined;
  private keepAliveTimer: ReturnType<typeof setInterval> | undefined;
  private initPromise: Promise<void> = Promise.resolve();
  private apiVersion = 'unknown';
  private streamEndpoints: StreamEndpoint[] = [];
  private namespaceSet: Set<string> = new Set();
  private skipTlsVerify = false;
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
    this.skipTlsVerify = opts.skipTlsVerify || process.env.EDA_SKIP_TLS_VERIFY === 'true';
    this.agent = this.skipTlsVerify ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;
    log(
      `EdaClient initialized for ${this.baseUrl} (clientId=${this.clientId})`,
      LogLevel.DEBUG,
    );
    this.messageIntervalMs = opts.messageIntervalMs ?? 500;
    this.authPromise = this.auth();
    this.initPromise = this.authPromise.then(() => this.initializeSpecs());
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

  private async fetchJSON<T = any>(path: string): Promise<T> {
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

  private async fetchJsonUrl(url: string): Promise<any> {
    await this.authPromise;
    const res = await fetch(url, { headers: this.headers, dispatcher: this.agent });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: HTTP ${res.status} ${text}`);
    }
    return JSON.parse(text);
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
    const url = `${this.baseUrl}${path}`;
    const data = await this.fetchJsonUrl(url);
    const full = (data?.eda?.version as string | undefined) ?? 'unknown';
    const match = full.match(/^([^-]+)/);
    return match ? match[1] : full;
  }

  private async fetchAndWriteAllSpecs(apiRoot: any, version: string): Promise<StreamEndpoint[]> {
    const all: StreamEndpoint[] = [];
    for (const [apiPath, info] of Object.entries<any>(apiRoot.paths ?? {})) {
      const url = `${this.baseUrl}${info.serverRelativeURL}`;
      log(`Fetching spec ${apiPath} from ${url}`, LogLevel.DEBUG);
      const spec = await this.fetchJsonUrl(url);
      const { category, name } = this.parseApiPath(apiPath);
      await this.writeSpecAndTypes(spec, name, version, category);
      all.push(...this.collectStreamEndpoints(spec));
    }
    return all;
  }

  private async initializeSpecs(): Promise<void> {
    log('Initializing API specs...', LogLevel.INFO);
    try {
      const apiRoot = await this.fetchJsonUrl(`${this.baseUrl}/openapi/v3`);
      const coreEntry = Object.entries<any>(apiRoot.paths ?? {}).find(([p]) => /\/core$/.test(p));
      if (!coreEntry) {
        log('core API path not found in root spec', LogLevel.WARN);
        return;
      }
      const coreUrl = `${this.baseUrl}${(coreEntry[1] as any).serverRelativeURL}`;
      const coreSpec = await this.fetchJsonUrl(coreUrl);
      const nsPath = this.findPathByOperationId(coreSpec, 'accessGetNamespaces');
      const versionPath = this.findPathByOperationId(coreSpec, 'versionGet');
      this.apiVersion = await this.fetchVersion(versionPath);
      let endpoints = await this.loadCachedSpecs(this.apiVersion);
      if (endpoints.length > 0) {
        log(`Loaded cached API specs for version ${this.apiVersion}`, LogLevel.INFO);
        this.streamEndpoints = endpoints;
      } else {
        this.streamEndpoints = await this.fetchAndWriteAllSpecs(apiRoot, this.apiVersion);
      }
      log(`Discovered ${this.streamEndpoints.length} stream endpoints`, LogLevel.DEBUG);
      // prime namespace set
      const ns = await this.fetchJsonUrl(`${this.baseUrl}${nsPath}`) as NamespaceGetResponse;
      this.namespaceSet = new Set((ns.namespaces || []).map(n => n.name || '').filter(n => n));
      log('Spec initialization complete', LogLevel.INFO);
    } catch (err) {
      log(`Failed to initialize specs: ${err}`, LogLevel.WARN);
    }
  }

  private async startStream(client: string, endpoint: StreamEndpoint): Promise<void> {
    const url =
      `${this.baseUrl}${endpoint.path}` +
      `?eventclient=${encodeURIComponent(client)}` +
      `&stream=${encodeURIComponent(endpoint.stream)}`;

    let res: any;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'text/event-stream',
        },
        dispatcher: this.agent,
      });
    } catch (err) {
      log(`[STREAM] request failed ${err}`, LogLevel.ERROR);
      return;
    }

    if (!res.ok || !res.body) {
      log(`[STREAM] failed ${url}: HTTP ${res.status}`, LogLevel.ERROR);
      return;
    }
    log(`[STREAM] connected → ${url}`, LogLevel.DEBUG);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        log('[STREAM] ended', LogLevel.DEBUG);
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        this.handleEventMessage(line);
      }
    }
  }

  private async connectEventSocket(): Promise<void> {
    await this.authPromise;
    if (this.eventSocket && this.eventSocket.readyState === WebSocket.OPEN) {
      return;
    }

    const url = new URL(this.baseUrl);
    const wsUrl = `wss://${url.host}/events`;
    log(`CONNECT ${wsUrl}`, LogLevel.INFO);

    const socket = new WebSocket(wsUrl, {
      headers: this.wsHeaders,
      rejectUnauthorized: !this.skipTlsVerify,
    });
    this.eventSocket = socket;

    socket.on('open', () => {
      log('Event WebSocket connected', LogLevel.DEBUG);
      log(`Started streaming on ${this.streamEndpoints.length} nodes`, LogLevel.INFO);
      for (const stream of this.activeStreams) {
        log(`Started to stream endpoint ${stream}`, LogLevel.DEBUG);
        socket.send(JSON.stringify({ type: 'next', stream }));
      }
      if (this.keepAliveTimer) {
        clearInterval(this.keepAliveTimer);
      }
      this.keepAliveTimer = setInterval(() => {
        for (const stream of this.activeStreams) {
          socket.send(JSON.stringify({ type: 'next', stream }));
        }
      }, this.messageIntervalMs);
    });

    socket.on('message', data => {
      const txt = data.toString();
      if (!this.eventClient) {
        try {
          const obj = JSON.parse(txt);
          const client = obj?.msg?.client as string | undefined;
          if (obj.type === 'register' && client) {
            this.eventClient = client;
            log(`WS eventclient id = ${this.eventClient}`, LogLevel.DEBUG);
            for (const ep of this.streamEndpoints) {
              void this.startStream(this.eventClient, ep);
            }
          }
        } catch {
          /* ignore */
        }
      }
      this.handleEventMessage(txt);
    });

    const reconnect = () => {
      this.eventSocket = undefined;
      this.eventClient = undefined;
      if (this.keepAliveTimer) {
        clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = undefined;
      }
      setTimeout(() => {
        void this.connectEventSocket();
      }, 2000);
    };

    socket.on('close', reconnect);
    socket.on('error', err => {
      log(`Event WebSocket error: ${err}`, LogLevel.ERROR);
      reconnect();
    });
  }

  private handleEventMessage(data: string): void {
    log(`WS message: ${data}`, LogLevel.DEBUG);
    try {
      const msg = JSON.parse(data);
      if (
        msg.type === 'update' &&
        msg.stream === 'namespaces' &&
        this.callbacks.namespaces
      ) {
        const updates = Array.isArray(msg.msg?.updates) ? msg.msg.updates : [];
        for (const up of updates) {
          let name: string | undefined = up.data?.metadata?.name || up.data?.name;
          if (!name && up.key) {
            const matches = [...String(up.key).matchAll(/namespace\{\.name=="([^"]+)"\}/g)];
            if (matches.length > 0) {
              name = matches[matches.length - 1][1];
            }
          }
          if (!name) continue;
          if (up.data === null) {
            this.namespaceSet.delete(name);
          } else {
            this.namespaceSet.add(name);
          }
        }
        this.callbacks.namespaces(Array.from(this.namespaceSet));
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
    await this.initPromise;
    if (this.namespaceSet.size > 0) {
      return Array.from(this.namespaceSet);
    }
    const data = await this.fetchJSON<NamespaceGetResponse>('/core/access/v1/namespaces');
    const list = data.namespaces || [];
    this.namespaceSet = new Set(list.map(n => n.name || '').filter(n => n));
    log(`Fetched namespaces: ${Array.from(this.namespaceSet).join(', ')}`, LogLevel.DEBUG);
    return Array.from(this.namespaceSet);
  }

  /**
   * Stream accessible namespaces over WebSocket.
   * @param onNamespaces Callback invoked with the list of namespace names.
   */
  public async streamEdaNamespaces(onNamespaces: NamespaceCallback): Promise<void> {
    await this.initPromise;
    this.callbacks.namespaces = onNamespaces;
    onNamespaces(Array.from(this.namespaceSet));
    this.activeStreams.add('namespaces');
    log('Started to stream endpoint namespaces', LogLevel.DEBUG);
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
    log('Started to stream endpoint alarms', LogLevel.DEBUG);
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
    log('Started to stream endpoint deviations', LogLevel.DEBUG);
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
    log('Started to stream endpoint transactions', LogLevel.DEBUG);
    await this.connectEventSocket();
  }

  /** Close any open transaction stream */
  public closeTransactionStream(): void {
    delete this.callbacks.transactions;
    this.activeStreams.delete('transactions');
  }

  /** Get recent transactions */
  public async getEdaTransactions(size = 50): Promise<any[]> {
    const path = `/core/transaction/v1/resultsummary?size=${size}`;
    const data = await this.fetchJSON<TransactionSummaryResults>(path);
    return (data.results as any[]) || [];
  }
  /** Get details for a transaction */
  public async getTransactionDetails(id: string): Promise<string> {
    const data = await this.fetchJSON<TransactionDetails>(`/core/transaction/v1/details/${id}`);
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
    const data = await this.fetchJSON<any>(`/apps/core.eda.nokia.com/v1/namespaces/${namespace}/deviations`);
    return data.items || [];
  }

  /** Get unique stream names discovered from the API */
  public async getStreamNames(): Promise<string[]> {
    await this.initPromise;
    const names = Array.from(new Set(this.streamEndpoints.map(e => e.stream)));
    names.sort();
    return names;
  }

  /** Fetch a resource YAML using EDA API */
  public async getEdaResourceYaml(kind: string, name: string, namespace: string): Promise<string> {
    const plural = kind.toLowerCase() + 's';
    const data = await this.fetchJSON<any>(`/apps/core.eda.nokia.com/v1/namespaces/${namespace}/${plural}/${name}`);
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
