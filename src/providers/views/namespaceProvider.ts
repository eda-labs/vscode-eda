// src/providers/views/namespaceProvider.ts

import * as vscode from 'vscode';

import { serviceManager } from '../../services/serviceManager';
import type { KubernetesClient } from '../../clients/kubernetesClient';
import type { EdaClient, TransactionRequest } from '../../clients/edaClient';
import type { BootstrapSnapshot } from '../../clients/edaApiClient';
import { namespaceSelectionService } from '../../services/namespaceSelectionService';
import type { ResourceService } from '../../services/resourceService';
import type { ResourceStatusService } from '../../services/resourceStatusService';
import { log, LogLevel } from '../../extension';
import { runKubectl } from '../../utils/kubectlRunner';
import { parseUpdateKey } from '../../utils/parseUpdateKey';
import { getUpdates } from '../../utils/streamMessageUtils';
import { ALL_NAMESPACES } from '../../webviews/constants';

import { FilteredTreeProvider } from './filteredTreeProvider';
import { TreeItemBase } from './treeItem';

// Constants for duplicate strings (sonarjs/no-duplicate-string)
const STREAM_GROUP_KUBERNETES = 'kubernetes';
const CONTEXT_RESOURCE_CATEGORY = 'resource-category';
const CONTEXT_K8S_NAMESPACE = 'k8s-namespace';
const CONTEXT_STREAM_ITEM = 'stream-item';
const STREAM_NAMESPACE_SEPARATOR = ':';
const DEFAULT_FAST_BOOTSTRAP_MIN_RESOURCES = 900;
const DEFAULT_FAST_BOOTSTRAP_BATCH_SIZE = 12;
const INDEXER_INSTALL_PROMPT =
  'Resource indexer endpoint is unavailable. Install it now for faster initial indexing?';
const INDEXER_REPOSITORY_URL = 'https://github.com/FloSch62/resource-indexer/';
const INDEXER_INSTALL_REMOTE_KUSTOMIZE_URL =
  'https://github.com/FloSch62/resource-indexer//packages/resource-text-indexer?ref=main';
const INDEXER_INSTALL_PROGRESS_TITLE = 'Installing Resource Indexer';
const INDEXER_UNINSTALL_PROGRESS_TITLE = 'Uninstalling Resource Indexer';
const INDEXER_PROMPT_ACTION_INSTALL = 'Install';
const INDEXER_PROMPT_ACTION_NOT_NOW = 'Not now';
const INDEXER_PROMPT_ACTION_NEVER_ASK = 'Never ask again';
const INDEXER_PROMPT_ACTION_WHAT_IS_THIS = 'What is this?';
const INDEXER_INSTALL_PROMPT_SETTING = 'showIndexerInstallPrompt';
const INDEXER_HTTP_PROXY_GROUP = 'core.eda.nokia.com';
const INDEXER_HTTP_PROXY_VERSION = 'v1';
const INDEXER_HTTP_PROXY_KIND = 'HttpProxy';
const INDEXER_HTTP_PROXY_NAME = 'indexer';
const INDEXER_HTTP_PROXY_NAMESPACE = 'eda-system';
const INDEXER_HTTP_PROXY_ROOT_URL =
  'http://resource-text-indexer.resource-text-indexer.svc.cluster.local:80/';
const INDEXER_READY_RETRY_ATTEMPTS = 24;
const INDEXER_READY_RETRY_DELAY_MS = 5000;
const INDEXER_INSTALL_TIMEOUT_MS = 180000;
const INDEXER_INSTALL_MAX_BUFFER = 10 * 1024 * 1024;
const INDEXER_MANUAL_INSTALL_MESSAGE =
  'Resource indexer endpoint is unavailable and no Kubernetes context is configured for this target. '
  + 'Install manually: kubectl apply -k '
  + `"${INDEXER_INSTALL_REMOTE_KUSTOMIZE_URL}", `
  + 'then commit HttpProxy eda-system/indexer.';
const INDEXER_MANUAL_UNINSTALL_MESSAGE =
  'Resource indexer uninstall requires a Kubernetes context for this target.';
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

/** Standard Kubernetes resource metadata */
interface K8sMetadata {
  name?: string;
  namespace?: string;
  uid?: string;
  resourceVersion?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  [key: string]: unknown;
}

/** Standard Kubernetes resource object */
interface K8sResource {
  apiVersion?: string;
  kind?: string;
  metadata?: K8sMetadata;
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Stream update object from EDA */
interface StreamUpdate {
  key?: string;
  data?: K8sResource | null;
}

/** Stream message envelope */
interface StreamMessageEnvelope {
  msg?: {
    updates?: StreamUpdate[];
    Updates?: StreamUpdate[];
  };
}

/**
 * TreeDataProvider for the EDA Namespaces view
 */
export class EdaNamespaceProvider extends FilteredTreeProvider<TreeItemBase> {
  private expandAll: boolean = false;

  private k8sClient?: KubernetesClient;
  private readonly kubernetesIcon: vscode.ThemeIcon;
  private readonly collapsedStreamIcon = new vscode.ThemeIcon('expand-all');
  private readonly expandedStreamIcon = new vscode.ThemeIcon('collapse-all');
  private edaClient: EdaClient;
  private resourceService?: ResourceService;
  private statusService?: ResourceStatusService;

  // The current filter text (if any) is managed by FilteredTreeProvider

  private cachedNamespaces: string[] = [];
  private cachedStreamGroups: Record<string, string[]> = {};
  private cachedStreamUiCategories: Record<string, string> = {};
  private streamData: Map<string, Map<string, K8sResource>> = new Map();
  private k8sStreams: string[] = [];
  private disposables: vscode.Disposable[] = [];
  /** Track expanded streams so icons persist across refreshes */
  private expandedStreams: Set<string> = new Set();
  /** Throttled refresh timer */
  private refreshHandle?: ReturnType<typeof setTimeout>;
  private pendingSummary?: string;
  private streamRefreshHandle?: ReturnType<typeof setTimeout>;
  private pendingStreamRefresh = false;
  private namesOnlyBootstrapStreams: Set<string> = new Set();
  private deferredBootstrapInFlight = false;
  private k8sInitializationHandle?: ReturnType<typeof setTimeout>;
  private k8sStartupDelayMs = 3000;
  private resourceRefreshIntervalMs = 180;
  private streamRefreshIntervalMs = 60;
  private fastBootstrapMinimumResources = DEFAULT_FAST_BOOTSTRAP_MIN_RESOURCES;
  private fastBootstrapAdditionalBatchSize = DEFAULT_FAST_BOOTSTRAP_BATCH_SIZE;
  private indexerInstallCheckInFlight = false;
  private indexerInstallPromptShown = false;
  private selectedNamespace = ALL_NAMESPACES;

constructor() {
    super();
    this.kubernetesIcon = new vscode.ThemeIcon('layers');
    log('EdaNamespaceProvider constructor starting', LogLevel.DEBUG);
    const configuredInterval = Number(process.env.EDA_STREAM_TREE_REFRESH_MS);
    if (!Number.isNaN(configuredInterval) && configuredInterval >= 0) {
      this.streamRefreshIntervalMs = configuredInterval;
    }
    const configuredK8sDelay = Number(process.env.EDA_K8S_STARTUP_DELAY_MS);
    if (!Number.isNaN(configuredK8sDelay) && configuredK8sDelay >= 0) {
      this.k8sStartupDelayMs = configuredK8sDelay;
    }
    const configuredResourceInterval = Number(process.env.EDA_RESOURCE_TREE_REFRESH_MS);
    if (!Number.isNaN(configuredResourceInterval) && configuredResourceInterval >= 0) {
      this.resourceRefreshIntervalMs = configuredResourceInterval;
    }
    const configuredBootstrapMinResources = Number(process.env.EDA_FAST_BOOTSTRAP_MIN_RESOURCES);
    if (!Number.isNaN(configuredBootstrapMinResources) && configuredBootstrapMinResources >= 0) {
      this.fastBootstrapMinimumResources = configuredBootstrapMinResources;
    }
    const configuredBootstrapBatchSize = Number(process.env.EDA_FAST_BOOTSTRAP_BATCH_SIZE);
    if (!Number.isNaN(configuredBootstrapBatchSize) && configuredBootstrapBatchSize > 0) {
      this.fastBootstrapAdditionalBatchSize = configuredBootstrapBatchSize;
    }

    this.initializeKubernetesClient();
    this.initializeServices();
    this.setupEventListeners();
    this.logKubernetesClientStatus();
    this.initializeNamespaceCache();
    this.setupStreamMessageHandler();
    this.selectedNamespace = namespaceSelectionService.getSelectedNamespace();
    this.disposables.push(
      namespaceSelectionService.onDidChangeSelection((namespace) => {
        this.selectedNamespace = namespace;
        this.refresh();
      })
    );
  }

  /** Initialize Kubernetes client and related streams */
  private initializeKubernetesClient(): void {
    const hasK8sClient = serviceManager.getClientNames().includes(STREAM_GROUP_KUBERNETES);
    log(`Kubernetes client registered in serviceManager: ${hasK8sClient}`, LogLevel.DEBUG);

    try {
      this.k8sClient = serviceManager.getClient<KubernetesClient>(STREAM_GROUP_KUBERNETES);
      log(`Kubernetes client obtained: ${this.k8sClient ? 'YES' : 'NO'}`, LogLevel.DEBUG);
      this.verifyKubernetesEventEmitter();
    } catch (err) {
      log(`Failed to get Kubernetes client: ${err}`, LogLevel.DEBUG);
      this.k8sClient = undefined;
    }

    if (this.k8sClient) {
      this.k8sStreams = this.k8sClient.getWatchedResourceTypes().slice().sort();
    }
  }

  /** Verify that the Kubernetes event emitter is working */
  private verifyKubernetesEventEmitter(): void {
    if (!this.k8sClient) {
      return;
    }
    log('Testing k8s client event emitter...', LogLevel.DEBUG);
    const testDisp = this.k8sClient.onResourceChanged(() => {
      log('TEST: K8s resource change event received!', LogLevel.DEBUG);
    });
    testDisp.dispose();
    log('Test listener set up and disposed successfully', LogLevel.DEBUG);
  }

  /** Initialize resource and status services */
  private initializeServices(): void {
    this.edaClient = serviceManager.getClient<EdaClient>('eda');

    try {
      this.resourceService = serviceManager.getService<ResourceService>('kubernetes-resources');
    } catch {
      this.resourceService = undefined;
    }

    try {
      this.statusService = serviceManager.getService<ResourceStatusService>('resource-status');
    } catch {
      this.statusService = undefined;
    }
  }

  /** Log the Kubernetes client initialization status */
  private logKubernetesClientStatus(): void {
    if (this.k8sClient) {
      log('Kubernetes client event listeners should be set up', LogLevel.DEBUG);
    } else {
      log('No Kubernetes client - event listeners NOT set up', LogLevel.WARN);
    }
  }

  /** Initialize namespace cache from EDA client */
  private initializeNamespaceCache(): void {
    this.cachedNamespaces = this.edaClient.getCachedNamespaces();
    const coreNs = this.edaClient.getCoreNamespace();
    if (!this.cachedNamespaces.includes(coreNs)) {
      this.cachedNamespaces.push(coreNs);
    }
  }

  /** Set up stream message handler */
  private setupStreamMessageHandler(): void {
    this.edaClient.onStreamMessage((stream, msg) => {
      const envelope = msg as StreamMessageEnvelope;
      if (stream === 'namespaces') {
        this.handleNamespaceMessage(envelope);
      } else {
        this.processStreamMessage(stream, envelope);
      }
    });
  }

  /**
   * Initialize async operations. Call this after construction.
   */
  public async initialize(): Promise<void> {
    await this.loadStreams();
    void this.maybePromptIndexerInstall();
    const loadedStreams = await this.loadFastResourceBootstrap();
    void this.subscribeToKnownEdaStreams().catch((err) => {
      log(`Failed to start EDA streams in background: ${err}`, LogLevel.DEBUG);
    });
    void this.loadDeferredResourceBootstrap(loadedStreams);
    this.scheduleKubernetesInitialization();
    this.edaClient.streamEdaNamespaces().catch(() => {
      // startup path is best-effort; stream errors are surfaced via stream logs/events
    });
  }

  private scheduleKubernetesInitialization(): void {
    if (!this.k8sClient) {
      return;
    }
    if (this.k8sStartupDelayMs <= 0) {
      void this.initializeKubernetesNamespaces();
      return;
    }
    if (this.k8sInitializationHandle) {
      return;
    }
    this.k8sInitializationHandle = setTimeout(() => {
      this.k8sInitializationHandle = undefined;
      void this.initializeKubernetesNamespaces();
    }, this.k8sStartupDelayMs);
  }

  private async subscribeToKnownEdaStreams(): Promise<void> {
    const streams = new Set<string>();
    for (const [group, names] of Object.entries(this.cachedStreamGroups)) {
      if (group === STREAM_GROUP_KUBERNETES) {
        continue;
      }
      for (const stream of names) {
        if (!STREAM_SUBSCRIBE_EXCLUDE.has(stream) && !stream.startsWith('_')) {
          streams.add(stream);
        }
      }
    }

    await Promise.all(
      Array.from(streams).map(async stream => {
        try {
          await this.edaClient.streamByName(stream);
        } catch (err) {
          log(`Failed to subscribe stream ${stream}: ${err}`, LogLevel.DEBUG);
        }
      })
    );
  }

  private hasKubernetesContext(): boolean {
    if (!this.k8sClient) {
      return false;
    }
    const context = this.k8sClient.getCurrentContext();
    return typeof context === 'string' && context.length > 0 && context !== 'none';
  }

  private shouldShowIndexerInstallPrompt(): boolean {
    const configuration = vscode.workspace.getConfiguration('vscode-eda');
    return configuration.get<boolean>(INDEXER_INSTALL_PROMPT_SETTING, true);
  }

  private async disableIndexerInstallPrompt(): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('vscode-eda');
    await configuration.update(
      INDEXER_INSTALL_PROMPT_SETTING,
      false,
      vscode.ConfigurationTarget.Global
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private async waitForIndexerAvailability(): Promise<boolean> {
    for (let attempt = 0; attempt < INDEXER_READY_RETRY_ATTEMPTS; attempt += 1) {
      if (await this.edaClient.isIndexerAvailable()) {
        return true;
      }
      await this.sleep(INDEXER_READY_RETRY_DELAY_MS);
    }
    return false;
  }

  private async waitForIndexerUnavailability(): Promise<boolean> {
    for (let attempt = 0; attempt < INDEXER_READY_RETRY_ATTEMPTS; attempt += 1) {
      if (!(await this.edaClient.isIndexerAvailable())) {
        return true;
      }
      await this.sleep(INDEXER_READY_RETRY_DELAY_MS);
    }
    return false;
  }

  private async promptIndexerInstallChoice(): Promise<string | undefined> {
    while (true) {
      const choice = await vscode.window.showInformationMessage(
        INDEXER_INSTALL_PROMPT,
        INDEXER_PROMPT_ACTION_INSTALL,
        INDEXER_PROMPT_ACTION_NOT_NOW,
        INDEXER_PROMPT_ACTION_NEVER_ASK,
        INDEXER_PROMPT_ACTION_WHAT_IS_THIS
      );
      if (choice !== INDEXER_PROMPT_ACTION_WHAT_IS_THIS) {
        return choice;
      }
      await vscode.env.openExternal(vscode.Uri.parse(INDEXER_REPOSITORY_URL));
    }
  }

  private async hasIndexerHttpProxy(): Promise<boolean> {
    const resources = await this.edaClient.listResources(
      INDEXER_HTTP_PROXY_GROUP,
      INDEXER_HTTP_PROXY_VERSION,
      INDEXER_HTTP_PROXY_KIND,
      INDEXER_HTTP_PROXY_NAMESPACE
    );
    return resources.some((resource) => resource.metadata?.name === INDEXER_HTTP_PROXY_NAME);
  }

  private async commitIndexerHttpProxy(): Promise<number> {
    const resource: K8sResource = {
      apiVersion: `${INDEXER_HTTP_PROXY_GROUP}/${INDEXER_HTTP_PROXY_VERSION}`,
      kind: INDEXER_HTTP_PROXY_KIND,
      metadata: {
        name: INDEXER_HTTP_PROXY_NAME,
        namespace: INDEXER_HTTP_PROXY_NAMESPACE
      },
      spec: {
        authType: 'atDestination',
        rootUrl: INDEXER_HTTP_PROXY_ROOT_URL
      }
    };
    const tx: TransactionRequest = {
      description: 'vscode install resource indexer httpproxy',
      dryRun: false,
      retain: true,
      resultType: 'normal',
      crs: [{ type: { replace: { value: resource } } }]
    };
    return this.edaClient.runTransaction(tx);
  }

  private async removeIndexerHttpProxy(): Promise<number | undefined> {
    const hasHttpProxy = await this.hasIndexerHttpProxy();
    if (!hasHttpProxy) {
      return undefined;
    }
    const tx: TransactionRequest = {
      description: 'vscode uninstall resource indexer httpproxy',
      dryRun: false,
      retain: true,
      resultType: 'normal',
      crs: [
        {
          type: {
            delete: {
              gvk: {
                group: INDEXER_HTTP_PROXY_GROUP,
                version: INDEXER_HTTP_PROXY_VERSION,
                kind: INDEXER_HTTP_PROXY_KIND
              },
              name: INDEXER_HTTP_PROXY_NAME,
              namespace: INDEXER_HTTP_PROXY_NAMESPACE
            }
          }
        }
      ]
    };
    return this.edaClient.runTransaction(tx);
  }

  private async installIndexerInBackground(): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: INDEXER_INSTALL_PROGRESS_TITLE,
        cancellable: false
      },
      async (progress) => {
        progress.report({ message: 'Applying Kubernetes manifests...' });
        runKubectl(
          'kubectl',
          ['apply', '-k', INDEXER_INSTALL_REMOTE_KUSTOMIZE_URL],
          { timeout: INDEXER_INSTALL_TIMEOUT_MS, maxBuffer: INDEXER_INSTALL_MAX_BUFFER }
        );

        progress.report({ message: 'Committing HttpProxy resource...' });
        const transactionId = await this.commitIndexerHttpProxy();

        progress.report({ message: 'Waiting for endpoint readiness...' });
        const ready = await this.waitForIndexerAvailability();
        if (ready) {
          vscode.window.showInformationMessage(
            `Resource indexer is ready (transaction ${transactionId}).`
          );
          return;
        }
        vscode.window.showInformationMessage(
          `Indexer install submitted (transaction ${transactionId}). `
          + 'Live streams continue until the endpoint becomes ready.'
        );
      }
    );
  }

  private async uninstallIndexerInBackground(): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: INDEXER_UNINSTALL_PROGRESS_TITLE,
        cancellable: false
      },
      async (progress) => {
        progress.report({ message: 'Deleting Kubernetes manifests...' });
        runKubectl(
          'kubectl',
          ['delete', '-k', INDEXER_INSTALL_REMOTE_KUSTOMIZE_URL, '--ignore-not-found=true'],
          { timeout: INDEXER_INSTALL_TIMEOUT_MS, maxBuffer: INDEXER_INSTALL_MAX_BUFFER }
        );

        progress.report({ message: 'Removing HttpProxy resource...' });
        const transactionId = await this.removeIndexerHttpProxy();

        progress.report({ message: 'Waiting for endpoint shutdown...' });
        const removed = await this.waitForIndexerUnavailability();
        if (removed) {
          const txSuffix = transactionId !== undefined ? ` (transaction ${transactionId})` : '';
          vscode.window.showInformationMessage(`Resource indexer is removed${txSuffix}.`);
          return;
        }
        const txMessage = transactionId !== undefined
          ? ` (transaction ${transactionId}).`
          : '.';
        vscode.window.showInformationMessage(
          'Indexer uninstall submitted'
          + `${txMessage} Endpoint availability may persist briefly while resources terminate.`
        );
      }
    );
  }

  public async installResourceIndexer(): Promise<void> {
    try {
      if (!this.hasKubernetesContext()) {
        vscode.window.showWarningMessage(INDEXER_MANUAL_INSTALL_MESSAGE);
        return;
      }
      await this.installIndexerInBackground();
    } catch (err) {
      const message = String(err);
      log(`Indexer install command failed: ${message}`, LogLevel.WARN);
      vscode.window.showWarningMessage(`Failed to install resource indexer: ${message}`);
    }
  }

  public async uninstallResourceIndexer(): Promise<void> {
    try {
      if (!this.hasKubernetesContext()) {
        vscode.window.showWarningMessage(INDEXER_MANUAL_UNINSTALL_MESSAGE);
        return;
      }
      await this.uninstallIndexerInBackground();
    } catch (err) {
      const message = String(err);
      log(`Indexer uninstall command failed: ${message}`, LogLevel.WARN);
      vscode.window.showWarningMessage(`Failed to uninstall resource indexer: ${message}`);
    }
  }

  private async maybePromptIndexerInstall(): Promise<void> {
    if (this.indexerInstallCheckInFlight || this.indexerInstallPromptShown) {
      return;
    }
    if (!this.shouldShowIndexerInstallPrompt()) {
      return;
    }
    this.indexerInstallCheckInFlight = true;
    try {
      const available = await this.edaClient.isIndexerAvailable();
      if (available) {
        return;
      }

      this.indexerInstallPromptShown = true;
      if (!this.hasKubernetesContext()) {
        log(
          `${INDEXER_MANUAL_INSTALL_MESSAGE} HttpProxy spec: authType=atDestination, `
          + `rootUrl=${INDEXER_HTTP_PROXY_ROOT_URL}.`,
          LogLevel.WARN
        );
        vscode.window.showWarningMessage(INDEXER_MANUAL_INSTALL_MESSAGE);
        return;
      }

      const choice = await this.promptIndexerInstallChoice();
      if (choice === INDEXER_PROMPT_ACTION_NEVER_ASK) {
        await this.disableIndexerInstallPrompt();
        return;
      }
      if (choice !== INDEXER_PROMPT_ACTION_INSTALL) {
        return;
      }
      await this.installIndexerInBackground();
    } catch (err) {
      const message = String(err);
      log(`Indexer install flow failed: ${message}`, LogLevel.WARN);
      vscode.window.showWarningMessage(`Failed to install resource indexer: ${message}`);
    } finally {
      this.indexerInstallCheckInFlight = false;
    }
  }

  /**
   * Listen for changes in resources so we can refresh
   */
  private setupEventListeners(): void {
    // initialize listeners for resource and kubernetes events

    if (this.resourceService) {
      const disp = this.resourceService.onDidChangeResources(summary => {
        this.scheduleRefresh(summary);
      });
      this.disposables.push(disp);
      } else {
        log('No resource service available', LogLevel.DEBUG);
      }

      if (this.k8sClient) {
        try {
          const disp1 = this.k8sClient.onResourceChanged(() => {
            this.scheduleRefresh();
          });
          this.disposables.push(disp1);

          const disp2 = this.k8sClient.onNamespacesChanged(() => {
            this.scheduleRefresh();
          });
          this.disposables.push(disp2);
        } catch (err) {
          log(`Error setting up K8s listeners: ${err}`, LogLevel.ERROR);
        }
      } else {
        log('No Kubernetes client available for event listener', LogLevel.WARN);
      }
  }

  private async loadStreams(): Promise<void> {
    try {
      this.cachedStreamGroups = await this.edaClient.getStreamGroups();
      this.cachedStreamUiCategories = await this.edaClient.getStreamUiCategories();
      const groupList = Object.keys(this.cachedStreamGroups).join(', ');
      log(`Discovered stream groups: ${groupList}`, LogLevel.DEBUG);
      if (this.k8sStreams.length > 0) {
        this.cachedStreamGroups[STREAM_GROUP_KUBERNETES] = this.k8sStreams;
      }
    } catch (err) {
      this.cachedStreamUiCategories = {};
      log(`Failed to load streams: ${err}`, LogLevel.ERROR);
    }
  }

  private getBootstrapNamespaces(): string[] {
    const namespaces = new Set<string>();
    for (const namespace of this.cachedNamespaces) {
      if (typeof namespace === 'string' && namespace.length > 0) {
        namespaces.add(namespace);
      }
    }
    const coreNamespace = this.edaClient.getCoreNamespace();
    if (typeof coreNamespace === 'string' && coreNamespace.length > 0) {
      namespaces.add(coreNamespace);
    }
    return Array.from(namespaces).sort((a, b) => a.localeCompare(b));
  }

  public getNamespaceSelectionOptions(): string[] {
    const namespaces = new Set<string>(this.getBootstrapNamespaces());
    if (this.k8sClient) {
      for (const namespace of this.k8sClient.getCachedNamespaces()) {
        if (namespace) {
          namespaces.add(namespace);
        }
      }
    }
    const coreNamespace = this.edaClient.getCoreNamespace();
    if (coreNamespace) {
      namespaces.delete(coreNamespace);
    }
    return Array.from(namespaces).sort((a, b) => a.localeCompare(b));
  }

  private snapshotResourceCount(snapshot: BootstrapSnapshot): number {
    let count = 0;
    for (const bucket of snapshot.values()) {
      count += bucket.size;
    }
    return count;
  }

  private splitStreamNamespaceKey(key: string): { stream: string; namespace: string } | undefined {
    const separatorIndex = key.indexOf(STREAM_NAMESPACE_SEPARATOR);
    if (separatorIndex <= 0 || separatorIndex >= key.length - 1) {
      return undefined;
    }
    return {
      stream: key.slice(0, separatorIndex),
      namespace: key.slice(separatorIndex + 1)
    };
  }

  private mergeBootstrapSnapshot(snapshot: BootstrapSnapshot): boolean {
    let changed = false;
    let namespacesChanged = false;

    for (const [key, resources] of snapshot.entries()) {
      const parts = this.splitStreamNamespaceKey(key);
      if (!parts) {
        continue;
      }
      const { stream, namespace } = parts;
      const map = this.getOrCreateStreamNamespaceMap(stream, namespace);
      if (this.ensureCachedNamespace(namespace)) {
        namespacesChanged = true;
      }
      for (const [name, resource] of resources.entries()) {
        changed = this.applyIncomingStreamData(map, name, resource) || changed;
      }
    }

    if (namespacesChanged) {
      this.syncNamespacesWithK8s();
    }

    return changed || namespacesChanged;
  }

  private async loadFastResourceBootstrap(): Promise<Set<string>> {
    const namespaces = this.getBootstrapNamespaces();
    if (namespaces.length === 0) {
      return new Set<string>();
    }

    const startedAt = Date.now();
    try {
      let postedSnapshot = false;
      const result = await this.edaClient.fastBootstrapStreamItems(namespaces, {
        excludeStreams: STREAM_SUBSCRIBE_EXCLUDE,
        minimumResources: this.fastBootstrapMinimumResources,
        additionalBatchSize: this.fastBootstrapAdditionalBatchSize,
        onBatchSnapshot: (batchSnapshot) => {
          if (!this.mergeBootstrapSnapshot(batchSnapshot)) {
            return;
          }
          if (!postedSnapshot) {
            postedSnapshot = true;
            this.refresh();
            return;
          }
          this.scheduleStreamRefresh();
        }
      });

      this.namesOnlyBootstrapStreams = new Set(result.namesOnlyStreams);
      if (!postedSnapshot && this.mergeBootstrapSnapshot(result.snapshot)) {
        this.refresh();
      }

      const loadedCount = this.snapshotResourceCount(result.snapshot);
      const availableStreams = this.edaClient.availableBootstrapStreams({
        excludeStreams: STREAM_SUBSCRIBE_EXCLUDE
      });
      const remainingStreams = Math.max(0, availableStreams.length - result.loadedStreams.size);
      const elapsed = (Date.now() - startedAt) / 1000;
      log(
        `Fast resource bootstrap: ${loadedCount} resources in ${elapsed.toFixed(3)}s `
        + `(${result.loadedStreams.size} streams, ${remainingStreams} deferred, `
        + `${result.namesOnlyStreams.size} name-only).`,
        LogLevel.INFO
      );

      return result.loadedStreams;
    } catch (err) {
      log(`Fast resource bootstrap skipped: ${err}`, LogLevel.DEBUG);
      this.namesOnlyBootstrapStreams.clear();
      return new Set<string>();
    }
  }

  private async loadDeferredResourceBootstrap(loadedStreams: Set<string>): Promise<void> {
    if (this.deferredBootstrapInFlight) {
      return;
    }
    this.deferredBootstrapInFlight = true;

    try {
      const namespaces = this.getBootstrapNamespaces();
      if (namespaces.length === 0) {
        return;
      }

      const availableStreams = this.edaClient.availableBootstrapStreams({
        excludeStreams: STREAM_SUBSCRIBE_EXCLUDE
      });
      const remainingStreams = availableStreams.filter((stream) => !loadedStreams.has(stream));
      const streamsToLoad = new Set<string>([
        ...remainingStreams,
        ...Array.from(this.namesOnlyBootstrapStreams)
      ]);
      if (streamsToLoad.size === 0) {
        return;
      }

      const snapshot = await this.edaClient.bootstrapStreamItems(namespaces, {
        excludeStreams: STREAM_SUBSCRIBE_EXCLUDE,
        includeStreams: streamsToLoad
      });

      for (const stream of streamsToLoad) {
        this.namesOnlyBootstrapStreams.delete(stream);
      }

      if (this.mergeBootstrapSnapshot(snapshot)) {
        this.scheduleStreamRefresh();
      }

      log(
        `Deferred resource bootstrap loaded ${this.snapshotResourceCount(snapshot)} resources `
        + `from ${streamsToLoad.size} streams.`,
        LogLevel.DEBUG
      );
    } catch (err) {
      log(`Deferred resource bootstrap skipped: ${err}`, LogLevel.DEBUG);
    } finally {
      this.deferredBootstrapInFlight = false;
    }
  }

  /**
   * Load all Kubernetes namespaces and start watchers for them
   */
  private async initializeKubernetesNamespaces(): Promise<void> {
    if (!this.k8sClient) {
      return;
    }
    try {
      const nsObjs = (await this.k8sClient.listNamespaces()) as K8sResource[];
      const ns = nsObjs
        .map(n => n.metadata?.name)
        .filter((n): n is string => typeof n === 'string');
      const all = Array.from(new Set([...ns, ...this.cachedNamespaces]));
      this.k8sClient.setWatchedNamespaces(all);
    } catch (err) {
      log(`Failed to initialize Kubernetes namespaces: ${err}`, LogLevel.WARN);
    }
  }

  /**
   * Schedule a refresh and collapse multiple events occurring in quick succession.
   */
  private scheduleRefresh(summary?: string): void {
    if (summary) {
      this.pendingSummary = summary;
    }
    if (this.refreshHandle) {
      return;
    }
    this.refreshHandle = setTimeout(() => {
      const msg = this.pendingSummary
        ? `Resource change detected (${this.pendingSummary}), refreshing tree view`
        : 'Resource change detected, refreshing tree view';
      log(msg, LogLevel.DEBUG);
      this.refresh();
      this.pendingSummary = undefined;
      this.refreshHandle = undefined;
    }, this.resourceRefreshIntervalMs);
  }

  /**
   * Refresh the tree view immediately
   */
  public refresh(): void {
      super.refresh();
  }
  /**
   * Set whether all tree items should be expanded
  */
  public setExpandAll(expand: boolean): void {
    const changed = this.expandAll !== expand;
    this.expandAll = expand;
    if (changed) {
      this.refresh();
    }
  }

  /**
   * Set filter text for searching categories/types/instances
  */
  public setTreeFilter(filterText: string): void {
    log(`Tree filter set to: "${filterText}"`, LogLevel.INFO);
    super.setTreeFilter(filterText);
  }

  /**
   * Clear the filter text
   */
  public clearTreeFilter(): void {
    log(`Clearing tree filter`, LogLevel.INFO);
    super.clearTreeFilter();
  }

  /**
   * Determine if a stream should be shown based on the current filter.
   * Matches on the stream name or any of its items.
   */
  private streamMatches(namespace: string, stream: string): boolean {
    if (!this.treeFilter) {
      return true;
    }
    if (this.matchesFilter(stream)) {
      return true;
    }
    if (this.k8sStreams.includes(stream)) {
      const items = (this.k8sClient?.getCachedResource(stream, this.k8sClient?.isNamespacedResource(stream) ? namespace : undefined) || []) as K8sResource[];
      return items.some(r => this.matchesFilter(r.metadata?.name || ''));
    }
    const key = `${stream}:${namespace}`;
    const map = this.streamData.get(key);
    if (!map) {
      return false;
    }
    for (const name of Array.from(map.keys())) {
      if (this.matchesFilter(name)) {
        return true;
      }
    }
    return false;
  }

  /** Determine if a Kubernetes namespace should be shown based on the current filter */
  private kubernetesNamespaceMatches(namespace: string): boolean {
    if (!this.k8sClient) {
      return false;
    }
    if (!this.treeFilter) {
      return true;
    }
    if (this.matchesFilter(namespace)) {
      return true;
    }
    for (const stream of this.k8sStreams) {
      if (!this.streamHasData(namespace, stream)) {
        continue;
      }
      if (this.streamMatches(namespace, stream)) {
        return true;
      }
    }
    return false;
  }

  private kubernetesRootMatches(): boolean {
    if (!this.k8sClient) {
      return false;
    }
    for (const ns of this.getSelectedKubernetesNamespaces()) {
      if (this.kubernetesNamespaceMatches(ns)) {
        return true;
      }
    }
    return false;
  }

  /** Check if a stream currently has any child items */
  private streamHasData(namespace: string, stream: string): boolean {
    if (this.k8sStreams.includes(stream)) {
      const items = this.k8sClient?.getCachedResource(stream, this.k8sClient?.isNamespacedResource(stream) ? namespace : undefined) || [];
      return items.length > 0;
    }
    const map = this.streamData.get(`${stream}:${namespace}`);
    return !!map && map.size > 0;
  }

  private streamHasDataInAnyNamespace(stream: string): boolean {
    for (const namespace of this.getSelectedBootstrapNamespaces()) {
      if (this.streamHasData(namespace, stream)) {
        return true;
      }
    }
    return false;
  }

  private streamMatchesAcrossNamespaces(stream: string, category?: string): boolean {
    if (!this.treeFilter) {
      return true;
    }
    if (this.matchesFilter(stream)) {
      return true;
    }
    if (category && this.matchesFilter(category)) {
      return true;
    }
    for (const namespace of this.getSelectedBootstrapNamespaces()) {
      if (!this.streamHasData(namespace, stream)) {
        continue;
      }
      if (this.streamMatches(namespace, stream)) {
        return true;
      }
    }
    return false;
  }

  private getEffectiveStreamCategory(group: string, stream: string): string {
    const configured = this.cachedStreamUiCategories[stream];
    const category = typeof configured === 'string' ? configured.trim() : '';
    if (category.length > 0) {
      return category;
    }
    return group;
  }

  private getEdaStreamsByCategory(): Record<string, string[]> {
    const byCategory = new Map<string, Set<string>>();
    const groups = Object.keys(this.cachedStreamGroups)
      .filter(group => group !== STREAM_GROUP_KUBERNETES)
      .sort();

    for (const group of groups) {
      const streams = (this.cachedStreamGroups[group] || []).slice().sort();
      for (const stream of streams) {
        if (!this.streamHasDataInAnyNamespace(stream)) {
          continue;
        }
        const category = this.getEffectiveStreamCategory(group, stream);
        if (!byCategory.has(category)) {
          byCategory.set(category, new Set<string>());
        }
        byCategory.get(category)?.add(stream);
      }
    }

    const out: Record<string, string[]> = {};
    for (const [category, streams] of Array.from(byCategory.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      out[category] = Array.from(streams).sort((a, b) => a.localeCompare(b));
    }
    return out;
  }

  private categoryMatches(category: string, streams: string[]): boolean {
    if (!this.treeFilter) {
      return true;
    }
    if (this.matchesFilter(category)) {
      return true;
    }
    for (const stream of streams) {
      if (this.streamMatchesAcrossNamespaces(stream, category)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Implementation of TreeDataProvider: get a tree item
   */
  getTreeItem(element: TreeItemBase): vscode.TreeItem {
    return element;
  }

  /**
   * Implementation of TreeDataProvider: get children
   */
  getChildren(element?: TreeItemBase): TreeItemBase[] {
    if (!element) {
      const items = this.getResourceCategories();
      const kRoot = this.getKubernetesRoot();
      if (kRoot) {
        items.push(kRoot);
      }
      return items;
    } else if (element.contextValue === CONTEXT_RESOURCE_CATEGORY) {
      return this.getStreamsForCategory(element.label as string);
    } else if (element.contextValue === 'k8s-root') {
      return this.getKubernetesNamespaces();
    } else if (element.contextValue === CONTEXT_K8S_NAMESPACE) {
      return this.getKubernetesStreams(element.label as string);
    } else if (element.contextValue === 'stream') {
      if (element.streamGroup === STREAM_GROUP_KUBERNETES && typeof element.namespace === 'string') {
        return this.getItemsForStream(element.namespace, element.label as string, element.streamGroup);
      }
      return this.getEdaStreamItems(element.label as string, element.streamGroup);
    }
    return [];
  }

  /**
   * Implementation of TreeDataProvider: gets the parent of a tree item
   */
  getParent(element: TreeItemBase): vscode.ProviderResult<TreeItemBase> {
    if (element.contextValue === CONTEXT_RESOURCE_CATEGORY || element.contextValue === 'message' || element.contextValue === 'k8s-root') {
      return null;
    } else if (element.contextValue === CONTEXT_K8S_NAMESPACE) {
      return this.getKubernetesRoot();
    } else if (element.contextValue === 'stream') {
      const group = element.streamGroup ?? '';
      if (group === STREAM_GROUP_KUBERNETES) {
        const namespaces = this.getKubernetesNamespaces();
        return namespaces.find(ns => ns.label === element.namespace);
      }
      const categories = this.getResourceCategories();
      return categories.find(category => category.label === group);
    } else if (element.contextValue === CONTEXT_STREAM_ITEM) {
      const group = element.streamGroup ?? '';
      if (group === STREAM_GROUP_KUBERNETES) {
        const streamItems = this.getKubernetesStreams(element.namespace!);
        return streamItems.find(s => s.label === element.resourceType);
      }
      const streamItems = this.getStreamsForCategory(group);
      return streamItems.find(s => s.label === element.resourceType);
    }
    return null;
  }

  private createResourceCategoryNodeId(category: string): string {
    return `resource-category:${encodeURIComponent(category)}`;
  }

  private createKubernetesRootNodeId(): string {
    return 'k8s-root';
  }

  private createKubernetesNamespaceNodeId(namespace: string): string {
    return `k8s-namespace:${encodeURIComponent(namespace)}`;
  }

  private createEdaStreamNodeId(category: string, stream: string): string {
    return `stream:${encodeURIComponent(category)}/${encodeURIComponent(stream)}`;
  }

  private createStreamNodeId(namespace: string, group: string, stream: string): string {
    return `stream:${encodeURIComponent(namespace)}/${encodeURIComponent(group)}/${encodeURIComponent(stream)}`;
  }

  private createStreamItemNodeId(
    namespace: string,
    stream: string,
    streamGroup: string | undefined,
    resource: K8sResource,
    name: string
  ): string {
    const identity = resource.metadata?.uid
      ?? `${resource.apiVersion ?? ''}|${resource.kind ?? ''}|${resource.metadata?.name ?? name}`;
    const group = streamGroup ?? '';
    return `stream-item:${encodeURIComponent(namespace)}/${encodeURIComponent(group)}/${encodeURIComponent(stream)}/${encodeURIComponent(identity)}`;
  }

  private getResourceCategories(): TreeItemBase[] {
    const byCategory = this.getEdaStreamsByCategory();
    const categories = Object.keys(byCategory).sort((a, b) => a.localeCompare(b));
    if (categories.length === 0) {
      const item = new TreeItemBase('No streams found', vscode.TreeItemCollapsibleState.None, 'message');
      item.iconPath = new vscode.ThemeIcon('info');
      return [item];
    }

    const items: TreeItemBase[] = [];
    for (const category of categories) {
      const streams = byCategory[category] || [];
      if (!this.categoryMatches(category, streams)) {
        continue;
      }
      const item = new TreeItemBase(
        category,
        this.expandAll
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
        CONTEXT_RESOURCE_CATEGORY
      );
      item.id = this.createResourceCategoryNodeId(category);
      item.iconPath = new vscode.ThemeIcon('folder-library');
      item.streamGroup = category;
      item.resourceCategory = category;
      items.push(item);
    }

    return items;
  }

  private getKubernetesRoot(): TreeItemBase | undefined {
    if (!this.k8sClient) {
      return undefined;
    }
    if (this.treeFilter && !this.kubernetesRootMatches()) {
      return undefined;
    }
    const item = new TreeItemBase(
      'Kubernetes',
      this.expandAll
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
      'k8s-root'
    );
    item.id = this.createKubernetesRootNodeId();
    item.iconPath = this.kubernetesIcon;
    return item;
  }

  private getKubernetesNamespaces(): TreeItemBase[] {
    if (!this.k8sClient) {
      return [];
    }
    const namespaces = this.getSelectedKubernetesNamespaces();
    if (namespaces.length === 0) {
      const msgItem = new TreeItemBase(
        'No Kubernetes namespaces found',
        vscode.TreeItemCollapsibleState.None,
        'message'
      );
      msgItem.iconPath = new vscode.ThemeIcon('warning');
      return [msgItem];
    }
    const items: TreeItemBase[] = [];
    for (const ns of namespaces) {
      if (!this.kubernetesNamespaceMatches(ns)) {
        continue;
      }
      const item = new TreeItemBase(
        ns,
        this.expandAll
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
        CONTEXT_K8S_NAMESPACE
      );
      item.iconPath = this.kubernetesIcon;
      item.namespace = ns;
      item.id = this.createKubernetesNamespaceNodeId(ns);
      items.push(item);
    }
    return items;
  }

  private getKubernetesStreams(namespace: string): TreeItemBase[] {
    return this.getStreamsForGroup(namespace, STREAM_GROUP_KUBERNETES);
  }

  private createEdaStreamTreeItem(category: string, stream: string): TreeItemBase {
    const key = this.createEdaStreamNodeId(category, stream);
    const isExpanded = this.expandAll || this.expandedStreams.has(key);
    const collapsible = isExpanded
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed;
    const ti = new TreeItemBase(stream, collapsible, 'stream');
    ti.id = key;
    ti.iconPath = isExpanded ? this.expandedStreamIcon : this.collapsedStreamIcon;
    ti.streamGroup = category;
    ti.resourceCategory = category;
    return ti;
  }

  private getStreamsForCategory(category: string): TreeItemBase[] {
    const byCategory = this.getEdaStreamsByCategory();
    const streams = byCategory[category] || [];
    const categoryMatched = !!this.treeFilter && this.matchesFilter(category);
    const items: TreeItemBase[] = [];
    for (const stream of streams) {
      if (!categoryMatched && !this.streamMatchesAcrossNamespaces(stream, category)) {
        continue;
      }
      items.push(this.createEdaStreamTreeItem(category, stream));
    }
    return items;
  }

  /** Get stream items under a group */
  private getStreamsForGroup(namespace: string, group: string): TreeItemBase[] {
    const streams = (this.cachedStreamGroups[group] || []).slice().sort();
    const items: TreeItemBase[] = [];
    for (const s of streams) {
      if (!this.streamHasData(namespace, s)) {
        continue;
      }
      if (this.treeFilter && !this.streamMatches(namespace, s)) {
        continue;
      }
      const key = this.createStreamNodeId(namespace, group, s);
      const isExpanded = this.expandAll || this.expandedStreams.has(key);
      const collapsible = isExpanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
      const ti = new TreeItemBase(s, collapsible, 'stream');
      ti.id = key;
      ti.iconPath = isExpanded ? this.expandedStreamIcon : this.collapsedStreamIcon;
      ti.namespace = namespace;
      ti.streamGroup = group;
      items.push(ti);
    }

    return items;
  }

  private ensureCachedNamespace(namespace: string): boolean {
    if (this.cachedNamespaces.includes(namespace)) {
      return false;
    }
    this.cachedNamespaces.push(namespace);
    return true;
  }

  private getOrCreateStreamNamespaceMap(stream: string, namespace: string): Map<string, K8sResource> {
    const key = `${stream}:${namespace}`;
    const existing = this.streamData.get(key);
    if (existing) {
      return existing;
    }

    const created = new Map<string, K8sResource>();
    this.streamData.set(key, created);
    return created;
  }

  private applyIncomingStreamData(
    map: Map<string, K8sResource>,
    name: string,
    data: K8sResource | null | undefined
  ): boolean {
    if (data === null) {
      return map.delete(name);
    }
    if (!data) {
      return false;
    }

    const existing = map.get(name);
    if (!this.shouldUpdateResource(existing, data)) {
      return false;
    }
    map.set(name, data);
    return true;
  }

  private processSingleStreamUpdate(
    stream: string,
    up: StreamUpdate
  ): { changed: boolean; namespaceAdded: boolean } {
    const { name, namespace } = this.extractNames(up);
    if (!namespace || !name) {
      return { changed: false, namespaceAdded: false };
    }

    const namespaceAdded = this.ensureCachedNamespace(namespace);
    const map = this.getOrCreateStreamNamespaceMap(stream, namespace);
    const changed = this.applyIncomingStreamData(map, name, up.data);
    return { changed, namespaceAdded };
  }

  /** Handle incoming stream messages and cache items */
  private processStreamMessage(stream: string, msg: StreamMessageEnvelope): void {
    const updates = getUpdates(msg.msg) as StreamUpdate[];
    if (updates.length === 0) {
      log(`[STREAM:${stream}] No updates in message`, LogLevel.DEBUG);
      return;
    }
    log(`[STREAM:${stream}] Processing ${updates.length} updates`, LogLevel.DEBUG);
    let changed = false;
    let namespacesChanged = false;
    for (const up of updates) {
      const result = this.processSingleStreamUpdate(stream, up);
      changed = changed || result.changed;
      namespacesChanged = namespacesChanged || result.namespaceAdded;
    }
    if (namespacesChanged) {
      this.syncNamespacesWithK8s();
    }
    if (changed || namespacesChanged) {
      this.scheduleStreamRefresh();
    }
  }

  /** Extract namespace name from an update object */
  private extractNamespaceName(up: StreamUpdate): string | undefined {
    const data = up.data;
    let name: string | undefined = data?.metadata?.name ?? (data?.name as string | undefined);
    if (!name && up.key) {
      name = parseUpdateKey(String(up.key)).name;
    }
    return name;
  }

  /** Process a single namespace update, returns true if changed */
  private processSingleNamespaceUpdate(up: StreamUpdate): boolean {
    const name = this.extractNamespaceName(up);
    if (!name) {
      return false;
    }
    if (up.data === null) {
      const idx = this.cachedNamespaces.indexOf(name);
      if (idx !== -1) {
        this.cachedNamespaces.splice(idx, 1);
        return true;
      }
    } else if (!this.cachedNamespaces.includes(name)) {
      this.cachedNamespaces.push(name);
      return true;
    }
    return false;
  }

  /** Synchronize namespace cache with Kubernetes client */
  private syncNamespacesWithK8s(): void {
    this.edaClient.setCachedNamespaces(this.cachedNamespaces);
    if (this.k8sClient) {
      const existing = this.k8sClient.getCachedNamespaces();
      const all = Array.from(new Set([...existing, ...this.cachedNamespaces]));
      this.k8sClient.setWatchedNamespaces(all);
    }
  }

  /** Update cached namespaces from stream messages */
  private handleNamespaceMessage(msg: StreamMessageEnvelope): void {
    const updates = getUpdates(msg.msg) as StreamUpdate[];
    if (updates.length === 0) {
      return;
    }
    let changed = false;
    for (const up of updates) {
      if (this.processSingleNamespaceUpdate(up)) {
        changed = true;
      }
    }
    if (changed) {
      this.syncNamespacesWithK8s();
      this.scheduleStreamRefresh();
    }
  }

  private scheduleStreamRefresh(): void {
    this.pendingStreamRefresh = true;
    if (this.streamRefreshHandle) {
      return;
    }
    this.streamRefreshHandle = setTimeout(() => {
      this.streamRefreshHandle = undefined;
      if (!this.pendingStreamRefresh) {
        return;
      }
      this.pendingStreamRefresh = false;
      this.refresh();
    }, this.streamRefreshIntervalMs);
  }

  private shouldUpdateResource(existing: K8sResource | undefined, incoming: K8sResource): boolean {
    if (!existing) {
      return true;
    }
    const existingUid = existing.metadata?.uid;
    const incomingUid = incoming.metadata?.uid;
    if (existingUid && incomingUid && existingUid !== incomingUid) {
      return true;
    }
    const existingVersion = existing.metadata?.resourceVersion;
    const incomingVersion = incoming.metadata?.resourceVersion;
    if (existingVersion && incomingVersion) {
      return existingVersion !== incomingVersion;
    }
    if (existingVersion || incomingVersion) {
      return true;
    }
    return true;
  }

  /** Extract name and namespace from a stream update */
  private extractNames(update: StreamUpdate): { name?: string; namespace?: string } {
    let name: string | undefined = update.data?.metadata?.name;
    let namespace: string | undefined = update.data?.metadata?.namespace;
    if ((!name || !namespace) && update.key) {
      const parsed = parseUpdateKey(String(update.key));
      if (!name) {
        name = parsed.name;
      }
      if (!namespace) {
        namespace = parsed.namespace;
      }
    }
    return { name, namespace };
  }

  /** Create an empty items placeholder */
  private createNoItemsPlaceholder(): TreeItemBase {
    const item = new TreeItemBase('No Items', vscode.TreeItemCollapsibleState.None, 'message');
    item.iconPath = new vscode.ThemeIcon('info');
    return item;
  }

  /** Check if parent item matched filter */
  private isParentFilterMatched(stream: string, streamGroup?: string): boolean {
    return !!this.treeFilter && (this.matchesFilter(stream) || (!!streamGroup && this.matchesFilter(streamGroup)));
  }

  /** Get the context value for a stream item based on stream type */
  private getStreamItemContextValue(stream: string): string {
    if (stream === 'pods') {
      return 'pod';
    }
    if (stream === 'deployments') {
      return 'k8s-deployment-instance';
    }
    if (stream === 'toponodes') {
      return 'toponode';
    }
    return CONTEXT_STREAM_ITEM;
  }

  /** Apply status styling to a tree item */
  private applyStatusStyling(ti: TreeItemBase, resource: K8sResource): void {
    if (!resource || !this.statusService) {
      return;
    }
    const indicator = this.statusService.getResourceStatusIndicator(resource);
    const desc = this.statusService.getStatusDescription(resource);
    ti.iconPath = this.statusService.getStatusIcon(indicator);
    ti.description = desc;
    ti.tooltip = this.statusService.getResourceTooltip(resource);
    ti.status = { indicator, description: desc };

    // Mark derived resources with a special icon but keep status color
    if (resource.metadata?.labels?.['eda.nokia.com/source'] === 'derived') {
      const color = this.statusService.getThemeStatusIcon(indicator).color;
      ti.iconPath = new vscode.ThemeIcon('debug-breakpoint-data-unverified', color);
    }
  }

  /** Create a tree item for a resource */
  private createResourceTreeItem(
    name: string,
    resource: K8sResource,
    namespace: string,
    stream: string,
    streamGroup?: string
  ): TreeItemBase {
    const ti = new TreeItemBase(name, vscode.TreeItemCollapsibleState.None, CONTEXT_STREAM_ITEM, resource);
    ti.id = this.createStreamItemNodeId(namespace, stream, streamGroup, resource, name);
    ti.contextValue = this.getStreamItemContextValue(stream);
    ti.namespace = namespace;
    ti.resourceType = stream;
    ti.streamGroup = streamGroup;
    ti.command = {
      command: 'vscode-eda.viewStreamItem',
      title: 'View Stream Item',
      arguments: [ti.getCommandArguments()]
    };
    this.applyStatusStyling(ti, resource);
    return ti;
  }

  /** Build items for Kubernetes stream */
  private getKubernetesStreamItems(namespace: string, stream: string, streamGroup: string): TreeItemBase[] {
    const items = (this.k8sClient?.getCachedResource(stream, this.k8sClient?.isNamespacedResource(stream) ? namespace : undefined) || []) as K8sResource[];
    if (items.length === 0) {
      return [this.createNoItemsPlaceholder()];
    }
    const out: TreeItemBase[] = [];
    const parentMatched = this.isParentFilterMatched(stream, streamGroup);
    for (const resource of items) {
      // Kubernetes watch bookmarks can include an "initial-events-end" marker object
      // without resource identity; skip these synthetic entries.
      if (resource.metadata?.annotations?.['k8s.io/initial-events-end'] === 'true') {
        continue;
      }
      const name = resource.metadata?.name;
      if (!name) {
        log(`Resource in stream ${stream} missing name: ${JSON.stringify(resource).slice(0, 200)}`, LogLevel.DEBUG);
        continue;
      }
      if (!parentMatched && this.treeFilter && !this.matchesFilter(name)) {
        continue;
      }
      out.push(this.createResourceTreeItem(name, resource, namespace, stream, streamGroup));
    }
    return out;
  }

  /** Build items for EDA stream */
  private getEdaStreamItems(stream: string, streamGroup?: string): TreeItemBase[] {
    const entries: Array<{ namespace: string; name: string; resource: K8sResource }> = [];
    for (const namespace of this.getSelectedBootstrapNamespaces()) {
      const key = `${stream}:${namespace}`;
      const map = this.streamData.get(key);
      if (!map || map.size === 0) {
        continue;
      }
      for (const [name, resource] of map.entries()) {
        const resourceNamespace = typeof resource.metadata?.namespace === 'string' && resource.metadata.namespace.length > 0
          ? resource.metadata.namespace
          : namespace;
        entries.push({
          namespace: resourceNamespace,
          name,
          resource
        });
      }
    }

    if (entries.length === 0) {
      return [this.createNoItemsPlaceholder()];
    }

    const items: TreeItemBase[] = [];
    const parentMatched = this.isParentFilterMatched(stream, streamGroup);
    entries.sort((a, b) => {
      const namespaceCompare = a.namespace.localeCompare(b.namespace);
      if (namespaceCompare !== 0) {
        return namespaceCompare;
      }
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      const displayName = `${entry.namespace}/${entry.name}`;
      if (!parentMatched
        && this.treeFilter
        && !this.matchesFilter(entry.name)
        && !this.matchesFilter(displayName)) {
        continue;
      }
      items.push(
        this.createResourceTreeItem(
          displayName,
          entry.resource,
          entry.namespace,
          stream,
          streamGroup
        )
      );
    }
    return items.length > 0 ? items : [this.createNoItemsPlaceholder()];
  }

  /** Build items for a specific stream */
  private getItemsForStream(namespace: string, stream: string, streamGroup?: string): TreeItemBase[] {
    if (streamGroup === STREAM_GROUP_KUBERNETES) {
      return this.getKubernetesStreamItems(namespace, stream, streamGroup);
    }
    return this.getEdaStreamItems(stream, streamGroup);
  }

  private getSelectedBootstrapNamespaces(): string[] {
    const namespaces = this.getBootstrapNamespaces();
    if (this.selectedNamespace === ALL_NAMESPACES) {
      return namespaces;
    }
    return namespaces.includes(this.selectedNamespace) ? [this.selectedNamespace] : [];
  }

  private getSelectedKubernetesNamespaces(): string[] {
    if (!this.k8sClient) {
      return [];
    }
    const namespaces = this.k8sClient.getCachedNamespaces().slice().sort();
    if (this.selectedNamespace === ALL_NAMESPACES) {
      return namespaces;
    }
    return namespaces.filter(namespace => namespace === this.selectedNamespace);
  }

  public dispose(): void {
    if (this.refreshHandle) {
      clearTimeout(this.refreshHandle);
      this.refreshHandle = undefined;
    }
    if (this.streamRefreshHandle) {
      clearTimeout(this.streamRefreshHandle);
      this.streamRefreshHandle = undefined;
    }
    if (this.k8sInitializationHandle) {
      clearTimeout(this.k8sInitializationHandle);
      this.k8sInitializationHandle = undefined;
    }
    this.pendingStreamRefresh = false;
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        // ignore
      }
    }
    this.disposables = [];
  }
}

/**
 * Simple helper for array equality (shallow).
 */
