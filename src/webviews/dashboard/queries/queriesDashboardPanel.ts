import { randomUUID } from 'crypto';

import * as vscode from 'vscode';

import { BasePanel } from '../../basePanel';
import { ALL_NAMESPACES } from '../../constants';
import { serviceManager } from '../../../services/serviceManager';
import type { EdaClient } from '../../../clients/edaClient';
import { EmbeddingSearchService } from '../../../services/embeddingSearchService';
import { LogLevel, log } from '../../../extension';
import { getOps, getDelete, getDeleteIds, getInsertOrModify, getRows, type DeleteOperationWithIds, type InsertOrModifyWithRows, type StreamMessageWithOps, type OperationWithInsertOrModify, type OperationWithDelete } from '../../../utils/streamMessageUtils';

/** Message received from the webview */
interface WebviewMessage {
  command: string;
  query?: string;
  namespace?: string;
  queryType?: string;
}

/** Inner payload of stream messages */
interface StreamMessagePayload extends StreamMessageWithOps, OperationWithInsertOrModify, OperationWithDelete {
  schema?: { fields?: unknown };
}

/** Stream message wrapper from EdaClient callbacks */
interface StreamMessageWrapper extends StreamMessageWithOps {
  msg?: StreamMessagePayload;
  details?: string;
  stream?: string;
  message?: {
    details?: string;
    stream?: string;
  };
  state?: string;
}

/** Stream operation containing insert/modify or delete */
interface StreamOperation extends OperationWithInsertOrModify, OperationWithDelete {}

/** Row entry in insert/modify operations */
interface StreamRow {
  id?: string | number;
  data?: Record<string, unknown>;
}

export class QueriesDashboardPanel extends BasePanel {
  private static currentPanel: QueriesDashboardPanel | undefined;
  private edaClient: EdaClient;
  private embeddingSearch: EmbeddingSearchService;
  private queryStreamName?: string;
  private columns: string[] = [];
  private rows: unknown[][] = [];
  private rowMap: Map<string, unknown[]> = new Map();
  private nqlConversionShown: boolean = false;

  constructor(context: vscode.ExtensionContext, title: string) {
    super(context, 'queriesDashboard', title, undefined, BasePanel.getEdaIconPath(context));

    this.edaClient = serviceManager.getClient<EdaClient>('eda');
    this.embeddingSearch = EmbeddingSearchService.getInstance();

    this.edaClient.onStreamMessage((stream, msg) => {
      log(`EdaClient callback received stream: ${stream}, queryStreamName: ${this.queryStreamName}`, LogLevel.DEBUG);
      if (stream === this.queryStreamName) {
        log('Stream name matches, calling handleQueryStream', LogLevel.DEBUG);
        this.handleQueryStream(msg as StreamMessageWrapper);
      } else {
        log('Stream name does not match', LogLevel.DEBUG);
      }
    });

    this.panel.onDidDispose(() => {
      if (this.queryStreamName) {
        void this.edaClient.closeEqlStream(this.queryStreamName);
      }
    });

    this.panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      if (msg.command === 'ready') {
        this.sendNamespaces();
      } else if (msg.command === 'runQuery') {
        await this.handleQuery(msg.query ?? '', msg.namespace ?? '', msg.queryType ?? 'eql');
      } else if (msg.command === 'autocomplete') {
        const query = msg.query ?? '';
        // Only provide autocomplete for EQL queries (starting with .)
        if (query.trim().startsWith('.')) {
          const list = await this.edaClient.autocompleteEql(query, 20);
          this.panel.webview.postMessage({ command: 'autocomplete', list });
        } else {
          // No autocomplete for natural language queries
          this.panel.webview.postMessage({ command: 'autocomplete', list: [] });
        }
      } else if (msg.command === 'searchNaturalLanguage') {
        await this.handleNaturalLanguageSearch(msg.query ?? '');
      }
    });

    this.panel.webview.html = this.buildHtml();
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'queriesDashboard.js');
    return `<script nonce="${nonce}" src="${scriptUri}"></script>`;
  }

  private sendNamespaces(): void {
    const coreNs = this.edaClient.getCoreNamespace();
    const namespaces = this.edaClient
      .getCachedNamespaces()
      .filter(ns => ns !== coreNs);
    namespaces.unshift(ALL_NAMESPACES);
    this.panel.webview.postMessage({
      command: 'init',
      namespaces,
      selected: ALL_NAMESPACES
    });
  }

  private async handleQuery(query: string, namespace: string, queryType: string = 'eql'): Promise<void> {
    if (queryType === 'nql') {
      // Handle NQL (Natural Query Language) queries
      await this.handleNqlQuery(query, namespace);
    } else if (queryType === 'emb' && this.embeddingSearch.isNaturalLanguageQuery(query)) {
      try {
        // Check if embeddingsearch is ready
        if (!this.embeddingSearch.isReady()) {
          this.panel.webview.postMessage({
            command: 'error',
            error: 'Natural language queries are still initializing. Please try again in a moment or use EQL queries (starting with .)'
          });
          // Try to wait for setup to complete
          this.embeddingSearch.waitForSetup().then(() => {
            this.panel.webview.postMessage({
              command: 'info',
              message: 'Natural language queries are now ready!'
            });
          }).catch(() => {});
          return;
        }

        // Convert natural language to EQL
        const result = await this.embeddingSearch.searchNaturalLanguage(query);
        if (result && result.topMatch) {
          // Use the converted EQL query
          await this.startQueryStream(result.topMatch.query, namespace);
          // Send the converted query back to the UI
          this.panel.webview.postMessage({
            command: 'convertedQuery',
            originalQuery: query,
            eqlQuery: result.topMatch.query,
            queryType: 'emb',
            description: result.topMatch.description,
            alternatives: result.others
          });
        } else {
          this.panel.webview.postMessage({
            command: 'error',
            error: 'No matching queries found for your natural language input'
          });
        }
      } catch (error) {
        this.panel.webview.postMessage({
          command: 'error',
          error: `Failed to process natural language query: ${error}`
        });
      }
    } else {
      // Regular EQL query
      await this.startQueryStream(query, namespace);
    }
  }

  private async handleNqlQuery(query: string, namespace: string): Promise<void> {
    try {
      // Remove question marks from NQL queries as they cause issues
      const cleanedQuery = query.replace(/\?/g, '');
      // Use the NQL streaming endpoint directly
      await this.startNqlQueryStream(cleanedQuery, namespace);
    } catch (error) {
      this.panel.webview.postMessage({
        command: 'error',
        error: `Failed to process NQL query: ${error}`
      });
    }
  }

  private async handleNaturalLanguageSearch(query: string): Promise<void> {
    try {
      // Check if embeddingsearch is ready
      if (!this.embeddingSearch.isReady()) {
        this.panel.webview.postMessage({
          command: 'error',
          error: 'Natural language queries are still initializing. Please try again in a moment.'
        });
        return;
      }

      const result = await this.embeddingSearch.searchNaturalLanguage(query);
      this.panel.webview.postMessage({
        command: 'naturalLanguageResults',
        results: result
      });
    } catch (error) {
      this.panel.webview.postMessage({
        command: 'error',
        error: `Natural language search failed: ${error}`
      });
    }
  }

  private async startQueryStream(query: string, namespace: string): Promise<void> {
    this.columns = [];
    this.rows = [];
    this.rowMap.clear();
    this.nqlConversionShown = false;
    if (this.queryStreamName) {
      await this.edaClient.closeEqlStream(this.queryStreamName);
    }
    this.queryStreamName = `query-${Date.now()}`;
    const ns = namespace === ALL_NAMESPACES ? undefined : namespace;
    await this.edaClient.streamEql(query, ns, this.queryStreamName);
    this.panel.webview.postMessage({ command: 'clear' });
  }

  private async startNqlQueryStream(query: string, namespace: string): Promise<void> {
    this.columns = [];
    this.rows = [];
    this.rowMap.clear();
    this.nqlConversionShown = false;
    if (this.queryStreamName) {
      await this.edaClient.closeNqlStream(this.queryStreamName);
    }
    this.queryStreamName = `nql-${Date.now()}`;

    // For NQL, if "All Namespaces" is selected, pass undefined (no namespace parameter)
    const ns = namespace === ALL_NAMESPACES ? undefined : namespace;

    log(`Starting NQL stream with namespace: ${ns}`, LogLevel.DEBUG);
    await this.edaClient.streamNql(query, ns, this.queryStreamName);
    this.panel.webview.postMessage({ command: 'clear' });
  }

  private flattenData(data: unknown, prefix = ''): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (!data || typeof data !== 'object') {
      return result;
    }
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(result, this.flattenData(value, fullKey));
      } else {
        result[fullKey] = value;
      }
    }
    return result;
  }

  /**
   * Extract operations from various possible locations in the message structure.
   * Uses case-insensitive helpers for API inconsistencies.
   */
  private extractOperations(msg: StreamMessageWrapper): StreamOperation[] {
    let ops = getOps(msg.msg);
    if (ops.length === 0) {
      ops = getOps(msg);
    }
    if (ops.length === 0 && msg.msg && typeof msg.msg === 'object') {
      // For NQL streams, the structure might be different
      // Check if msg itself contains the operation data
      const insertOrModify = getInsertOrModify(msg.msg);
      const deleteOp = getDelete(msg.msg);
      if (insertOrModify || deleteOp) {
        ops = [msg.msg as StreamOperation];
      }
    }
    return ops as StreamOperation[];
  }

  /**
   * Handle NQL conversion details from stream message.
   * Returns true if conversion was shown.
   */
  private handleNqlConversion(streamName: string | undefined, details: string | undefined): void {
    if (streamName?.startsWith('nql') && !this.nqlConversionShown && details) {
      log(`Sending convertedQuery message with details: ${details}`, LogLevel.DEBUG);
      this.panel.webview.postMessage({
        command: 'convertedQuery',
        originalQuery: '', // We don't have the original query here
        eqlQuery: details,
        queryType: 'nql',
        description: 'Natural Query Language converted to EQL query'
      });
      this.nqlConversionShown = true;
    }
  }

  /**
   * Process delete operations from a single operation object.
   */
  private processDeleteOperation(op: StreamOperation): void {
    const deleteOp = getDelete(op) as DeleteOperationWithIds | null | undefined;
    const deleteIds = getDeleteIds(deleteOp);
    for (const id of deleteIds) {
      this.rowMap.delete(String(id));
    }
  }

  /**
   * Update columns array with new keys from data.
   * Returns true if columns were changed.
   */
  private updateColumns(dataKeys: string[]): boolean {
    let columnsChanged = false;
    for (const key of dataKeys) {
      if (!this.columns.includes(key)) {
        this.columns.push(key);
        columnsChanged = true;
      }
    }
    return columnsChanged;
  }

  /**
   * Rebuild all existing rows to accommodate new columns.
   */
  private rebuildRowsForNewColumns(): void {
    const currentRows = Array.from(this.rowMap.entries());
    this.rowMap.clear();
    for (const [key, oldRow] of currentRows) {
      // Create a new row with the updated column structure
      const newRow: unknown[] = this.columns.map((_, idx) => {
        // Keep existing data if the column index is within the old row
        return idx < oldRow.length ? oldRow[idx] : undefined;
      });
      this.rowMap.set(key, newRow);
    }
  }

  /**
   * Process insert or modify operations from a single operation object.
   */
  private processInsertOrModifyOperation(op: StreamOperation): void {
    const insertOrModify = getInsertOrModify(op) as InsertOrModifyWithRows | null | undefined;
    const rows = getRows(insertOrModify);
    if (rows.length === 0) return;

    for (const r of rows) {
      const row = r as StreamRow;
      const data = row.data ?? r;
      const flat = this.flattenData(data);

      // Update columns if we encounter new fields
      const columnsChanged = this.updateColumns(Object.keys(flat));

      // If columns changed, we need to update all existing rows to have placeholders for new columns
      if (columnsChanged) {
        this.rebuildRowsForNewColumns();
      }

      const rowData: unknown[] = this.columns.map(c => flat[c]);
      const key = row.id !== undefined ? String(row.id) : randomUUID();
      this.rowMap.set(key, rowData);
    }
  }

  /**
   * Send empty results when stream is synced with schema but no data.
   */
  private handleEmptyResults(msg: StreamMessageWrapper): void {
    if (msg.msg?.schema?.fields && msg.state === 'synced') {
      log('Stream synced with schema but no data operations', LogLevel.DEBUG);
      if (this.rows.length === 0) {
        this.panel.webview.postMessage({
          command: 'results',
          columns: [],
          rows: [],
          status: 'Query completed - no matching results found'
        });
      }
    }
  }

  /**
   * Send current results to webview.
   */
  private sendResults(): void {
    this.rows = Array.from(this.rowMap.values());
    this.panel.webview.postMessage({
      command: 'results',
      columns: this.columns,
      rows: this.rows,
      status: `Count: ${this.rows.length}`
    });
  }

  private handleQueryStream(msg: StreamMessageWrapper): void {
    log(`Received stream message: ${JSON.stringify(msg, null, 2)}`, LogLevel.DEBUG);

    // Check if this is an NQL stream with conversion details
    const details = msg.details ?? msg.message?.details;
    const streamName = msg.stream ?? msg.message?.stream;

    log(`Stream name: ${streamName}`, LogLevel.DEBUG);
    log(`Details: ${details}`, LogLevel.DEBUG);

    this.handleNqlConversion(streamName, details);

    const ops = this.extractOperations(msg);
    log(`Operations array length: ${ops.length}`, LogLevel.DEBUG);

    if (ops.length === 0) {
      this.handleEmptyResults(msg);
      return;
    }

    for (const op of ops) {
      this.processDeleteOperation(op);
      this.processInsertOrModifyOperation(op);
    }

    this.sendResults();
  }

  static show(context: vscode.ExtensionContext, title: string): QueriesDashboardPanel {
    if (QueriesDashboardPanel.currentPanel) {
      QueriesDashboardPanel.currentPanel.panel.title = title;
      QueriesDashboardPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
      return QueriesDashboardPanel.currentPanel;
    }

    const panel = new QueriesDashboardPanel(context, title);
    QueriesDashboardPanel.currentPanel = panel;
    panel.panel.onDidDispose(() => {
      if (QueriesDashboardPanel.currentPanel === panel) {
        QueriesDashboardPanel.currentPanel = undefined;
      }
    });
    return panel;
  }
}
