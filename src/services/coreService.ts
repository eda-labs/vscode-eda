// src/services/coreService.ts
import * as vscode from 'vscode';

/**
 * Base class for all services
 */
export abstract class CoreService {
  protected _onDidChangeNamespace = new vscode.EventEmitter<string>();
  readonly onDidChangeNamespace = this._onDidChangeNamespace.event;
  
  protected namespace: string = 'default';
  
  /**
   * Set current namespace
   * @param namespace Namespace name
   * @param fireEvent Whether to fire the namespace change event
   */
  public setNamespace(namespace: string, fireEvent: boolean = true): void {
    this.namespace = namespace;
    
    if (fireEvent) {
      this._onDidChangeNamespace.fire(namespace);
    }
  }
  
  /**
   * Get current namespace
   */
  public getNamespace(): string {
    return this.namespace;
  }
  
  /**
   * Dispose service resources
   */
  public dispose(): void {
    this._onDidChangeNamespace.dispose();
  }
}