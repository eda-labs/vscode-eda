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
const MSG_TYPE_NEXT = 'next';
const MSG_TYPE_CLOSE = 'close';
const MSG_TYPE_REGISTER = 'register';

export interface StreamEndpoint {
  path: string;
  stream: string;
}

export interface StreamMessage {
  stream: string;
  message: any;
}

/**
 * Client for EDA WebSocket streaming
 */
export class EdaStreamClient {
  private eventSocket: WebSocket | undefined;
  private eventClient: string | undefined;
  private activeStreams: Set<string> = new Set();
  private transactionSummarySize = 50;
  private lastNextTimestamps: Map<string, number> = new Map();
  private pendingNextMessages: Set<string> = new Set();
  private messageIntervalMs = 500;
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

  // Stream names that should not be automatically subscribed to
  private static readonly AUTO_EXCLUDE = new Set([
    'resultsummary',
    'v1',
    'eql',
    'nql',
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

  public setEqlQuery(query: string, namespaces?: string, streamName = 'eql'): void {
    this.eqlStreams.set(streamName, { query, namespaces });
  }

  public setNqlQuery(query: string, namespaces?: string, streamName = 'nql'): void {
    this.nqlStreams.set(streamName, { query, namespaces });
  }

  /**
   * Connect to the WebSocket
   */
  public async connect(): Promise<void> {
    if (!this.authClient) {
      throw new Error('Auth client not set');
    }

    await this.authClient.waitForAuth();

    if (
      this.eventSocket &&
      (this.eventSocket.readyState === WebSocket.OPEN ||
        this.eventSocket.readyState === WebSocket.CONNECTING)
    ) {
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

    socket.on('open', () => {
      log('Event WebSocket connected', LogLevel.DEBUG);
      log(`Started streaming on ${this.streamEndpoints.length} nodes`, LogLevel.INFO);

      // Build list of streams to auto-start (discovered streams minus excluded ones)
      const autoStartStreams = new Set<string>();
      for (const ep of this.streamEndpoints) {
        if (!EdaStreamClient.AUTO_EXCLUDE.has(ep.stream)) {
          autoStartStreams.add(ep.stream);
        }
      }

      // Add any explicitly subscribed streams
      for (const stream of this.activeStreams) {
        autoStartStreams.add(stream);
      }

      // Update activeStreams to include auto-start streams
      this.activeStreams = autoStartStreams;

      log(`WebSocket opened with ${this.activeStreams.size} active streams (including auto-discovered)`, LogLevel.DEBUG);
    });

    socket.on('message', data => {
      const txt = data.toString();
      if (!this.eventClient) {
        this.handleRegistrationMessage(txt, socket);
      }
      this.handleEventMessage(txt);
    });

    const reconnect = () => {
      this.eventSocket = undefined;
      this.eventClient = undefined;
      if (!this.disposed) {
        setTimeout(() => {
          this.connect().catch(() => { /* ignore */ });
        }, 2000);
      }
    };

    socket.on('close', reconnect);
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
        reconnect();
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
        reconnect();
      };
      handleError().catch(() => { /* ignore */ });
    });
  }

  /**
   * Handle WebSocket registration message and start all subscribed streams
   */
  private handleRegistrationMessage(txt: string, socket: WebSocket): void {
    try {
      const obj = JSON.parse(txt);
      const client = obj?.msg?.client as string | undefined;
      if (obj.type !== MSG_TYPE_REGISTER || !client) {
        return;
      }
      this.eventClient = client;
      log(`WS eventclient id = ${this.eventClient}`, LogLevel.DEBUG);

      this.startSubscribedStreams(client);
      this.startSpecialStreams(client);
      this.startUserStorageStreams(client, socket);
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
        this.startStream(client, ep).catch(() => { /* ignore */ });
      }
    }
  }

  /**
   * Start special streams (current-alarms, summary, EQL, NQL)
   */
  private startSpecialStreams(client: string): void {
    if (this.activeStreams.has('current-alarms')) {
      this.startCurrentAlarmStream(client).catch(() => { /* ignore */ });
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
  private startUserStorageStreams(client: string, socket: WebSocket): void {
    if (this.userStorageFiles.size > 0 && !this.activeStreams.has(STREAM_FILE)) {
      this.activeStreams.add(STREAM_FILE);
      socket.send(JSON.stringify({ type: MSG_TYPE_NEXT, stream: STREAM_FILE }));
    }
    for (const file of this.userStorageFiles) {
      this.startUserStorageFileStream(client, file).catch(() => { /* ignore */ });
    }
  }

  /**
   * Subscribe to a stream
   */
  public subscribeToStream(streamName: string): void {
    this.activeStreams.add(streamName);
    log(`Subscribed to stream: ${streamName}`, LogLevel.DEBUG);

    if (this.eventSocket?.readyState === WebSocket.OPEN) {
      this.sendNextMessage(streamName);
      if (this.eqlStreams.has(streamName)) {
        this.startEqlStream(this.eventClient as string, streamName);
      }
      if (this.nqlStreams.has(streamName)) {
        this.startNqlStream(this.eventClient as string, streamName);
      }
    }
  }

  /**
   * Unsubscribe from a stream
   */
  public unsubscribeFromStream(streamName: string): void {
    this.activeStreams.delete(streamName);

    // Send 'close' message to server to indicate we're done with this stream
    if (this.eventSocket?.readyState === WebSocket.OPEN) {
      log(`Sending 'close' for stream: ${streamName}`, LogLevel.DEBUG);
      this.eventSocket.send(JSON.stringify({ type: MSG_TYPE_CLOSE, stream: streamName }));
    }

    if (streamName === STREAM_SUMMARY && this.summaryAbortController) {
      this.summaryAbortController.abort();
      // do not clear summaryStreamPromise so a restart can wait for closure
      this.summaryAbortController = undefined;
    }
    const ctl = this.eqlAbortControllers.get(streamName);
    if (ctl) {
      ctl.abort();
      this.eqlAbortControllers.delete(streamName);
    }
    if (this.eqlStreamPromises.has(streamName)) {
      this.eqlStreamPromises.delete(streamName);
    }
    this.eqlStreams.delete(streamName);
    const nqlCtl = this.nqlAbortControllers.get(streamName);
    if (nqlCtl) {
      nqlCtl.abort();
      this.nqlAbortControllers.delete(streamName);
    }
    if (this.nqlStreamPromises.has(streamName)) {
      this.nqlStreamPromises.delete(streamName);
    }
    this.nqlStreams.delete(streamName);
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
    // Clear any pending next messages
    this.pendingNextMessages.clear();
    this.lastNextTimestamps.clear();

    if (this.eventSocket) {
      this.eventSocket.close();
      this.eventSocket = undefined;
    }
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
    this.eventClient = undefined;
    if (clearStreams) {
      this.activeStreams.clear();
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
      if (this.eventSocket?.readyState === WebSocket.OPEN) {
        this.eventSocket.send(JSON.stringify({ type: MSG_TYPE_NEXT, stream: STREAM_FILE }));
      }
    }

    await this.connect();
    if (this.eventClient) {
      await this.startUserStorageFileStream(this.eventClient, path);
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
  ): Promise<any> {
    return fetch(url, {
      headers,
      dispatcher: this.authClient!.getAgent(),
      signal: controller?.signal,
    } as any);
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
  private async processStreamBody(res: any, streamName: string): Promise<void> {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      let readResult;
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

    const res = await this.executeWithRetry(url, streamName, controller, extraHeaders);
    if (!res) {
      return;
    }

    log(`[STREAM:${streamName}] connected → ${url}`, LogLevel.DEBUG);

    // Check if this is a non-streaming response (e.g., NQL with content-length)
    if (res.headers.get('content-length')) {
      const text = await res.text();
      log(`[STREAM:${streamName}] Complete response received: ${text}`, LogLevel.DEBUG);
      this.handleEventMessage(text);
      return;
    }

    await this.processStreamBody(res, streamName);
  }

  /**
   * Check if SSE request result is a successful response
   */
  private isSuccessfulResponse(result: { response?: any; aborted?: boolean }): boolean {
    return Boolean(result.response?.ok && result.response?.body);
  }

  /**
   * Log failed request error
   */
  private logFailedRequest(
    result: { error?: Error; response?: any },
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
  ): Promise<any | undefined> {
    let attempt = 0;
    let delay = 1000;
    const maxRetries = 5;

    for (;;) {
      const headers = this.buildSseHeaders(extraHeaders, streamName, url);
      const result = await this.attemptSseRequest(url, headers, streamName, controller);

      if (result.aborted) {
        return undefined;
      }
      if (this.isSuccessfulResponse(result)) {
        return result.response;
      }

      // Try token refresh if response indicates expired token
      const refreshResult = await this.handleFailedResponse(result, url, headers, streamName, controller);
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
    result: { response?: any; error?: Error },
    url: string,
    headers: Record<string, string>,
    streamName: string,
    controller?: AbortController
  ): Promise<{ response?: any; aborted?: boolean }> {
    if (!result.response || result.response.ok) {
      return {};
    }

    const refreshed = await this.tryTokenRefreshAndRetry(
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
  ): Promise<{ response?: any; error?: Error; aborted?: boolean }> {
    try {
      const response = await this.doSseRequest(url, headers, controller);
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
    res: any,
    url: string,
    headers: Record<string, string>,
    streamName: string,
    controller?: AbortController
  ): Promise<{ response?: any; aborted?: boolean; shouldRetry?: boolean }> {
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

  private async startStream(client: string, endpoint: StreamEndpoint): Promise<void> {
    if (!this.authClient) return;

    // Double-check that we're not starting excluded streams
    if (EdaStreamClient.AUTO_EXCLUDE.has(endpoint.stream)) {
      log(`Attempted to start excluded stream ${endpoint.stream} - skipping`, LogLevel.WARN);
      return;
    }

    const url =
      `${this.authClient.getBaseUrl()}${endpoint.path}` +
      `?eventclient=${encodeURIComponent(client)}` +
      `&stream=${encodeURIComponent(endpoint.stream)}`;

    await this.streamSse(url);
  }

  private async startCurrentAlarmStream(client: string): Promise<void> {
    if (!this.authClient) return;

    const query = '.namespace.alarms.v1.current-alarm';
    const url =
      `${this.authClient.getBaseUrl()}/core/query/v1/eql` +
      `?eventclient=${encodeURIComponent(client)}` +
      `&stream=current-alarms` +
      `&query=${encodeURIComponent(query)}`;

    await this.streamSse(url);
  }

  private startEqlStream(client: string, streamName: string): void {
    if (!this.authClient) return;
    const info = this.eqlStreams.get(streamName);
    if (!info) return;
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

  private async startUserStorageFileStream(client: string, file: string): Promise<void> {
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

    await this.streamSse(url, undefined, customHeaders);
  }


  private handleEventMessage(data: string): void {
    log(`WS message: ${data}`, LogLevel.DEBUG);
    try {
      const msg = JSON.parse(data);
      if (msg.type && msg.stream) {
        log(`Stream ${msg.stream} event received`, LogLevel.DEBUG);
      }
      if (msg.stream) {
        this._onStreamMessage.fire({ stream: msg.stream, message: msg });

        // Send 'next' after processing messages to indicate we're ready for more
        // This includes 'update' messages, 'details' messages, and initial stream registration confirmations
        // But throttle to not send faster than messageIntervalMs
        // Skip only 'register' type messages
        if (msg.type !== MSG_TYPE_REGISTER && this.eventSocket?.readyState === WebSocket.OPEN) {
          this.scheduleNextMessage(msg.stream);
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
    const now = Date.now();
    const lastSent = this.lastNextTimestamps.get(stream) || 0;
    const timeSinceLastSent = now - lastSent;

    if (timeSinceLastSent >= this.messageIntervalMs) {
      // Enough time has passed, send immediately
      this.sendNextMessage(stream);
    } else if (!this.pendingNextMessages.has(stream)) {
      // Schedule a delayed send
      this.pendingNextMessages.add(stream);
      const delay = this.messageIntervalMs - timeSinceLastSent;
      log(`Scheduling 'next' for stream ${stream} in ${delay}ms`, LogLevel.DEBUG);

      setTimeout(() => {
        this.pendingNextMessages.delete(stream);
        if (this.activeStreams.has(stream) && this.eventSocket?.readyState === WebSocket.OPEN) {
          this.sendNextMessage(stream);
        }
      }, delay);
    }
    // If already pending, skip (we don't want multiple pending sends)
  }

  /**
   * Send a 'next' message and update timestamp
   */
  private sendNextMessage(stream: string): void {
    if (this.eventSocket?.readyState === WebSocket.OPEN) {
      log(`Sending 'next' for stream ${stream}`, LogLevel.DEBUG);
      this.eventSocket.send(JSON.stringify({ type: MSG_TYPE_NEXT, stream }));
      this.lastNextTimestamps.set(stream, Date.now());
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