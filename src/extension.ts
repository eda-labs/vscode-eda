import * as vscode from 'vscode';
import { serviceManager } from './services/serviceManager';
import { KubernetesClient } from './clients/kubernetesClient';
import { ResourceService } from './services/resourceService';

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
    await serviceManager.initialize(context);
    const k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');

    await k8sClient.startWatchers();
    
    const resourceService = new ResourceService(k8sClient);
    serviceManager.registerService('kubernetes-resources', resourceService);
    
    // Register commands
    const runTestsCommand = vscode.commands.registerCommand('vscode-eda.runResourceTests', async () => {
      const resourceSvc = serviceManager.getService<ResourceService>('kubernetes-resources');
      await resourceSvc.runResourceFetchTests();
    });
    
    context.subscriptions.push(runTestsCommand);
    log('Service architecture initialized successfully', LogLevel.INFO, true);
    
    // Run resource tests during activation
    const resourceSvc = serviceManager.getService<ResourceService>('kubernetes-resources');
    await resourceSvc.runResourceFetchTests();
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