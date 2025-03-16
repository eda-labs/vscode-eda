// src/providers/documents/resourceEditProvider.ts
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { BaseDocumentProvider } from './baseDocumentProvider';

/**
 * A file system provider for the "k8s:" scheme, handling the editable version
 * of Kubernetes resources.
 */
export class ResourceEditDocumentProvider extends BaseDocumentProvider {
  // Store original resources to compare for changes
  private originalResources = new Map<string, any>();

  public stat(uri: vscode.Uri): vscode.FileStat {
    // re-use the base logic, but remove 'readonly' permission
    const data = this.contentMap.get(uri.toString());
    if (!data) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: data.byteLength,
    };
  }

  /**
   * Store the YAML content for a given `k8s:` URI.
   */
  public setResourceContent(uri: vscode.Uri, yamlContent: string): void {
    this.setContent(uri, yamlContent);
  }

  /**
   * Store the original resource for a URI (used for diffs and change tracking)
   */
  public setOriginalResource(uri: vscode.Uri, resource: any): void {
    this.originalResources.set(uri.toString(), resource);
  }

  /**
   * Get the original resource for a URI
   */
  public getOriginalResource(uri: vscode.Uri): any {
    return this.originalResources.get(uri.toString());
  }

  /**
   * Check if the current resource has changes compared to the original
   */
  public async hasChanges(uri: vscode.Uri): Promise<boolean> {
    try {
      // Get the original resource
      const originalResource = this.originalResources.get(uri.toString());
      if (!originalResource) {
        return false;
      }

      // Get the current content
      const currentContent = this.readFile(uri);
      const currentYaml = Buffer.from(currentContent).toString('utf8');

      // Parse the YAML
      const currentResource = yaml.load(currentYaml);

      // Convert both to normalized YAML strings to compare
      const normalizedOriginal = yaml.dump(originalResource, { indent: 2 });
      const normalizedCurrent = yaml.dump(currentResource, { indent: 2 });

      return normalizedOriginal !== normalizedCurrent;
    } catch (error) {
      console.error('Error checking for changes', error);
      return true; // Assume there are changes if we can't check
    }
  }

  /**
   * Clean up resources when a document is closed
   */
  public cleanupDocument(uri: vscode.Uri): void {
    this.contentMap.delete(uri.toString());
    this.originalResources.delete(uri.toString());
  }

  /**
   * Parse a k8s URI to get namespace, kind, and name
   */
  static parseUri(uri: vscode.Uri): { namespace: string; kind: string; name: string } {
    // URI format: k8s:/namespace/kind/name
    const parts = uri.path.split('/').filter(p => p.length > 0);
    if (parts.length !== 3) {
      throw new Error(`Invalid k8s URI format: ${uri}`);
    }
    return {
      namespace: parts[0],
      kind: parts[1],
      name: parts[2]
    };
  }

  /**
   * Create a k8s URI for a resource
   */
  static createUri(namespace: string, kind: string, name: string): vscode.Uri {
    return vscode.Uri.parse(`k8s:/${namespace}/${kind}/${name}`);
  }

  /**
   * Override to allow write operations for k8s resources
   */
  writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): void {
    this.contentMap.set(uri.toString(), Buffer.from(content));
  }
}