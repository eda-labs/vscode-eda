import * as vscode from 'vscode';

import { ALL_NAMESPACES } from '../webviews/constants';

const ALL_RESOURCE_NAMESPACES_VALUE = '__all_namespaces__';

function normalizeNamespace(namespace: string | undefined): string {
  if (!namespace || namespace === ALL_RESOURCE_NAMESPACES_VALUE) {
    return ALL_NAMESPACES;
  }
  return namespace;
}

export class NamespaceSelectionService implements vscode.Disposable {
  private selectedNamespace = ALL_NAMESPACES;
  private readonly changeEmitter = new vscode.EventEmitter<string>();

  public readonly onDidChangeSelection = this.changeEmitter.event;

  public getSelectedNamespace(): string {
    return this.selectedNamespace;
  }

  public setSelectedNamespace(namespace: string | undefined): void {
    const normalized = normalizeNamespace(namespace);
    if (normalized === this.selectedNamespace) {
      return;
    }
    this.selectedNamespace = normalized;
    this.changeEmitter.fire(this.selectedNamespace);
  }

  public dispose(): void {
    this.changeEmitter.dispose();
  }
}

export const namespaceSelectionService = new NamespaceSelectionService();
