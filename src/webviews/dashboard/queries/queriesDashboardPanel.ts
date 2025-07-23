import * as vscode from 'vscode';
import { BasePanel } from '../../basePanel';
import { serviceManager } from '../../../services/serviceManager';
import { EdaClient } from '../../../clients/edaClient';
import { EmbeddingSearchService } from '../../../services/embeddingSearchService';
import { LogLevel, log } from '../../../extension';

export class QueriesDashboardPanel extends BasePanel {
  private edaClient: EdaClient;
  private embeddingSearch: EmbeddingSearchService;
  private queryStreamName?: string;
  private columns: string[] = [];
  private rows: any[][] = [];
  private rowMap: Map<string, any[]> = new Map();
  private nqlConversionShown: boolean = false;

  constructor(context: vscode.ExtensionContext, title: string) {
    super(context, 'queriesDashboard', title, undefined, {
      light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-black.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'eda-icon-white.svg')
    });

    this.edaClient = serviceManager.getClient<EdaClient>('eda');
    this.embeddingSearch = EmbeddingSearchService.getInstance();

    this.edaClient.onStreamMessage((stream, msg) => {
      log(`EdaClient callback received stream: ${stream}, queryStreamName: ${this.queryStreamName}`, LogLevel.DEBUG);
      if (stream === this.queryStreamName) {
        log('Stream name matches, calling handleQueryStream', LogLevel.DEBUG);
        this.handleQueryStream(msg);
      } else {
        log('Stream name does not match', LogLevel.DEBUG);
      }
    });

    this.panel.onDidDispose(() => {
      if (this.queryStreamName) {
        void this.edaClient.closeEqlStream(this.queryStreamName);
      }
    });

    this.panel.webview.onDidReceiveMessage(async msg => {
      if (msg.command === 'ready') {
        await this.sendNamespaces();
      } else if (msg.command === 'runQuery') {
        await this.handleQuery(msg.query as string, msg.namespace as string, msg.queryType as string);
      } else if (msg.command === 'autocomplete') {
        const query = msg.query as string;
        // Only provide autocomplete for EQL queries (starting with .)
        if (query.trim().startsWith('.')) {
          const list = await this.edaClient.autocompleteEql(query, 20);
          this.panel.webview.postMessage({ command: 'autocomplete', list });
        } else {
          // No autocomplete for natural language queries
          this.panel.webview.postMessage({ command: 'autocomplete', list: [] });
        }
      } else if (msg.command === 'searchNaturalLanguage') {
        await this.handleNaturalLanguageSearch(msg.query as string);
      }
    });

    this.panel.webview.html = this.buildHtml();
  }

  protected getHtml(): string {
    return this.readWebviewFile('dashboard', 'queries', 'queriesDashboard.html');
  }

  protected getCustomStyles(): string {
    return this.readWebviewFile('dashboard', 'queries', 'queriesDashboard.css');
  }

  protected getScripts(): string {
    return '';
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'queriesDashboard.js');
    return `<script nonce="${nonce}" src="${scriptUri}"></script>`;
  }

  private async sendNamespaces(): Promise<void> {
    const coreNs = this.edaClient.getCoreNamespace();
    const namespaces = this.edaClient
      .getCachedNamespaces()
      .filter(ns => ns !== coreNs);
    namespaces.unshift('All Namespaces');
    this.panel.webview.postMessage({
      command: 'init',
      namespaces,
      selected: 'All Namespaces'
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
    const ns = namespace === 'All Namespaces' ? undefined : namespace;
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
    const ns = namespace === 'All Namespaces' ? undefined : namespace;
    
    log(`Starting NQL stream with namespace: ${ns}`, LogLevel.DEBUG);
    await this.edaClient.streamNql(query, ns, this.queryStreamName);
    this.panel.webview.postMessage({ command: 'clear' });
  }

  private handleQueryStream(msg: any): void {
    // Debug logging to understand all message structures
    log(`Received stream message: ${JSON.stringify(msg, null, 2)}`, LogLevel.DEBUG);
    
    // Check if this is an NQL stream with conversion details
    // The details could be at msg.details or msg.message.details based on the SSE processing
    const details = msg.details || msg.message?.details;
    const streamName = msg.stream || msg.message?.stream;
    
    log(`Stream name: ${streamName}`, LogLevel.DEBUG);
    log(`Details: ${details}`, LogLevel.DEBUG);
    
    // For NQL streams, try to extract conversion details from the schema annotations
    // The converted EQL query might be embedded in the field annotations
    if (streamName?.startsWith('nql') && !this.nqlConversionShown) {
      let convertedEql = details;
      
      // Check if we can reconstruct the EQL query from the schema field annotations
      if (!convertedEql && msg.msg?.schema?.fields) {
        const fields = msg.msg.schema.fields;
        const namespaceFields = fields.filter((f: any) => f.name.startsWith('.namespace'));
        const valueFields = fields.filter((f: any) => !f.name.startsWith('.namespace'));
        
        if (namespaceFields.length > 0 && valueFields.length > 0) {
          // Try to reconstruct a basic EQL query from the schema
          const basePath = namespaceFields[0].name.replace(/\.name$/, '');
          const conditions = valueFields.map((f: any) => `(${f.name} > 0)`).join(' OR ');
          convertedEql = `${basePath} where ${conditions}`;
          log(`Reconstructed EQL from schema: ${convertedEql}`, LogLevel.DEBUG);
        }
      }
      
      if (convertedEql) {
        log(`Sending convertedQuery message with details: ${convertedEql}`, LogLevel.DEBUG);
        this.panel.webview.postMessage({
          command: 'convertedQuery',
          originalQuery: '', // We don't have the original query here
          eqlQuery: convertedEql,
          queryType: 'nql',
          description: 'Natural Query Language converted to EQL query'
        });
        this.nqlConversionShown = true;
      }
    }

    const ops: any[] = Array.isArray(msg.msg?.op) ? msg.msg.op : [];
    log(`Operations array length: ${ops.length}`, LogLevel.DEBUG);
    
    if (ops.length === 0) {
      // Check if we have schema but no data yet
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
      return;
    }
    for (const op of ops) {
      if (Array.isArray(op.delete?.ids)) {
        for (const id of op.delete.ids) {
          this.rowMap.delete(String(id));
        }
      }

      const rows = op?.insert_or_modify?.rows;
      if (!Array.isArray(rows)) continue;

      for (const r of rows) {
        const data = r.data || r;
        
        // Update columns if we encounter new fields
        const dataKeys = Object.keys(data);
        for (const key of dataKeys) {
          if (!this.columns.includes(key)) {
            this.columns.push(key);
          }
        }
        
        const row = this.columns.map(c => data[c]);
        const key = r.id !== undefined ? String(r.id) : `${Date.now()}${Math.random()}`;
        this.rowMap.set(key, row);
      }
    }

    this.rows = Array.from(this.rowMap.values());
    this.panel.webview.postMessage({
      command: 'results',
      columns: this.columns,
      rows: this.rows,
      status: `Count: ${this.rows.length}`
    });
  }

  static show(context: vscode.ExtensionContext, title: string): void {
    new QueriesDashboardPanel(context, title);
  }
}
