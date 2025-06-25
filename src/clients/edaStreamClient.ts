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
  private messageIntervalMs = 500;
  private transactionSummarySize = 50;
  private summaryAbortController: AbortController | undefined;
  private summaryStreamPromise: Promise<void> | undefined;

  private _onStreamMessage = new vscode.EventEmitter<StreamMessage>();
  public readonly onStreamMessage = this._onStreamMessage.event;

  private authClient: EdaAuthClient | undefined;
  private streamEndpoints: StreamEndpoint[] = [];

  // Stream names that should not be automatically subscribed to
  private static readonly AUTO_EXCLUDE = new Set([
    'alarms',
    'summary',
    'resultsummary',
    'v1',
    'eql',
    'nql',
    'directory',
    'file',
  ]);

  constructor(messageIntervalMs = 500) {
    this.messageIntervalMs = messageIntervalMs;
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

      // Ensure we request updates for every discovered stream
      const allStreams = new Set<string>([
        ...this.activeStreams,
        ...this.streamEndpoints
          .map(e => e.stream)
          .filter(s => !EdaStreamClient.AUTO_EXCLUDE.has(s)),
      ]);
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
              if (EdaStreamClient.AUTO_EXCLUDE.has(ep.stream)) continue;
              void this.startStream(this.eventClient, ep);
            }
            if (this.activeStreams.has('current-alarms')) {
              void this.startCurrentAlarmStream(this.eventClient);
            }
            if (this.activeStreams.has('summary')) {
              void this.startTransactionSummaryStream(this.eventClient);
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
        void this.connect();
      }, 2000);
    };

    socket.on('close', reconnect);
    socket.on('error', err => {
      log(`Event WebSocket error: ${err}`, LogLevel.ERROR);
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
    log(`Unsubscribed from stream: ${streamName}`, LogLevel.DEBUG);
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
   * Open a server-sent events connection
   */
  private async streamSse(url: string, controller?: AbortController): Promise<void> {
    if (!this.authClient) {
      throw new Error('Auth client not set');
    }

    let res: any;
    try {
      // Get the full headers object and use it directly
      const headers = this.authClient.getHeaders();
      res = await fetch(url, {
        headers: {
          ...headers,
          Accept: 'text/event-stream',
        },
        dispatcher: this.authClient.getAgent(),
        signal: controller?.signal,
      } as any);
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

  private async startStream(client: string, endpoint: StreamEndpoint): Promise<void> {
    if (!this.authClient) return;

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
    this.disconnect();
    this._onStreamMessage.dispose();
  }
}