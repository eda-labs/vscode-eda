import type * as vscode from 'vscode';

import { BaseDocumentProvider } from './baseDocumentProvider';

/**
 * A read-only provider for the "crd:" scheme, storing CRD YAML in memory.
 */
export class CrdDefinitionFileSystemProvider extends BaseDocumentProvider {
  /**
   * Store the YAML in memory for the given `crd:` URI.
   */
  public setCrdYaml(uri: vscode.Uri, yamlContent: string): void {
    this.setContent(uri, yamlContent);
  }
}