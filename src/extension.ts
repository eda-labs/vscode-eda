// src/extension.ts
// Updated to use only the new service architecture

import * as vscode from 'vscode';
import { EdaNamespaceProvider } from './providers/views/namespaceProvider';
import { EdaSystemProvider } from './providers/views/systemProvider';
import { EdaTransactionProvider } from './providers/views/transactionProvider';
import { K8sFileSystemProvider } from './providers/documents/resourceProvider';
import { CrdDefinitionFileSystemProvider } from './providers/documents/crdDefinitionProvider';
import { PodDescribeDocumentProvider } from './providers/documents/podDescribeProvider';
import { TransactionDetailsDocumentProvider } from './providers/documents/transactionDetailsProvider';
import { SchemaProvider } from './providers/schema';
import { ResourceStore } from './services/store/resourceStore';
import { EdaAlarmProvider } from './providers/views/alarmProvider';
import { EdaDeviationProvider } from './providers/views/deviationProvider';
import { AlarmDetailsDocumentProvider } from './providers/documents/alarmDetailsProvider';
import { DeviationDetailsDocumentProvider } from './providers/documents/deviationDetailsProvider';
import { ResourceViewDocumentProvider } from './providers/documents/resourceViewProvider';

// Import new service architecture components
import { serviceManager } from './services/serviceManager';
import { KubernetesClient } from './clients/kubernetesClient';
import { EdactlClient } from './clients/edactlClient';
import { CacheService } from './services/cacheService';
import { ResourceService } from './services/resourceService';
import { EdaService } from './services/edaService';
import { StatusService } from './services/statusService';
import { CrdService } from './services/crdService';

import * as cmd from './commands/index';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export let edaOutputChannel: vscode.OutputChannel;
export let k8sFileSystemProvider: K8sFileSystemProvider;
export let currentLogLevel: LogLevel = LogLevel.INFO;
export let resourceStore: ResourceStore;
export let edaAlarmProvider: EdaAlarmProvider;
export let edaDeviationProvider: EdaDeviationProvider
export let alarmDetailsProvider: AlarmDetailsDocumentProvider;
export let deviationDetailsProvider: DeviationDetailsDocumentProvider;
export let edaTransactionProvider: EdaTransactionProvider;
export let registerResourceViewCommands: ResourceViewDocumentProvider;

export let resourceStatusService: StatusService;

// The global text filter that only applies to Namespaces & System
export let globalTreeFilter: string = '';

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

    // Add elapsed time for INFO logs when provided
    if (level === LogLevel.INFO && elapsedTime !== undefined) {
      logMessage += ` (took ${elapsedTime}ms)`;
    }

    edaOutputChannel.appendLine(logMessage);
  }
}

// Add a helper function for performance measurement
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

    // If the result is a string, use it as the message
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

async function initializeServices(context: vscode.ExtensionContext) {
  try {
    // Get necessary services from the service manager
    const k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');
    const resourceService = serviceManager.getService<ResourceService>('resource');
    const edaService = serviceManager.getService<EdaService>('eda');
    const crdService = serviceManager.getService<CrdService>('crd');

    // Initialize ResourceStore with all required services
    resourceStore = new ResourceStore(k8sClient, resourceService, edaService, crdService);

    // Initialize the resource store
    log('Initializing resource store...', LogLevel.INFO, true);
    await resourceStore.initCrdGroups();
    await resourceStore.loadNamespaceResources('eda-system');

    return true;
  } catch (error) {
    log(`Error initializing services: ${error}`, LogLevel.ERROR, true);
    return false;
  }
}

export async function activate(context: vscode.ExtensionContext) {
  console.log('Activating EDA extension');
  edaOutputChannel = vscode.window.createOutputChannel('EDA');

  const config = vscode.workspace.getConfiguration('vscode-eda');
  currentLogLevel = config.get<LogLevel>('logLevel', LogLevel.INFO);

  log('EDA extension activating...', LogLevel.INFO, true);

  // Initialize new service architecture
  try {
    log('Initializing service architecture...', LogLevel.INFO, true);
    await serviceManager.initialize(context);

    // Register and initialize services
    const k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');

    // Register CacheService
    const cacheService = serviceManager.registerService('cache', new CacheService());

    // Register EdactlClient
    const edactlClient = serviceManager.registerClient('edactl', new EdactlClient(k8sClient, cacheService));

    // Register ResourceService
    const resourceService = serviceManager.registerService('resource', new ResourceService(k8sClient, cacheService));

    // Register CrdService - needs to be registered before EdaService
    const crdService = serviceManager.registerService('crd', new CrdService(k8sClient, cacheService, resourceService));

    // Register EdaService
    const edaService = serviceManager.registerService('eda', new EdaService(k8sClient, edactlClient, cacheService));

    // Register StatusService
    const statusService = serviceManager.registerService('status', new StatusService(k8sClient));
    await statusService.initialize(context);
    resourceStatusService = statusService;

    log('Service architecture initialized successfully', LogLevel.INFO, true);

    // Initialize ResourceStore and other components
    await initializeServices(context);
  } catch (error) {
    log(`Error initializing service architecture: ${error}`, LogLevel.ERROR, true);
    vscode.window.showErrorMessage(`Failed to initialize EDA extension: ${error}`);
    throw error; // Re-throw to indicate activation failure
  }

  // Initialize filesystem providers and UI components
  k8sFileSystemProvider = new K8sFileSystemProvider();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('k8s', k8sFileSystemProvider, { isCaseSensitive: true })
  );

  const crdFsProvider = new CrdDefinitionFileSystemProvider();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('crd', crdFsProvider, { isCaseSensitive: true })
  );

  const resourceViewProvider = new ResourceViewDocumentProvider();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('k8s-view', resourceViewProvider, {
      isCaseSensitive: true
    })
  );

  const podDescribeProvider = new PodDescribeDocumentProvider();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('k8s-describe', podDescribeProvider, { isCaseSensitive: true })
  );

  edaAlarmProvider = new EdaAlarmProvider(context);
  vscode.window.registerTreeDataProvider('edaAlarms', edaAlarmProvider);

  edaDeviationProvider = new EdaDeviationProvider(context);
  vscode.window.registerTreeDataProvider('edaDeviations', edaDeviationProvider);

  const transactionDetailsProvider = new TransactionDetailsDocumentProvider();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('eda-transaction', transactionDetailsProvider, { isCaseSensitive: true })
  );

  const edaNamespaceProvider = new EdaNamespaceProvider(context);
  const edaSystemProvider = new EdaSystemProvider(context);
  edaTransactionProvider = new EdaTransactionProvider(context);

  vscode.window.registerTreeDataProvider('edaNamespaces', edaNamespaceProvider);
  vscode.window.registerTreeDataProvider('edaSystem', edaSystemProvider);
  vscode.window.registerTreeDataProvider('edaTransactions', edaTransactionProvider);

  log('Registering Schema Provider...', LogLevel.INFO, true);
  const schemaProvider = new SchemaProvider();
  schemaProvider.register(context);

  // Register commands - updated to use serviceManager instead of k8sService
  cmd.registerViewCommands(context, crdFsProvider, transactionDetailsProvider);
  cmd.registerPodCommands(context, podDescribeProvider);
  cmd.registerResourceViewCommands(context, resourceViewProvider);
  cmd.registerResourceEditCommands(context, k8sFileSystemProvider, {
    namespaceProvider: edaNamespaceProvider,
    systemProvider: edaSystemProvider,
    transactionProvider: edaTransactionProvider
  });
  cmd.registerResourceCreateCommand(context, k8sFileSystemProvider);
  cmd.registerDeviationCommands(context);
  cmd.registerTransactionCommands(context);

  // Filter command: Just set the globalTreeFilter, then refresh
  const filterTreeCommand = vscode.commands.registerCommand('vscode-eda.filterTree', async () => {
    const input = await vscode.window.showInputBox({
      placeHolder: 'Filter by resource name...',
      prompt: 'Enter partial text. If empty, filter is cleared. Searching is lazy BFS on demand.'
    });
    if (input !== undefined) {
      globalTreeFilter = input.trim();

      // Refresh
      edaNamespaceProvider.refresh();
      edaSystemProvider.refresh();
    }
  });
  context.subscriptions.push(filterTreeCommand);

  // Create provider instances
  alarmDetailsProvider = new AlarmDetailsDocumentProvider();
  deviationDetailsProvider = new DeviationDetailsDocumentProvider();

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('eda-alarm', alarmDetailsProvider, { isCaseSensitive: true }),
    vscode.workspace.registerFileSystemProvider('eda-deviation', deviationDetailsProvider, { isCaseSensitive: true })
  );

  const clearFilterCommand = vscode.commands.registerCommand('vscode-eda.clearFilter', () => {
    // Reset the global filter variable
    globalTreeFilter = '';

    // Refresh the views so that the filter is cleared from the UI
    edaNamespaceProvider.refresh();
    edaSystemProvider.refresh();

    vscode.window.showInformationMessage('Filter cleared');
  });
  context.subscriptions.push(clearFilterCommand);

  console.log('EDA extension activated');
  edaOutputChannel.appendLine('EDA extension activated');
}

export function deactivate() {
  console.log('EDA extension deactivated');
  edaOutputChannel?.appendLine('EDA extension deactivated');
  edaOutputChannel?.dispose();

  // Dispose service architecture
  try {
    serviceManager.dispose();
  } catch (error) {
    console.error('Error disposing service manager:', error);
  }
}