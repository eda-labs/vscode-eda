/* global AbortController */
import { TextDecoder } from 'util';

import WebSocket from 'ws';
import { fetch } from 'undici';
import * as vscode from 'vscode';

import { LogLevel, log } from '../extension';

import type { EdaAuthClient } from './edaAuthClient';

// String constants for stream-related values (sonarjs/no-duplicate-string)
const STREAM_FILE = 'file';
const STREAM_SUMMARY = 'summary';
const STREAM_CURRENT_ALARMS = 'current-alarms';
const MSG_TYPE_NEXT = 'next';
const MSG_TYPE_CLOSE = 'close';
const MSG_TYPE_REGISTER = 'register';

export interface StreamEndpoint {
  path: string;
  stream: string;
  namespaced?: boolean;
  namespaceParam?: string;
}

/** Generic stream message payload - the actual content varies by stream type */
export interface StreamMessagePayload {
  type?: string;
  stream?: string;
  msg?: {
    client?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface StreamMessage {
  stream: string;
  message: StreamMessagePayload;
}

/** WebSocket registration message structure */
interface RegistrationMessage {
  type: string;
  msg?: {
    client?: string;
  };
}

/** Undici fetch Response type for SSE streaming */
interface SseResponse {
  ok: boolean;
  status: number;
  headers: {
    get(name: string): string | null;
  };
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}

/** Reader for streaming response body */
interface StreamReader {
  read(): Promise<{ value?: Uint8Array; done: boolean }>;
}

/** Result of an SSE request attempt */
interface SseRequestResult {
  response?: SseResponse;
  error?: Error;
  aborted?: boolean;
}

/** Result of token refresh and retry attempt */
interface TokenRefreshResult extends SseRequestResult {
  shouldRetry?: boolean;
}

/**
 * Client for EDA WebSocket streaming
 */
export class EdaStreamClient {
  private eventSocket: WebSocket | undefined;
  private eventClient: string | undefined;
  private connectPromise: Promise<void> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private intentionallyClosedSockets = new WeakSet<WebSocket>();
  private activeStreams: Set<string> = new Set();
  private transactionSummarySize = 50;
  private lastNextTimestamps: Map<string, number> = new Map();
  private pendingNextMessages: Set<string> = new Set();
  private pendingNextTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private messageIntervalMs = 500;
  private streamAbortControllers: Map<string, AbortController> = new Map();
  private streamPromises: Map<string, Promise<void>> = new Map();
  private summaryAbortController: AbortController | undefined;
  private summaryStreamPromise: Promise<void> | undefined;
  private userStorageFiles: Set<string> = new Set();
  private eqlStreams: Map<string, { query: string; namespaces?: string }> = new Map();
  private eqlAbortControllers: Map<string, AbortController> = new Map();
  private eqlStreamPromises: Map<string, Promise<void>> = new Map();
  private nqlStreams: Map<string, { query: string; namespaces?: string }> = new Map();
  private nqlAbortControllers: Map<string, AbortController> = new Map();
  private nqlStreamPromises: Map<string, Promise<void>> = new Map();
  private disposed = false;

  private _onStreamMessage = new vscode.EventEmitter<StreamMessage>();
  public readonly onStreamMessage = this._onStreamMessage.event;


  private authClient: EdaAuthClient | undefined;
  private streamEndpoints: StreamEndpoint[] = [];
  private streamAliases: Map<string, string> = new Map();
  private namespaces: Set<string> = new Set();
  private coreNamespace = 'eda-system';

  // Stream names that should not be automatically subscribed to
  private static readonly AUTO_EXCLUDE = new Set([
    'resultsummary',
    'v1',
    'eql',
    'nql',
    STREAM_CURRENT_ALARMS,
    STREAM_SUMMARY,
    'directory',
    STREAM_FILE,  // user-storage file stream requires path parameter
  ]);

  constructor() {
    this.disposed = false;
    log('EdaStreamClient initialized', LogLevel.DEBUG);
  }


  public isConnected(): boolean {
    return (
      this.eventSocket !== undefined &&
      this.eventSocket.readyState === WebSocket.OPEN
    );
  }

  public isSubscribed(streamName: string): boolean {
    return this.activeStreams.has(streamName);
  }

  /**
   * Set the authentication client
   */
  public setAuthClient(authClient: EdaAuthClient): void {
    this.authClient = authClient;
  }

  /**
   * Set available stream endpoints
   */
  public setStreamEndpoints(endpoints: StreamEndpoint[]): void {
    this.streamEndpoints = endpoints;
  }

  public setCoreNamespace(namespace: string): void {
    if (!namespace) {
      return;
    }
    this.coreNamespace = namespace;
    if (this.namespaces.size === 0) {
      this.namespaces.add(namespace);
    }
  }

  private normalizeNamespaces(namespaces: string[]): Set<string> {
    const updated = new Set<string>();
    for (const namespace of namespaces) {
      if (typeof namespace === 'string' && namespace.length > 0) {
        updated.add(namespace);
      }
    }
    if (this.coreNamespace) {
      updated.add(this.coreNamespace);
    }
    return updated;
  }

  private stopRemovedNamespacedStreams(removedNamespaces: string[]): void {
    if (removedNamespaces.length === 0) {
      return;
    }
    for (const streamName of this.activeStreams) {
      const endpoint = this.streamEndpoints.find(ep => ep.stream === streamName);
      if (!endpoint || !endpoint.namespaced) {
        continue;
      }
      for (const namespace of removedNamespaces) {
        const alias = this.getNamespacedAlias(streamName, namespace);
        this.clearPendingNextTimer(alias);
        this.sendCloseMessage(alias);
        this.clearManagedStreamState(alias);
        this.streamAliases.delete(alias);
      }
    }
  }

  private restartActiveNamespacedStreams(client: string): void {
    for (const streamName of this.activeStreams) {
      const endpoint = this.streamEndpoints.find(ep => ep.stream === streamName);
      if (!endpoint || !endpoint.namespaced) {
        continue;
      }
      this.startNamespacedEndpointStreams(client, endpoint);
      this.sendNextForLogicalStream(streamName);
    }
  }

  public setNamespaces(namespaces: string[]): void {
    const previousNamespaces = new Set(this.getKnownNamespaces());
    const updated = this.normalizeNamespaces(namespaces);
    this.namespaces = updated;

    const removedNamespaces = Array.from(previousNamespaces).filter((namespace) => !updated.has(namespace));
    this.stopRemovedNamespacedStreams(removedNamespaces);

    if (this.eventSocket?.readyState !== WebSocket.OPEN || !this.eventClient) {
      return;
    }
    this.restartActiveNamespacedStreams(this.eventClient);
  }

  public setEqlQuery(query: string, namespaces?: string, streamName = 'eql'): void {
    this.eqlStreams.set(streamName, { query, namespaces });
  }

  public setNqlQuery(query: string, namespaces?: string, streamName = 'nql'): void {
    this.nqlStreams.set(streamName, { query, namespaces });
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect().catch(() => { /* ignore */ });
    }, 2000);
  }

  private clearPendingNextTimer(stream: string): void {
    this.pendingNextMessages.delete(stream);
    const timer = this.pendingNextTimers.get(stream);
    if (timer) {
      clearTimeout(timer);
      this.pendingNextTimers.delete(stream);
    }
  }

  private clearAllPendingNextTimers(): void {
    for (const timer of this.pendingNextTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingNextTimers.clear();
    this.pendingNextMessages.clear();
    this.lastNextTimestamps.clear();
  }

  private getLogicalStreamName(stream: string): string {
    return this.streamAliases.get(stream) ?? stream;
  }

  private isLogicalStreamActive(stream: string): boolean {
    return this.activeStreams.has(this.getLogicalStreamName(stream));
  }

  private getPhysicalStreamsForLogicalStream(streamName: string): string[] {
    const physical = new Set<string>([streamName]);
    for (const [alias, logical] of this.streamAliases.entries()) {
      if (logical === streamName) {
        physical.add(alias);
      }
    }
    return Array.from(physical);
  }

  private sendNextForLogicalStream(streamName: string): void {
    for (const physicalStream of this.getPhysicalStreamsForLogicalStream(streamName)) {
      this.sendNextMessage(physicalStream);
    }
  }

  private getKnownNamespaces(): string[] {
    if (this.namespaces.size > 0) {
      return Array.from(this.namespaces);
    }
    return this.coreNamespace ? [this.coreNamespace] : [];
  }

  private getNamespacedAlias(stream: string, namespace: string): string {
    return `${stream}__ns__${namespace}`;
  }

  private resolveNamespacedPath(endpoint: StreamEndpoint, namespace: string): string | undefined {
    const namespaceParam = endpoint.namespaceParam ?? 'namespace';
    const token = `{${namespaceParam}}`;
    if (!endpoint.path.includes(token)) {
      return undefined;
    }
    const resolved = endpoint.path.replace(token, encodeURIComponent(namespace));
    return resolved.includes('{') ? undefined : resolved;
  }

  private startNamespacedEndpointStreams(client: string, endpoint: StreamEndpoint): void {
    if (!this.authClient) {
      return;
    }
    for (const namespace of this.getKnownNamespaces()) {
      const path = this.resolveNamespacedPath(endpoint, namespace);
      if (!path) {
        log(`Failed to resolve namespaced stream path for ${endpoint.stream}: ${endpoint.path}`, LogLevel.DEBUG);
        continue;
      }
      const alias = this.getNamespacedAlias(endpoint.stream, namespace);
      this.streamAliases.set(alias, endpoint.stream);
      const url =
        `${this.authClient.getBaseUrl()}${path}` +
        `?eventclient=${encodeURIComponent(client)}` +
        `&stream=${encodeURIComponent(alias)}`;
      this.startManagedStream(alias, endpoint.stream, url);
    }
  }

  private startManagedStream(
    key: string,
    streamName: string,
    url: string,
    extraHeaders: Record<string, string> = {}
  ): void {
    if (this.streamPromises.has(key)) {
      return;
    }

    const controller = new AbortController();
    this.streamAbortControllers.set(key, controller);
    const promise = this.streamSse(url, controller, extraHeaders)
      .catch(err => {
        log(`[STREAM:${streamName}] error: ${err}`, LogLevel.ERROR);
      })
      .finally(() => {
        this.streamAbortControllers.delete(key);
        this.streamPromises.delete(key);
      });
    this.streamPromises.set(key, promise);
  }

  /**
   * Connect to the WebSocket
   */
  public async connect(): Promise<void> {
    if (!this.authClient) {
      throw new Error('Auth client not set');
    }

    if (this.disposed) {
      return;
    }

    await this.authClient.waitForAuth();

    this.clearReconnectTimer();

    if (
      this.eventSocket &&
      (this.eventSocket.readyState === WebSocket.OPEN ||
        this.eventSocket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }

    const url = new URL(this.authClient.getBaseUrl());
    const wsUrl = `wss://${url.host}/events`;
    log(`CONNECT ${wsUrl}`, LogLevel.INFO);

    const socket = new WebSocket(wsUrl, {
      headers: this.authClient.getWsHeaders(),
      ...this.authClient.getWsOptions(),
    });
    this.eventSocket = socket;

    const connectPromise = new Promise<void>(resolve => {
      let settled = false;
      const settle = () => {
        if (settled) {
          return;
        }
        settled = true;
        if (this.connectPromise === connectPromise) {
          this.connectPromise = undefined;
        }
        resolve();
      };

      const handleSocketClose = () => {
        const isCurrentSocket = this.eventSocket === socket;
        if (isCurrentSocket) {
          this.eventSocket = undefined;
          this.eventClient = undefined;
        }

        const intentional = this.intentionallyClosedSockets.has(socket);
        this.intentionallyClosedSockets.delete(socket);
        if (!intentional) {
          this.scheduleReconnect();
        }

        settle();
      };

      socket.on('open', () => {
        if (this.eventSocket !== socket) {
          settle();
          return;
        }
        log('Event WebSocket connected', LogLevel.DEBUG);
        log(`Started streaming on ${this.streamEndpoints.length} nodes`, LogLevel.INFO);
        log(`WebSocket opened with ${this.activeStreams.size} active streams`, LogLevel.DEBUG);
        settle();
      });

      socket.on('message', data => {
        if (this.eventSocket !== socket) {
          return;
        }
        const txt = data.toString();
        if (!this.eventClient) {
          this.handleRegistrationMessage(txt);
        }
        this.handleEventMessage(txt);
      });

      socket.on('close', () => {
        handleSocketClose();
      });

      socket.on('unexpected-response', (_req, res) => {
        const handleUnexpectedResponse = async () => {
          log(
            `Event WebSocket unexpected response: HTTP ${res.statusCode}`,
            LogLevel.ERROR
          );
          if (res.statusCode === 401 && this.authClient) {
            log('Refreshing authentication token for WebSocket...', LogLevel.INFO);
            await this.authClient.refreshAuth();
          }
          this.intentionallyClosedSockets.add(socket);
          try {
            socket.close();
          } catch {
            /* ignore */
          }
          if (this.eventSocket === socket) {
            this.eventSocket = undefined;
            this.eventClient = undefined;
          }
          this.scheduleReconnect();
          settle();
        };
        handleUnexpectedResponse().catch(() => { /* ignore */ });
      });

      socket.on('error', err => {
        const handleError = async () => {
          log(`Event WebSocket error: ${err}`, LogLevel.ERROR);
          if (err instanceof Error && err.message.includes('401') && this.authClient) {
            log('Refreshing authentication token for WebSocket...', LogLevel.INFO);
            await this.authClient.refreshAuth();
          }
          settle();
        };
        handleError().catch(() => { /* ignore */ });
      });
    });

    this.connectPromise = connectPromise;
    await connectPromise;
  }

  /**
   * Handle WebSocket registration message and start all subscribed streams
   */
  private handleRegistrationMessage(txt: string): void {
    try {
      const obj = JSON.parse(txt) as RegistrationMessage;
      const client = obj.msg?.client;
      if (obj.type !== MSG_TYPE_REGISTER || !client) {
        return;
      }
      this.eventClient = client;
      log(`WS eventclient id = ${this.eventClient}`, LogLevel.DEBUG);

      this.startSubscribedStreams(client);
      this.startSpecialStreams(client);
      this.startUserStorageStreams(client);
    } catch {
      /* ignore parse errors */
    }
  }

  /**
   * Start all regular streams that are in activeStreams
   */
  private startSubscribedStreams(client: string): void {
    for (const ep of this.streamEndpoints) {
      if (this.activeStreams.has(ep.stream)) {
        log(`Starting stream: ${ep.stream}`, LogLevel.DEBUG);
        this.startStream(client, ep);
      }
    }
  }

  /**
   * Start special streams (current-alarms, summary, EQL, NQL)
   */
  private startSpecialStreams(client: string): void {
    if (this.activeStreams.has(STREAM_CURRENT_ALARMS)) {
      this.startCurrentAlarmStream(client);
    }
    if (this.activeStreams.has(STREAM_SUMMARY)) {
      this.startTransactionSummaryStream(client);
    }
    for (const streamName of this.eqlStreams.keys()) {
      if (this.activeStreams.has(streamName)) {
        this.startEqlStream(client, streamName);
      }
    }
    for (const streamName of this.nqlStreams.keys()) {
      if (this.activeStreams.has(streamName)) {
        this.startNqlStream(client, streamName);
      }
    }
  }

  /**
   * Start user storage file streams
   */
  private startUserStorageStreams(client: string): void {
    if (this.userStorageFiles.size > 0 && !this.activeStreams.has(STREAM_FILE)) {
      this.activeStreams.add(STREAM_FILE);
      this.sendNextMessage(STREAM_FILE);
    }
    for (const file of this.userStorageFiles) {
      this.startUserStorageFileStream(client, file);
    }
  }

  /**
   * Subscribe to a stream
   */
  public subscribeToStream(streamName: string): void {
    this.activeStreams.add(streamName);
    log(`Subscribed to stream: ${streamName}`, LogLevel.DEBUG);

    if (this.eventSocket?.readyState === WebSocket.OPEN && this.eventClient) {
      this.startStreamByName(this.eventClient, streamName);
      this.sendNextForLogicalStream(streamName);
    }
  }

  private startStreamByName(client: string, streamName: string): void {
    if (streamName === STREAM_CURRENT_ALARMS) {
      this.startCurrentAlarmStream(client);
      return;
    }
    if (streamName === STREAM_SUMMARY) {
      this.startTransactionSummaryStream(client);
      return;
    }
    if (this.eqlStreams.has(streamName)) {
      this.startEqlStream(client, streamName);
      return;
    }
    if (this.nqlStreams.has(streamName)) {
      this.startNqlStream(client, streamName);
      return;
    }
    if (streamName === STREAM_FILE) {
      this.startUserStorageStreams(client);
      return;
    }

    const endpoint = this.streamEndpoints.find(ep => ep.stream === streamName);
    if (!endpoint) {
      log(`No stream endpoint found for ${streamName}`, LogLevel.DEBUG);
      return;
    }
    this.startStream(client, endpoint);
  }

  private sendCloseMessage(streamName: string): void {
    if (this.eventSocket?.readyState !== WebSocket.OPEN) {
      return;
    }
    log(`Sending 'close' for stream: ${streamName}`, LogLevel.DEBUG);
    try {
      this.eventSocket.send(JSON.stringify({ type: MSG_TYPE_CLOSE, stream: streamName }));
    } catch (err) {
      log(`Failed sending 'close' for stream ${streamName}: ${err}`, LogLevel.DEBUG);
    }
  }

  private clearSummaryStreamState(streamName: string): void {
    if (streamName !== STREAM_SUMMARY || !this.summaryAbortController) {
      return;
    }
    this.summaryAbortController.abort();
    // do not clear summaryStreamPromise so a restart can wait for closure
    this.summaryAbortController = undefined;
  }

  private clearEqlStreamState(streamName: string): void {
    const ctl = this.eqlAbortControllers.get(streamName);
    if (ctl) {
      ctl.abort();
      this.eqlAbortControllers.delete(streamName);
    }
    this.eqlStreamPromises.delete(streamName);
    this.eqlStreams.delete(streamName);
  }

  private clearNqlStreamState(streamName: string): void {
    const ctl = this.nqlAbortControllers.get(streamName);
    if (ctl) {
      ctl.abort();
      this.nqlAbortControllers.delete(streamName);
    }
    this.nqlStreamPromises.delete(streamName);
    this.nqlStreams.delete(streamName);
  }

  private clearManagedStreamState(streamName: string): void {
    const streamCtl = this.streamAbortControllers.get(streamName);
    if (streamCtl) {
      streamCtl.abort();
      this.streamAbortControllers.delete(streamName);
    }
    this.streamPromises.delete(streamName);
  }

  private clearFileManagedStreams(): void {
    for (const key of Array.from(this.streamAbortControllers.keys())) {
      if (key.startsWith(`${STREAM_FILE}:`)) {
        const fileCtl = this.streamAbortControllers.get(key);
        if (fileCtl) {
          fileCtl.abort();
        }
        this.streamAbortControllers.delete(key);
        this.streamPromises.delete(key);
      }
    }
  }

  /**
   * Unsubscribe from a stream
   */
  public unsubscribeFromStream(streamName: string): void {
    this.activeStreams.delete(streamName);
    const physicalStreams = this.getPhysicalStreamsForLogicalStream(streamName);
    for (const physicalStream of physicalStreams) {
      this.clearPendingNextTimer(physicalStream);
      this.sendCloseMessage(physicalStream);
      this.clearManagedStreamState(physicalStream);
      if (physicalStream !== streamName) {
        this.streamAliases.delete(physicalStream);
      }
    }

    this.clearSummaryStreamState(streamName);
    this.clearEqlStreamState(streamName);
    this.clearNqlStreamState(streamName);
    if (streamName === STREAM_FILE) {
      this.clearFileManagedStreams();
    }

    log(`Unsubscribed from stream: ${streamName}`, LogLevel.DEBUG);
  }

  public async closeEqlStream(streamName: string): Promise<void> {
    const promise = this.eqlStreamPromises.get(streamName);
    this.unsubscribeFromStream(streamName);
    if (promise) {
      try {
        await promise;
      } catch {
        /* ignore */
      }
    }
  }

  public async closeNqlStream(streamName: string): Promise<void> {
    const promise = this.nqlStreamPromises.get(streamName);
    this.unsubscribeFromStream(streamName);
    if (promise) {
      try {
        await promise;
      } catch {
        /* ignore */
      }
    }
  }


  /**
   * Set transaction summary size
   */
  public setTransactionSummarySize(size: number): void {
    this.transactionSummarySize = size;
  }

  /**
   * Restart the transaction summary stream with the current size
   */
  public async restartTransactionSummaryStream(): Promise<void> {
    log('Restarting transaction summary stream', LogLevel.DEBUG);
    if (this.summaryAbortController) {
      this.summaryAbortController.abort();
    }
    if (this.summaryStreamPromise) {
      try {
        await this.summaryStreamPromise;
      } catch {
        // ignore errors from aborted stream
      }
    }
    this.summaryAbortController = undefined;
    this.summaryStreamPromise = undefined;
    await this.reconnect(false);
  }

  /**
   * Disconnect the WebSocket
   */
  public disconnect(clearStreams = true): void {
    this.clearReconnectTimer();
    this.clearAllPendingNextTimers();

    if (this.eventSocket) {
      this.intentionallyClosedSockets.add(this.eventSocket);
      this.eventSocket.close();
      this.eventSocket = undefined;
    }
    this.connectPromise = undefined;
    if (this.summaryAbortController) {
      this.summaryAbortController.abort();
    }
    if (this.summaryStreamPromise) {
      // wait briefly for the stream to close
      this.summaryStreamPromise.catch(() => { /* ignore */ });
      this.summaryStreamPromise = undefined;
    }
    this.summaryAbortController = undefined;
    for (const ctl of this.eqlAbortControllers.values()) {
      ctl.abort();
    }
    this.eqlAbortControllers.clear();
    this.eqlStreamPromises.clear();
    for (const ctl of this.nqlAbortControllers.values()) {
      ctl.abort();
    }
    this.nqlAbortControllers.clear();
    this.nqlStreamPromises.clear();

    for (const ctl of this.streamAbortControllers.values()) {
      ctl.abort();
    }
    this.streamAbortControllers.clear();
    this.streamPromises.clear();

    this.eventClient = undefined;
    if (clearStreams) {
      this.activeStreams.clear();
      this.streamAliases.clear();
    }
  }

  public async reconnect(clearStreams = false): Promise<void> {
    log('Reconnecting stream client', LogLevel.DEBUG);
    this.disconnect(clearStreams);
    await this.connect();
  }

  /**
   * Add a user-storage file to stream
   */
  public async streamUserStorageFile(path: string): Promise<void> {
    this.userStorageFiles.add(path);

    // Make sure we're subscribed to the 'file' stream via WebSocket
    if (!this.activeStreams.has(STREAM_FILE)) {
      this.activeStreams.add(STREAM_FILE);
      this.sendNextMessage(STREAM_FILE);
    }

    await this.connect();
    if (this.eventClient) {
      this.startUserStorageFileStream(this.eventClient, path);
    }
  }

  /**
   * Build headers for SSE request
   */
  private buildSseHeaders(
    extraHeaders: Record<string, string>,
    streamName: string,
    url: string
  ): Record<string, string> {
    const authHeaders = this.authClient!.getHeaders();
    const finalHeaders: Record<string, string> = { ...authHeaders };

    // Note: v25.12+ uses application/json for stream registration responses
    // The actual stream data comes via WebSocket, not SSE
    if (!extraHeaders.Accept) {
      finalHeaders.Accept = 'application/json';
    }

    for (const [key, value] of Object.entries(extraHeaders)) {
      finalHeaders[key] = value;
    }

    const sanitizedHeaders: Record<string, string> = { ...finalHeaders };
    if ('Authorization' in sanitizedHeaders) {
      sanitizedHeaders.Authorization = 'Bearer ***';
    }

    log(`[STREAM:${streamName}] request ${url} with ${JSON.stringify(sanitizedHeaders)}`, LogLevel.DEBUG);
    return finalHeaders;
  }

  /**
   * Make SSE request with given headers
   */
  private doSseRequest(
    url: string,
    headers: Record<string, string>,
    controller?: AbortController
  ): Promise<SseResponse> {
    return fetch(url, {
      headers,
      dispatcher: this.authClient!.getAgent(),
      signal: controller?.signal,
    } as Parameters<typeof fetch>[1]) as Promise<SseResponse>;
  }

  /**
   * Handle abort errors during SSE requests
   * @returns true if request was aborted
   */
  private handleSseAbort(err: Error, streamName: string): boolean {
    if (err.name === 'AbortError') {
      log(`[STREAM:${streamName}] request aborted`, LogLevel.DEBUG);
      return true;
    }
    return false;
  }

  /**
   * Process streaming response body line by line
   */
  private async processStreamBody(res: SseResponse, streamName: string): Promise<void> {
    if (!res.body) {
      log(`[STREAM:${streamName}] no response body`, LogLevel.ERROR);
      return;
    }
    const reader = (res.body as unknown as { getReader(): StreamReader }).getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      let readResult: { value?: Uint8Array; done: boolean };
      try {
        readResult = await reader.read();
      } catch (err) {
        log(`[STREAM:${streamName}] read error: ${err}`, LogLevel.ERROR);
        break;
      }
      const { value, done } = readResult;
      if (done) {
        log(`[STREAM:${streamName}] ended`, LogLevel.DEBUG);
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      buffer = this.processStreamBuffer(buffer);
    }
  }

  /**
   * Process buffered stream data and emit complete lines
   * @returns remaining buffer content
   */
  private processStreamBuffer(buffer: string): string {
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) {
        this.handleEventMessage(line);
      }
    }
    return buffer;
  }

  /**
   * Open a server-sent events connection
   */
  private async streamSse(
    url: string,
    controller?: AbortController,
    extraHeaders: Record<string, string> = {}
  ): Promise<void> {
    if (!this.authClient) {
      throw new Error('Auth client not set');
    }

    const urlObj = new URL(url);
    const streamName = urlObj.searchParams.get('stream') || 'unknown';

    const res: SseResponse | undefined = await this.executeWithRetry(url, streamName, controller, extraHeaders);
    if (!res) {
      return;
    }

    log(`[STREAM:${streamName}] connected → ${url}`, LogLevel.DEBUG);

    // Check if this is a non-streaming response (e.g., NQL with content-length)
    if (res.headers.get('content-length')) {
      const text: string = await res.text();
      log(`[STREAM:${streamName}] Complete response received: ${text}`, LogLevel.DEBUG);
      this.handleEventMessage(text);
      return;
    }

    await this.processStreamBody(res, streamName);
  }

  /**
   * Check if SSE request result is a successful response
   */
  private isSuccessfulResponse(result: SseRequestResult): boolean {
    return Boolean(result.response?.ok && result.response?.body);
  }

  /**
   * Log failed request error
   */
  private logFailedRequest(
    result: SseRequestResult,
    url: string,
    streamName: string
  ): void {
    if (result.error) {
      log(`[STREAM:${streamName}] request failed for ${url}: ${result.error}`, LogLevel.ERROR);
    }
    if (result.response && !result.response.ok) {
      log(`[STREAM:${streamName}] failed ${url}: HTTP ${result.response.status}`, LogLevel.ERROR);
    }
  }

  /**
   * Wait with exponential backoff delay
   * @returns updated delay value
   */
  private async waitWithBackoff(delay: number): Promise<number> {
    await new Promise(r => setTimeout(r, delay));
    return Math.min(delay * 2, 30000);
  }

  /**
   * Execute SSE request with retry logic and token refresh
   * @returns response object or undefined if aborted/max retries exceeded
   */
  private async executeWithRetry(
    url: string,
    streamName: string,
    controller?: AbortController,
    extraHeaders: Record<string, string> = {}
  ): Promise<SseResponse | undefined> {
    let attempt = 0;
    let delay = 1000;
    const maxRetries = 5;

    for (;;) {
      const headers = this.buildSseHeaders(extraHeaders, streamName, url);
      const result: SseRequestResult = await this.attemptSseRequest(url, headers, streamName, controller);

      if (result.aborted) {
        return undefined;
      }
      if (this.isSuccessfulResponse(result)) {
        return result.response;
      }

      // Try token refresh if response indicates expired token
      const refreshResult: TokenRefreshResult = await this.handleFailedResponse(result, url, headers, streamName, controller);
      if (refreshResult.aborted) {
        return undefined;
      }
      if (refreshResult.response) {
        return refreshResult.response;
      }

      this.logFailedRequest(result, url, streamName);

      if (++attempt > maxRetries) {
        return undefined;
      }
      delay = await this.waitWithBackoff(delay);
    }
  }

  /**
   * Handle failed response - attempt token refresh if applicable
   */
  private async handleFailedResponse(
    result: SseRequestResult,
    url: string,
    headers: Record<string, string>,
    streamName: string,
    controller?: AbortController
  ): Promise<TokenRefreshResult> {
    if (!result.response || result.response.ok) {
      return {};
    }

    const refreshed: TokenRefreshResult = await this.tryTokenRefreshAndRetry(
      result.response, url, headers, streamName, controller
    );

    if (refreshed.aborted) {
      return { aborted: true };
    }
    if (this.isSuccessfulResponse(refreshed)) {
      return { response: refreshed.response };
    }

    return {};
  }

  /**
   * Attempt a single SSE request
   */
  private async attemptSseRequest(
    url: string,
    headers: Record<string, string>,
    streamName: string,
    controller?: AbortController
  ): Promise<SseRequestResult> {
    try {
      const response: SseResponse = await this.doSseRequest(url, headers, controller);
      return { response };
    } catch (err) {
      if (this.handleSseAbort(err as Error, streamName)) {
        return { aborted: true };
      }
      return { error: err as Error };
    }
  }

  /**
   * Try to refresh token and retry request if token expired
   */
  private async tryTokenRefreshAndRetry(
    res: SseResponse,
    url: string,
    headers: Record<string, string>,
    streamName: string,
    controller?: AbortController
  ): Promise<TokenRefreshResult> {
    let text = '';
    try {
      text = await res.text();
    } catch {
      /* ignore */
    }

    if (!this.authClient!.isTokenExpiredResponse(res.status, text)) {
      return { shouldRetry: true };
    }

    log('Access token expired, refreshing...', LogLevel.INFO);
    await this.authClient!.refreshAuth();

    // Rebuild headers after auth refresh
    const newHeaders = this.buildSseHeaders({}, streamName, url);
    Object.assign(newHeaders, headers);

    return this.attemptSseRequest(url, newHeaders, streamName, controller);
  }

  private startStream(client: string, endpoint: StreamEndpoint): void {
    if (!this.authClient) return;

    // Double-check that we're not starting excluded streams
    if (EdaStreamClient.AUTO_EXCLUDE.has(endpoint.stream)) {
      log(`Attempted to start excluded stream ${endpoint.stream} - skipping`, LogLevel.WARN);
      return;
    }

    if (endpoint.namespaced) {
      this.startNamespacedEndpointStreams(client, endpoint);
      return;
    }

    const url =
      `${this.authClient.getBaseUrl()}${endpoint.path}` +
      `?eventclient=${encodeURIComponent(client)}` +
      `&stream=${encodeURIComponent(endpoint.stream)}`;

    this.startManagedStream(endpoint.stream, endpoint.stream, url);
  }

  private startCurrentAlarmStream(client: string): void {
    if (!this.authClient) return;

    const query = '.namespace.alarms.v1.current-alarm';
    const url =
      `${this.authClient.getBaseUrl()}/core/query/v1/eql` +
      `?eventclient=${encodeURIComponent(client)}` +
      `&stream=${STREAM_CURRENT_ALARMS}` +
      `&query=${encodeURIComponent(query)}`;

    this.startManagedStream(STREAM_CURRENT_ALARMS, STREAM_CURRENT_ALARMS, url);
  }

  private startEqlStream(client: string, streamName: string): void {
    if (!this.authClient) return;
    const info = this.eqlStreams.get(streamName);
    if (!info) return;
    if (this.eqlStreamPromises.has(streamName)) return;
    let url =
      `${this.authClient.getBaseUrl()}/core/query/v1/eql` +
      `?eventclient=${encodeURIComponent(client)}` +
      `&stream=${encodeURIComponent(streamName)}` +
      `&query=${encodeURIComponent(info.query)}`;
    if (info.namespaces) {
      url += `&namespaces=${encodeURIComponent(info.namespaces)}`;
    }

    const controller = new AbortController();
    this.eqlAbortControllers.set(streamName, controller);
    const promise = this.streamSse(url, controller).finally(() => {
      this.eqlAbortControllers.delete(streamName);
      this.eqlStreamPromises.delete(streamName);
    });
    this.eqlStreamPromises.set(streamName, promise);
  }

  private startNqlStream(client: string, streamName: string): void {
    if (!this.authClient) return;
    const info = this.nqlStreams.get(streamName);
    if (!info) return;
    if (this.nqlStreamPromises.has(streamName)) return;
    let url =
      `${this.authClient.getBaseUrl()}/core/query/v1/nql` +
      `?eventclient=${encodeURIComponent(client)}` +
      `&stream=${encodeURIComponent(streamName)}` +
      `&query=${encodeURIComponent(info.query)}`;
    if (info.namespaces) {
      url += `&namespaces=${encodeURIComponent(info.namespaces)}`;
    }

    const controller = new AbortController();
    this.nqlAbortControllers.set(streamName, controller);
    const promise = this.streamSse(url, controller).finally(() => {
      this.nqlAbortControllers.delete(streamName);
      this.nqlStreamPromises.delete(streamName);
    });
    this.nqlStreamPromises.set(streamName, promise);
  }

  private startTransactionSummaryStream(client: string): void {
    if (!this.authClient) return;
    if (this.summaryStreamPromise) return;

    const ep = this.streamEndpoints.find(e => e.stream === STREAM_SUMMARY);
    const path = ep?.path || '/core/transaction/v2/result/summary';
    const url =
      `${this.authClient.getBaseUrl()}${path}` +
      `?size=${this.transactionSummarySize}` +
      `&eventclient=${encodeURIComponent(client)}` +
      `&stream=${STREAM_SUMMARY}`;
    this.summaryAbortController = new AbortController();
    log('Starting transaction summary stream', LogLevel.DEBUG);
    this.summaryStreamPromise = this.streamSse(url, this.summaryAbortController)
      .catch(err => {
        log(`[STREAM:summary] error: ${err}`, LogLevel.ERROR);
      })
      .finally(() => {
        log('[STREAM:summary] stream closed', LogLevel.DEBUG);
        this.summaryStreamPromise = undefined;
      });
  }

  private startUserStorageFileStream(client: string, file: string): void {
    if (!this.authClient) return;

    log(`Starting user storage file stream for: ${file}`, LogLevel.DEBUG);

    const url =
      `${this.authClient.getBaseUrl()}/core/user-storage/v2/file` +
      `?path=${encodeURIComponent(file)}` +
      `&eventclient=${encodeURIComponent(client)}` +
      `&stream=${STREAM_FILE}`;

    // User-storage file stream uses Accept: */*
    const customHeaders = {
      Accept: '*/*',
      'Accept-Encoding': 'gzip, deflate, br, zsrd',
    };

    this.startManagedStream(`${STREAM_FILE}:${file}`, STREAM_FILE, url, customHeaders);
  }


  private handleEventMessage(data: string): void {
    log(`WS message: ${data}`, LogLevel.DEBUG);
    try {
      const msg = JSON.parse(data) as StreamMessagePayload;
      if (msg.type && msg.stream) {
        log(`Stream ${msg.stream} event received`, LogLevel.DEBUG);
      }
      if (msg.stream) {
        const physicalStream = msg.stream;
        const logicalStream = this.getLogicalStreamName(physicalStream);
        const forwardedMessage = logicalStream === physicalStream ? msg : { ...msg, stream: logicalStream };
        this._onStreamMessage.fire({ stream: logicalStream, message: forwardedMessage });

        // Send 'next' after processing messages to indicate we're ready for more
        // This includes 'update' messages, 'details' messages, and initial stream registration confirmations
        // But throttle to not send faster than messageIntervalMs
        // Skip only 'register' type messages
        if (
          msg.type !== MSG_TYPE_REGISTER &&
          this.isLogicalStreamActive(physicalStream) &&
          this.eventSocket?.readyState === WebSocket.OPEN
        ) {
          this.scheduleNextMessage(physicalStream);
        }
      }
    } catch (err) {
      log(`Failed to parse event message: ${err}`, LogLevel.ERROR);
    }
  }

  /**
   * Schedule a 'next' message with rate limiting
   */
  private scheduleNextMessage(stream: string): void {
    if (!this.isLogicalStreamActive(stream)) {
      return;
    }

    const now = Date.now();
    const lastSent = this.lastNextTimestamps.get(stream) || 0;
    const timeSinceLastSent = now - lastSent;

    if (timeSinceLastSent >= this.messageIntervalMs) {
      // Enough time has passed, send immediately
      this.sendNextMessage(stream);
    } else if (!this.pendingNextMessages.has(stream) && !this.pendingNextTimers.has(stream)) {
      // Schedule a delayed send
      this.pendingNextMessages.add(stream);
      const delay = this.messageIntervalMs - timeSinceLastSent;
      log(`Scheduling 'next' for stream ${stream} in ${delay}ms`, LogLevel.DEBUG);

      const timer = setTimeout(() => {
        this.pendingNextMessages.delete(stream);
        this.pendingNextTimers.delete(stream);
        if (this.isLogicalStreamActive(stream) && this.eventSocket?.readyState === WebSocket.OPEN) {
          this.sendNextMessage(stream);
        }
      }, delay);
      this.pendingNextTimers.set(stream, timer);
    }
    // If already pending, skip (we don't want multiple pending sends)
  }

  /**
   * Send a 'next' message and update timestamp
   */
  private sendNextMessage(stream: string): void {
    if (!this.isLogicalStreamActive(stream)) {
      return;
    }
    if (this.eventSocket?.readyState === WebSocket.OPEN) {
      log(`Sending 'next' for stream ${stream}`, LogLevel.DEBUG);
      try {
        this.eventSocket.send(JSON.stringify({ type: MSG_TYPE_NEXT, stream }));
        this.lastNextTimestamps.set(stream, Date.now());
      } catch (err) {
        log(`Failed sending 'next' for stream ${stream}: ${err}`, LogLevel.DEBUG);
      }
    }
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.disposed = true;
    this.disconnect();
    this._onStreamMessage.dispose();
  }
}
