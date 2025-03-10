import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { KubernetesService } from '../../services/kubernetes/kubernetes';
import { log, LogLevel } from '../../extension.js';

/**
 * Interface for a K8s resource with minimum required fields
 */
interface K8sResource {
  apiVersion?: string;
  kind: string;
  metadata?: {
    name: string;
    namespace?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

/**
 * File system provider for Kubernetes resources with a custom URI scheme
 * Format: k8s://namespace/kind/name
 */
export class K8sFileSystemProvider implements vscode.FileSystemProvider {
  private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  // Map to store original resources
  private originalResources = new Map<string, any>();

  // Map to store file contents for virtual files
  private fileContents = new Map<string, Uint8Array>();

  constructor(private k8sService: KubernetesService) {}

  setFileContent(uri: vscode.Uri, content: Uint8Array): void {
    this.fileContents.set(uri.toString(), content);
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
   * Store the original resource for a given URI
   */
  setOriginalResource(uri: vscode.Uri, resource: any): void {
    // Make a deep copy so we don't mutate
    this.originalResources.set(uri.toString(), JSON.parse(JSON.stringify(resource)));
  }

  /**
   * Get the original resource for a given URI
   */
  getOriginalResource(uri: vscode.Uri): any {
    return this.originalResources.get(uri.toString());
  }

  /**
   * Get API version based on resource kind using a pattern
   */
  private getApiVersionForKind(kind: string): string {
    // Standard Kubernetes resources need specific handling
    const k8sResources: Record<string, string> = {
      'Pod': 'v1',
      'Service': 'v1',
      'Deployment': 'apps/v1',
      'ConfigMap': 'v1',
      'Secret': 'v1',
      'Node': 'v1'
    };

    // Check if it's a standard K8s resource
    if (k8sResources[kind]) {
      return k8sResources[kind];
    }

    // For EDA CRDs, follow the pattern: lowercase plural form + ".eda.nokia.com/v1alpha1"
    let plural = kind.toLowerCase();
    if (plural.endsWith('f')) {
      plural = plural.slice(0, -1) + 'ves'; // e.g., MacVrf -> macvrves
    } else if (plural.endsWith('y')) {
      plural = plural.slice(0, -1) + 'ies'; // e.g., Policy -> policies
    } else if (!plural.endsWith('s')) {
      plural += 's'; // e.g., Interface -> interfaces
    }

    return `${plural}.eda.nokia.com/v1alpha1`;
  }

  // -- FileSystemProvider implementation --

  watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
    // We don't need to watch for external changes as we control all changes
    return new vscode.Disposable(() => {});
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    return {
      type: vscode.FileType.File,
      ctime: Date.now(),
      mtime: Date.now(),
      size: this.fileContents.get(uri.toString())?.length || 0
    };
  }

  readDirectory(_uri: vscode.Uri): [string, vscode.FileType][] {
    // Not supporting directory operations
    return [];
  }

  createDirectory(_uri: vscode.Uri): void {
    // Not supporting directory operations
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const uriString = uri.toString();

    // Return cached content if available
    if (this.fileContents.has(uriString)) {
      return this.fileContents.get(uriString)!;
    }

    try {
      // Get resource info from URI
      const { namespace, kind, name } = K8sFileSystemProvider.parseUri(uri);
      log(`Fetching ${kind}/${name} from namespace ${namespace}...`, LogLevel.INFO);

      // Get YAML directly from Kubernetes service - optimized to use kubectl when possible
      let yamlContent = await this.k8sService.getResourceYaml(kind, name, namespace);

      // Check if the YAML has apiVersion (might be missing in edactl output)
      const hasApiVersion = yamlContent.includes('apiVersion:');

      if (!hasApiVersion) {
        // Add the appropriate apiVersion based on the kind
        const apiVersion = this.getApiVersionForKind(kind);
        yamlContent = `apiVersion: ${apiVersion}\n${yamlContent}`;
      }

      // Store content
      const contentBuffer = Buffer.from(yamlContent, 'utf8');
      this.fileContents.set(uriString, contentBuffer);

      // Try to parse the YAML to get resource for comparison
      try {
        const resource = yaml.load(yamlContent) as K8sResource;
        if (resource && typeof resource === 'object') {
          this.setOriginalResource(uri, resource);
        }
      } catch (parseError) {
        // If we can't parse, create a minimal resource object
        log(`Could not parse YAML: ${parseError}`, LogLevel.DEBUG);
        const minimalResource: K8sResource = {
          kind: kind,
          apiVersion: this.getApiVersionForKind(kind),
          metadata: {
            name: name,
            namespace: namespace
          }
        };
        this.setOriginalResource(uri, minimalResource);
      }

      return contentBuffer;
    } catch (error) {
      log(`Error reading file: ${error}`, LogLevel.ERROR);
      const errorContent = `# Error loading resource: ${error}`;
      const contentBuffer = Buffer.from(errorContent, 'utf8');
      this.fileContents.set(uriString, contentBuffer);
      return contentBuffer;
    }
  }

  writeFile(uri: vscode.Uri, content: Uint8Array, _options: { create: boolean; overwrite: boolean }): void {
    const uriString = uri.toString();
    this.fileContents.set(uriString, content);

    // Notify that the file has changed
    this._onDidChangeFile.fire([{
      type: vscode.FileChangeType.Changed,
      uri
    }]);
  }

  delete(uri: vscode.Uri, _options: { recursive: boolean }): void {
    const uriString = uri.toString();
    this.fileContents.delete(uriString);
    this.originalResources.delete(uriString);
  }

  rename(_oldUri: vscode.Uri, _newUri: vscode.Uri, _options: { overwrite: boolean }): void {
    // Not supporting rename operations
    throw new Error('Rename operation not supported for Kubernetes resources');
  }

  /**
   * Clean up resources when a document is closed
   */
  cleanupDocument(uri: vscode.Uri): void {
    const uriString = uri.toString();
    this.originalResources.delete(uriString);
    this.fileContents.delete(uriString);
  }

  /**
   * Get the current document text as a string
   */
  getContentAsString(uri: vscode.Uri): string {
    const uriString = uri.toString();
    if (this.fileContents.has(uriString)) {
      return Buffer.from(this.fileContents.get(uriString)!).toString('utf8');
    }
    return '';
  }

  /**
   * Check if the current content has changes compared to the original
   */
  async hasChanges(uri: vscode.Uri, bypassChangesCheck: boolean = false): Promise<boolean> {
    // If bypass is requested, always return true
    if (bypassChangesCheck) {
      return true;
    }

    const uriString = uri.toString();
    if (!this.fileContents.has(uriString)) {
      return false;
    }

    const originalResource = this.getOriginalResource(uri);
    if (!originalResource) {
      return true;
    }

    try {
      const currentContent = this.getContentAsString(uri);
      const currentResource = yaml.load(currentContent);

      // Compare the two resources (ignoring metadata fields that change automatically)
      const originalCopy = JSON.parse(JSON.stringify(originalResource));
      const currentCopy = JSON.parse(JSON.stringify(currentResource));

      // Remove fields that change automatically
      const cleanMetadata = (obj: any) => {
        if (obj && obj.metadata) {
          delete obj.metadata.resourceVersion;
          delete obj.metadata.generation;
          delete obj.metadata.creationTimestamp;
          delete obj.metadata.uid;
          delete obj.metadata.managedFields;
        }
      };

      cleanMetadata(originalCopy);
      cleanMetadata(currentCopy);

      return JSON.stringify(originalCopy) !== JSON.stringify(currentCopy);
    } catch (error) {
      log(`Error checking for changes: ${error}`, LogLevel.ERROR);
      return true;
    }
  }
}