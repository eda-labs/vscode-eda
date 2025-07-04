/* global AbortController */
import WebSocket from 'ws';
import { fetch } from 'undici';
import { TextDecoder } from 'util';
import * as vscode from 'vscode';
import { LogLevel, log } from '../extension';
import { EdaAuthClient } from './edaAuthClient';

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
  private keepAliveTimer: ReturnType<typeof setInterval> | undefined;
  private activeStreams: Set<string> = new Set();
  private messageIntervalMs = 1000;
  private transactionSummarySize = 50;
  private summaryAbortController: AbortController | undefined;
  private summaryStreamPromise: Promise<void> | undefined;
  private userStorageFiles: Set<string> = new Set();
  private eqlStreams: Map<string, { query: string; namespaces?: string }> = new Map();
  private eqlAbortControllers: Map<string, AbortController> = new Map();
  private eqlStreamPromises: Map<string, Promise<void>> = new Map();
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
    'summary',
    'directory',
    'file',  // user-storage file stream requires path parameter
  ]);

  constructor(messageIntervalMs = 500) {
    this.messageIntervalMs = messageIntervalMs;
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

      // Ensure we request updates for every discovered stream (except AUTO_EXCLUDE)
      const allStreams = new Set<string>();

      // Add active streams
      for (const stream of this.activeStreams) {
        allStreams.add(stream);
      }

      // Add discovered streams (except excluded ones)
      for (const ep of this.streamEndpoints) {
        if (!EdaStreamClient.AUTO_EXCLUDE.has(ep.stream)) {
          allStreams.add(ep.stream);
        }
      }

      // Don't add user storage files to activeStreams here
      // They need special handling with custom headers
      this.activeStreams = allStreams;

      for (const stream of allStreams) {
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
              if (EdaStreamClient.AUTO_EXCLUDE.has(ep.stream)) {
                log(`Skipping auto-start for excluded stream: ${ep.stream}`, LogLevel.DEBUG);
                continue;
              }
              void this.startStream(this.eventClient, ep);
            }
            if (this.activeStreams.has('current-alarms')) {
              void this.startCurrentAlarmStream(this.eventClient);
            }
            if (this.activeStreams.has('summary')) {
              void this.startTransactionSummaryStream(this.eventClient);
            }
            for (const streamName of this.eqlStreams.keys()) {
              if (this.activeStreams.has(streamName)) {
                void this.startEqlStream(this.eventClient, streamName);
              }
            }
            // If we have user storage files, make sure we're subscribed to 'file' stream
            if (this.userStorageFiles.size > 0 && !this.activeStreams.has('file')) {
              this.activeStreams.add('file');
              socket.send(JSON.stringify({ type: 'next', stream: 'file' }));
            }
            for (const file of this.userStorageFiles) {
              // Start user storage file streams with special headers
              void this.startUserStorageFileStream(this.eventClient, file);
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
      if (!this.disposed) {
        setTimeout(() => {
          void this.connect();
        }, 2000);
      }
    };

    socket.on('close', reconnect);
    socket.on('unexpected-response', async (_req, res) => {
      log(
        `Event WebSocket unexpected response: HTTP ${res.statusCode}`,
        LogLevel.ERROR
      );
      if (res.statusCode === 401 && this.authClient) {
        log('Refreshing authentication token for WebSocket...', LogLevel.INFO);
        await this.authClient.refreshAuth();
      }
      reconnect();
    });
    socket.on('error', async err => {
      log(`Event WebSocket error: ${err}`, LogLevel.ERROR);
      if (err instanceof Error && err.message.includes('401') && this.authClient) {
        log('Refreshing authentication token for WebSocket...', LogLevel.INFO);
        await this.authClient.refreshAuth();
      }
      reconnect();
    });
  }

  /**
   * Subscribe to a stream
   */
  public async subscribeToStream(streamName: string): Promise<void> {
    this.activeStreams.add(streamName);
    log(`Subscribed to stream: ${streamName}`, LogLevel.DEBUG);

    if (this.eventSocket?.readyState === WebSocket.OPEN) {
      this.eventSocket.send(JSON.stringify({ type: 'next', stream: streamName }));
      if (this.eqlStreams.has(streamName)) {
        void this.startEqlStream(this.eventClient as string, streamName);
      }
    }
  }

  /**
   * Unsubscribe from a stream
   */
  public unsubscribeFromStream(streamName: string): void {
    this.activeStreams.delete(streamName);
    if (streamName === 'summary' && this.summaryAbortController) {
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
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
    }
    if (this.eventSocket) {
      this.eventSocket.close();
      this.eventSocket = undefined;
    }
    if (this.summaryAbortController) {
      this.summaryAbortController.abort();
    }
    if (this.summaryStreamPromise) {
      // wait briefly for the stream to close
      void this.summaryStreamPromise.catch(() => {});
      this.summaryStreamPromise = undefined;
    }
    this.summaryAbortController = undefined;
    for (const ctl of this.eqlAbortControllers.values()) {
      ctl.abort();
    }
    this.eqlAbortControllers.clear();
    this.eqlStreamPromises.clear();
    this.eventClient = undefined;
    if (clearStreams) {
      this.activeStreams.clear();
    }
  }

  public async reconnect(clearStreams = false): Promise<void> {
    this.disconnect(clearStreams);
    await this.connect();
  }

  /**
   * Add a user-storage file to stream
   */
  public async streamUserStorageFile(path: string): Promise<void> {
    this.userStorageFiles.add(path);

    // Make sure we're subscribed to the 'file' stream via WebSocket
    if (!this.activeStreams.has('file')) {
      this.activeStreams.add('file');
      if (this.eventSocket?.readyState === WebSocket.OPEN) {
        this.eventSocket.send(JSON.stringify({ type: 'next', stream: 'file' }));
      }
    }

    await this.connect();
    if (this.eventClient) {
      await this.startUserStorageFileStream(this.eventClient, path);
    }
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

    const doRequest = async () => {
      const authHeaders = this.authClient!.getHeaders();
      const finalHeaders: Record<string, string> = { ...authHeaders };

      if (!extraHeaders.Accept) {
        finalHeaders.Accept = 'text/event-stream';
      }

      for (const [key, value] of Object.entries(extraHeaders)) {
        finalHeaders[key] = value;
      }

      const sanitizedHeaders: Record<string, string> = { ...finalHeaders };
      if ('Authorization' in sanitizedHeaders) {
        sanitizedHeaders.Authorization = 'Bearer ***';
      }

      log(`[STREAM:${streamName}] request ${url} with ${JSON.stringify(sanitizedHeaders)}`, LogLevel.DEBUG);

      return fetch(url, {
        headers: finalHeaders,
        dispatcher: this.authClient!.getAgent(),
        signal: controller?.signal,
      } as any);
    };

    let res: any;
    try {
      res = await doRequest();
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        log(`[STREAM:${streamName}] request aborted`, LogLevel.DEBUG);
      } else {
        log(`[STREAM:${streamName}] request failed for ${url}: ${err}`, LogLevel.ERROR);
      }
      return;
    }

    if (!res.ok || !res.body) {
      let text = '';
      try {
        text = await res.text();
      } catch {
        /* ignore */
      }
      if (this.authClient.isTokenExpiredResponse(res.status, text)) {
        log('Access token expired, refreshing...', LogLevel.INFO);
        await this.authClient.refreshAuth();
        try {
          res = await doRequest();
        } catch (err) {
          if ((err as Error).name === 'AbortError') {
            log(`[STREAM:${streamName}] request aborted`, LogLevel.DEBUG);
          } else {
            log(`[STREAM:${streamName}] request failed for ${url}: ${err}`, LogLevel.ERROR);
          }
          return;
        }
      }

      if (!res.ok || !res.body) {
        log(`[STREAM:${streamName}] failed ${url}: HTTP ${res.status}`, LogLevel.ERROR);
        return;
      }
    }
    log(`[STREAM:${streamName}] connected → ${url}`, LogLevel.DEBUG);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        log(`[STREAM:${streamName}] ended`, LogLevel.DEBUG);
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

  private startTransactionSummaryStream(client: string): void {
    if (!this.authClient) return;

    const ep = this.streamEndpoints.find(e => e.stream === 'summary');
    const path = ep?.path || '/core/transaction/v2/result/summary';
    const url =
      `${this.authClient.getBaseUrl()}${path}` +
      `?size=${this.transactionSummarySize}` +
      `&eventclient=${encodeURIComponent(client)}` +
      `&stream=summary`;
    this.summaryAbortController = new AbortController();
    this.summaryStreamPromise = this.streamSse(url, this.summaryAbortController).finally(() => {
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
      `&stream=file`;

    // User-storage file stream requires Accept: */* instead of text/event-stream
    // Otherwise it returns 406 Not Acceptable
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
      }
    } catch (err) {
      log(`Failed to parse event message: ${err}`, LogLevel.ERROR);
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