import * as vscode from 'vscode';
import { KubernetesClient } from './clients/kubernetesClient';
import { EdaClient } from './clients/edaClient';
import { serviceManager } from './services/serviceManager';
// import { ResourceService } from './services/resourceService';
import { ResourceStatusService } from './services/resourceStatusService';
import { EdaNamespaceProvider } from './providers/views/namespaceProvider';
import { EdaAlarmProvider } from './providers/views/alarmProvider';
// import { EdaDeviationProvider } from './providers/views/deviationProvider';
// import { EdaTransactionProvider } from './providers/views/transactionProvider';
import { AlarmDetailsDocumentProvider } from './providers/documents/alarmDetailsProvider';
import { DeviationDetailsDocumentProvider } from './providers/documents/deviationDetailsProvider';
import { TransactionDetailsDocumentProvider } from './providers/documents/transactionDetailsProvider';
// import { CrdDefinitionFileSystemProvider } from './providers/documents/crdDefinitionProvider';
// import { ResourceEditDocumentProvider } from './providers/documents/resourceEditProvider';
import { ResourceViewDocumentProvider } from './providers/documents/resourceViewProvider';
import { SchemaProviderService } from './services/schemaProviderService';

import { registerResourceViewCommands } from './commands/resourceViewCommands';

// import { registerDeviationCommands } from './commands/deviationCommands';
// import { registerTransactionCommands } from './commands/transactionCommands';
// import { registerViewCommands } from './commands/viewCommands';
// import { registerResourceEditCommands } from './commands/resourceEditCommands';
// import { registerResourceCreateCommand } from './commands/resourceCreateCommand';
// import { registerResourceDeleteCommand } from './commands/resourceDeleteCommand';
// import { registerResourceViewCommands } from './commands/resourceViewCommands';
// import { registerDeploymentCommands } from './commands/deploymentCommands';
// import { registerEngineConfigCommands } from './commands/engineConfigCommands';
// import { CrdDefinitionFileSystemProvider } from './providers/documents/crdDefinitionProvider';
// import { PodDescribeDocumentProvider } from './providers/documents/podDescribeProvider';
// import { ResourceViewDocumentProvider } from './providers/documents/resourceViewProvider';
// import { registerPodCommands } from './commands/podCommands';



/* eslint-disable no-unused-vars */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}
/* eslint-enable no-unused-vars */

// export let edaDeviationProvider: EdaDeviationProvider;
// export let edaTransactionProvider: EdaTransactionProvider;
export let alarmDetailsProvider: AlarmDetailsDocumentProvider;
export let deviationDetailsProvider: DeviationDetailsDocumentProvider;
export let transactionDetailsProvider: TransactionDetailsDocumentProvider;
export let resourceViewProvider: ResourceViewDocumentProvider;
export let edaOutputChannel: vscode.OutputChannel;
export let currentLogLevel: LogLevel = LogLevel.INFO;
let contextStatusBarItem: vscode.StatusBarItem;

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
  console.log('Activating EDA extension');
  edaOutputChannel = vscode.window.createOutputChannel('EDA');

  const config = vscode.workspace.getConfiguration('vscode-eda');
  currentLogLevel = config.get<LogLevel>('logLevel', LogLevel.INFO);

  log('EDA extension activating...', LogLevel.INFO, true);
  const edaUrl = config.get<string>("edaUrl", "https://eda-api");
  const edaUsername = config.get<string>('edaUsername', 'admin');
  const edaPassword = config.get<string>('edaPassword', 'admin');
  const kcUsername = config.get<string>('kcUsername', 'admin');
  const kcPassword = config.get<string>('kcPassword', 'admin');
  const clientId = config.get<string>('clientId', 'eda');
  const clientSecret = config.get<string>('clientSecret', '');
  const skipTlsVerify = config.get<boolean>('skipTlsVerify', false);


  // Create a status bar item for showing current Kubernetes context:
  contextStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  // Clicking the status bar item will trigger our switchContext command:
  contextStatusBarItem.command = 'vscode-eda.switchContext';
  contextStatusBarItem.text = '$(kubernetes) EDA: unknown';
  contextStatusBarItem.tooltip = 'Switch the current Kubernetes context';
  contextStatusBarItem.show();
  context.subscriptions.push(contextStatusBarItem);
//
  try {
    log('Initializing service architecture...', LogLevel.INFO, true);

    // 1) Create the clients independently

    const k8sClient = new KubernetesClient();
    const edactlClient = new EdaClient(edaUrl, {
      edaUsername,
      edaPassword,
      kcUsername,
      kcPassword,
      clientId,
      clientSecret: clientSecret || undefined,
      skipTlsVerify
    });
    const currentContext = k8sClient.getCurrentContext();
    contextStatusBarItem.text = `$(kubernetes) EDA: ${currentContext}`;

    // 2) Optionally register them in your ServiceManager
    serviceManager.registerClient('edactl', edactlClient);
    serviceManager.registerClient('kubernetes', k8sClient);

  //   // 3) Let k8sClient know about edactlClient so it can call it
  //   k8sClient.setEdaClient(edactlClient);

  //   // 4) Kick off watchers immediately so caches warm while we continue
  //   void k8sClient.startWatchers().catch(err => {
  //     log(`Watcher startup failed: ${err}`, LogLevel.ERROR, true);
  //   });
  //   // 5) Create core services
  //   const resourceService = new ResourceService(k8sClient);
  //   serviceManager.registerService('kubernetes-resources', resourceService);

    const resourceStatusService = new ResourceStatusService(k8sClient);
    serviceManager.registerService('resource-status', resourceStatusService);
    void resourceStatusService.initialize(context);

    resourceViewProvider = new ResourceViewDocumentProvider();
    context.subscriptions.push(
      vscode.workspace.registerFileSystemProvider('k8s-view', resourceViewProvider, { isCaseSensitive: true })
    );
    registerResourceViewCommands(context, resourceViewProvider);

    const schemaProviderService = new SchemaProviderService();
    serviceManager.registerService('schema-provider', schemaProviderService);
    await schemaProviderService.initialize(context);

  //   const namespaceProvider = new EdaNamespaceProvider();
  //   const namespaceTreeView = vscode.window.createTreeView('edaNamespaces', {
  //     treeDataProvider: namespaceProvider,
  //     showCollapseAll: true
  //   });

  const namespaceProvider = new EdaNamespaceProvider();
  const namespaceTreeView = vscode.window.createTreeView('edaNamespaces', {
    treeDataProvider: namespaceProvider,
    showCollapseAll: true
  });

  const alarmProvider = new EdaAlarmProvider();
  const alarmTreeView = vscode.window.createTreeView('edaAlarms', {
    treeDataProvider: alarmProvider,
    showCollapseAll: true
  });

  //   edaDeviationProvider = new EdaDeviationProvider();
  //   const deviationTreeView = vscode.window.createTreeView('edaDeviations', {
  //     treeDataProvider: edaDeviationProvider,
  //     showCollapseAll: true
  //   });

  //   edaTransactionProvider = new EdaTransactionProvider();
  //   const transactionTreeView = vscode.window.createTreeView('edaTransactions', {
  //     treeDataProvider: edaTransactionProvider,
  //     showCollapseAll: true
  //   });

  context.subscriptions.push(namespaceTreeView);
  context.subscriptions.push(alarmTreeView);
  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-eda.refreshResources', () => {
      namespaceProvider.refresh();
    })
  );

  // Allow the user to filter the namespace tree
  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-eda.filterTree', async () => {
      const filterText = await vscode.window.showInputBox({
        prompt: 'Filter resources by text',
        placeHolder: 'Enter filter text'
      });
      if (filterText !== undefined) {
        namespaceProvider.setTreeFilter(filterText.trim());
      }
    })
  );

  // Clear any active tree filter
  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-eda.clearFilter', () => {
      namespaceProvider.clearTreeFilter();
    })
  );

  //   context.subscriptions.push(namespaceTreeView);
  //   context.subscriptions.push(alarmTreeView, { dispose: () => alarmProvider.dispose() });
  //   context.subscriptions.push(deviationTreeView, { dispose: () => edaDeviationProvider.dispose() });
  //   context.subscriptions.push(transactionTreeView, { dispose: () => edaTransactionProvider.dispose() });

  //   context.subscriptions.push(
  //     vscode.commands.registerCommand('vscode-eda.refreshResources', () => {
  //       namespaceProvider.refresh();
  //     })
  //   );

  //   const crdFsProvider = new CrdDefinitionFileSystemProvider();
  //   const transactionDetailsProviderLocal = new TransactionDetailsDocumentProvider();
  //   const alarmDetailsProviderLocal = new AlarmDetailsDocumentProvider();
  //   const deviationDetailsProviderLocal = new DeviationDetailsDocumentProvider();

  //   alarmDetailsProvider = alarmDetailsProviderLocal;
  //   deviationDetailsProvider = deviationDetailsProviderLocal;
  //   transactionDetailsProvider = transactionDetailsProviderLocal;

  //   context.subscriptions.push(
  //     vscode.workspace.registerFileSystemProvider('crd', crdFsProvider, { isCaseSensitive: true }),
  //     vscode.workspace.registerFileSystemProvider('eda-transaction', transactionDetailsProviderLocal, { isCaseSensitive: true }),
  //     vscode.workspace.registerFileSystemProvider('eda-alarm', alarmDetailsProviderLocal, { isCaseSensitive: true }),
  //     vscode.workspace.registerFileSystemProvider('eda-deviation', deviationDetailsProviderLocal, { isCaseSensitive: true })
  //   );

  //   registerViewCommands(
  //     context,
  //     crdFsProvider,
  //     transactionDetailsProviderLocal,
  //     alarmDetailsProviderLocal,
  //     deviationDetailsProviderLocal
  //   );
  //   registerDeviationCommands(context, edaDeviationProvider);
  //   registerTransactionCommands(context);

  //   log('Service architecture initialized successfully', LogLevel.INFO, true);
  } catch (error) {
    log(`Error initializing service architecture: ${error}`, LogLevel.ERROR, true);
    vscode.window.showErrorMessage(`Failed to initialize EDA extension: ${error}`);
  }

  // const k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');

  // context.subscriptions.push(
  //   vscode.commands.registerCommand('vscode-eda.switchContext', async () => {
  //     try {
  //       const contexts = k8sClient.getAvailableContexts();
  //       if (!contexts || contexts.length === 0) {
  //         vscode.window.showWarningMessage('No Kubernetes contexts found in your kubeconfig.');
  //         return;
  //       }

  //       const newContext = await vscode.window.showQuickPick(contexts, {
  //         placeHolder: 'Select the new Kubernetes context'
  //       });
  //       if (!newContext) {
  //         return;
  //       }

  //       await k8sClient.switchContext(newContext);
  //       contextStatusBarItem.text = `$(kubernetes) EDA: ${k8sClient.getCurrentContext()}`;

  //       const rs = serviceManager.getService<ResourceService>('kubernetes-resources');
  //       rs.forceRefresh();

  //       vscode.window.showInformationMessage(`Switched to Kubernetes context: ${newContext}`);
  //     } catch (error) {
  //       vscode.window.showErrorMessage(`Error switching context: ${error}`);
  //     }
  //   })
  // );


  // log('EDA extension activated', LogLevel.INFO, true);
}

export function deactivate() {
  console.log('EDA extension deactivated');
  edaOutputChannel?.appendLine('EDA extension deactivated');
  edaOutputChannel?.dispose();
  try {
//     serviceManager.dispose();
  } catch (error) {
    console.error('Error disposing service manager:', error);
  }
}