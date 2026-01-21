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
    // URI format: k8s-view:/namespace/kind/name?origin=eda|k8s
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
   * Determine the origin of a k8s-view URI
   */
  static getOrigin(uri: vscode.Uri): 'eda' | 'k8s' | undefined {
    const params = new URLSearchParams(uri.query);
    const origin = params.get('origin');
    if (origin === 'eda' || origin === 'k8s') {
      return origin;
    }
    return undefined;
  }

  /**
   * Create a k8s-view URI for a resource
   */
  static createUri(
    namespace: string,
    kind: string,
    name: string,
    origin?: 'eda' | 'k8s'
  ): vscode.Uri {
    const query = origin ? `?origin=${origin}` : '';
    return vscode.Uri.parse(`k8s-view:/${namespace}/${kind}/${name}${query}`);
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