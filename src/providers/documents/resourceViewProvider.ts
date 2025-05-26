// Updated src/providers/documents/resourceViewProvider.ts
import * as vscode from 'vscode';
import { BaseDocumentProvider } from './baseDocumentProvider';

/**
 * A read-only provider for the "k8s-view:" scheme, displaying resources in read-only mode.
 */
export class ResourceViewDocumentProvider extends BaseDocumentProvider {
  /**
   * Store the YAML content for a given `k8s-view:` URI.
   */
  public setResourceContent(uri: vscode.Uri, yamlContent: string): void {
    this.setContent(uri, yamlContent);
  }

  /**
   * Parse a k8s-view URI to get namespace, kind, and name
   */
  static parseUri(uri: vscode.Uri): { namespace: string; kind: string; name: string } {
    // URI format: k8s-view:/namespace/kind/name
    const parts = uri.path.split('/').filter(p => p.length > 0);
    if (parts.length !== 3) {
      throw new Error(`Invalid k8s-view URI format: ${uri}`);
    }
    return {
      namespace: parts[0],
      kind: parts[1],
      name: parts[2]
    };
  }

  /**
   * Create a k8s-view URI for a resource
   */
  static createUri(namespace: string, kind: string, name: string): vscode.Uri {
    return vscode.Uri.parse(`k8s-view:/${namespace}/${kind}/${name}`);
  }

  /**
   * Override writeFile to explicitly throw NoPermissions
   */
  writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): void {
    void uri;
    void content;
    void options;
    throw vscode.FileSystemError.NoPermissions("This document is read-only. Use 'Switch to Edit' to modify.");
  }
}