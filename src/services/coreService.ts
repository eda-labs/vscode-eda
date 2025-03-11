// src/services/coreService.ts
import * as vscode from 'vscode';
import { LogLevel, log } from '../extension';

/**
 * Abstract base class for all services
 */
export abstract class CoreService {
  protected namespace: string = 'default';
  protected _onDidChangeNamespace = new vscode.EventEmitter<string>();
  readonly onDidChangeNamespace = this._onDidChangeNamespace.event;
  
  constructor(protected name: string) {
    log(`Initializing ${name} service`, LogLevel.INFO);
  }
  
  /**
   * Set the current namespace
   * @param namespace Namespace name
   * @param shouldLog Whether to log the namespace change
   */
  public setNamespace(namespace: string, shouldLog: boolean = true): void {
    if (this.namespace === namespace) {
      return;
    }
    
    this.namespace = namespace;
    
    if (shouldLog) {
      log(`${this.name}: set namespace to '${namespace}'`, LogLevel.INFO);
    }
    
    this._onDidChangeNamespace.fire(namespace);
  }
  
  /**
   * Get the current namespace
   * @returns Current namespace
   */
  public getCurrentNamespace(): string {
    return this.namespace;
  }
  
  /**
   * Log message with service prefix
   * @param message Message to log
   * @param level Log level
   * @param forceLog Force logging regardless of level
   */
  protected logWithPrefix(message: string, level: LogLevel = LogLevel.INFO, forceLog: boolean = false): void {
    log(`[${this.name}] ${message}`, level, forceLog);
  }
  
  /**
   * Dispose service resources
   */
  public dispose(): void {
    this._onDidChangeNamespace.dispose();
  }
}