import * as fs from 'fs';
import * as path from 'path';

import { expect } from 'chai';
import sinon from 'sinon';
import { Agent, fetch } from 'undici';
import * as vscode from 'vscode';

import {
  buildExplorerSnapshot,
  DashboardProvider,
  EdaAlarmProvider,
  EdaClient,
  EdaDeviationProvider,
  EdaNamespaceProvider,
  EdaTransactionProvider,
  HelpProvider,
  KubernetesClient,
  ResourceService,
  ResourceStatusService,
  serviceManager,
  TransactionBasketProvider,
  extension,
  type ExplorerSnapshotProviders
} from './support/perfDeps';
import { renderExplorerSectionsMarkup } from './support/explorerRenderPerf';

const STREAM_SUBSCRIBE_EXCLUDE = new Set([
  'resultsummary',
  'v1',
  'eql',
  'nql',
  'current-alarms',
  'summary',
  'directory',
  'file',
  'namespaces'
]);

interface PerfConfig {
  baseUrl: string;
  apiPrefixes: string[];
  edaUsername: string;
  edaPassword: string;
  kcUsername: string;
  kcPassword: string;
  clientId: string;
  clientSecret?: string;
  skipTlsVerify: boolean;
  streamLimit: number;
  explicitStreams?: string[];
  firstEventTimeoutMs: number;
  fullStartupSimulation: boolean;
  basketFilePath: string;
  includeBasketStartup: boolean;
  includeKubernetes: boolean;
  treeStabilityMs: number;
  treePollMs: number;
  targetResourceLeafCount: number;
  syntheticResourceStream: string;
  syntheticBatchSize: number;
  syntheticBatchDelayMs: number;
  postStartupMonitorMs: number;
  captureExtensionDebugLogs: boolean;
  debugLogSampleLimit: number;
  logFilePath?: string;
}

interface KeycloakTokenResponse {
  access_token?: string;
}

interface KeycloakClient {
  id: string;
  clientId: string;
}

interface KeycloakClientSecretResponse {
  value?: string;
}

interface StreamEnvelope {
  state?: string;
  type?: string;
}

interface ExplorerSnapshotNode {
  contextValue?: string;
  children?: ExplorerSnapshotNode[];
}

interface ExplorerSnapshotSection {
  id: string;
  nodes: ExplorerSnapshotNode[];
}

interface ExplorerSnapshotMessageLike {
  sections?: ExplorerSnapshotSection[];
}

interface StartupHarness {
  providers: ExplorerSnapshotProviders;
  k8sClient?: KubernetesClient;
  resourceService?: ResourceService;
}

class PerfFileLogger {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '', { encoding: 'utf8' });
  }

  public write(message: string): void {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    fs.appendFileSync(this.filePath, line, { encoding: 'utf8' });
  }

  public getPath(): string {
    return this.filePath;
  }
}

class ExtensionDebugLogCollector {
  private readonly logger: PerfFileLogger;
  private readonly enabled: boolean;
  private readonly sampleLimit: number;

  private totalLines = 0;
  private sampledLines = 0;
  private sampleLimitReached = false;

  private streamEvents = 0;
  private streamUpdates = 0;
  private streamUpdateItems = 0;
  private nextScheduled = 0;
  private nextSent = 0;
  private transactionTreeLoads = 0;
  private k8sChangeEvents = 0;
  private treeRefreshEvents = 0;

  private readonly nextDelays: number[] = [];
  private readonly eventStreams = new Map<string, number>();
  private readonly updateStreams = new Map<string, number>();
  private readonly nextScheduledStreams = new Map<string, number>();
  private readonly nextSentStreams = new Map<string, number>();

  constructor(logger: PerfFileLogger, enabled: boolean, sampleLimit: number) {
    this.logger = logger;
    this.enabled = enabled;
    this.sampleLimit = sampleLimit;
  }

  private increment(map: Map<string, number>, key: string, value = 1): void {
    map.set(key, (map.get(key) || 0) + value);
  }

  private parseStreamEvent(message: string): string | undefined {
    const prefix = 'Stream ';
    const suffix = ' event received';
    if (!message.startsWith(prefix) || !message.endsWith(suffix)) {
      return undefined;
    }
    return message.slice(prefix.length, message.length - suffix.length).trim() || 'unknown';
  }

  private parseStreamUpdate(message: string): { stream: string; updates: number } | undefined {
    const prefix = '[STREAM:';
    const marker = '] Processing ';
    const suffix = ' updates';
    if (!message.startsWith(prefix) || !message.endsWith(suffix)) {
      return undefined;
    }

    const markerIndex = message.indexOf(marker);
    if (markerIndex < prefix.length) {
      return undefined;
    }

    const stream = message.slice(prefix.length, markerIndex).trim() || 'unknown';
    const updateText = message.slice(markerIndex + marker.length, message.length - suffix.length).trim();
    const updates = Number(updateText);
    return Number.isFinite(updates) ? { stream, updates } : undefined;
  }

  private parseScheduledNext(message: string): { stream: string; delayMs: number } | undefined {
    const prefix = "Scheduling 'next' for stream ";
    const marker = ' in ';
    const suffix = 'ms';
    if (!message.startsWith(prefix) || !message.endsWith(suffix)) {
      return undefined;
    }

    const markerIndex = message.lastIndexOf(marker);
    if (markerIndex < prefix.length) {
      return undefined;
    }

    const stream = message.slice(prefix.length, markerIndex).trim() || 'unknown';
    const delayText = message.slice(markerIndex + marker.length, message.length - suffix.length).trim();
    const delayMs = Number(delayText);
    return Number.isFinite(delayMs) ? { stream, delayMs } : undefined;
  }

  private parseSentNext(message: string): string | undefined {
    const prefix = "Sending 'next' for stream ";
    if (!message.startsWith(prefix)) {
      return undefined;
    }
    return message.slice(prefix.length).trim() || 'unknown';
  }

  public capture(message: string, level: unknown): void {
    if (!this.enabled) {
      return;
    }

    this.totalLines += 1;
    const levelName = typeof level === 'number'
      ? extension.LogLevel[level] || String(level)
      : String(level ?? '');

    if (this.sampledLines < this.sampleLimit) {
      this.sampledLines += 1;
      this.logger.write(`[EXT:${levelName}] ${message}`);
    } else if (!this.sampleLimitReached) {
      this.sampleLimitReached = true;
      this.logger.write(`[EXT] debug sample limit reached (${this.sampleLimit}); continuing with aggregate counters only`);
    }

    if (levelName !== 'DEBUG') {
      return;
    }

    const eventStream = this.parseStreamEvent(message);
    if (eventStream) {
      this.streamEvents += 1;
      this.increment(this.eventStreams, eventStream);
      return;
    }

    const streamUpdate = this.parseStreamUpdate(message);
    if (streamUpdate) {
      this.streamUpdates += 1;
      this.streamUpdateItems += streamUpdate.updates;
      this.increment(this.updateStreams, streamUpdate.stream);
      return;
    }

    const scheduledNext = this.parseScheduledNext(message);
    if (scheduledNext) {
      this.nextScheduled += 1;
      this.increment(this.nextScheduledStreams, scheduledNext.stream);
      if (scheduledNext.delayMs >= 0) {
        this.nextDelays.push(scheduledNext.delayMs);
      }
      return;
    }

    const sentStream = this.parseSentNext(message);
    if (sentStream) {
      this.nextSent += 1;
      this.increment(this.nextSentStreams, sentStream);
      return;
    }

    if (message === 'Loading transactions for the transaction tree...') {
      this.transactionTreeLoads += 1;
      return;
    }

    if (message.startsWith('Change detected from stream ')) {
      this.k8sChangeEvents += 1;
      return;
    }

    if (message.startsWith('Resource change detected')) {
      this.treeRefreshEvents += 1;
    }
  }

  public toResult(): BenchmarkResult['debugLogs'] {
    const delayCount = this.nextDelays.length;
    const totalDelay = this.nextDelays.reduce((sum, delay) => sum + delay, 0);
    return {
      enabled: this.enabled,
      totalLines: this.totalLines,
      sampledLines: this.sampledLines,
      sampleLimit: this.sampleLimit,
      streamEvents: this.streamEvents,
      streamUpdates: this.streamUpdates,
      streamUpdateItems: this.streamUpdateItems,
      nextScheduled: this.nextScheduled,
      nextSent: this.nextSent,
      transactionTreeLoads: this.transactionTreeLoads,
      k8sChangeEvents: this.k8sChangeEvents,
      treeRefreshEvents: this.treeRefreshEvents,
      nextDelayMs: {
        avgMs: roundMs(delayCount > 0 ? totalDelay / delayCount : 0),
        p50Ms: roundMs(percentile(this.nextDelays, 50)),
        p95Ms: roundMs(percentile(this.nextDelays, 95)),
        maxMs: roundMs(delayCount > 0 ? Math.max(...this.nextDelays) : 0)
      },
      topEventStreams: topEntriesByValue(this.eventStreams, 10),
      topUpdateStreams: topEntriesByValue(this.updateStreams, 10),
      topNextScheduledStreams: topEntriesByValue(this.nextScheduledStreams, 10),
      topNextSentStreams: topEntriesByValue(this.nextSentStreams, 10)
    };
  }
}

interface StreamEndpointMeta {
  stream: string;
  namespaced?: boolean;
}

interface StreamClientMeta {
  streamEndpoints?: StreamEndpointMeta[];
  _onStreamMessage?: {
    fire(event: { stream: string; message: unknown }): void;
  };
}

interface EdaClientWithPrivateStreamClient {
  streamClient?: StreamClientMeta;
}

interface BenchmarkResult {
  apiBaseUrl: string;
  startupMode: string;
  discoveredStreams: number;
  subscribedStreams: number;
  namespaceCount: number;
  initializationMs: number;
  subscribeCallMs: number;
  syncCompletionMs: number;
  treeSnapshotMs: number;
  treeStableMs: number;
  firstMessage: {
    receivedStreams: number;
    missingStreams: number;
    minMs: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
  };
  updateVolume: {
    messages: number;
    updates: number;
  };
  syncState: {
    streamsWithStateSeen: number;
    syncedStreams: number;
    unsyncedStreams: number;
  };
  treeSummary: {
    sectionNodeCounts: Record<string, number>;
    totalNodes: number;
    resourceLeafCount: number;
  };
  webviewRender: {
    initialSsrVisibleRenderMs: number;
    stableSsrVisibleRenderMs: number;
    initialVisibleMarkupBytes: number;
    stableVisibleMarkupBytes: number;
    initialSsrExpandedRenderMs: number;
    stableSsrExpandedRenderMs: number;
    initialExpandedMarkupBytes: number;
    stableExpandedMarkupBytes: number;
  };
  resourceTarget: {
    targetResourceLeafCount: number;
    injectedSyntheticResources: number;
    syntheticStream: string;
    reachedTarget: boolean;
    reachedTargetFromSubscribeMs: number;
    reachedTargetMs: number;
  };
  kubernetes: {
    enabled: boolean;
    context: string;
    cachedNamespaces: number;
    watchedResourceTypes: number;
  };
  monitor: {
    durationMs: number;
    messages: number;
    updates: number;
    topStreamsByMessages: Array<{ stream: string; count: number }>;
    topStreamsByUpdates: Array<{ stream: string; count: number }>;
  };
  debugLogs: {
    enabled: boolean;
    totalLines: number;
    sampledLines: number;
    sampleLimit: number;
    streamEvents: number;
    streamUpdates: number;
    streamUpdateItems: number;
    nextScheduled: number;
    nextSent: number;
    transactionTreeLoads: number;
    k8sChangeEvents: number;
    treeRefreshEvents: number;
    nextDelayMs: {
      avgMs: number;
      p50Ms: number;
      p95Ms: number;
      maxMs: number;
    };
    topEventStreams: Array<{ stream: string; count: number }>;
    topUpdateStreams: Array<{ stream: string; count: number }>;
    topNextScheduledStreams: Array<{ stream: string; count: number }>;
    topNextSentStreams: Array<{ stream: string; count: number }>;
  };
  logFilePath: string;
  registrationFanout: {
    streamsWithEndpoint: number;
    namespacedStreams: number;
    nonNamespacedStreams: number;
    specialStreamsWithoutEndpoint: number;
    projectedSseRegistrations: number;
  };
}

const runPerf = process.env.EDA_PERF_RUN === 'true';
const maybeDescribe = runPerf ? describe : describe.skip;

function normalizeBaseUrl(baseUrl: string): string {
  let normalized = baseUrl;
  while (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function normalizePrefix(prefix: string): string {
  const trimmed = prefix.trim();
  if (!trimmed || trimmed === '/') {
    return '';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }
  return raw.toLowerCase() === 'true';
}

function parseNumberEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

function splitCsv(input: string | undefined): string[] {
  if (!input) {
    return [];
  }
  return input
    .split(',')
    .map(part => part.trim())
    .filter(part => part.length > 0);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1);
  return sorted[index] ?? sorted[sorted.length - 1] ?? 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function countUpdates(message: unknown): number {
  const envelope = message as { msg?: { updates?: unknown[]; Updates?: unknown[] } };
  const payload = envelope.msg;
  if (!payload) {
    return 0;
  }
  if (Array.isArray(payload.updates)) {
    return payload.updates.length;
  }
  if (Array.isArray(payload.Updates)) {
    return payload.Updates.length;
  }
  return 0;
}

function createMockExtensionContext(): vscode.ExtensionContext {
  const cwd = process.cwd();
  return {
    extensionUri: vscode.Uri.file(cwd),
    asAbsolutePath: (relativePath: string) => path.resolve(cwd, relativePath)
  } as unknown as vscode.ExtensionContext;
}

function countNodes(nodes: ExplorerSnapshotNode[]): number {
  let total = 0;
  for (const node of nodes) {
    total += 1;
    total += countNodes(node.children || []);
  }
  return total;
}

function countByContext(nodes: ExplorerSnapshotNode[], context: string): number {
  let total = 0;
  for (const node of nodes) {
    if (node.contextValue === context) {
      total += 1;
    }
    total += countByContext(node.children || [], context);
  }
  return total;
}

function summarizeSnapshot(snapshot: unknown): {
  sectionNodeCounts: Record<string, number>;
  totalNodes: number;
  resourceLeafCount: number;
  signature: string;
} {
  const snapshotLike = snapshot as ExplorerSnapshotMessageLike;
  const sections = Array.isArray(snapshotLike.sections) ? snapshotLike.sections : [];
  const sectionNodeCounts: Record<string, number> = {};
  let totalNodes = 0;
  let resourceLeafCount = 0;

  for (const section of sections) {
    const count = countNodes(section.nodes || []);
    sectionNodeCounts[section.id] = count;
    totalNodes += count;
    if (section.id === 'resources') {
      resourceLeafCount = countByContext(section.nodes || [], 'stream-item');
    }
  }

  const signature = `${totalNodes}|${resourceLeafCount}|${JSON.stringify(sectionNodeCounts)}`;
  return { sectionNodeCounts, totalNodes, resourceLeafCount, signature };
}

function waitForFullySyncedOrFirstData(
  expectedStreams: string[],
  firstMessageByStream: Map<string, number>,
  streamHasStateField: Map<string, boolean>,
  syncedByStream: Map<string, number>,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const isReady = (): boolean => expectedStreams.every((streamName) => {
    if (!firstMessageByStream.has(streamName)) {
      return false;
    }
    if (streamHasStateField.get(streamName)) {
      return syncedByStream.has(streamName);
    }
    return true;
  });

  return new Promise((resolve) => {
    const poll = () => {
      if (isReady() || Date.now() >= deadline) {
        resolve();
        return;
      }
      setTimeout(poll, 200);
    };
    poll();
  });
}

function readConfig(): PerfConfig {
  const baseUrl = process.env.EDA_PERF_BASE_URL
    || process.env.EDA_API_URL
    || 'https://100.82.85.163/';
  const rawPrefixes = splitCsv(process.env.EDA_PERF_API_PREFIXES);
  const explicitPrefix = process.env.EDA_PERF_API_PREFIX;
  const apiPrefixes = unique([
    ...rawPrefixes,
    ...(explicitPrefix ? [explicitPrefix] : []),
    '',
    '/queryapi',
    '/api',
    '/ui/main/queryapi',
    '/ui/main',
    '/ui'
  ]);
  const explicitStreams = splitCsv(process.env.EDA_PERF_STREAMS);
  return {
    baseUrl,
    apiPrefixes,
    edaUsername: process.env.EDA_PERF_EDA_USERNAME || 'admin',
    edaPassword: process.env.EDA_PERF_EDA_PASSWORD || 'admin',
    kcUsername: process.env.EDA_PERF_KC_USERNAME || 'admin',
    kcPassword: process.env.EDA_PERF_KC_PASSWORD || 'admin',
    clientId: process.env.EDA_PERF_CLIENT_ID || 'eda',
    clientSecret: process.env.EDA_PERF_CLIENT_SECRET,
    skipTlsVerify: parseBooleanEnv('EDA_PERF_SKIP_TLS_VERIFY', true),
    streamLimit: parseNumberEnv('EDA_PERF_STREAM_LIMIT', 0),
    explicitStreams: explicitStreams.length > 0 ? explicitStreams : undefined,
    firstEventTimeoutMs: parseNumberEnv('EDA_PERF_FIRST_EVENT_TIMEOUT_MS', 60_000),
    fullStartupSimulation: parseBooleanEnv('EDA_PERF_FULL_STARTUP', true),
    basketFilePath: process.env.EDA_PERF_BASKET_FILE_PATH || 'Transactions',
    includeBasketStartup: parseBooleanEnv('EDA_PERF_INCLUDE_BASKET_STARTUP', true),
    includeKubernetes: parseBooleanEnv('EDA_PERF_INCLUDE_K8S', false),
    treeStabilityMs: parseNumberEnv('EDA_PERF_TREE_STABILITY_MS', 2000),
    treePollMs: parseNumberEnv('EDA_PERF_TREE_POLL_MS', 250),
    targetResourceLeafCount: parseNumberEnv('EDA_PERF_TARGET_RESOURCE_LEAF_COUNT', 0),
    syntheticResourceStream: process.env.EDA_PERF_SYNTHETIC_RESOURCE_STREAM || 'interfaces',
    syntheticBatchSize: parseNumberEnv('EDA_PERF_SYNTHETIC_BATCH_SIZE', 1000),
    syntheticBatchDelayMs: parseNumberEnv('EDA_PERF_SYNTHETIC_BATCH_DELAY_MS', 0),
    postStartupMonitorMs: parseNumberEnv('EDA_PERF_POST_STARTUP_MONITOR_MS', 30_000),
    captureExtensionDebugLogs: parseBooleanEnv('EDA_PERF_CAPTURE_EXTENSION_DEBUG_LOGS', true),
    debugLogSampleLimit: parseNumberEnv('EDA_PERF_DEBUG_LOG_SAMPLE_LIMIT', 5000),
    logFilePath: process.env.EDA_PERF_LOG_FILE
  };
}

async function endpointExists(baseUrl: string, dispatcher: Agent | undefined): Promise<boolean> {
  const probeUrl = `${baseUrl}/core/httpproxy/v1/keycloak/realms/eda/protocol/openid-connect/token`;
  const response = await fetch(probeUrl, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: 'probe' }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    dispatcher
  });
  return response.status !== 404;
}

async function resolveApiBaseUrl(
  baseUrl: string,
  prefixes: string[],
  dispatcher: Agent | undefined
): Promise<string> {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  for (const prefix of prefixes) {
    const candidate = `${normalizedBase}${normalizePrefix(prefix)}`;
    try {
      if (await endpointExists(candidate, dispatcher)) {
        return candidate;
      }
    } catch {
      // Try next candidate.
    }
  }

  const tried = prefixes.map(prefix => `${normalizedBase}${normalizePrefix(prefix)}`).join(', ');
  throw new Error(`Could not detect an EDA API base URL. Tried: ${tried}`);
}

async function fetchClientSecret(
  apiBaseUrl: string,
  clientId: string,
  kcUsername: string,
  kcPassword: string,
  dispatcher: Agent | undefined
): Promise<string> {
  const keycloakBase = `${apiBaseUrl}/core/httpproxy/v1/keycloak`;
  const tokenResponse = await fetch(`${keycloakBase}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: kcUsername,
      password: kcPassword
    }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    dispatcher
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    throw new Error(`Admin login failed: HTTP ${tokenResponse.status} ${body}`);
  }

  const tokenBody = await tokenResponse.json() as KeycloakTokenResponse;
  const adminToken = tokenBody.access_token;
  if (!adminToken) {
    throw new Error('Keycloak admin token was empty');
  }

  const clientsResponse = await fetch(`${keycloakBase}/admin/realms/eda/clients`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    dispatcher
  });
  if (!clientsResponse.ok) {
    const body = await clientsResponse.text();
    throw new Error(`Listing Keycloak clients failed: HTTP ${clientsResponse.status} ${body}`);
  }

  const clients = await clientsResponse.json() as KeycloakClient[];
  const client = clients.find(entry => entry.clientId === clientId);
  if (!client) {
    throw new Error(`Client '${clientId}' not found in realm 'eda'`);
  }

  const secretResponse = await fetch(
    `${keycloakBase}/admin/realms/eda/clients/${client.id}/client-secret`,
    {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      dispatcher
    }
  );
  if (!secretResponse.ok) {
    const body = await secretResponse.text();
    throw new Error(`Fetching client secret failed: HTTP ${secretResponse.status} ${body}`);
  }

  const secretBody = await secretResponse.json() as KeycloakClientSecretResponse;
  const secret = secretBody.value;
  if (!secret) {
    throw new Error(`Client secret for '${clientId}' was empty`);
  }
  return secret;
}

function pickStreams(allStreams: string[], config: PerfConfig): string[] {
  if (config.explicitStreams && config.explicitStreams.length > 0) {
    const existing = new Set(allStreams);
    return config.explicitStreams.filter(stream => existing.has(stream));
  }

  const filtered = allStreams.filter(stream =>
    !STREAM_SUBSCRIBE_EXCLUDE.has(stream) && !stream.startsWith('_')
  );
  if (config.streamLimit > 0) {
    return filtered.slice(0, config.streamLimit);
  }
  return filtered;
}

function estimateRegistrationFanout(
  client: EdaClient,
  subscribedStreams: string[],
  namespaceCount: number
): BenchmarkResult['registrationFanout'] {
  const streamClient = (client as unknown as EdaClientWithPrivateStreamClient).streamClient;
  const endpoints = streamClient?.streamEndpoints || [];
  const endpointMap = new Map<string, StreamEndpointMeta>();
  for (const endpoint of endpoints) {
    if (!endpointMap.has(endpoint.stream)) {
      endpointMap.set(endpoint.stream, endpoint);
    }
  }

  let namespacedStreams = 0;
  let nonNamespacedStreams = 0;
  let streamsWithEndpoint = 0;
  let specialStreamsWithoutEndpoint = 0;

  for (const streamName of subscribedStreams) {
    const endpoint = endpointMap.get(streamName);
    if (!endpoint) {
      specialStreamsWithoutEndpoint += 1;
      continue;
    }
    streamsWithEndpoint += 1;
    if (endpoint.namespaced) {
      namespacedStreams += 1;
    } else {
      nonNamespacedStreams += 1;
    }
  }

  return {
    streamsWithEndpoint,
    namespacedStreams,
    nonNamespacedStreams,
    specialStreamsWithoutEndpoint,
    projectedSseRegistrations:
      nonNamespacedStreams
      + (namespacedStreams * Math.max(namespaceCount, 1))
      + specialStreamsWithoutEndpoint
  };
}

function getStreamEmitter(client: EdaClient): StreamClientMeta['_onStreamMessage'] {
  const streamClient = (client as unknown as EdaClientWithPrivateStreamClient).streamClient;
  return streamClient?._onStreamMessage;
}

function buildSyntheticResourceMessage(
  stream: string,
  updates: Array<{
    key: string;
    data: {
      apiVersion: string;
      kind: string;
      metadata: {
        name: string;
        namespace: string;
        uid: string;
        resourceVersion: string;
      };
      spec: { source: string; index: number };
      status: { state: string };
    };
  }>
): { stream: string; type: string; msg: { updates: typeof updates } } {
  return {
    stream,
    type: 'next',
    msg: { updates }
  };
}

async function injectSyntheticResources(
  client: EdaClient,
  perfLogger: PerfFileLogger,
  config: PerfConfig,
  currentResourceLeafCount: number
): Promise<number> {
  const target = config.targetResourceLeafCount;
  if (target <= 0 || currentResourceLeafCount >= target) {
    return 0;
  }

  const emitter = getStreamEmitter(client);
  if (!emitter) {
    perfLogger.write('Synthetic resource injection skipped: stream emitter not available');
    return 0;
  }

  const namespaceCandidates = client.getCachedNamespaces();
  const namespaces = namespaceCandidates.length > 0 ? namespaceCandidates : ['default'];
  const toInject = target - currentResourceLeafCount;
  const batchSize = Math.max(1, config.syntheticBatchSize);
  const batchDelayMs = Math.max(0, config.syntheticBatchDelayMs);
  const runTag = Date.now().toString(36);
  let injected = 0;

  perfLogger.write(
    `Injecting ${toInject} synthetic resources on stream '${config.syntheticResourceStream}'`
    + ` across ${namespaces.length} namespace(s) in batches of ${batchSize}`
    + ` with ${batchDelayMs}ms delay`
  );

  while (injected < toInject) {
    const batchCount = Math.min(batchSize, toInject - injected);
    const updates = Array.from({ length: batchCount }, (_unused, offset) => {
      const globalIndex = injected + offset;
      const namespace = namespaces[globalIndex % namespaces.length] || 'default';
      const name = `perf-${runTag}-${globalIndex}`;
      return {
        key: `${namespace}/${name}`,
        data: {
          apiVersion: 'core.eda.nokia.com/v1',
          kind: 'Interface',
          metadata: {
            name,
            namespace,
            uid: `perf-${runTag}-uid-${globalIndex}`,
            resourceVersion: `${globalIndex + 1}`
          },
          spec: { source: 'synthetic-perf', index: globalIndex },
          status: { state: 'up' }
        }
      };
    });
    const message = buildSyntheticResourceMessage(config.syntheticResourceStream, updates);
    emitter.fire({
      stream: config.syntheticResourceStream,
      message
    });
    injected += batchCount;
    if (batchDelayMs > 0) {
      await sleep(batchDelayMs);
    }
  }

  perfLogger.write(`Injected ${injected} synthetic resources`);
  return injected;
}

function createStartupProviders(client: EdaClient, includeKubernetes: boolean): StartupHarness {
  serviceManager.registerClient('eda', client);

  const statusService = new ResourceStatusService();
  statusService.initialize(createMockExtensionContext());
  serviceManager.registerService('resource-status', statusService);

  let k8sClient: KubernetesClient | undefined;
  let resourceService: ResourceService | undefined;

  if (includeKubernetes) {
    k8sClient = new KubernetesClient();
    const context = k8sClient.getCurrentContext();
    if (!context || context === 'none') {
      throw new Error('EDA_PERF_INCLUDE_K8S=true but no current Kubernetes context is available');
    }
    serviceManager.registerClient('kubernetes', k8sClient);
    resourceService = new ResourceService(k8sClient);
    serviceManager.registerService('kubernetes-resources', resourceService);
  }

  const providers: ExplorerSnapshotProviders = {
    dashboardProvider: new DashboardProvider(),
    namespaceProvider: new EdaNamespaceProvider(),
    alarmProvider: new EdaAlarmProvider(),
    deviationProvider: new EdaDeviationProvider(),
    basketProvider: new TransactionBasketProvider(),
    transactionProvider: new EdaTransactionProvider(),
    helpProvider: new HelpProvider()
  };

  return { providers, k8sClient, resourceService };
}

function topEntriesByValue(
  map: Map<string, number>,
  count: number
): Array<{ stream: string; count: number }> {
  return Array.from(map.entries())
    .map(([stream, value]) => ({ stream, count: value }))
    .sort((a, b) => b.count - a.count)
    .slice(0, count);
}

function resetServiceManagerSilently(): void {
  const manager = serviceManager as unknown as {
    services?: Map<string, unknown>;
    clients?: Map<string, unknown>;
  };
  manager.services?.clear();
  manager.clients?.clear();
}

maybeDescribe('EDA loading performance benchmark (integration)', function () {
  this.timeout(parseNumberEnv('EDA_PERF_TEST_TIMEOUT_MS', 10 * 60_000));

  let client: EdaClient | undefined;
  let logStub: sinon.SinonStub | undefined;
  let streamListener: { dispose(): void } | undefined;

  beforeEach(() => {
    resetServiceManagerSilently();
  });

  afterEach(() => {
    if (streamListener) {
      streamListener.dispose();
      streamListener = undefined;
    }
    if (client) {
      client.dispose();
      client = undefined;
    }
    if (logStub) {
      logStub.restore();
      logStub = undefined;
    }
    resetServiceManagerSilently();
  });

  it('measures initialization and API stream startup timing', async () => {
    const config = readConfig();
    const runModeLabel = config.includeKubernetes ? 'with-k8s' : 'without-k8s';
    const fallbackLogFilePath = path.join(
      process.cwd(),
      'test-results',
      `eda-loading-perf-${runModeLabel}-${Date.now()}.log`
    );
    const perfLogger = new PerfFileLogger(config.logFilePath || fallbackLogFilePath);
    const debugLogCollector = new ExtensionDebugLogCollector(
      perfLogger,
      config.captureExtensionDebugLogs,
      config.debugLogSampleLimit
    );
    perfLogger.write(`Starting perf run (${runModeLabel})`);
    perfLogger.write(`Config: ${JSON.stringify({
      baseUrl: config.baseUrl,
      apiPrefixes: config.apiPrefixes,
      streamLimit: config.streamLimit,
      fullStartupSimulation: config.fullStartupSimulation,
      includeBasketStartup: config.includeBasketStartup,
      includeKubernetes: config.includeKubernetes,
      treeStabilityMs: config.treeStabilityMs,
      targetResourceLeafCount: config.targetResourceLeafCount,
      syntheticResourceStream: config.syntheticResourceStream,
      syntheticBatchSize: config.syntheticBatchSize,
      syntheticBatchDelayMs: config.syntheticBatchDelayMs,
      postStartupMonitorMs: config.postStartupMonitorMs,
      captureExtensionDebugLogs: config.captureExtensionDebugLogs,
      debugLogSampleLimit: config.debugLogSampleLimit
    })}`);

    const dispatcher = config.skipTlsVerify
      ? new Agent({ connect: { rejectUnauthorized: false } })
      : undefined;

    const apiBaseUrl = await resolveApiBaseUrl(config.baseUrl, config.apiPrefixes, dispatcher);
    perfLogger.write(`Resolved API base URL: ${apiBaseUrl}`);
    const clientSecret = config.clientSecret || await fetchClientSecret(
      apiBaseUrl,
      config.clientId,
      config.kcUsername,
      config.kcPassword,
      dispatcher
    );
    expect(clientSecret).to.be.a('string').and.not.empty;
    perfLogger.write('Client secret resolved');

    logStub = sinon.stub(extension, 'log').callsFake((
      message: string,
      level: extension.LogLevel = extension.LogLevel.INFO
    ) => {
      debugLogCollector.capture(message, level);
    });

    const initStart = nowMs();
    client = new EdaClient(apiBaseUrl, {
      clientId: config.clientId,
      clientSecret,
      skipTlsVerify: config.skipTlsVerify,
      edaUsername: config.edaUsername,
      edaPassword: config.edaPassword
    });
    const streamNames = await client.getStreamNames();
    const initDurationMs = nowMs() - initStart;
    perfLogger.write(`Discovered ${streamNames.length} streams in ${roundMs(initDurationMs)}ms`);

    const namespaceProviderStreams = pickStreams(streamNames, config);
    expect(namespaceProviderStreams.length).to.be.greaterThan(0);

    const expectedStreamSet = new Set(namespaceProviderStreams);
    expectedStreamSet.add('namespaces');

    if (config.fullStartupSimulation) {
      expectedStreamSet.add('current-alarms');
      expectedStreamSet.add('deviations');
      expectedStreamSet.add('summary');
      if (config.includeBasketStartup) {
        expectedStreamSet.add('file');
      }
    }
    const expectedStreams = Array.from(expectedStreamSet);
    perfLogger.write(`Expecting ${expectedStreams.length} active startup streams`);

    const harness = createStartupProviders(client, config.includeKubernetes);
    const providers = harness.providers;
    const firstMessageByStream = new Map<string, number>();
    const messageCountByStream = new Map<string, number>();
    const updateCountByStream = new Map<string, number>();
    const streamHasStateField = new Map<string, boolean>();
    const syncedByStream = new Map<string, number>();

    const subscribeStart = nowMs();
    streamListener = client.onStreamMessage((stream, message) => {
      if (!expectedStreamSet.has(stream)) {
        return;
      }
      if (!firstMessageByStream.has(stream)) {
        firstMessageByStream.set(stream, nowMs() - subscribeStart);
        perfLogger.write(`First message: ${stream} at ${roundMs(firstMessageByStream.get(stream) || 0)}ms`);
      }

      const envelope = message as StreamEnvelope;
      if (typeof envelope.state === 'string') {
        streamHasStateField.set(stream, true);
        if (envelope.state.toLowerCase() === 'synced' && !syncedByStream.has(stream)) {
          syncedByStream.set(stream, nowMs() - subscribeStart);
          perfLogger.write(`Synced: ${stream} at ${roundMs(syncedByStream.get(stream) || 0)}ms`);
        }
      }

      messageCountByStream.set(stream, (messageCountByStream.get(stream) || 0) + 1);
      updateCountByStream.set(stream, (updateCountByStream.get(stream) || 0) + countUpdates(message));
    });

    const subscribeCallStart = nowMs();
    const startupCalls: Array<Promise<void>> = [providers.namespaceProvider.initialize()];
    if (config.fullStartupSimulation) {
      startupCalls.push(
        providers.alarmProvider.initialize(),
        providers.deviationProvider.initialize(),
        providers.transactionProvider.initialize()
      );
      if (config.includeBasketStartup) {
        startupCalls.push(providers.basketProvider.initialize());
      }
    }
    await Promise.all(startupCalls);
    const subscribeCallMs = nowMs() - subscribeCallStart;
    perfLogger.write(`Startup provider initialization calls completed in ${roundMs(subscribeCallMs)}ms`);

    let injectedSyntheticResources = 0;
    let reachedTargetFromSubscribeMs = 0;
    if (config.targetResourceLeafCount > 0) {
      const initialTargetSnapshot = buildExplorerSnapshot(providers, '');
      let targetSummary = summarizeSnapshot(initialTargetSnapshot);
      if (targetSummary.resourceLeafCount < config.targetResourceLeafCount) {
        injectedSyntheticResources = await injectSyntheticResources(
          client,
          perfLogger,
          config,
          targetSummary.resourceLeafCount
        );
      }

      const targetDeadline = Date.now() + config.firstEventTimeoutMs;
      while (Date.now() < targetDeadline) {
        const probeSnapshot = buildExplorerSnapshot(providers, '');
        targetSummary = summarizeSnapshot(probeSnapshot);
        if (targetSummary.resourceLeafCount >= config.targetResourceLeafCount) {
          reachedTargetFromSubscribeMs = nowMs() - subscribeStart;
          break;
        }
        await sleep(config.treePollMs);
      }
      if (reachedTargetFromSubscribeMs > 0) {
        perfLogger.write(
          `Target resource count reached from subscribe-start in ${roundMs(reachedTargetFromSubscribeMs)}ms`
        );
      } else {
        perfLogger.write(
          `Target resource count not reached from subscribe-start before timeout (target=${config.targetResourceLeafCount})`
        );
      }
    }

    await waitForFullySyncedOrFirstData(
      expectedStreams,
      firstMessageByStream,
      streamHasStateField,
      syncedByStream,
      config.firstEventTimeoutMs
    );
    perfLogger.write('Reached synced-or-first-data condition for expected streams');

    // Give the providers a short settle window before taking the tree snapshot.
    await sleep(500);

    const latencies = Array.from(firstMessageByStream.values()).sort((a, b) => a - b);
    expect(latencies.length).to.be.greaterThan(0);

    const syncLatencies = Array.from(syncedByStream.values()).sort((a, b) => a - b);
    const syncCompletionMs = syncLatencies.length > 0
      ? (syncLatencies[syncLatencies.length - 1] || 0)
      : (latencies[latencies.length - 1] || 0);

    const totalMessages = Array.from(messageCountByStream.values()).reduce((sum, count) => sum + count, 0);
    const totalUpdates = Array.from(updateCountByStream.values()).reduce((sum, count) => sum + count, 0);
    const namespaceCount = client.getCachedNamespaces().length;

    const initialSnapshotStart = nowMs();
    const initialSnapshot = buildExplorerSnapshot(providers, '');
    let snapshotMs = nowMs() - initialSnapshotStart;
    let latestSnapshot = initialSnapshot;
    const initialVisibleSsrRenderStart = nowMs();
    const initialVisibleMarkup = renderExplorerSectionsMarkup(initialSnapshot.sections, false);
    const initialSsrVisibleRenderMs = nowMs() - initialVisibleSsrRenderStart;
    const initialVisibleMarkupBytes = Buffer.byteLength(initialVisibleMarkup, 'utf8');
    perfLogger.write(
      `Webview SSR visible render (initial snapshot): ${roundMs(initialSsrVisibleRenderMs)}ms`
      + `, markup=${initialVisibleMarkupBytes} bytes`
    );

    const initialExpandedSsrRenderStart = nowMs();
    const initialExpandedMarkup = renderExplorerSectionsMarkup(initialSnapshot.sections, true);
    const initialSsrExpandedRenderMs = nowMs() - initialExpandedSsrRenderStart;
    const initialExpandedMarkupBytes = Buffer.byteLength(initialExpandedMarkup, 'utf8');
    perfLogger.write(
      `Webview SSR expanded render (initial snapshot): ${roundMs(initialSsrExpandedRenderMs)}ms`
      + `, markup=${initialExpandedMarkupBytes} bytes`
    );
    const initialSummary = summarizeSnapshot(initialSnapshot);
    let sectionNodeCounts: Record<string, number> = initialSummary.sectionNodeCounts;
    let totalNodes = initialSummary.totalNodes;
    let resourceLeafCount = initialSummary.resourceLeafCount;
    let lastSignature = initialSummary.signature;

    const treeStabilityStart = nowMs();
    let stableSince = nowMs();
    let reachedTargetMs = 0;

    while ((nowMs() - treeStabilityStart) < config.firstEventTimeoutMs) {
      const snapshotStart = nowMs();
      const snapshot = buildExplorerSnapshot(providers, '');
      latestSnapshot = snapshot;
      snapshotMs = nowMs() - snapshotStart;
      const summary = summarizeSnapshot(snapshot);
      sectionNodeCounts = summary.sectionNodeCounts;
      totalNodes = summary.totalNodes;
      resourceLeafCount = summary.resourceLeafCount;

      if (summary.signature !== lastSignature) {
        lastSignature = summary.signature;
        stableSince = nowMs();
      }

      const targetReached = config.targetResourceLeafCount <= 0 || resourceLeafCount >= config.targetResourceLeafCount;
      if (targetReached && reachedTargetMs === 0) {
        reachedTargetMs = nowMs() - treeStabilityStart;
      }

      if (targetReached && (nowMs() - stableSince) >= config.treeStabilityMs) {
        perfLogger.write(`Tree stabilized after ${roundMs(nowMs() - treeStabilityStart)}ms`);
        break;
      }

      await sleep(config.treePollMs);
    }
    const treeStableMs = nowMs() - treeStabilityStart;
    const stableVisibleSsrRenderStart = nowMs();
    const stableVisibleMarkup = renderExplorerSectionsMarkup(latestSnapshot.sections, false);
    const stableSsrVisibleRenderMs = nowMs() - stableVisibleSsrRenderStart;
    const stableVisibleMarkupBytes = Buffer.byteLength(stableVisibleMarkup, 'utf8');
    perfLogger.write(
      `Webview SSR visible render (stable snapshot): ${roundMs(stableSsrVisibleRenderMs)}ms`
      + `, markup=${stableVisibleMarkupBytes} bytes`
    );

    const stableExpandedSsrRenderStart = nowMs();
    const stableExpandedMarkup = renderExplorerSectionsMarkup(latestSnapshot.sections, true);
    const stableSsrExpandedRenderMs = nowMs() - stableExpandedSsrRenderStart;
    const stableExpandedMarkupBytes = Buffer.byteLength(stableExpandedMarkup, 'utf8');
    perfLogger.write(
      `Webview SSR expanded render (stable snapshot): ${roundMs(stableSsrExpandedRenderMs)}ms`
      + `, markup=${stableExpandedMarkupBytes} bytes`
    );
    const reachedTarget = config.targetResourceLeafCount <= 0 || resourceLeafCount >= config.targetResourceLeafCount;
    if (!reachedTarget) {
      perfLogger.write(
        `Target resource count not reached before timeout: current=${resourceLeafCount}, target=${config.targetResourceLeafCount}`
      );
    }

    const monitorMessagesBefore = new Map(messageCountByStream);
    const monitorUpdatesBefore = new Map(updateCountByStream);
    if (config.postStartupMonitorMs > 0) {
      perfLogger.write(`Monitoring incoming messages for ${config.postStartupMonitorMs}ms`);
      await sleep(config.postStartupMonitorMs);
    }

    const monitorMessageDelta = new Map<string, number>();
    const monitorUpdateDelta = new Map<string, number>();
    for (const streamName of expectedStreams) {
      const messageBefore = monitorMessagesBefore.get(streamName) || 0;
      const messageAfter = messageCountByStream.get(streamName) || 0;
      const updateBefore = monitorUpdatesBefore.get(streamName) || 0;
      const updateAfter = updateCountByStream.get(streamName) || 0;
      monitorMessageDelta.set(streamName, Math.max(0, messageAfter - messageBefore));
      monitorUpdateDelta.set(streamName, Math.max(0, updateAfter - updateBefore));
    }
    const monitorMessages = Array.from(monitorMessageDelta.values()).reduce((sum, value) => sum + value, 0);
    const monitorUpdates = Array.from(monitorUpdateDelta.values()).reduce((sum, value) => sum + value, 0);
    const topStreamsByMessages = topEntriesByValue(monitorMessageDelta, 10);
    const topStreamsByUpdates = topEntriesByValue(monitorUpdateDelta, 10);
    perfLogger.write(`Monitor totals: messages=${monitorMessages}, updates=${monitorUpdates}`);
    perfLogger.write(`Top streams by messages: ${JSON.stringify(topStreamsByMessages)}`);
    perfLogger.write(`Top streams by updates: ${JSON.stringify(topStreamsByUpdates)}`);

    const streamsWithStateSeen = Array.from(streamHasStateField.entries())
      .filter(([, hasState]) => hasState)
      .map(([name]) => name);
    const unsyncedStreams = streamsWithStateSeen.filter(name => !syncedByStream.has(name));
    const debugLogs = debugLogCollector.toResult();

    const result: BenchmarkResult = {
      apiBaseUrl,
      startupMode: config.fullStartupSimulation ? 'full-extension-stream-startup' : 'namespace-provider-only',
      discoveredStreams: streamNames.length,
      subscribedStreams: expectedStreams.length,
      namespaceCount,
      initializationMs: roundMs(initDurationMs),
      subscribeCallMs: roundMs(subscribeCallMs),
      syncCompletionMs: roundMs(syncCompletionMs),
      treeSnapshotMs: roundMs(snapshotMs),
      treeStableMs: roundMs(treeStableMs),
      firstMessage: {
        receivedStreams: firstMessageByStream.size,
        missingStreams: expectedStreams.length - firstMessageByStream.size,
        minMs: roundMs(latencies[0] || 0),
        p50Ms: roundMs(percentile(latencies, 50)),
        p95Ms: roundMs(percentile(latencies, 95)),
        maxMs: roundMs(latencies[latencies.length - 1] || 0)
      },
      updateVolume: {
        messages: totalMessages,
        updates: totalUpdates
      },
      syncState: {
        streamsWithStateSeen: streamsWithStateSeen.length,
        syncedStreams: syncedByStream.size,
        unsyncedStreams: unsyncedStreams.length
      },
      treeSummary: {
        sectionNodeCounts,
        totalNodes,
        resourceLeafCount
      },
      webviewRender: {
        initialSsrVisibleRenderMs: roundMs(initialSsrVisibleRenderMs),
        stableSsrVisibleRenderMs: roundMs(stableSsrVisibleRenderMs),
        initialVisibleMarkupBytes,
        stableVisibleMarkupBytes,
        initialSsrExpandedRenderMs: roundMs(initialSsrExpandedRenderMs),
        stableSsrExpandedRenderMs: roundMs(stableSsrExpandedRenderMs),
        initialExpandedMarkupBytes,
        stableExpandedMarkupBytes
      },
      resourceTarget: {
        targetResourceLeafCount: config.targetResourceLeafCount,
        injectedSyntheticResources,
        syntheticStream: config.syntheticResourceStream,
        reachedTarget,
        reachedTargetFromSubscribeMs: roundMs(reachedTargetFromSubscribeMs),
        reachedTargetMs: roundMs(reachedTargetMs)
      },
      kubernetes: {
        enabled: config.includeKubernetes,
        context: harness.k8sClient?.getCurrentContext() || 'none',
        cachedNamespaces: harness.k8sClient?.getCachedNamespaces().length || 0,
        watchedResourceTypes: harness.k8sClient?.getWatchedResourceTypes().length || 0
      },
      monitor: {
        durationMs: config.postStartupMonitorMs,
        messages: monitorMessages,
        updates: monitorUpdates,
        topStreamsByMessages,
        topStreamsByUpdates
      },
      debugLogs,
      logFilePath: perfLogger.getPath(),
      registrationFanout: estimateRegistrationFanout(client, expectedStreams, namespaceCount)
    };

    process.stdout.write(`[EDA_PERF] ${JSON.stringify(result, null, 2)}\n`);
    perfLogger.write(`Final result: ${JSON.stringify(result)}`);
    perfLogger.write(`Debug summary: ${JSON.stringify(debugLogs)}`);

    if (firstMessageByStream.size !== expectedStreams.length) {
      const missingStreams = expectedStreams.filter(name => !firstMessageByStream.has(name));
      process.stdout.write(`[EDA_PERF] Missing first message for ${missingStreams.length} stream(s): ${missingStreams.join(', ')}\n`);
    }
    if (unsyncedStreams.length > 0) {
      process.stdout.write(`[EDA_PERF] Streams with state but not synced: ${unsyncedStreams.join(', ')}\n`);
    }

    for (const streamName of expectedStreams) {
      client.closeStreamByName(streamName);
    }
    providers.namespaceProvider.dispose();
    providers.alarmProvider.dispose();
    providers.deviationProvider.dispose();
    providers.basketProvider.dispose();
    providers.transactionProvider.dispose();
    harness.resourceService?.dispose();
    harness.k8sClient?.dispose();
  });
});
