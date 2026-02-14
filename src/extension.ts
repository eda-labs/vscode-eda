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
import { configureTargets, fetchClientSecretDirectly } from './webviews/targetWizard/targetWizardPanel';
import { setAuthLogger } from './clients/edaAuthClient';
import type { TreeItemBase } from './providers/views/treeItem';
import { EmbeddingSearchService } from './services/embeddingSearchService';

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
let edaNamespaceProvider: EdaNamespaceProvider;
let edaAlarmProvider: EdaAlarmProvider;
let serviceArchitectureInitialized = false;

const SWITCH_TARGET_COMMAND = 'vscode-eda.applyTargetSwitch';

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
  context: vscode.ExtensionContext
): void {
  const switchCmd = vscode.commands.registerCommand('vscode-eda.switchContext', async () => {
    await configureTargets(context);
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
}

interface ResolvedServiceConfig {
  serviceConfig: ServiceConfig;
  selectedIndex: number;
}

function getConfiguredTargetEntries(
  config: vscode.WorkspaceConfiguration
): [string, EdaTargetValue][] {
  const targets = config.get<Record<string, EdaTargetValue>>('edaTargets') ?? {};
  return Object.entries(targets);
}

async function resolveServiceConfigForTarget(
  context: vscode.ExtensionContext,
  config: vscode.WorkspaceConfiguration,
  selectedIndex?: number
): Promise<ResolvedServiceConfig> {
  const targetEntries = getConfiguredTargetEntries(config);
  if (targetEntries.length === 0) {
    throw new Error('No EDA targets configured.');
  }

  const storedIndex = context.globalState.get<number>('selectedEdaTarget', 0) ?? 0;
  const requestedIndex = selectedIndex ?? storedIndex;
  const normalizedIndex = Math.max(0, Math.min(requestedIndex, targetEntries.length - 1));

  const targetConfig = loadTargetConfig(config, targetEntries, normalizedIndex);
  const { edaUrl, edaContext, edaUsername, skipTlsVerify, coreNamespace, clientId } = targetConfig;
  const hostKey = getHostFromUrl(edaUrl);

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
    throw new Error('Client secret is required. Please configure EDA targets.');
  }
  if (!edaPassword) {
    throw new Error('EDA password is required. Please configure EDA targets.');
  }

  return {
    selectedIndex: normalizedIndex,
    serviceConfig: {
      edaUrl,
      edaContext,
      edaUsername,
      edaPassword,
      clientId,
      clientSecret,
      skipTlsVerify,
      coreNamespace
    }
  };
}

async function initializeCoreServices(
  context: vscode.ExtensionContext,
  config: ServiceConfig
): Promise<void> {
  const { edaUrl, edaContext, edaUsername, edaPassword, clientId, clientSecret, skipTlsVerify, coreNamespace } = config;

  const k8sClient = edaContext ? new KubernetesClient(edaContext) : undefined;
  const edaClient = new EdaClient(edaUrl, {
    clientId,
    clientSecret,
    edaUsername,
    edaPassword,
    skipTlsVerify,
    coreNamespace
  });

  serviceManager.registerClient('eda', edaClient);
  if (k8sClient) {
    serviceManager.registerClient('kubernetes', k8sClient);
  }

  if (k8sClient && edaContext) {
    k8sClient.switchContext(edaContext);
  }

  if (k8sClient) {
    await verifyKubernetesContext(edaClient, k8sClient);
  }

  if (contextStatusBarItem) {
    const host = getHostFromUrl(edaUrl);
    const ctxText = edaContext ? ` (${edaContext})` : '';
    contextStatusBarItem.text = `$(server) ${host}${ctxText}`;
  }

  const resourceStatusService = new ResourceStatusService();
  serviceManager.registerService('resource-status', resourceStatusService);
  resourceStatusService.initialize(context);

  if (k8sClient) {
    const resourceService = new ResourceService(k8sClient);
    serviceManager.registerService('kubernetes-resources', resourceService);
  }

  const schemaProviderService = new SchemaProviderService();
  serviceManager.registerService('schema-provider', schemaProviderService);
  await schemaProviderService.initialize(context);
}

async function reconnectExplorerProviders(): Promise<void> {
  const reconnectTasks: Array<Promise<void>> = [];

  if (edaNamespaceProvider?.reconnect) {
    reconnectTasks.push(edaNamespaceProvider.reconnect());
  }
  if (edaAlarmProvider?.reconnect) {
    reconnectTasks.push(edaAlarmProvider.reconnect());
  }
  if (edaDeviationProvider?.reconnect) {
    reconnectTasks.push(edaDeviationProvider.reconnect());
  }
  if (edaTransactionBasketProvider?.reconnect) {
    reconnectTasks.push(edaTransactionBasketProvider.reconnect());
  }
  if (edaTransactionProvider?.reconnect) {
    reconnectTasks.push(edaTransactionProvider.reconnect());
  }

  await Promise.all(reconnectTasks);
}

let targetSwitchInProgress = false;

async function switchTargetWithoutReload(
  context: vscode.ExtensionContext,
  targetIndex?: number
): Promise<void> {
  if (targetSwitchInProgress) {
    vscode.window.showInformationMessage('An EDA target switch is already in progress.');
    return;
  }

  const config = vscode.workspace.getConfiguration('vscode-eda');
  const targetEntries = getConfiguredTargetEntries(config);
  if (targetEntries.length === 0) {
    vscode.window.showInformationMessage('No EDA targets configured.');
    return;
  }

  const previousIndex = context.globalState.get<number>('selectedEdaTarget', 0) ?? 0;
  const hasActiveClient = serviceManager.getClientNames().includes('eda');
  let previousConfig: ResolvedServiceConfig | undefined;
  if (hasActiveClient) {
    try {
      previousConfig = await resolveServiceConfigForTarget(context, config, previousIndex);
    } catch (error) {
      log(`Unable to resolve previous target configuration for rollback: ${error}`, LogLevel.WARN, true);
    }
  }
  const nextConfig = await resolveServiceConfigForTarget(context, config, targetIndex);

  if (nextConfig.selectedIndex === previousIndex && hasActiveClient) {
    return;
  }

  const [nextUrl, nextTargetValue] = targetEntries[nextConfig.selectedIndex];
  const nextContext =
    typeof nextTargetValue === 'string'
      ? nextTargetValue
      : nextTargetValue?.context;
  const nextHost = getHostFromUrl(nextUrl);
  const nextContextSuffix = nextContext ? ` (${nextContext})` : '';
  const nextLabel = `${nextHost}${nextContextSuffix}`;

  targetSwitchInProgress = true;
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Switching EDA target to ${nextLabel}...`
      },
      async () => {
        serviceManager.dispose();

        try {
          if (!serviceArchitectureInitialized) {
            await initializeServiceArchitecture(context, nextConfig.serviceConfig);
            serviceArchitectureInitialized = true;
          } else {
            await initializeCoreServices(context, nextConfig.serviceConfig);
            await reconnectExplorerProviders();
          }
        } catch (error) {
          if (previousConfig) {
            log(`Switch failed, restoring previous target: ${error}`, LogLevel.ERROR, true);
            serviceManager.dispose();
            if (!serviceArchitectureInitialized) {
              await initializeServiceArchitecture(context, previousConfig.serviceConfig);
              serviceArchitectureInitialized = true;
            } else {
              await initializeCoreServices(context, previousConfig.serviceConfig);
              await reconnectExplorerProviders();
            }
          }
          throw error;
        }
      }
    );

    await context.globalState.update('selectedEdaTarget', nextConfig.selectedIndex);
    vscode.window.showInformationMessage(`Switched EDA target to ${nextLabel}.`);
  } finally {
    targetSwitchInProgress = false;
  }
}

async function initializeServiceArchitecture(
  context: vscode.ExtensionContext,
  config: ServiceConfig
): Promise<void> {
  await initializeCoreServices(context, config);
  const k8sClient = config.edaContext ? serviceManager.getClient<KubernetesClient>('kubernetes') : undefined;

  // 7) Register file system providers
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

  if (k8sClient) {
    podDescribeProvider = new PodDescribeDocumentProvider();
    context.subscriptions.push(
      vscode.workspace.registerFileSystemProvider('k8s-describe', podDescribeProvider, { isCaseSensitive: true })
    );
    registerPodCommands(context, podDescribeProvider);
    registerDeploymentCommands(context);
    registerNodeConfigCommands(context);
    registerTopoNodeCommands(context);
  }

  registerResourceDeleteCommand(context);

  // 8) Create tree providers and register remaining commands
  await initializeTreeViewsAndCommands(context);
}

async function initializeTreeViewsAndCommands(context: vscode.ExtensionContext): Promise<void> {
  const dashboardProvider = new DashboardProvider();
  const dashboardTreeView = vscode.window.createTreeView('edaDashboards', {
    treeDataProvider: dashboardProvider,
    showCollapseAll: true,
  });

  edaNamespaceProvider = new EdaNamespaceProvider();
  void edaNamespaceProvider.initialize();
  const namespaceTreeView = vscode.window.createTreeView('edaNamespaces', {
    treeDataProvider: edaNamespaceProvider,
    showCollapseAll: true
  });
  namespaceTreeView.onDidExpandElement(e => {
    edaNamespaceProvider.updateStreamExpansion(e.element as TreeItemBase, false);
  });
  namespaceTreeView.onDidCollapseElement(e => {
    edaNamespaceProvider.setExpandAll(false);
    edaNamespaceProvider.updateStreamExpansion(e.element as TreeItemBase, true);
  });

  edaAlarmProvider = new EdaAlarmProvider();
  void edaAlarmProvider.initialize();
  const alarmTreeView = vscode.window.createTreeView('edaAlarms', {
    treeDataProvider: edaAlarmProvider,
    showCollapseAll: true
  });
  alarmTreeView.title = `Alarms (${edaAlarmProvider.count})`;
  edaAlarmProvider.onAlarmCountChanged(count => {
    alarmTreeView.title = `Alarms (${count})`;
  });

  edaDeviationProvider = new EdaDeviationProvider();
  void edaDeviationProvider.initialize();
  const deviationTreeView = vscode.window.createTreeView('edaDeviations', {
    treeDataProvider: edaDeviationProvider,
    showCollapseAll: true
  });
  deviationTreeView.title = `Deviations (${edaDeviationProvider.count})`;
  edaDeviationProvider.onDeviationCountChanged(count => {
    deviationTreeView.title = `Deviations (${count})`;
  });

  edaTransactionBasketProvider = new TransactionBasketProvider();
  void edaTransactionBasketProvider.initialize();
  const basketTreeView = vscode.window.createTreeView('edaTransactionBasket', {
    treeDataProvider: edaTransactionBasketProvider,
    showCollapseAll: true
  });
  basketTreeView.title = `Transaction Basket (${edaTransactionBasketProvider.count})`;
  edaTransactionBasketProvider.onBasketCountChanged(count => {
    basketTreeView.title = `Transaction Basket (${count})`;
  });

  edaTransactionProvider = new EdaTransactionProvider();
  void edaTransactionProvider.initialize();
  const transactionTreeView = vscode.window.createTreeView('edaTransactions', {
    treeDataProvider: edaTransactionProvider,
    showCollapseAll: true
  });

  const helpProvider = new HelpProvider();
  const helpTreeView = vscode.window.createTreeView('edaHelp', {
    treeDataProvider: helpProvider,
    showCollapseAll: true
  });

  const edaTreeViews = [
    dashboardTreeView,
    namespaceTreeView,
    alarmTreeView,
    deviationTreeView,
    basketTreeView,
    transactionTreeView,
    helpTreeView
  ];

  const updateEdaExplorerVisibilityContext = () =>
    vscode.commands.executeCommand(
      'setContext',
      'edaExplorerVisible',
      edaTreeViews.some(view => view.visible)
    );

  edaTreeViews.forEach(treeView => {
    context.subscriptions.push(
      treeView.onDidChangeVisibility(() => {
        updateEdaExplorerVisibilityContext();
      })
    );
  });
  updateEdaExplorerVisibilityContext();

  // Register filter commands
  const allProviders = [dashboardProvider, edaNamespaceProvider, edaAlarmProvider, edaDeviationProvider, edaTransactionBasketProvider, edaTransactionProvider, helpProvider];

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
      allProviders.forEach(p => p.setTreeFilter(text));
      await vscode.commands.executeCommand('setContext', 'edaTreeFilterActive', text.length > 0);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-eda.filterTree', filterTreeCommand),
    vscode.commands.registerCommand('vscode-eda.filterTreeActive', filterTreeCommand),
    vscode.commands.registerCommand('vscode-eda.clearFilter', () => {
      allProviders.forEach(p => p.clearTreeFilter());
      vscode.commands.executeCommand('setContext', 'edaTreeFilterActive', false);
    }),
    vscode.commands.registerCommand('vscode-eda.expandAllNamespaces', async () => {
      try {
        edaNamespaceProvider.setExpandAll(true);
        await edaNamespaceProvider.expandAllNamespaces(namespaceTreeView);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to expand namespaces: ${message}`);
      }
    })
  );

  context.subscriptions.push(dashboardTreeView);
  context.subscriptions.push(namespaceTreeView);
  context.subscriptions.push(alarmTreeView);
  context.subscriptions.push(deviationTreeView, { dispose: () => edaDeviationProvider.dispose() });
  context.subscriptions.push(basketTreeView, { dispose: () => edaTransactionBasketProvider.dispose?.() });
  context.subscriptions.push(transactionTreeView, { dispose: () => edaTransactionProvider.dispose() });
  context.subscriptions.push(helpTreeView);

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

  registerViewCommands(context, crdFsProvider, deviationDetailsProviderLocal, basketProviderLocal);
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
  const embeddingSearchService = EmbeddingSearchService.getInstance();
  embeddingSearchService.initialize().catch(error => {
    log(`Failed to initialize embeddingsearch: ${error}`, LogLevel.ERROR);
  });

  // Create status bar and register commands
  contextStatusBarItem = createStatusBarItem(context);
  registerSwitchContextCommand(context);

  const configCmd = vscode.commands.registerCommand('vscode-eda.configureTargets', async () => {
    await configureTargets(context);
  });
  const switchTargetCmd = vscode.commands.registerCommand(SWITCH_TARGET_COMMAND, async (targetIndex?: number) => {
    try {
      await switchTargetWithoutReload(context, targetIndex);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Error switching target: ${message}`, LogLevel.ERROR, true);
      vscode.window.showErrorMessage(`Failed to switch EDA target: ${message}`);
      throw error;
    }
  });
  context.subscriptions.push(configCmd, switchTargetCmd);

  setupYamlContextDetection(context);

  const targetEntries = getConfiguredTargetEntries(config);
  if (targetEntries.length === 0) {
    await configureTargets(context);
    return;
  }

  try {
    log('Initializing service architecture...', LogLevel.INFO, true);
    const resolvedConfig = await resolveServiceConfigForTarget(context, config);
    await initializeServiceArchitecture(context, resolvedConfig.serviceConfig);
    serviceArchitectureInitialized = true;
  } catch (error) {
    log(`Error initializing service architecture: ${error}`, LogLevel.ERROR, true);
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to initialize EDA extension: ${message}`);
    if (/Client secret is required|EDA password is required/.test(message)) {
      await configureTargets(context);
    }
  }
}

export function deactivate() {
  console.warn('EDA extension deactivated');
  edaOutputChannel?.appendLine('EDA extension deactivated');
  edaOutputChannel?.dispose();
  serviceArchitectureInitialized = false;
  try {
    serviceManager.dispose();
  } catch (error) {
    console.error('Error disposing service manager:', error);
  }
}
