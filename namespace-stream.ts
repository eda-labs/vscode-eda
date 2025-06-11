import { fetch, Agent } from 'undici';
import WebSocket from 'ws';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TextDecoder } from 'util';
import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript';

interface Config {
  /** Base URL of the EDA API server */
  edaUrl: string;
  /** Username for the EDA realm */
  edaUsername: string;
  /** Password for the EDA realm */
  edaPassword: string;
  /** Keycloak admin username */
  kcUsername: string;
  /** Keycloak admin password */
  kcPassword: string;
  /** Client ID for authentication */
  clientId: string;
  /** Optional client secret; will be auto-fetched if omitted */
  clientSecret?: string;
  /** Skip TLS certificate verification */
  skipTlsVerify?: boolean;
  /** Interval between keep alive messages in milliseconds */
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

async function loadConfig(path = 'stream.config.json'): Promise<Config> {
  const raw = await fs.promises.readFile(path, 'utf8');
  return JSON.parse(raw) as Config;
}

async function fetchOpenApiRoot(token: string, cfg: Config): Promise<any> {
  const url = `${cfg.edaUrl.replace(/\/$/, '')}/openapi/v3`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const agent = cfg.skipTlsVerify ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;
  console.log('GET', url);
  const res = await fetch(url, { headers, dispatcher: agent });
  console.log('Response status', res.status);
  const text = await res.text();
  console.log('Response body:', text);
  if (!res.ok) {
    throw new Error(`Failed to fetch openapi root: HTTP ${res.status} ${text}`);
  }
  return JSON.parse(text);
}

async function fetchJson(url: string, token: string, cfg: Config): Promise<any> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const agent = cfg.skipTlsVerify ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;
  console.log('GET', url);
  const res = await fetch(url, { headers, dispatcher: agent });
  console.log('Response status', res.status);
  const text = await res.text();
  console.log('Response body:', text);
  if (!res.ok) {
    throw new Error(`Failed HTTP ${res.status} ${text}`);
  }
  return JSON.parse(text);
}

function findPathByOperationId(spec: any, opId: string): string {
  for (const [p, methods] of Object.entries<any>(spec.paths ?? {})) {
    for (const m of Object.values<any>(methods as any)) {
      if (m && typeof m === 'object' && m.operationId === opId) {
        return p;
      }
    }
  }
  throw new Error(`operationId '${opId}' not found in spec`);
}

async function writeSpecAndTypes(
  spec: any,
  name: string,
  version: string,
  category: string,
): Promise<void> {
  const versionDir = path.join(os.homedir(), '.eda', version, category);
  await fs.promises.mkdir(versionDir, { recursive: true });
  const jsonPath = path.join(versionDir, `${name}.json`);
  await fs.promises.writeFile(jsonPath, JSON.stringify(spec, null, 2));

  const tsAst = await openapiTS(spec);
  const ts = COMMENT_HEADER + astToString(tsAst);
  const dtsPath = path.join(versionDir, `${name}.d.ts`);
  await fs.promises.writeFile(dtsPath, ts);

  console.log(`Saved spec to ${jsonPath} and types to ${dtsPath}`);
}

async function fetchVersion(token: string, cfg: Config, path: string): Promise<string> {
  const url = `${cfg.edaUrl.replace(/\/$/, '')}${path}`;
  const data = await fetchJson(url, token, cfg);
  const full = (data?.eda?.version as string | undefined) ?? 'unknown';
  const match = full.match(/^([^-]+)/);
  return match ? match[1] : full;
}

function parseApiPath(apiPath: string): { category: string; name: string } {
  const parts = apiPath.split('/').filter(Boolean);
  const category = parts[0] || 'core';
  const nameSeg = category === 'apps' ? parts[1] : category;
  const name = (nameSeg ?? 'core').split('.')[0];
  return { category, name };
}

async function fetchAndWriteAllSpecs(
  apiRoot: any,
  token: string,
  cfg: Config,
  version: string,
): Promise<void> {
  for (const [apiPath, info] of Object.entries<any>(apiRoot.paths ?? {})) {
    const url = `${cfg.edaUrl.replace(/\/$/, '')}${info.serverRelativeURL}`;
    const spec = await fetchJson(url, token, cfg);

    const { category, name } = parseApiPath(apiPath);

    await writeSpecAndTypes(spec, name, version, category);
    console.log(`Fetched ${apiPath}`);
  }
}

async function fetchAdminToken(cfg: Config): Promise<string> {
  const base = cfg.edaUrl.replace(/\/$/, '');
  const url = `${base}/core/httpproxy/v1/keycloak/realms/master/protocol/openid-connect/token`;
  const params = new URLSearchParams();
  params.set('grant_type', 'password');
  params.set('client_id', 'admin-cli');
  params.set('username', cfg.kcUsername);
  params.set('password', cfg.kcPassword);
  const agent = cfg.skipTlsVerify ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;
  console.log('POST', url);
  console.log('Headers:', { 'Content-Type': 'application/x-www-form-urlencoded' });
  console.log('Body:', params.toString());
  const res = await fetch(url, {
    method: 'POST',
    body: params,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    dispatcher: agent,
  });
  console.log('Response status', res.status);
  const text = await res.text();
  console.log('Response body:', text);
  if (!res.ok) {
    throw new Error(`Admin auth failed: HTTP ${res.status} ${text}`);
  }
  const data = JSON.parse(text) as any;
  return data.access_token as string;
}

async function fetchClientSecret(adminToken: string, cfg: Config): Promise<string> {
  const base = cfg.edaUrl.replace(/\/$/, '');
  const listUrl = `${base}/core/httpproxy/v1/keycloak/admin/realms/eda/clients`;
  const agent = cfg.skipTlsVerify ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;
  console.log('GET', listUrl);
  console.log('Headers:', { Authorization: `Bearer ${adminToken}` });
  const res = await fetch(listUrl, { headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, dispatcher: agent });
  console.log('Response status', res.status);
  const text = await res.text();
  console.log('Response body:', text);
  if (!res.ok) {
    throw new Error(`Failed to list clients: HTTP ${res.status} ${text}`);
  }
  const clients = JSON.parse(text) as any[];
  const client = clients.find(c => c.clientId === cfg.clientId);
  if (!client) {
    throw new Error(`Client '${cfg.clientId}' not found`);
  }
  const secretUrl = `${listUrl}/${client.id}/client-secret`;
  console.log('GET', secretUrl);
  console.log('Headers:', { Authorization: `Bearer ${adminToken}` });
  const secretRes = await fetch(secretUrl, { headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, dispatcher: agent });
  console.log('Response status', secretRes.status);
  const secretText = await secretRes.text();
  console.log('Response body:', secretText);
  if (!secretRes.ok) {
    throw new Error(`Failed to fetch client secret: HTTP ${secretRes.status} ${secretText}`);
  }
  const secretJson = JSON.parse(secretText) as any;
  return secretJson.value as string;
}

async function authenticate(cfg: Config): Promise<string> {
  const base = cfg.edaUrl.replace(/\/$/, '');
  if (!cfg.clientSecret) {
    try {
      const adminToken = await fetchAdminToken(cfg);
      cfg.clientSecret = await fetchClientSecret(adminToken, cfg);
    } catch (err) {
      console.warn('Failed to auto-fetch client secret:', err);
    }
  }
  const url = `${base}/core/httpproxy/v1/keycloak/realms/eda/protocol/openid-connect/token`;
  const params = new URLSearchParams();
  params.set('grant_type', 'password');
  params.set('client_id', cfg.clientId);
  params.set('username', cfg.edaUsername);
  params.set('password', cfg.edaPassword);
  params.set('scope', 'openid');
  if (cfg.clientSecret) {
    params.set('client_secret', cfg.clientSecret);
  }
  const agent = cfg.skipTlsVerify ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;
  console.log('POST', url);
  console.log('Headers:', { 'Content-Type': 'application/x-www-form-urlencoded' });
  console.log('Body:', params.toString());
  const res = await fetch(url, {
    method: 'POST',
    body: params,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    dispatcher: agent,
  });
  console.log('Response status', res.status);
  const text = await res.text();
  console.log('Response body:', text);
  if (!res.ok) {
    throw new Error(`Authentication failed: HTTP ${res.status} ${text}`);
  }
  const data = JSON.parse(text) as any;
  return data.access_token as string;
}

async function fetchNamespaces(token: string, cfg: Config, path: string): Promise<NamespaceGetResponse> {
  const url = `${cfg.edaUrl.replace(/\/$/, '')}${path}`;
  const headers = { Authorization: `Bearer ${token}` };
  const agent = cfg.skipTlsVerify ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;
  console.log('GET', url);
  console.log('Headers:', headers);
  const res = await fetch(url, { headers, dispatcher: agent });
  console.log('Response status', res.status);
  const text = await res.text();
  console.log('Response body:', text);
  if (!res.ok) {
    throw new Error(`Failed to fetch namespaces: HTTP ${res.status} ${text}`);
  }
  return JSON.parse(text) as NamespaceGetResponse;
}

async function startNamespaceStream(
  client: string,
  token: string,
  cfg: Config,
  path: string,
): Promise<void> {
  const url =
    `${cfg.edaUrl.replace(/\/$/, '')}${path}` +
    `?eventclient=${encodeURIComponent(client)}` +
    `&stream=namespaces`;

  const agent = cfg.skipTlsVerify
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : undefined;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'text/event-stream',      // tell EDA we want a live stream
    },
    dispatcher: agent,
  });

  if (!res.ok || !res.body) {
    throw new Error(`stream failed: HTTP ${res.status}`);
  }
  console.log('[STREAM] connected →', url);

  const reader   = res.body.getReader();
  const decoder  = new TextDecoder();
  let   buffer   = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) { console.log('[STREAM] ended'); break; }

    buffer += decoder.decode(value, { stream: true });

    // newline-delimited JSON objects
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;

      try {
        const obj = JSON.parse(line);
        console.log('[STREAM] update', JSON.stringify(obj));
      } catch {
        console.warn('[STREAM] non-JSON line:', line);
      }
    }
  }
}

function connectWebSocket(token: string, cfg: Config, namespacesPath: string): void {
  const base = new URL(cfg.edaUrl);
  const wsUrl = `wss://${base.host}/events`;

  const ws = new WebSocket(wsUrl, {
    headers: { Authorization: `Bearer ${token}` },
    rejectUnauthorized: !(cfg.skipTlsVerify ?? false),
  });

  let eventClient: string | undefined;

  ws.on('open', () => {
    console.log('[WS] connected');
    // first “next” immediately
    ws.send(JSON.stringify({ type: 'next', stream: 'namespaces' }));
    // then every 0.5 s
    const iv = setInterval(() => {
      ws.send(JSON.stringify({ type: 'next', stream: 'namespaces' }));
    }, cfg.messageIntervalMs ?? 500);

    ws.on('close', (code, reason) => {
      console.log('[WS] closed', code, reason.toString());
      clearInterval(iv);
    });
  });

  ws.on('message', async data => {
    const txt = data.toString();
    console.log('[WS] ←', txt);

    // first server message contains  { type:"s2c-eventclient", msg:{ client:"…" } }
    if (!eventClient) {
      try {
        const obj = JSON.parse(txt);
        const client = obj?.msg?.client as string | undefined;
        if (client) {
          eventClient = client;
          console.log('[WS] eventclient id =', eventClient);
          // kick off the HTTP stream once we have the id
          void startNamespaceStream(eventClient, token, cfg, namespacesPath);
        }
      } catch {/* ignore non-JSON frames */}
    }
  });

  ws.on('error', err => console.error('[WS] error', err));
}

async function main() {
  const cfg = await loadConfig();
  const token = await authenticate(cfg);
  const apiRoot = await fetchOpenApiRoot(token, cfg);
  const corePathEntry = Object.entries<any>(apiRoot.paths ?? {}).find(([p]) => /\/core$/.test(p));
  if (!corePathEntry) {
    throw new Error('core API path not found');
  }
  const coreUrl = `${cfg.edaUrl.replace(/\/$/, '')}${corePathEntry[1].serverRelativeURL}`;
  const coreSpec = await fetchJson(coreUrl, token, cfg);
  const namespacesPath = findPathByOperationId(coreSpec, 'accessGetNamespaces');
  const versionPath = findPathByOperationId(coreSpec, 'versionGet');
  const version = await fetchVersion(token, cfg, versionPath);

  await fetchAndWriteAllSpecs(apiRoot, token, cfg, version);

  const namespaces = await fetchNamespaces(token, cfg, namespacesPath);
  console.log('Initial namespaces:', JSON.stringify(namespaces));
  connectWebSocket(token, cfg, namespacesPath);
}

main().catch(err => {
  console.error('Fatal error', err);
  process.exit(1);
});
