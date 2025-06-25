import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { CoreService } from './coreService';
import { log, LogLevel } from '../extension';
import { ResourceViewDocumentProvider } from '../providers/documents/resourceViewProvider';
import { ResourceEditDocumentProvider } from '../providers/documents/resourceEditProvider';
import { EdaCrd } from '../types';

export class SchemaProviderService extends CoreService {
  private schemaCacheDir: string;
  private disposables: vscode.Disposable[] = [];
  private schemaCache = new Map<string, string>();
  private yamlApi: any | null = null;
  private context!: vscode.ExtensionContext;

  constructor() {
    super();
    this.schemaCacheDir = path.join(os.tmpdir(), 'vscode-eda-schemas');
    if (!fs.existsSync(this.schemaCacheDir)) {
      fs.mkdirSync(this.schemaCacheDir, { recursive: true });
    }
  }

  public async initialize(context: vscode.ExtensionContext): Promise<void> {
    this.context = context;
    this.disposables.push(
      vscode.commands.registerCommand('vscode-eda.refreshSchemas', async () => {
        await this.loadSchemas();
        vscode.workspace.textDocuments.forEach(d => this.handleDocument(d));
      }),
      vscode.workspace.onDidOpenTextDocument(doc => void this.handleDocument(doc)),
      vscode.workspace.onDidSaveTextDocument(doc => void this.handleDocument(doc))
    );

    await this.loadSchemas();
    await this.activateYamlExtension();
    vscode.workspace.textDocuments.forEach(d => void this.handleDocument(d));
    context.subscriptions.push(...this.disposables);
    log('Registered schema provider for YAML validation', LogLevel.INFO, true);
  }

  private async findSpecDir(): Promise<string> {
    const baseDir = path.join(os.homedir(), '.eda');
    try {
      const entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
      if (dirs.length > 0) {
        return path.join(baseDir, dirs[dirs.length - 1]);
      }
    } catch {
      // ignore
    }
    throw new Error(`No EDA specifications found in ${baseDir}`);
  }

  private async loadSchemas(): Promise<void> {
    this.schemaCache.clear();
    if (!fs.existsSync(this.schemaCacheDir)) {
      fs.mkdirSync(this.schemaCacheDir, { recursive: true });
    }
    const specDir = await this.findSpecDir();
    await this.scanSpecDir(specDir);
  }

  private async scanSpecDir(dir: string): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.scanSpecDir(full);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        await this.processSpecFile(full);
      }
    }
  }

  private async processSpecFile(file: string): Promise<void> {
    try {
      const content = await fs.promises.readFile(file, 'utf8');
      const json = JSON.parse(content);
      const schemas = json.components?.schemas ?? {};
      for (const [name, schema] of Object.entries<any>(schemas)) {
        const kind =
          schema?.properties?.kind?.default ||
          (Array.isArray(schema?.properties?.kind?.enum) ? schema.properties.kind.enum[0] : undefined) ||
          name.split('.').pop();
        if (typeof kind === 'string') {
          const schemaPath = path.join(this.schemaCacheDir, `${kind.toLowerCase()}.json`);
          await fs.promises.writeFile(schemaPath, JSON.stringify(schema, null, 2));
          this.schemaCache.set(kind, schemaPath);
        }
      }
    } catch (err) {
      log(`Failed to load schema from ${file}: ${err}`, LogLevel.WARN);
    }
  }

  private async handleDocument(document: vscode.TextDocument): Promise<void> {
    if (document.languageId !== 'yaml') {
      return;
    }
    try {
      let kind: string | undefined;
      if (document.uri.scheme === 'k8s-view') {
        kind = ResourceViewDocumentProvider.parseUri(document.uri).kind;
      } else if (document.uri.scheme === 'k8s') {
        kind = ResourceEditDocumentProvider.parseUri(document.uri).kind;
      } else {
        const parsed = yaml.load(document.getText()) as any;
        if (parsed && typeof parsed === 'object') {
          kind = parsed.kind as string | undefined;
        }
      }
      if (kind) {
        await this.getOrCreateSchemaForKind(kind);
      }
    } catch (err) {
      log(`Error handling document: ${err}`, LogLevel.ERROR);
    }
  }

  private async getOrCreateSchemaForKind(kind: string): Promise<string | null> {
    if (this.schemaCache.has(kind)) {
      return this.schemaCache.get(kind) || null;
    }
    return null;
  }

  private async activateYamlExtension(): Promise<void> {
    try {
      const ext = vscode.extensions.getExtension('redhat.vscode-yaml');
      if (!ext) {
        log('YAML extension not found; schema validation disabled', LogLevel.WARN);
        return;
      }
      this.yamlApi = await ext.activate();
      if (!this.yamlApi?.registerContributor) {
        log('YAML extension API missing registerContributor', LogLevel.WARN);
        return;
      }
      this.yamlApi.registerContributor(
        'vscode-eda',
        (resource: string) => this.getSchemaUriForResource(resource),
        (schemaUri: string) => this.getSchemaContent(schemaUri)
      );
      log('Registered YAML schema contributor', LogLevel.INFO);
    } catch (err) {
      log(`Failed to activate YAML extension API: ${err}`, LogLevel.ERROR);
    }
  }

  private getSchemaUriForResource(resource: string): string | undefined {
    try {
      const uri = vscode.Uri.parse(resource);
      let kind: string | undefined;
      if (uri.scheme === 'k8s-view') {
        kind = ResourceViewDocumentProvider.parseUri(uri).kind;
      } else if (uri.scheme === 'k8s') {
        kind = ResourceEditDocumentProvider.parseUri(uri).kind;
      } else {
        const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === resource);
        if (doc) {
          const parsed = yaml.load(doc.getText()) as any;
          if (parsed?.kind) {
            kind = parsed.kind as string;
          }
        }
      }
      if (kind && this.schemaCache.has(kind)) {
        return vscode.Uri.file(this.schemaCache.get(kind) as string).toString();
      }
    } catch (err) {
      log(`Error determining schema for ${resource}: ${err}`, LogLevel.ERROR);
    }
    return undefined;
  }

  private getSchemaContent(schemaUri: string): string | undefined {
    try {
      const filePath = vscode.Uri.parse(schemaUri).fsPath;
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8');
      }
    } catch (err) {
      log(`Error loading schema content ${schemaUri}: ${err}`, LogLevel.ERROR);
    }
    return undefined;
  }

  /** Return CRD metadata discovered from cached OpenAPI specs */
  public async getCustomResourceDefinitions(): Promise<EdaCrd[]> {
    const specDir = await this.findSpecDir();
    const results: EdaCrd[] = [];
    try {
      const categories = await fs.promises.readdir(specDir, { withFileTypes: true });
      for (const cat of categories) {
        if (!cat.isDirectory()) continue;
        const catDir = path.join(specDir, cat.name);
        const files = await fs.promises.readdir(catDir);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          const specPath = path.join(catDir, file);
          try {
            const raw = await fs.promises.readFile(specPath, 'utf8');
            const spec = JSON.parse(raw);
            for (const [p, methods] of Object.entries<any>(spec.paths ?? {})) {
              const post = (methods as any).post;
              if (!post || !post.requestBody) continue;
              const match = p.match(/^\/apps\/([^/]+)\/([^/]+)(?:\/namespaces\/{namespace\})?\/([^/]+)$/);
              if (!match) continue;
              const [, group, version, plural] = match;
              const namespaced = p.includes('/namespaces/{namespace}/');
              let kind: string | undefined;
              let description: string | undefined = post.description || post.summary;
              const ref = post.requestBody.content?.['application/json']?.schema?.['$ref'];
              if (typeof ref === 'string') {
                const m = /\.([^./]+)$/.exec(ref);
                if (m) {
                  kind = m[1];
                  description = description ?? spec.components?.schemas?.[m[1]]?.description;
                }
              }
              if (!kind) {
                kind = plural.replace(/s$/, '').replace(/(^|[-_])(\w)/g, (_, __, ch) => ch.toUpperCase());
              }
              results.push({ kind, group, version, plural, namespaced, description });
            }
          } catch (err) {
            log(`Failed to parse spec ${specPath}: ${err}`, LogLevel.WARN);
          }
        }
      }
    } catch (err) {
      log(`Failed to load CRD definitions: ${err}`, LogLevel.WARN);
    }
    results.sort((a, b) => a.kind.localeCompare(b.kind));
    return results;
  }

  /** Get JSON schema for a given resource kind */
  public async getSchemaForKind(kind: string): Promise<any | null> {
    if (!this.schemaCache.has(kind)) {
      return null;
    }
    const schemaPath = this.schemaCache.get(kind) as string;
    try {
      const raw = await fs.promises.readFile(schemaPath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  public dispose(): void {
    super.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
