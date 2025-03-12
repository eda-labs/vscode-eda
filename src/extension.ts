import * as vscode from 'vscode';
import { serviceManager } from './services/serviceManager';
import { KubernetesClient } from './clients/kubernetesClient';
import { ResourceService } from './services/resourceService';
import { EdactlClient } from './clients/edactlClient';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export let edaOutputChannel: vscode.OutputChannel;
export let currentLogLevel: LogLevel = LogLevel.INFO;

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

  try {
    log('Initializing service architecture...', LogLevel.INFO, true);

    // 1) Create the clients independently
    const edactlClient = new EdactlClient(/* no K8sClient needed here */);
    const k8sClient = new KubernetesClient();

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

    log('Service architecture initialized successfully', LogLevel.INFO, true);
  } catch (error) {
    log(`Error initializing service architecture: ${error}`, LogLevel.ERROR, true);
    vscode.window.showErrorMessage(`Failed to initialize EDA extension: ${error}`);
  }

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