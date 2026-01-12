import { fetch, Agent } from 'undici';
// Local lightweight logger to avoid VS Code dependency when used standalone
enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

// External logger callback that can be set by extension.ts
type LoggerCallback = (message: string, level: number, forceLog?: boolean, elapsedTime?: number) => void;
let externalLogger: LoggerCallback | undefined;

export function setAuthLogger(logger: LoggerCallback): void {
  externalLogger = logger;
}

function log(
  message: string,
  level: LogLevel = LogLevel.INFO,
  forceLog = false,
  elapsedTime?: number
): void {
  // Use external logger if set (VS Code output channel)
  if (externalLogger) {
    externalLogger(message, level, forceLog, elapsedTime);
    return;
  }

  // Fallback to console.log
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
  clientId?: string;
  clientSecret: string;
  skipTlsVerify?: boolean;
  kcUsername?: string;
  kcPassword?: string;
  edaUsername?: string;
  edaPassword?: string;
}

/**
 * Client for handling EDA authentication
 */
export class EdaAuthClient {
  private baseUrl: string;
  private kcUrl: string;
  private token = '';
  private authPromise: Promise<void> = Promise.resolve();
  private clientId: string;
  private clientSecret: string;
  private agent: Agent | undefined;
  private skipTlsVerify = false;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private kcUsername?: string;
  private kcPassword?: string;
  private edaUsername: string;
  private edaPassword: string;

  constructor(baseUrl: string, opts: EdaAuthOptions) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.kcUrl = `${this.baseUrl}/core/httpproxy/v1/keycloak`;
    this.clientId = opts.clientId || process.env.EDA_CLIENT_ID || 'eda';
    this.clientSecret = opts.clientSecret;
    this.skipTlsVerify = opts.skipTlsVerify || process.env.EDA_SKIP_TLS_VERIFY === 'true';
    this.agent = this.skipTlsVerify ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;
    this.kcUsername = opts.kcUsername;
    this.kcPassword = opts.kcPassword;
    this.edaUsername = opts.edaUsername || process.env.EDA_USERNAME || 'admin';
    this.edaPassword = opts.edaPassword || process.env.EDA_PASSWORD || 'admin';

    if (!this.clientSecret) {
      throw new Error('Client secret is required for authentication');
    }

    log(
      `EdaAuthClient initialized for ${this.baseUrl} (clientId=${this.clientId})`,
      LogLevel.DEBUG
    );
    this.authPromise = this.auth();
    this.refreshTimer = setInterval(() => {
      void this.refreshAuth().catch(err =>
        log(`Failed to refresh auth token: ${err}`, LogLevel.WARN)
      );
    }, 60_000);
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

  public async fetchAdminToken(): Promise<string> {
    if (!this.kcUsername || !this.kcPassword) {
      throw new Error('Keycloak admin credentials are required to fetch admin token');
    }
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

  public async fetchClientSecret(adminToken: string): Promise<string> {
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

    const url = `${this.kcUrl}/realms/eda/protocol/openid-connect/token`;
    const params = new URLSearchParams();
    params.set('grant_type', 'password');
    params.set('client_id', this.clientId);
    params.set('client_secret', this.clientSecret);
    params.set('username', this.edaUsername);
    params.set('password', this.edaPassword);
    params.set('scope', 'openid');

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

  /**
   * Dispose resources
   */
  public dispose(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }
}