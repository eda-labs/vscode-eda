// src/providers/documents/resourceEditProvider.ts
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { BaseDocumentProvider } from './baseDocumentProvider';
import type { EdaCrd } from '../../types';

/**
 * A file system provider for the "k8s:" scheme, handling the editable version
 * of Kubernetes resources.
 */
export class ResourceEditDocumentProvider extends BaseDocumentProvider {
  // Store original resources to compare for changes
  private originalResources = new Map<string, any>();
  private crdInfo = new Map<string, EdaCrd>();
  private newResources = new Set<string>();

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

  public setCrdInfo(uri: vscode.Uri, crd: EdaCrd): void {
    this.crdInfo.set(uri.toString(), crd);
  }

  public getCrdInfo(uri: vscode.Uri): EdaCrd | undefined {
    return this.crdInfo.get(uri.toString());
  }

  public markNewResource(uri: vscode.Uri): void {
    this.newResources.add(uri.toString());
  }

  public clearNewResource(uri: vscode.Uri): void {
    this.newResources.delete(uri.toString());
  }

  public isNewResource(uri: vscode.Uri): boolean {
    return this.newResources.has(uri.toString());
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
    this.crdInfo.delete(uri.toString());
    this.newResources.delete(uri.toString());
  }

  /**
   * Parse a k8s URI to get namespace, kind, and name
   */
  static parseUri(uri: vscode.Uri): { namespace: string; kind: string; name: string } {
    // URI format: k8s:/namespace/kind/name?origin=eda|k8s
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
   * Determine the origin of a k8s URI
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
   * Create a k8s URI for a resource
   */
  static createUri(
    namespace: string,
    kind: string,
    name: string,
    origin?: 'eda' | 'k8s'
  ): vscode.Uri {
    const query = origin ? `?origin=${origin}` : '';
    return vscode.Uri.parse(`k8s:/${namespace}/${kind}/${name}${query}`);
  }

  /**
   * VS Code may attempt to create directories when saving. Since our provider
   * is backed by an in-memory map, we simply ignore these calls instead of
   * throwing a read-only error.
   */
  public createDirectory(_uri: vscode.Uri): void {
    // no-op
  }

  /**
   * Override to allow write operations for k8s resources
   */
  writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): void {
    void options;
    this.contentMap.set(uri.toString(), Buffer.from(content));
  }
}