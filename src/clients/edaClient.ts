import { LogLevel, log } from '../extension';
import { EdaAuthClient, EdaAuthOptions } from './edaAuthClient';
import { EdaApiClient } from './edaApiClient';
import { EdaStreamClient, StreamMessage } from './edaStreamClient';
import { EdaSpecManager } from './edaSpecManager';

// Re-export types for backward compatibility
export type { NamespaceCallback, DeviationCallback, TransactionCallback, AlarmCallback } from './types';
export interface EdaClientOptions extends EdaAuthOptions {
  messageIntervalMs?: number;
}

/**
 * Facade client that combines all EDA client functionality
 * This maintains backward compatibility while delegating to focused clients
 */
export class EdaClient {
  private authClient: EdaAuthClient;
  private apiClient: EdaApiClient;
  private streamClient: EdaStreamClient;
  private specManager: EdaSpecManager;
  private initPromise: Promise<void>;

  constructor(baseUrl: string, opts: EdaClientOptions = {}) {
    log('Initializing EdaClient with new architecture', LogLevel.DEBUG);

    // Initialize sub-clients
    this.authClient = new EdaAuthClient(baseUrl, opts);
    this.apiClient = new EdaApiClient(this.authClient);
    this.streamClient = new EdaStreamClient(opts.messageIntervalMs);
    this.specManager = new EdaSpecManager(this.apiClient);
    this.apiClient.setSpecManager(this.specManager);

    // Connect components
    this.streamClient.setAuthClient(this.authClient);

    // Initialize specs and set up streaming
    this.initPromise = this.initializeAsync();
  }

  private async initializeAsync(): Promise<void> {
    await this.specManager.waitForInit();
    this.streamClient.setStreamEndpoints(this.specManager.getStreamEndpoints());
  }

  // Stream event forwarding
  public onStreamMessage(cb: (stream: string, msg: any) => void): void {
    this.streamClient.onStreamMessage((event: StreamMessage) => {
      cb(event.stream, event.message);
    });
  }

  public offStreamMessage(): void {
    // Note: This requires updating EdaStreamClient to support removing listeners
    log('offStreamMessage not yet implemented in new architecture', LogLevel.WARN);
  }

  // Streaming methods
  public async streamEdaNamespaces(): Promise<void> {
    await this.initPromise; // Ensure initialization is complete
    this.streamClient.subscribeToStream('namespaces');
    await this.streamClient.connect();
  }

  public async streamEdaAlarms(): Promise<void> {
    await this.initPromise;
    this.streamClient.subscribeToStream('current-alarms');
    await this.streamClient.connect();
  }

  public async streamEdaDeviations(): Promise<void> {
    await this.initPromise;
    this.streamClient.subscribeToStream('deviations');
    await this.streamClient.connect();
  }

  public async streamEdaTransactions(size = 50): Promise<void> {
    await this.initPromise;
    this.streamClient.setTransactionSummarySize(size);
    if (!this.streamClient.isSubscribed('summary')) {
      this.streamClient.subscribeToStream('summary');
    }
    if (!this.streamClient.isConnected()) {
      await this.streamClient.connect();
    } else {
      await this.streamClient.restartTransactionSummaryStream();
    }
  }

  public closeAlarmStream(): void {
    this.streamClient.unsubscribeFromStream('current-alarms');
  }

  public closeDeviationStream(): void {
    this.streamClient.unsubscribeFromStream('deviations');
  }

  public closeTransactionStream(): void {
    this.streamClient.unsubscribeFromStream('summary');
  }

  // API methods (delegated)
  public async getEdaResourceYaml(kind: string, name: string, namespace: string): Promise<string> {
    return this.apiClient.getEdaResourceYaml(kind, name, namespace);
  }

  public async createDeviationAction(namespace: string, action: any): Promise<any> {
    return this.apiClient.createDeviationAction(namespace, action);
  }

  public async restoreTransaction(transactionId: string | number): Promise<any> {
    return this.apiClient.restoreTransaction(transactionId);
  }

  public async revertTransaction(transactionId: string | number): Promise<any> {
    return this.apiClient.revertTransaction(transactionId);
  }

  public async runTransaction(transaction: any): Promise<number> {
    return this.apiClient.runTransaction(transaction);
  }

  public async createCustomResource(
    group: string,
    version: string,
    namespace: string | undefined,
    plural: string,
    body: any,
    namespaced = true,
    dryRun = false
  ): Promise<any> {
    return this.apiClient.createCustomResource(group, version, namespace, plural, body, namespaced, dryRun);
  }

  public async updateCustomResource(
    group: string,
    version: string,
    namespace: string | undefined,
    plural: string,
    name: string,
    body: any,
    namespaced = true,
    dryRun = false
  ): Promise<any> {
    return this.apiClient.updateCustomResource(group, version, namespace, plural, name, body, namespaced, dryRun);
  }

  public async deleteCustomResource(
    group: string,
    version: string,
    namespace: string | undefined,
    plural: string,
    name: string,
    namespaced = true
  ): Promise<any> {
    return this.apiClient.deleteCustomResource(group, version, namespace, plural, name, namespaced);
  }

  public async validateCustomResources(resources: any[]): Promise<void> {
    return this.apiClient.validateCustomResources(resources);
  }

  public async getEdaTransactions(size = 50): Promise<any[]> {
    await this.initPromise;
    return this.apiClient.getEdaTransactions(size);
  }

  public async getTransactionSummary(transactionId: string | number): Promise<any> {
    return this.apiClient.getTransactionSummary(transactionId);
  }

  public async getTransactionDetails(
    transactionId: string | number,
    waitForComplete = false,
    failOnErrors = false
  ): Promise<any> {
    return this.apiClient.getTransactionDetails(transactionId, waitForComplete, failOnErrors);
  }

  public async getUserStorageFile(path: string): Promise<string | undefined> {
    return this.apiClient.getUserStorageFile(path);
  }

  public async putUserStorageFile(path: string, content: string): Promise<void> {
    await this.apiClient.putUserStorageFile(path, content);
  }

  public async streamUserStorageFile(path: string): Promise<void> {
    await this.initPromise;
    await this.streamClient.streamUserStorageFile(path);
  }

  public async getNodeConfig(namespace: string, node: string): Promise<any> {
    return this.apiClient.getNodeConfig(namespace, node);
  }

  // Spec manager methods (delegated)
  public getCachedNamespaces(): string[] {
    return this.specManager.getCachedNamespaces();
  }

  public setCachedNamespaces(names: string[]): void {
    this.specManager.setCachedNamespaces(names);
  }

  public async getStreamNames(): Promise<string[]> {
    await this.initPromise;
    return this.specManager.getStreamNames();
  }

  public async getStreamGroups(): Promise<Record<string, string[]>> {
    await this.initPromise;
    return this.specManager.getStreamGroups();
  }

  // Compatibility method
  public async executeEdactl(command: string): Promise<string> {
    const getMatch = command.match(/^get\s+deviation\s+(\S+)\s+-n\s+(\S+)\s+-o\s+yaml$/);
    if (getMatch) {
      const [, name, ns] = getMatch;
      return this.getEdaResourceYaml('deviation', name, ns);
    }
    throw new Error('executeEdactl not supported in API mode');
  }

  public clearCache(): void {
    // no-op for compatibility
  }

  /**
   * Dispose all resources
   */
  public dispose(): void {
    this.streamClient.dispose();
  }
}