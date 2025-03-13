import * as vscode from 'vscode';
import { serviceManager } from './services/serviceManager';
import { KubernetesClient } from './clients/kubernetesClient';
import { ResourceService } from './services/resourceService';
import { EdactlClient } from './clients/edactlClient';
import { EdaNamespaceProvider } from './providers/views/namespaceProvider';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

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

  try {
    log('Initializing service architecture...', LogLevel.INFO, true);

    // 1) Create the clients independently
    const edactlClient = new EdactlClient(/* no K8sClient needed here */);
    const k8sClient = new KubernetesClient();
    const currentContext = k8sClient.getCurrentContext();
    contextStatusBarItem.text = `$(kubernetes) EDA: ${currentContext}`;

    // 2) Optionally register them in your ServiceManager
    serviceManager.registerClient('edactl', edactlClient);
    serviceManager.registerClient('kubernetes', k8sClient);

    // 3) Let k8sClient know about edactlClient so it can call it
    k8sClient.setEdactlClient(edactlClient);

    // 4) Start watchers
    await k8sClient.startWatchers();

    // 5) Example: create ResourceService, etc.
    const resourceService = new ResourceService(k8sClient);
    serviceManager.registerService('kubernetes-resources', resourceService);

    // Show EDA namespaces after activation
    const edaNamespaces = await edactlClient.getEdaNamespaces();
    log(`EDA namespaces: ${edaNamespaces.join(', ')}`, LogLevel.INFO, true);

    // Initialize the namespace tree provider
    const namespaceProvider = new EdaNamespaceProvider(context);

    // Register the tree view
    const namespaceTreeView = vscode.window.createTreeView('edaNamespaces', {
      treeDataProvider: namespaceProvider,
      showCollapseAll: true
    });

    // Register the tree view to extension context
    context.subscriptions.push(namespaceTreeView);

    // Register the refresh command
    context.subscriptions.push(
      vscode.commands.registerCommand('vscode-eda.refreshResources', () => {
        namespaceProvider.refresh();
      })
    );

    // Register filter commands
    context.subscriptions.push(
      vscode.commands.registerCommand('vscode-eda.filterTree', async () => {
        const filterText = await vscode.window.showInputBox({
          prompt: 'Enter filter text',
          placeHolder: 'Filter resources...'
        });

        if (filterText !== undefined) {
          namespaceProvider.setTreeFilter(filterText);
        }
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('vscode-eda.clearFilter', () => {
        namespaceProvider.clearTreeFilter();
      })
    );


    log('Service architecture initialized successfully', LogLevel.INFO, true);
  } catch (error) {
    log(`Error initializing service architecture: ${error}`, LogLevel.ERROR, true);
    vscode.window.showErrorMessage(`Failed to initialize EDA extension: ${error}`);
  }

  const k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');

  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-eda.switchContext', async () => {
      try {
        // 1) Get the currently available contexts
        const contexts = k8sClient.getAvailableContexts();
        if (!contexts || contexts.length === 0) {
          vscode.window.showWarningMessage(
            'No Kubernetes contexts found in your kubeconfig.'
          );
          return;
        }

        // 2) Prompt user to pick one
        const newContext = await vscode.window.showQuickPick(contexts, {
          placeHolder: 'Select the new Kubernetes context'
        });
        if (!newContext) {
          return; // user cancelled
        }

        // 3) Switch context in K8sClient (this will dispose watchers and re-init them)
        await k8sClient.switchContext(newContext);

        // 4) Update status bar
        contextStatusBarItem.text = `$(kubernetes) EDA: ${k8sClient.getCurrentContext()}`;

        // 5) Force a refresh of your tree or any other UI components
        //    e.g., if you want to force ResourceService to fetch again:
        const resourceService = serviceManager.getService<ResourceService>('kubernetes-resources');
        resourceService.forceRefresh();

        // If you have any other UI that needs manual refresh, do so here
        // For example, if your EdaNamespaceProvider has a .refresh() method, call it:
        // const namespaceProvider = ... // if you have the instance
        // namespaceProvider.refresh();

        vscode.window.showInformationMessage(
          `Switched to Kubernetes context: ${newContext}`
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Error switching context: ${error}`);
      }
    })
  );


  log('EDA extension activated', LogLevel.INFO, true);
}

export function deactivate() {
  console.log('EDA extension deactivated');
  edaOutputChannel?.appendLine('EDA extension deactivated');
  edaOutputChannel?.dispose();
  try {
    serviceManager.dispose();
  } catch (error) {
    console.error('Error disposing service manager:', error);
  }
}