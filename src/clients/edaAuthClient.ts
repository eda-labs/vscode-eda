import { fetch, Agent } from 'undici';
// Local lightweight logger to avoid VS Code dependency when used standalone
enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

function log(
  message: string,
  level: LogLevel = LogLevel.INFO,
  forceLog = false,
  elapsedTime?: number
): void {
  if (level >= LogLevel.INFO || forceLog) {
    const prefix = LogLevel[level];
    const timestamp = new Date().toISOString();
    let line = `[${timestamp}] [${prefix}] ${message}`;
    if (level === LogLevel.INFO && elapsedTime !== undefined) {
      line += ` (took ${elapsedTime}ms)`;
    }
    console.log(line);
  } else if (process.env.NODE_ENV !== 'production') {
    const prefix = LogLevel[level];
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${prefix}] ${message}`);
  }
}

export interface EdaAuthOptions {
  edaUsername?: string;
  edaPassword?: string;
  kcUsername?: string;
  kcPassword?: string;
  clientId?: string;
  clientSecret?: string;
  skipTlsVerify?: boolean;
}

/**
 * Client for handling EDA authentication
 */
export class EdaAuthClient {
  private baseUrl: string;
  private kcUrl: string;
  private token = '';
  private authPromise: Promise<void> = Promise.resolve();
  private edaUsername: string;
  private edaPassword: string;
  private kcUsername: string;
  private kcPassword: string;
  private clientId: string;
  private clientSecret?: string;
  private agent: Agent | undefined;
  private skipTlsVerify = false;

  constructor(baseUrl: string, opts: EdaAuthOptions = {}) {
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

    log(`EdaAuthClient initialized for ${this.baseUrl} (clientId=${this.clientId})`, LogLevel.DEBUG);
    this.authPromise = this.auth();
  }

  /**
   * Get the base URL
   */
  public getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Get the HTTP agent for requests
   */
  public getAgent(): Agent | undefined {
    return this.agent;
  }

  /**
   * Get headers for HTTP requests
   */
  public getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Get headers for WebSocket connections
   */
  public getWsHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }

  /**
   * Get WebSocket options including TLS verification
   */
  public getWsOptions(): { rejectUnauthorized: boolean } {
    return { rejectUnauthorized: !this.skipTlsVerify };
  }

  /**
   * Wait for authentication to complete
   */
  public async waitForAuth(): Promise<void> {
    await this.authPromise;
  }

  /**
   * Refresh authentication token
   */
  public async refreshAuth(): Promise<void> {
    log('Refreshing authentication token...', LogLevel.INFO);
    this.authPromise = this.auth();
    await this.authPromise;
  }

  /**
   * Check if token might be expired based on HTTP response
   */
  public isTokenExpiredResponse(status: number, body: string): boolean {
    return status === 401 && body.includes('Access token has expired');
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
    log('Admin token received', LogLevel.DEBUG);
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
    log('Client secret obtained', LogLevel.DEBUG);
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
    log('Access token obtained', LogLevel.DEBUG);
  }
}