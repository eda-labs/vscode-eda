import { LogLevel, log } from '../extension';

import type { EdaAuthOptions } from './edaAuthClient';
import { EdaAuthClient } from './edaAuthClient';
import { EdaApiClient } from './edaApiClient';
import type { WorkflowGetInputsRespElem, WorkflowInputDataElem } from './edaApiClient';
import type { StreamMessage } from './edaStreamClient';
import { EdaStreamClient } from './edaStreamClient';
import { EdaSpecManager } from './edaSpecManager';

// Constants for stream names
const STREAM_SUMMARY = 'summary';

// ============================================================================
// Type definitions for EDA API resources
// ============================================================================

/** Standard Kubernetes object metadata */
export interface K8sMetadata {
  name?: string;
  namespace?: string;
  uid?: string;
  resourceVersion?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  [key: string]: unknown;
}

/** Base Kubernetes resource structure */
export interface K8sResource {
  apiVersion?: string;
  kind?: string;
  metadata?: K8sMetadata;
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Transaction summary returned from the API */
export interface TransactionSummary {
  id: number | string;
  username?: string;
  state?: string;
  success?: boolean;
  dryRun?: boolean;
  description?: string;
  lastChangeTimestamp?: string;
  [key: string]: unknown;
}

/** Transaction details including execution and input resources */
export interface TransactionDetails extends TransactionSummary {
  execution?: Record<string, unknown>;
  inputResources?: K8sResource[];
  [key: string]: unknown;
}

/** Deviation action request body */
export interface DeviationAction {
  apiVersion?: string;
  kind?: string;
  metadata?: K8sMetadata;
  spec?: {
    actions?: Array<{
      action: string;
      path?: string;
      recurse?: boolean;
    }>;
    nodeEndpoint?: string;
  };
  [key: string]: unknown;
}

/** Transaction request body */
export interface TransactionRequest {
  description?: string;
  dryRun?: boolean;
  retain?: boolean;
  resultType?: string;
  crs?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/** API operation result (generic for restore/revert operations) */
export interface ApiOperationResult {
  success?: boolean;
  message?: string;
  [key: string]: unknown;
}

/** Resource diff returned from transaction diff API */
export interface ResourceDiff {
  diff?: string;
  before?: string;
  after?: string;
  [key: string]: unknown;
}

/** Node configuration diff */
export interface NodeConfigDiff {
  diff?: string;
  before?: string;
  after?: string;
  [key: string]: unknown;
}

/** TopoNode resource */
export interface TopoNode extends K8sResource {
  spec?: {
    platform?: string;
    [key: string]: unknown;
  };
  status?: {
    'node-details'?: string;
    [key: string]: unknown;
  };
}

/** TopoLink resource */
export interface TopoLink extends K8sResource {
  spec?: {
    endpoints?: Array<{
      node?: string;
      interface?: string;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
}

/** Interface resource */
export interface InterfaceResource extends K8sResource {
  spec?: {
    node?: string;
    name?: string;
    [key: string]: unknown;
  };
}

/** NodeUser resource */
export interface NodeUser extends K8sResource {
  spec?: {
    username?: string;
    groupBindings?: Array<{
      nodes?: string[];
      nodeSelector?: string[];
    }>;
    [key: string]: unknown;
  };
}

/** Topology resource */
export interface Topology {
  name?: string;
  namespace?: string;
  [key: string]: unknown;
}

/** Topology grouping resource */
export interface TopologyGrouping extends K8sResource {
  spec?: {
    topology?: string;
    [key: string]: unknown;
  };
}

/** Node configuration */
export interface NodeConfig {
  config?: string;
  [key: string]: unknown;
}

/** EQL query result */
export interface EqlQueryResult {
  results?: unknown[];
  [key: string]: unknown;
}

/** Stream message callback type */
export type StreamMessageCallback = (stream: string, message: unknown) => void;

export interface EdaClientOptions extends EdaAuthOptions {
  coreNamespace?: string;
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
  private initPromise: Promise<void> = Promise.resolve();
  private streamRefCounts: Map<string, number> = new Map();
  private eqlStreamRefCounts: Map<string, number> = new Map();
  private nqlStreamRefCounts: Map<string, number> = new Map();

  constructor(baseUrl: string, opts: EdaClientOptions) {
    log('Initializing EdaClient with new architecture', LogLevel.DEBUG);

    // Initialize sub-clients
    this.authClient = new EdaAuthClient(baseUrl, opts);
    this.apiClient = new EdaApiClient(this.authClient);
    this.streamClient = new EdaStreamClient();
    this.specManager = new EdaSpecManager(this.apiClient, opts.coreNamespace);
    this.apiClient.setSpecManager(this.specManager);

    // Connect components
    this.streamClient.setAuthClient(this.authClient);

    // Start async initialization
    this.startInitialization();
  }

  /**
   * Start async initialization. Separated from constructor to satisfy sonarjs/no-async-constructor.
   */
  private startInitialization(): void {
    this.specManager.startInitialization();
    this.initPromise = this.specManager.waitForInit().then(() => {
      this.streamClient.setStreamEndpoints(this.specManager.getStreamEndpoints());
      this.streamClient.setCoreNamespace(this.specManager.getCoreNamespace());
      this.streamClient.setNamespaces(this.specManager.getCachedNamespaces());
    });
  }

  private incrementRefCount(map: Map<string, number>, key: string): boolean {
    const current = map.get(key) ?? 0;
    map.set(key, current + 1);
    return current === 0;
  }

  private decrementRefCount(map: Map<string, number>, key: string): boolean {
    const current = map.get(key) ?? 0;
    if (current === 0) {
      return false;
    }
    if (current <= 1) {
      map.delete(key);
      return true;
    }
    map.set(key, current - 1);
    return false;
  }

  // Stream event forwarding
  public onStreamMessage(cb: StreamMessageCallback): { dispose(): void } {
    return this.streamClient.onStreamMessage((event: StreamMessage) => {
      cb(event.stream, event.message as unknown);
    });
  }

  public offStreamMessage(): void {
    // Note: This requires updating EdaStreamClient to support removing listeners
    log('offStreamMessage not yet implemented in new architecture', LogLevel.WARN);
  }

  // Streaming methods
  public async streamByName(streamName: string): Promise<void> {
    await this.initPromise;
    const isFirstSubscriber = this.incrementRefCount(this.streamRefCounts, streamName);
    if (isFirstSubscriber) {
      this.streamClient.subscribeToStream(streamName);
    }
    await this.streamClient.connect();
  }

  public closeStreamByName(streamName: string): void {
    const shouldClose = this.decrementRefCount(this.streamRefCounts, streamName);
    if (shouldClose) {
      this.streamClient.unsubscribeFromStream(streamName);
    }
  }

  public async streamEdaNamespaces(): Promise<void> {
    await this.streamByName('namespaces');
  }

  public async streamEdaAlarms(): Promise<void> {
    await this.streamByName('current-alarms');
  }

  public async streamEdaDeviations(): Promise<void> {
    await this.streamByName('deviations');
  }

  public async streamTopoNodes(): Promise<void> {
    await this.streamByName('toponodes');
  }

  public async streamTopoLinks(): Promise<void> {
    await this.streamByName('topolinks');
  }

  public async streamInterfaces(): Promise<void> {
    await this.streamByName('interfaces');
  }

  public async streamEql(
    query: string,
    namespaces?: string,
    streamName = 'eql'
  ): Promise<void> {
    await this.initPromise;
    const isFirstSubscriber = this.incrementRefCount(this.eqlStreamRefCounts, streamName);
    this.streamClient.setEqlQuery(query, namespaces, streamName);
    if (isFirstSubscriber) {
      this.streamClient.subscribeToStream(streamName);
    }
    await this.streamClient.connect();
  }

  public async closeEqlStream(streamName = 'eql'): Promise<void> {
    const shouldClose = this.decrementRefCount(this.eqlStreamRefCounts, streamName);
    if (shouldClose) {
      await this.streamClient.closeEqlStream(streamName);
    }
  }

  public async streamNql(
    query: string,
    namespaces?: string,
    streamName = 'nql'
  ): Promise<void> {
    await this.initPromise;
    const isFirstSubscriber = this.incrementRefCount(this.nqlStreamRefCounts, streamName);
    this.streamClient.setNqlQuery(query, namespaces, streamName);
    if (isFirstSubscriber) {
      this.streamClient.subscribeToStream(streamName);
    }
    await this.streamClient.connect();
  }

  public async closeNqlStream(streamName = 'nql'): Promise<void> {
    const shouldClose = this.decrementRefCount(this.nqlStreamRefCounts, streamName);
    if (shouldClose) {
      await this.streamClient.closeNqlStream(streamName);
    }
  }

  public async streamEdaTransactions(size = 50): Promise<void> {
    await this.initPromise;
    const isFirstSubscriber = this.incrementRefCount(this.streamRefCounts, STREAM_SUMMARY);
    this.streamClient.setTransactionSummarySize(size);
    if (isFirstSubscriber) {
      this.streamClient.subscribeToStream(STREAM_SUMMARY);
      await this.streamClient.connect();
      return;
    }
    if (!this.streamClient.isConnected()) {
      await this.streamClient.connect();
    } else {
      await this.streamClient.restartTransactionSummaryStream();
    }
  }

  public closeAlarmStream(): void {
    this.closeStreamByName('current-alarms');
  }

  public closeDeviationStream(): void {
    this.closeStreamByName('deviations');
  }

  public closeTopoNodeStream(): void {
    this.closeStreamByName('toponodes');
  }

  public closeTopoLinkStream(): void {
    this.closeStreamByName('topolinks');
  }

  public closeInterfaceStream(): void {
    this.closeStreamByName('interfaces');
  }

  public closeTransactionStream(): void {
    this.closeStreamByName(STREAM_SUMMARY);
  }

  public async updateTransactionStreamSize(size = 50): Promise<void> {
    await this.initPromise;
    this.streamClient.setTransactionSummarySize(size);
    if (!this.streamClient.isSubscribed(STREAM_SUMMARY)) {
      return;
    }
    if (!this.streamClient.isConnected()) {
      await this.streamClient.connect();
      return;
    }
    await this.streamClient.restartTransactionSummaryStream();
  }

  // API methods (delegated)
  public async getEdaResourceYaml(
    kind: string,
    name: string,
    namespace: string,
    apiVersion?: string
  ): Promise<string> {
    return this.apiClient.getEdaResourceYaml(kind, name, namespace, apiVersion);
  }

  public async createDeviationAction(namespace: string, action: DeviationAction): Promise<K8sResource> {
    return this.apiClient.createDeviationAction(namespace, action) as Promise<K8sResource>;
  }

  public async restoreTransaction(transactionId: string | number): Promise<ApiOperationResult> {
    return this.apiClient.restoreTransaction(transactionId) as Promise<ApiOperationResult>;
  }

  public async revertTransaction(transactionId: string | number): Promise<ApiOperationResult> {
    return this.apiClient.revertTransaction(transactionId) as Promise<ApiOperationResult>;
  }

  public async runTransaction(transaction: TransactionRequest): Promise<number> {
    return this.apiClient.runTransaction(transaction);
  }

  public async createCustomResource(
    group: string,
    version: string,
    namespace: string | undefined,
    plural: string,
    body: K8sResource,
    namespaced = true,
    dryRun = false
  ): Promise<K8sResource> {
    return this.apiClient.createCustomResource(group, version, namespace, plural, body, namespaced, dryRun) as Promise<K8sResource>;
  }

  public async updateCustomResource(
    group: string,
    version: string,
    namespace: string | undefined,
    plural: string,
    name: string,
    body: K8sResource,
    namespaced = true,
    dryRun = false
  ): Promise<K8sResource> {
    return this.apiClient.updateCustomResource(group, version, namespace, plural, name, body, namespaced, dryRun) as Promise<K8sResource>;
  }

  public async deleteCustomResource(
    group: string,
    version: string,
    namespace: string | undefined,
    plural: string,
    name: string,
    namespaced = true
  ): Promise<ApiOperationResult> {
    return this.apiClient.deleteCustomResource(group, version, namespace, plural, name, namespaced) as Promise<ApiOperationResult>;
  }

  public async validateCustomResources(resources: K8sResource[]): Promise<void> {
    return this.apiClient.validateCustomResources(resources);
  }

  public async getEdaTransactions(size = 50): Promise<TransactionSummary[]> {
    await this.initPromise;
    return this.apiClient.getEdaTransactions(size) as Promise<TransactionSummary[]>;
  }

  public async getTransactionSummary(transactionId: string | number): Promise<TransactionSummary> {
    return this.apiClient.getTransactionSummary(transactionId) as Promise<TransactionSummary>;
  }

  public async getTransactionDetails(
    transactionId: string | number,
    waitForComplete = false,
    failOnErrors = false
  ): Promise<TransactionDetails> {
    return this.apiClient.getTransactionDetails(transactionId, waitForComplete, failOnErrors) as Promise<TransactionDetails>;
  }

  public async getResourceDiff(
    transactionId: string | number,
    group: string,
    version: string,
    kind: string,
    name: string,
    namespace: string
  ): Promise<ResourceDiff> {
    return this.apiClient.getResourceDiff(transactionId, group, version, kind, name, namespace) as Promise<ResourceDiff>;
  }

  public async getNodeConfigDiff(
    transactionId: string | number,
    node: string,
    namespace: string
  ): Promise<NodeConfigDiff> {
    return this.apiClient.getNodeConfigDiff(transactionId, node, namespace) as Promise<NodeConfigDiff>;
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

  public async getNodeConfig(namespace: string, node: string): Promise<NodeConfig> {
    return this.apiClient.getNodeConfig(namespace, node) as Promise<NodeConfig>;
  }

  public async getTopoNode(namespace: string, name: string): Promise<TopoNode> {
    await this.initPromise;
    return this.apiClient.getTopoNode(namespace, name) as Promise<TopoNode>;
  }

  public async listTopoNodes(namespace: string): Promise<TopoNode[]> {
    await this.initPromise;
    return this.apiClient.listTopoNodes(namespace) as Promise<TopoNode[]>;
  }

  public async listNodeUsers(namespace: string): Promise<NodeUser[]> {
    await this.initPromise;
    return this.apiClient.listNodeUsers(namespace) as Promise<NodeUser[]>;
  }

  public async listInterfaces(namespace: string): Promise<InterfaceResource[]> {
    await this.initPromise;
    return this.apiClient.listInterfaces(namespace) as Promise<InterfaceResource[]>;
  }

  public async listTopoLinks(namespace: string): Promise<TopoLink[]> {
    await this.initPromise;
    return this.apiClient.listTopoLinks(namespace) as Promise<TopoLink[]>;
  }

  public async listNamespaces(): Promise<string[]> {
    await this.initPromise;
    return this.apiClient.listNamespaces();
  }

  public async listResources(
    group: string,
    version: string,
    kind: string,
    namespace?: string
  ): Promise<K8sResource[]> {
    await this.initPromise;
    return this.apiClient.listResources(group, version, kind, namespace) as Promise<K8sResource[]>;
  }

  public async createResource(
    group: string,
    version: string,
    kind: string,
    resource: K8sResource,
    namespace?: string
  ): Promise<K8sResource> {
    await this.initPromise;
    return this.apiClient.createResource(group, version, kind, resource, namespace) as Promise<K8sResource>;
  }

  public async getWorkflowInputs(path: string): Promise<WorkflowGetInputsRespElem[]> {
    await this.initPromise;
    return this.apiClient.getWorkflowInputs(path);
  }

  public async submitWorkflowInput(path: string, data: WorkflowInputDataElem[]): Promise<void> {
    await this.initPromise;
    await this.apiClient.submitWorkflowInput(path, data);
  }

  public async getResource(path: string): Promise<K8sResource> {
    await this.initPromise;
    return this.apiClient.fetchJSON<K8sResource>(path);
  }

  public async getResourceYaml(
    group: string,
    version: string,
    kind: string,
    name: string,
    namespace?: string
  ): Promise<string> {
    await this.initPromise;
    return this.apiClient.getResourceYaml(group, version, kind, name, namespace);
  }

  public async listTopologies(): Promise<Topology[]> {
    await this.initPromise;
    return this.apiClient.listTopologies() as Promise<Topology[]>;
  }

  public async listTopologyGroupings(topologyName: string): Promise<TopologyGrouping[]> {
    await this.initPromise;
    return this.apiClient.listTopologyGroupings(topologyName) as Promise<TopologyGrouping[]>;
  }

  public async queryEql(query: string, namespaces?: string): Promise<EqlQueryResult> {
    await this.initPromise;
    return this.apiClient.queryEql(query, namespaces) as Promise<EqlQueryResult>;
  }

  public async autocompleteEql(
    query: string,
    limit = 20
  ): Promise<string[]> {
    await this.initPromise;
    return this.apiClient.autocompleteEql(query, limit);
  }

  // Spec manager methods (delegated)
  public getCachedNamespaces(): string[] {
    return this.specManager.getCachedNamespaces();
  }

  public setCachedNamespaces(names: string[]): void {
    this.specManager.setCachedNamespaces(names);
    this.streamClient.setNamespaces(names);
  }

  public getCoreNamespace(): string {
    return this.specManager.getCoreNamespace();
  }

  public getApiVersion(): string {
    return this.specManager.getApiVersion();
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
    const regex = /^get\s+deviation\s+(\S+)\s+-n\s+(\S+)\s+-o\s+yaml$/;
    const getMatch = regex.exec(command);
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
    this.streamRefCounts.clear();
    this.eqlStreamRefCounts.clear();
    this.nqlStreamRefCounts.clear();
    this.streamClient.dispose();
    this.authClient.dispose();
  }
}
