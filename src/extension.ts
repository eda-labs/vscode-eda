// src/extension.ts

import * as vscode from 'vscode';
import { EdaNamespaceProvider } from './providers/views/namespaceProvider';
import { EdaSystemProvider } from './providers/views/systemProvider';
import { EdaTransactionProvider } from './providers/views/transactionProvider';
import { KubernetesService } from './services/kubernetes/kubernetes';
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
import { ClusterManager } from './services/kubernetes/clusterManager';
import { ResourceStatusService } from './services/resourceStatusService';

import * as cmd from './commands/index';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export let edaOutputChannel: vscode.OutputChannel;
export let k8sFileSystemProvider: K8sFileSystemProvider;
export let k8sService: KubernetesService;
export let currentLogLevel: LogLevel = LogLevel.INFO;
export let resourceStore: ResourceStore;
export let edaAlarmProvider: EdaAlarmProvider;
export let edaDeviationProvider: EdaDeviationProvider
export let alarmDetailsProvider: AlarmDetailsDocumentProvider;
export let deviationDetailsProvider: DeviationDetailsDocumentProvider;
export let edaTransactionProvider: EdaTransactionProvider;
export let registerResourceViewCommands: ResourceViewDocumentProvider;
export let clusterManager: ClusterManager;
export let resourceStatusService: ResourceStatusService;

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

export async function activate(context: vscode.ExtensionContext) {
  console.log('Activating EDA extension');
  edaOutputChannel = vscode.window.createOutputChannel('EDA');

  const config = vscode.workspace.getConfiguration('vscode-eda');
  currentLogLevel = config.get<LogLevel>('logLevel', LogLevel.INFO);

  log('EDA extension activating...', LogLevel.INFO, true);


  k8sService = new KubernetesService();
  resourceStore = new ResourceStore(k8sService);

  // Initialize cluster manager
  clusterManager = new ClusterManager(k8sService);
  context.subscriptions.push(clusterManager);

  // Initialize the resource store
  log('Initializing resource store...', LogLevel.INFO, true);
  await resourceStore.initCrdGroups();
  await resourceStore.loadNamespaceResources('eda-system');

  // Initialize the resource status service
  log('Initializing resource status service...', LogLevel.INFO, true);
  resourceStatusService = new ResourceStatusService(k8sService);
  await resourceStatusService.initialize(context);

  k8sFileSystemProvider = new K8sFileSystemProvider(k8sService);
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

  edaAlarmProvider = new EdaAlarmProvider(context, k8sService);
  vscode.window.registerTreeDataProvider('edaAlarms', edaAlarmProvider);

  edaDeviationProvider = new EdaDeviationProvider(context, k8sService);
  vscode.window.registerTreeDataProvider('edaDeviations', edaDeviationProvider);

  const transactionDetailsProvider = new TransactionDetailsDocumentProvider();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('eda-transaction', transactionDetailsProvider, { isCaseSensitive: true })
  );

  const edaNamespaceProvider = new EdaNamespaceProvider(context, k8sService);
  const edaSystemProvider = new EdaSystemProvider(context, k8sService);
  edaTransactionProvider = new EdaTransactionProvider(context, k8sService);

  vscode.window.registerTreeDataProvider('edaNamespaces', edaNamespaceProvider);
  vscode.window.registerTreeDataProvider('edaSystem', edaSystemProvider);
  vscode.window.registerTreeDataProvider('edaTransactions', edaTransactionProvider);

  log('Registering Schema Provider...', LogLevel.INFO, true);
  const schemaProvider = new SchemaProvider(k8sService);
  schemaProvider.register(context);

  // Register commands
  cmd.registerClusterCommands(context, k8sService, clusterManager, resourceStore);
  cmd.registerRefreshCommands(context);
  cmd.registerViewCommands(context, k8sService, crdFsProvider, transactionDetailsProvider);
  cmd.registerPodCommands(context, k8sService, podDescribeProvider);
  cmd.registerResourceViewCommands(context, k8sService, resourceViewProvider);
  cmd.registerSwitchToEditCommand(context);
  cmd.registerResourceEditCommands(context, k8sService, k8sFileSystemProvider, {
    namespaceProvider: edaNamespaceProvider,
    systemProvider: edaSystemProvider,
    transactionProvider: edaTransactionProvider
  });
  cmd.registerResourceCreateCommand(context, k8sService, k8sFileSystemProvider);
  cmd.registerDeviationCommands(context, k8sService);
  cmd.registerTransactionCommands(context, k8sService);

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
  clusterManager?.dispose();
}