/* eslint-disable import-x/max-dependencies -- Extension entry point requires many imports */
import * as vscode from 'vscode';

import { KubernetesClient } from './clients/kubernetesClient';
import { EdaClient } from './clients/edaClient';
import { serviceManager } from './services/serviceManager';
import { ResourceService } from './services/resourceService';
import { ResourceStatusService } from './services/resourceStatusService';
import { EdaNamespaceProvider } from './providers/views/namespaceProvider';
import { EdaAlarmProvider } from './providers/views/alarmProvider';
import { EdaDeviationProvider } from './providers/views/deviationProvider';
import { TransactionBasketProvider } from './providers/views/transactionBasketProvider';
import { EdaTransactionProvider } from './providers/views/transactionProvider';
import { DashboardProvider } from './providers/views/dashboardProvider';
import { HelpProvider } from './providers/views/helpProvider';
import { DeviationDetailsDocumentProvider } from './providers/documents/deviationDetailsProvider';
import { BasketTransactionDocumentProvider } from './providers/documents/basketTransactionProvider';
import { BasketEditDocumentProvider } from './providers/documents/basketEditProvider';
import { CrdDefinitionFileSystemProvider } from './providers/documents/crdDefinitionProvider';
import { ResourceEditDocumentProvider } from './providers/documents/resourceEditProvider';
import { ResourceViewDocumentProvider } from './providers/documents/resourceViewProvider';
import { SchemaProviderService } from './services/schemaProviderService';
import { PodDescribeDocumentProvider } from './providers/documents/podDescribeProvider';
import { registerPodCommands } from './commands/podCommands';
import { registerDeploymentCommands } from './commands/deploymentCommands';
import { registerNodeConfigCommands } from './commands/nodeConfigCommands';
import { registerTopoNodeCommands } from './commands/toponodeCommands';
import { registerResourceViewCommands } from './commands/resourceViewCommands';
import { registerDeviationCommands } from './commands/deviationCommands';
import { registerTransactionCommands } from './commands/transactionCommands';
import { registerBasketCommands } from './commands/basketCommands';
import { registerViewCommands } from './commands/viewCommands';
import { registerResourceEditCommands } from './commands/resourceEditCommands';
import { registerResourceCreateCommand } from './commands/resourceCreateCommand';
import { registerCredentialCommands } from './commands/credentialCommands';
import { registerResourceDeleteCommand } from './commands/resourceDeleteCommand';
import { registerDashboardCommands } from './commands/dashboardCommands';
import { registerApplyYamlFileCommand } from './commands/applyYamlFileCommand';
import { registerResourceBrowserCommand } from './commands/resourceBrowserCommand';
import { EdaExplorerViewProvider } from './webviews/explorer/edaExplorerViewProvider';
import { setAuthLogger } from './clients/edaAuthClient';

export interface EdaTargetConfig {
  context?: string;
  edaUsername?: string;
  edaPassword?: string;
  skipTlsVerify?: boolean;
  coreNamespace?: string;
  kcUsername?: string;
  kcPassword?: string;
}

export type EdaTargetValue = string | EdaTargetConfig | undefined;


export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export function parseLogLevel(value: unknown): LogLevel {
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'debug':
        return LogLevel.DEBUG;
      case 'info':
        return LogLevel.INFO;
      case 'warn':
      case 'warning':
        return LogLevel.WARN;
      case 'error':
        return LogLevel.ERROR;
      default:
        return LogLevel.INFO;
    }
  }
  if (typeof value === 'number') {
    return value in LogLevel ? (value as LogLevel) : LogLevel.INFO;
  }
  return LogLevel.INFO;
}

export let edaDeviationProvider: EdaDeviationProvider;
export let edaTransactionBasketProvider: TransactionBasketProvider;
export let edaTransactionProvider: EdaTransactionProvider;
export let deviationDetailsProvider: DeviationDetailsDocumentProvider;
export let basketTransactionProvider: BasketTransactionDocumentProvider;
export let basketEditProvider: BasketEditDocumentProvider;
export let resourceViewProvider: ResourceViewDocumentProvider;
export let resourceEditProvider: ResourceEditDocumentProvider;
export let podDescribeProvider: PodDescribeDocumentProvider;
export let edaOutputChannel: vscode.OutputChannel;
export let currentLogLevel: LogLevel = LogLevel.INFO;
let contextStatusBarItem: vscode.StatusBarItem;

interface TargetConfigResult {
  edaUrl: string;
  edaContext: string | undefined;
  edaUsername: string;
  skipTlsVerify: boolean;
  coreNamespace: string;
  kcUsername: string | undefined;
  kcPassword: string | undefined;
  edaPasswordFromSettings: string | undefined;
  clientId: string;
}

function getHostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function loadTargetConfig(
  config: vscode.WorkspaceConfiguration,
  targetEntries: [string, EdaTargetValue][],
  selectedIndex: number
): TargetConfigResult {
  const idx = Math.min(selectedIndex, targetEntries.length - 1);
  const [url, val] = targetEntries[idx];

  const edaUrl = url;
  let edaContext: string | undefined;
  let skipTlsVerify = process.env.EDA_SKIP_TLS_VERIFY === 'true';
  let coreNamespace = process.env.EDA_CORE_NAMESPACE || 'eda-system';
  let edaUsername = config.get<string>('edaUsername', 'admin');
  let kcUsername: string | undefined;
  let kcPassword: string | undefined;
  let edaPasswordFromSettings: string | undefined;

  if (typeof val === 'string') {
    edaContext = val || undefined;
  } else if (val) {
    edaContext = val.context || undefined;
    if (val.edaUsername) {
      edaUsername = val.edaUsername;
    }
    if (val.skipTlsVerify !== undefined) {
      skipTlsVerify = val.skipTlsVerify;
    }
    if (val.coreNamespace) {
      coreNamespace = val.coreNamespace;
    }
    kcUsername = val.kcUsername;
    kcPassword = val.kcPassword;
    edaPasswordFromSettings = val.edaPassword;
  }

  return {
    edaUrl,
    edaContext,
    edaUsername,
    skipTlsVerify,
    coreNamespace,
    kcUsername,
    kcPassword,
    edaPasswordFromSettings,
    clientId: config.get<string>('clientId', 'eda')
  };
}

async function loadCredentials(
  context: vscode.ExtensionContext,
  hostKey: string,
  edaUrl: string,
  edaPasswordFromSettings: string | undefined,
  kcUsername: string | undefined,
  kcPassword: string | undefined
): Promise<{ edaPassword: string; clientSecret: string }> {
  let edaPassword = await context.secrets.get(`edaPassword:${hostKey}`) || '';
  let clientSecret = await context.secrets.get(`clientSecret:${hostKey}`) || '';

  if (!edaPassword && edaPasswordFromSettings) {
    edaPassword = edaPasswordFromSettings;
    await context.secrets.store(`edaPassword:${hostKey}`, edaPassword);
  }

  if (!clientSecret && kcUsername && kcPassword) {
    try {
      const { fetchClientSecretDirectly } = await import('./services/clientSecretService');
      clientSecret = await fetchClientSecretDirectly(edaUrl, kcUsername, kcPassword);
      if (clientSecret) {
        await context.secrets.store(`clientSecret:${hostKey}`, clientSecret);
      }
    } catch (error) {
      log(`Failed to fetch client secret: ${error}`, LogLevel.ERROR, true);
    }
  }

  return { edaPassword, clientSecret };
}

async function configureTargetsFromWizard(context: vscode.ExtensionContext): Promise<void> {
  const { configureTargets } = await import('./webviews/targetWizard/targetWizardPanel');
  await configureTargets(context);
}

function initializeEmbeddingSearchInBackground(): void {
  void import('./services/embeddingSearchService').then(({ EmbeddingSearchService }) => {
    return EmbeddingSearchService.getInstance().initialize();
  }).catch(error => {
    log(`Failed to initialize embeddingsearch: ${error}`, LogLevel.ERROR);
  });
}

function createStatusBarItem(context: vscode.ExtensionContext): vscode.StatusBarItem {
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = 'vscode-eda.switchContext';
  statusBarItem.tooltip = 'Switch the current EDA API URL and Kubernetes context';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
  return statusBarItem;
}

function registerSwitchContextCommand(
  context: vscode.ExtensionContext,
  config: vscode.WorkspaceConfiguration
): void {
  const switchCmd = vscode.commands.registerCommand('vscode-eda.switchContext', async () => {
    const targetsMap = config.get<Record<string, string | EdaTargetConfig | undefined>>('edaTargets') || {};
    const entries = Object.entries(targetsMap);
    if (entries.length === 0) {
      vscode.window.showInformationMessage('No EDA targets configured.');
      return;
    }
    const items = entries.map(([url, val], i) => {
      const ctx = typeof val === 'string' ? val : val?.context;
      return {
        label: url,
        description: ctx ? `context: ${ctx}` : 'no kubernetes',
        index: i
      };
    });

    const choice = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select the EDA API URL and optional context'
    });
    if (!choice) {
      return;
    }

    await context.globalState.update('selectedEdaTarget', choice.index);
    if (contextStatusBarItem) {
      const ctxVal = entries[choice.index][1];
      const ctx = typeof ctxVal === 'string' ? ctxVal : ctxVal?.context;
      const host = getHostFromUrl(entries[choice.index][0]);
      const ctxText = ctx ? ` (${ctx})` : '';
      contextStatusBarItem.text = `$(server) ${host}${ctxText}`;
    }

    vscode.window.showInformationMessage('EDA target updated. Reload window to apply.', 'Reload').then(value => {
      if (value === 'Reload') {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    });
  });
  context.subscriptions.push(switchCmd);
}

function setupYamlContextDetection(context: vscode.ExtensionContext): void {
  const updateYamlContext = (editor?: vscode.TextEditor) => {
    if (!editor) {
      vscode.commands.executeCommand('setContext', 'edaYamlDocument', false);
      return;
    }
    const doc = editor.document;
    if (doc.languageId !== 'yaml') {
      vscode.commands.executeCommand('setContext', 'edaYamlDocument', false);
      return;
    }
    const maxLine = Math.min(50, doc.lineCount);
    const text = doc.getText(new vscode.Range(0, 0, maxLine, 0));
    const isEdaYaml = /apiVersion:\s*\S*eda\.nokia\.com/.test(text);
    vscode.commands.executeCommand('setContext', 'edaYamlDocument', isEdaYaml);
  };

  updateYamlContext(vscode.window.activeTextEditor);
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateYamlContext));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => {
    if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) {
      updateYamlContext(vscode.window.activeTextEditor);
    }
  }));
}

interface ServiceConfig {
  edaUrl: string;
  edaContext: string | undefined;
  edaUsername: string;
  edaPassword: string;
  clientId: string;
  clientSecret: string;
  skipTlsVerify: boolean;
  coreNamespace: string;
  activationStartMs?: number;
}

async function initializeServiceArchitecture(
  context: vscode.ExtensionContext,
  config: ServiceConfig
): Promise<void> {
  const {
    edaUrl,
    edaContext,
    edaUsername,
    edaPassword,
    clientId,
    clientSecret,
    skipTlsVerify,
    coreNamespace,
    activationStartMs
  } = config;

  // 1) Create the clients
  const k8sClient = edaContext ? new KubernetesClient(edaContext) : undefined;
  const edaClient = new EdaClient(edaUrl, {
    clientId,
    clientSecret,
    edaUsername,
    edaPassword,
    skipTlsVerify,
    coreNamespace
  });

  // 2) Register clients FIRST - before any providers are created
  serviceManager.registerClient('eda', edaClient);
  if (k8sClient) {
    serviceManager.registerClient('kubernetes', k8sClient);
  }

  // 3) Switch context if needed
  if (k8sClient && edaContext) {
    k8sClient.switchContext(edaContext);
  }

  // 4) Update status bar
  if (contextStatusBarItem) {
    const host = getHostFromUrl(edaUrl);
    const ctxText = edaContext ? ` (${edaContext})` : '';
    contextStatusBarItem.text = `$(server) ${host}${ctxText}`;
  }

  // 5) Register services
  const resourceStatusService = new ResourceStatusService();
  serviceManager.registerService('resource-status', resourceStatusService);
  resourceStatusService.initialize(context);

  if (k8sClient) {
    const resourceService = new ResourceService(k8sClient);
    serviceManager.registerService('kubernetes-resources', resourceService);
  }

  // 6) Register file system providers
  resourceViewProvider = new ResourceViewDocumentProvider();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('k8s-view', resourceViewProvider, { isCaseSensitive: true })
  );

  resourceEditProvider = new ResourceEditDocumentProvider();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('k8s', resourceEditProvider, { isCaseSensitive: true })
  );

  registerResourceCreateCommand(context, resourceEditProvider);
  registerResourceEditCommands(context, resourceEditProvider, resourceViewProvider);
  registerResourceViewCommands(context, resourceViewProvider);
  registerNodeConfigCommands(context);

  if (k8sClient) {
    podDescribeProvider = new PodDescribeDocumentProvider();
    context.subscriptions.push(
      vscode.workspace.registerFileSystemProvider('k8s-describe', podDescribeProvider, { isCaseSensitive: true })
    );
    registerPodCommands(context, podDescribeProvider);
    registerDeploymentCommands(context);
    registerTopoNodeCommands(context);
  }

  registerResourceDeleteCommand(context);

  const schemaProviderService = new SchemaProviderService();
  serviceManager.registerService('schema-provider', schemaProviderService);

  // 7) Create tree providers and register remaining commands
  await initializeTreeViewsAndCommands(context, { activationStartMs });

  // 8) Run non-critical activation work in background.
  void schemaProviderService.initialize(context).catch(err => {
    log(`Failed to initialize schema provider service: ${String(err)}`, LogLevel.ERROR, true);
  });

  if (k8sClient) {
    void verifyKubernetesContext(edaClient, k8sClient);
  }
}

async function initializeTreeViewsAndCommands(
  context: vscode.ExtensionContext,
  options?: { activationStartMs?: number }
): Promise<void> {
  interface StartupInitializableProvider {
    initialize(): Promise<void>;
    refresh(): void;
  }

  const configuredNonResourceDelay = Number(process.env.EDA_NON_RESOURCE_STARTUP_DELAY_MS);
  const nonResourceStartupDelayMs = (!Number.isNaN(configuredNonResourceDelay) && configuredNonResourceDelay >= 0)
    ? configuredNonResourceDelay
    : 1200;
  const startupTimers = new Set<ReturnType<typeof setTimeout>>();

  const initializeProvider = (
    providerName: string,
    provider: StartupInitializableProvider,
    delayMs: number
  ): void => {
    const runInitialization = () => {
      void provider.initialize().then(() => {
        provider.refresh();
      }).catch((err: unknown) => {
        log(`Failed to initialize ${providerName}: ${String(err)}`, LogLevel.ERROR, true);
      });
    };

    if (delayMs <= 0) {
      runInitialization();
      return;
    }

    const timer = setTimeout(() => {
      startupTimers.delete(timer);
      runInitialization();
    }, delayMs);
    startupTimers.add(timer);
  };

  context.subscriptions.push({
    dispose: () => {
      for (const timer of startupTimers) {
        clearTimeout(timer);
      }
      startupTimers.clear();
    }
  });

  const dashboardProvider = new DashboardProvider();

  const namespaceProvider = new EdaNamespaceProvider();
  initializeProvider('namespace provider', namespaceProvider, 0);

  const alarmProvider = new EdaAlarmProvider();
  initializeProvider('alarm provider', alarmProvider, nonResourceStartupDelayMs);

  edaDeviationProvider = new EdaDeviationProvider();
  initializeProvider('deviation provider', edaDeviationProvider, nonResourceStartupDelayMs);

  edaTransactionBasketProvider = new TransactionBasketProvider();
  initializeProvider('transaction basket provider', edaTransactionBasketProvider, nonResourceStartupDelayMs);

  edaTransactionProvider = new EdaTransactionProvider();
  initializeProvider('transaction provider', edaTransactionProvider, nonResourceStartupDelayMs);

  const helpProvider = new HelpProvider();

  const explorerProvider = new EdaExplorerViewProvider(context, {
    dashboardProvider,
    namespaceProvider,
    alarmProvider,
    deviationProvider: edaDeviationProvider,
    basketProvider: edaTransactionBasketProvider,
    transactionProvider: edaTransactionProvider,
    helpProvider
  }, {
    activationStartMs: options?.activationStartMs
  });

  const updateEdaExplorerVisibilityContext = (visible: boolean): void => {
    void vscode.commands.executeCommand('setContext', 'edaExplorerVisible', visible);
  };

  updateEdaExplorerVisibilityContext(false);

  context.subscriptions.push(
    explorerProvider,
    explorerProvider.onDidChangeVisibility(visible => {
      updateEdaExplorerVisibilityContext(visible);
    }),
    vscode.window.registerWebviewViewProvider(EdaExplorerViewProvider.viewType, explorerProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    { dispose: () => namespaceProvider.dispose() },
    { dispose: () => edaDeviationProvider.dispose() },
    { dispose: () => edaTransactionBasketProvider.dispose?.() },
    { dispose: () => edaTransactionProvider.dispose() }
  );

  // Register filter commands
  const filterTreeCommand = async (prefill?: string) => {
    let filterText: string | undefined = typeof prefill === 'string' ? prefill : undefined;
    if (filterText === undefined) {
      filterText = await vscode.window.showInputBox({
        prompt: 'Filter resources (supports regex)',
        placeHolder: 'Enter filter pattern'
      });
    }
    if (typeof filterText === 'string') {
      const text = filterText.trim();
      await explorerProvider.setFilter(text);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-eda.filterTree', filterTreeCommand),
    vscode.commands.registerCommand('vscode-eda.filterTreeActive', filterTreeCommand),
    vscode.commands.registerCommand('vscode-eda.clearFilter', async () => {
      await explorerProvider.clearFilter();
    }),
    vscode.commands.registerCommand('vscode-eda.expandAllNamespaces', () => {
      namespaceProvider.setExpandAll(true);
      namespaceProvider.refresh();
      explorerProvider.expandAllResources();
    })
  );

  // Register document providers
  const crdFsProvider = new CrdDefinitionFileSystemProvider();
  const basketProviderLocal = new BasketTransactionDocumentProvider();
  const basketEditProviderLocal = new BasketEditDocumentProvider();
  const deviationDetailsProviderLocal = new DeviationDetailsDocumentProvider();

  deviationDetailsProvider = deviationDetailsProviderLocal;
  basketTransactionProvider = basketProviderLocal;
  basketEditProvider = basketEditProviderLocal;

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('crd', crdFsProvider, { isCaseSensitive: true }),
    vscode.workspace.registerFileSystemProvider('basket-tx', basketProviderLocal, { isCaseSensitive: true }),
    vscode.workspace.registerFileSystemProvider('basket-edit', basketEditProviderLocal, { isCaseSensitive: true }),
    vscode.workspace.registerFileSystemProvider('eda-deviation', deviationDetailsProviderLocal, { isCaseSensitive: true })
  );

  registerViewCommands(context, crdFsProvider, basketProviderLocal);
  registerDeviationCommands(context);
  registerTransactionCommands(context);
  registerBasketCommands(context);
  registerDashboardCommands(context);
  registerResourceBrowserCommand(context);
  registerCredentialCommands(context);
  registerApplyYamlFileCommand(context);
}

/** Kubernetes namespace resource structure */
interface K8sNamespaceResource {
  metadata?: { name?: string };
}

async function verifyKubernetesContext(
  edaClient: EdaClient,
  k8sClient: KubernetesClient
): Promise<void> {
  try {
    await edaClient.getStreamNames();
    const edaNamespaces = edaClient.getCachedNamespaces();
    const k8sNsObjs = await k8sClient.listNamespaces() as K8sNamespaceResource[];
    const k8sNamespaces = k8sNsObjs
      .map((n: K8sNamespaceResource) => n?.metadata?.name)
      .filter((n): n is string => typeof n === 'string');
    const missing = edaNamespaces.filter(ns => !k8sNamespaces.includes(ns));
    if (missing.length > 0) {
      const msg = `Kubernetes context may not match EDA cluster; missing namespaces: ${missing.join(
        ', '
      )}`;
      log(msg, LogLevel.WARN, true);
      vscode.window.showWarningMessage(msg);
    } else {
      log('Kubernetes context matches EDA API', LogLevel.INFO);
    }
  } catch (err) {
    log(`Failed to verify context: ${err}`, LogLevel.WARN);
  }
}

export function log(
  message: string,
  level: LogLevel = LogLevel.INFO,
  forceLog: boolean = false,
  elapsedTime?: number
): void {
  if (level >= currentLogLevel || forceLog) {
    const prefix = LogLevel[level].padEnd(5);
    const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
    let logMessage = `[${timestamp}] [${prefix}] ${message}`;
    if (level === LogLevel.INFO && elapsedTime !== undefined) {
      logMessage += ` (took ${elapsedTime}ms)`;
    }
    edaOutputChannel.appendLine(logMessage);
  }
}

export function measurePerformance<T>(
  operation: () => Promise<T>,
  description: string,
  logLevel: LogLevel = LogLevel.INFO,
  forceLog: boolean = false
): Promise<T> {
  const startTime = Date.now();
  return operation().then(result => {
    const elapsedTime = Date.now() - startTime;
    let logMessage = description;
    if (typeof result === 'string') {
      logMessage = result;
    }
    log(logMessage, logLevel, forceLog, elapsedTime);
    return result;
  }).catch(error => {
    const elapsedTime = Date.now() - startTime;
    log(`${description} - Failed: ${error}`, LogLevel.ERROR, true, elapsedTime);
    throw error;
  });
}

export async function activate(context: vscode.ExtensionContext) {
  // Output channel may not exist yet, use console.warn for early activation logging
  console.warn('Activating EDA extension');
  const activationStartMs = Date.now();
  edaOutputChannel = vscode.window.createOutputChannel('EDA');

  // Set up auth logger to use VS Code output channel
  setAuthLogger((message, level, forceLog, elapsedTime) => {
    log(message, level as LogLevel, forceLog, elapsedTime);
  });

  // Initialize filter context
  await vscode.commands.executeCommand('setContext', 'edaTreeFilterActive', false);

  const config = vscode.workspace.getConfiguration('vscode-eda');
  currentLogLevel = parseLogLevel(config.get('logLevel'));

  log('EDA extension activating...', LogLevel.INFO, true);

  // Initialize embeddingsearch service in background
  initializeEmbeddingSearchInBackground();

  const edaTargetsCfg = config.get<Record<string, string | EdaTargetConfig | undefined>>('edaTargets');
  const targetEntries = edaTargetsCfg ? Object.entries(edaTargetsCfg) : [];
  if (targetEntries.length === 0) {
    await configureTargetsFromWizard(context);
    return;
  }

  // Load target configuration
  const selectedIndex = context.globalState.get<number>('selectedEdaTarget', 0) ?? 0;
  const targetConfig = loadTargetConfig(config, targetEntries, selectedIndex);
  const { edaUrl, edaContext, edaUsername, skipTlsVerify, coreNamespace, clientId } = targetConfig;
  const hostKey = getHostFromUrl(edaUrl);

  // Load credentials
  const credentials = await loadCredentials(
    context,
    hostKey,
    edaUrl,
    targetConfig.edaPasswordFromSettings,
    targetConfig.kcUsername,
    targetConfig.kcPassword
  );
  const { edaPassword, clientSecret } = credentials;

  log(`Loading credentials for ${edaUrl} (host: ${hostKey})`, LogLevel.INFO, true);
  log(`EDA Username: ${edaUsername}`, LogLevel.INFO, true);
  log(`EDA Password: ${edaPassword ? '[SET]' : '[NOT SET]'}`, LogLevel.INFO, true);
  log(`Client Secret: ${clientSecret ? '[SET]' : '[NOT SET]'}`, LogLevel.INFO, true);

  if (!clientSecret) {
    vscode.window.showErrorMessage('Client secret is required. Please configure EDA targets.');
    await configureTargetsFromWizard(context);
    return;
  }

  if (!edaPassword) {
    vscode.window.showErrorMessage('EDA password is required. Please configure EDA targets.');
    await configureTargetsFromWizard(context);
    return;
  }

  // Create status bar and register commands
  contextStatusBarItem = createStatusBarItem(context);
  registerSwitchContextCommand(context, config);

  const configCmd = vscode.commands.registerCommand('vscode-eda.configureTargets', async () => {
    await configureTargetsFromWizard(context);
  });
  context.subscriptions.push(configCmd);

  setupYamlContextDetection(context);

  try {
    log('Initializing service architecture...', LogLevel.INFO, true);
    await initializeServiceArchitecture(context, {
      edaUrl,
      edaContext,
      edaUsername,
      edaPassword,
      clientId,
      clientSecret,
      skipTlsVerify,
      coreNamespace,
      activationStartMs
    });
  } catch (error) {
    log(`Error initializing service architecture: ${error}`, LogLevel.ERROR, true);
    vscode.window.showErrorMessage(`Failed to initialize EDA extension: ${error}`);
  }
}

export function deactivate() {
  console.warn('EDA extension deactivated');
  edaOutputChannel?.appendLine('EDA extension deactivated');
  edaOutputChannel?.dispose();
  try {
    serviceManager.dispose();
  } catch (error) {
    console.error('Error disposing service manager:', error);
  }
}
