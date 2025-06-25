import * as vscode from 'vscode';
import { KubernetesClient } from './clients/kubernetesClient';
import { EdaClient } from './clients/edaClient';
import { serviceManager } from './services/serviceManager';
import { ResourceService } from './services/resourceService';
import { ResourceStatusService } from './services/resourceStatusService';
import { EdaNamespaceProvider } from './providers/views/namespaceProvider';
import { EdaAlarmProvider } from './providers/views/alarmProvider';
import { EdaDeviationProvider } from './providers/views/deviationProvider';
import { EdaTransactionProvider } from './providers/views/transactionProvider';
import { AlarmDetailsDocumentProvider } from './providers/documents/alarmDetailsProvider';
import { DeviationDetailsDocumentProvider } from './providers/documents/deviationDetailsProvider';
import { TransactionDetailsDocumentProvider } from './providers/documents/transactionDetailsProvider';
import { CrdDefinitionFileSystemProvider } from './providers/documents/crdDefinitionProvider';
import { ResourceEditDocumentProvider } from './providers/documents/resourceEditProvider';
import { ResourceViewDocumentProvider } from './providers/documents/resourceViewProvider';
import { SchemaProviderService } from './services/schemaProviderService';
import { PodDescribeDocumentProvider } from './providers/documents/podDescribeProvider';
import { registerPodCommands } from './commands/podCommands';
import { registerDeploymentCommands } from './commands/deploymentCommands';

import { registerResourceViewCommands } from './commands/resourceViewCommands';
import { registerDeviationCommands } from './commands/deviationCommands';
import { registerTransactionCommands } from './commands/transactionCommands';
import { registerViewCommands } from './commands/viewCommands';
import { registerResourceEditCommands } from './commands/resourceEditCommands';
import { registerResourceCreateCommand } from './commands/resourceCreateCommand';
import { registerCredentialCommands } from './commands/credentialCommands';
// import { registerResourceDeleteCommand } from './commands/resourceDeleteCommand';
// import { registerResourceViewCommands } from './commands/resourceViewCommands';
// import { registerEngineConfigCommands } from './commands/engineConfigCommands';
// import { CrdDefinitionFileSystemProvider } from './providers/documents/crdDefinitionProvider';

export interface EdaTargetConfig {
  context?: string;
  edaUsername?: string;
  kcUsername?: string;
}



/* eslint-disable no-unused-vars */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}
/* eslint-enable no-unused-vars */

export let edaDeviationProvider: EdaDeviationProvider;
export let edaTransactionProvider: EdaTransactionProvider;
export let alarmDetailsProvider: AlarmDetailsDocumentProvider;
export let deviationDetailsProvider: DeviationDetailsDocumentProvider;
export let transactionDetailsProvider: TransactionDetailsDocumentProvider;
export let resourceViewProvider: ResourceViewDocumentProvider;
export let resourceEditProvider: ResourceEditDocumentProvider;
export let podDescribeProvider: PodDescribeDocumentProvider;
export let edaOutputChannel: vscode.OutputChannel;
export let currentLogLevel: LogLevel = LogLevel.INFO;
let contextStatusBarItem: vscode.StatusBarItem;

async function verifyKubernetesContext(
  edaClient: EdaClient,
  k8sClient: KubernetesClient
): Promise<void> {
  try {
    await edaClient.getStreamNames();
    const edaNamespaces = edaClient.getCachedNamespaces();
    const k8sNsObjs = await k8sClient.listNamespaces();
    const k8sNamespaces = k8sNsObjs
      .map((n: any) => n?.metadata?.name)
      .filter((n: any) => typeof n === 'string');
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
  console.log('Activating EDA extension');
  edaOutputChannel = vscode.window.createOutputChannel('EDA');

  const config = vscode.workspace.getConfiguration('vscode-eda');
  currentLogLevel = config.get<LogLevel>('logLevel', LogLevel.INFO);

  log('EDA extension activating...', LogLevel.INFO, true);
  let edaUrl = 'https://eda-api';
  let edaContext: string | undefined;
  let edaUsername = config.get<string>('edaUsername', 'admin');
  let kcUsername = config.get<string>('kcUsername', 'admin');
  const edaTargetsCfg = config.get<Record<string, string | EdaTargetConfig | undefined>>('edaTargets');
  const targetEntries = edaTargetsCfg ? Object.entries(edaTargetsCfg) : [];
  if (targetEntries.length > 0) {
    const idx = context.globalState.get<number>('selectedEdaTarget', 0) ?? 0;
    const [url, val] = targetEntries[Math.min(idx, targetEntries.length - 1)];
    edaUrl = url;
    if (typeof val === 'string' || val === null) {
      edaContext = val || undefined;
    } else if (val) {
      edaContext = val.context || undefined;
      if (val.edaUsername) {
        edaUsername = val.edaUsername;
      }
      if (val.kcUsername) {
        kcUsername = val.kcUsername;
      }
    }
  }
  const edaPasswordCfg = config.get<string>('edaPassword');
  const kcPasswordCfg = config.get<string>('kcPassword');
  const secrets = context.secrets;

  async function getOrPromptSecret(
    key: string,
    prompt: string,
    cfgVal?: string
  ): Promise<string> {
    if (cfgVal) {
      await secrets.store(key, cfgVal);
      return cfgVal;
    }
    let val = await secrets.get(key);
    if (!val) {
      val = await vscode.window.showInputBox({ prompt, password: true, ignoreFocusOut: true });
      if (val) {
        await secrets.store(key, val);
      } else {
        val = '';
      }
    }
    return val;
  }

  const hostKey = (() => {
    try {
      return new URL(edaUrl).host;
    } catch {
      return edaUrl;
    }
  })();

  const edaPassword = await getOrPromptSecret(`edaPassword:${hostKey}`, 'Enter EDA password', edaPasswordCfg);
  const kcPassword = await getOrPromptSecret(`kcPassword:${hostKey}`, 'Enter Keycloak admin password', kcPasswordCfg);

  // Remove plaintext passwords from configuration after storing them in secrets
  if (edaPasswordCfg) {
    const inspect = config.inspect<string>('edaPassword');
    if (inspect?.globalValue !== undefined) {
      await config.update('edaPassword', undefined, vscode.ConfigurationTarget.Global);
    }
    if (inspect?.workspaceValue !== undefined) {
      await config.update('edaPassword', undefined, vscode.ConfigurationTarget.Workspace);
    }
    if (inspect?.workspaceFolderValue !== undefined) {
      await config.update('edaPassword', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
    }
  }

  if (kcPasswordCfg) {
    const inspect = config.inspect<string>('kcPassword');
    if (inspect?.globalValue !== undefined) {
      await config.update('kcPassword', undefined, vscode.ConfigurationTarget.Global);
    }
    if (inspect?.workspaceValue !== undefined) {
      await config.update('kcPassword', undefined, vscode.ConfigurationTarget.Workspace);
    }
    if (inspect?.workspaceFolderValue !== undefined) {
      await config.update('kcPassword', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
    }
  }
  const clientId = config.get<string>('clientId', 'eda');
  const clientSecret = config.get<string>('clientSecret', '');
  const skipTlsVerify = config.get<boolean>('skipTlsVerify', false);
  const disableKubernetes =
    !edaContext ||
    config.get<boolean>('disableKubernetes', false) ||
    process.env.EDA_DISABLE_K8S === 'true';

  // Create a status bar item for showing current EDA target
  contextStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  // Clicking the status bar item will trigger our switchTarget command:
  contextStatusBarItem.command = 'vscode-eda.switchContext';
  contextStatusBarItem.tooltip =
    'Switch the current EDA API URL and Kubernetes context';
  contextStatusBarItem.show();
  context.subscriptions.push(contextStatusBarItem);
//
  try {
    log('Initializing service architecture...', LogLevel.INFO, true);

    // 1) Create the clients independently

    const k8sClient = disableKubernetes ? undefined : new KubernetesClient();
    const edaClient = new EdaClient(edaUrl, {
      edaUsername,
      edaPassword,
      kcUsername,
      kcPassword,
      clientId,
      clientSecret: clientSecret || undefined,
      skipTlsVerify
    });
    if (k8sClient && edaContext) {
      await k8sClient.switchContext(edaContext);
    }
    if (contextStatusBarItem) {
      const host = (() => {
        try {
          return new URL(edaUrl).host;
        } catch {
          return edaUrl;
        }
      })();
      const ctxText = edaContext ? ` (${edaContext})` : '';
      contextStatusBarItem.text = `$(server) ${host}${ctxText}`;
    }

    // 2) Optionally register them in your ServiceManager
    serviceManager.registerClient('eda', edaClient);
    if (k8sClient) {
      serviceManager.registerClient('kubernetes', k8sClient);
      await verifyKubernetesContext(edaClient, k8sClient);
    }

    const resourceStatusService = new ResourceStatusService(k8sClient);
    serviceManager.registerService('resource-status', resourceStatusService);
    void resourceStatusService.initialize(context);

    if (k8sClient) {
      const resourceService = new ResourceService(k8sClient);
      serviceManager.registerService('kubernetes-resources', resourceService);

      resourceViewProvider = new ResourceViewDocumentProvider();
      context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider('k8s-view', resourceViewProvider, { isCaseSensitive: true })
      );
      registerResourceViewCommands(context, resourceViewProvider);

      resourceEditProvider = new ResourceEditDocumentProvider();
      context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider('k8s', resourceEditProvider, { isCaseSensitive: true })
      );
      registerResourceCreateCommand(context, resourceEditProvider);
      registerResourceEditCommands(context, resourceEditProvider, resourceViewProvider);

      podDescribeProvider = new PodDescribeDocumentProvider();
      context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider('k8s-describe', podDescribeProvider, { isCaseSensitive: true })
      );
      registerPodCommands(context, podDescribeProvider);
      registerDeploymentCommands(context);
    }

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

  edaDeviationProvider = new EdaDeviationProvider();
  const deviationTreeView = vscode.window.createTreeView('edaDeviations', {
    treeDataProvider: edaDeviationProvider,
    showCollapseAll: true
  });

  edaTransactionProvider = new EdaTransactionProvider();
  const transactionTreeView = vscode.window.createTreeView('edaTransactions', {
    treeDataProvider: edaTransactionProvider,
    showCollapseAll: true
  });

  context.subscriptions.push(namespaceTreeView);
  context.subscriptions.push(alarmTreeView);


  // Allow the user to filter all tree views
  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-eda.filterTree', async () => {
      const filterText = await vscode.window.showInputBox({
        prompt: 'Filter resources by text',
        placeHolder: 'Enter filter text'
      });
      if (filterText !== undefined) {
        const text = filterText.trim();
        namespaceProvider.setTreeFilter(text);
        alarmProvider.setTreeFilter(text);
        edaDeviationProvider.setTreeFilter(text);
        edaTransactionProvider.setTreeFilter(text);
      }
    })
  );

  // Clear any active tree filter
  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-eda.clearFilter', () => {
      namespaceProvider.clearTreeFilter();
      alarmProvider.clearTreeFilter();
      edaDeviationProvider.clearTreeFilter();
      edaTransactionProvider.clearTreeFilter();
    })
  );

  context.subscriptions.push(namespaceTreeView);
  context.subscriptions.push(alarmTreeView);
  context.subscriptions.push(deviationTreeView, { dispose: () => edaDeviationProvider.dispose() });
  context.subscriptions.push(transactionTreeView, { dispose: () => edaTransactionProvider.dispose() });


  const crdFsProvider = new CrdDefinitionFileSystemProvider();
  const transactionDetailsProviderLocal = new TransactionDetailsDocumentProvider();
  const alarmDetailsProviderLocal = new AlarmDetailsDocumentProvider();
  const deviationDetailsProviderLocal = new DeviationDetailsDocumentProvider();

  alarmDetailsProvider = alarmDetailsProviderLocal;
  deviationDetailsProvider = deviationDetailsProviderLocal;
  transactionDetailsProvider = transactionDetailsProviderLocal;

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('crd', crdFsProvider, { isCaseSensitive: true }),
    vscode.workspace.registerFileSystemProvider('eda-transaction', transactionDetailsProviderLocal, { isCaseSensitive: true }),
    vscode.workspace.registerFileSystemProvider('eda-alarm', alarmDetailsProviderLocal, { isCaseSensitive: true }),
    vscode.workspace.registerFileSystemProvider('eda-deviation', deviationDetailsProviderLocal, { isCaseSensitive: true })
  );

  registerViewCommands(
    context,
    crdFsProvider,
    transactionDetailsProviderLocal,
    alarmDetailsProviderLocal,
    deviationDetailsProviderLocal
  );
  registerDeviationCommands(context);
  registerTransactionCommands(context);
  registerCredentialCommands(context);

  //   log('Service architecture initialized successfully', LogLevel.INFO, true);
  } catch (error) {
    log(`Error initializing service architecture: ${error}`, LogLevel.ERROR, true);
    vscode.window.showErrorMessage(`Failed to initialize EDA extension: ${error}`);
  }

  const switchCmd = vscode.commands.registerCommand('vscode-eda.switchContext', async () => {
    const targetsMap = config.get<Record<string, string | EdaTargetConfig | undefined>>('edaTargets') || {};
    const entries = Object.entries(targetsMap);
    if (entries.length === 0) {
      vscode.window.showInformationMessage('No EDA targets configured.');
      return;
    }
    const items = entries.map(([url, val], i) => {
      const ctx = typeof val === 'string' || val === null ? val : val?.context;
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
    edaUrl = entries[choice.index][0];
    const val = entries[choice.index][1];
    edaContext = typeof val === 'string' || val === null ? val || undefined : val?.context || undefined;
    if (contextStatusBarItem) {
      const ctxVal = entries[choice.index][1];
      const ctx = typeof ctxVal === 'string' || ctxVal === null ? ctxVal : ctxVal?.context;
      const host = (() => {
        try {
          return new URL(entries[choice.index][0]).host;
        } catch {
          return entries[choice.index][0];
        }
      })();
      const ctxText = ctx ? ` (${ctx})` : '';
      contextStatusBarItem.text = `$(server) ${host}${ctxText}`;
    }

    vscode.window.showInformationMessage('EDA target updated. Reload window to apply.', 'Reload').then(value => {
      if (value === 'Reload') {
        void vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    });
  });

  context.subscriptions.push(switchCmd);


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