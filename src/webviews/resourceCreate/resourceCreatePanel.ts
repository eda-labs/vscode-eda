import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

import type { EdaClient } from '../../clients/edaClient';
import type { EdaCrd } from '../../types';
import { log, LogLevel } from '../../extension';
import type { ResourceService } from '../../services/resourceService';
import { serviceManager } from '../../services/serviceManager';

import { BasePanel } from '../basePanel';

import type {
  JsonSchemaNode,
  ResourceCreatePanelToWebviewMessage,
  ResourceValueSuggestions,
  ResourceCreateWebviewMessage
} from './types';

interface ResourceCreatePanelInput {
  resourceUri: vscode.Uri;
  crd: EdaCrd;
  schema: JsonSchemaNode | null;
  mode?: 'create' | 'edit';
}

const MAX_SUGGESTION_VALUES = 32;
const MAX_SUGGESTION_PATHS = 320;
const MAX_SUGGESTION_SAMPLE_RESOURCES = 250;
const MAX_SUGGESTION_DEPTH = 8;
const ARRAY_PATH_SEGMENT = '[]';
const DEFAULT_TOPO_NODE_GROUP = 'core.eda.nokia.com';
const DEFAULT_TOPO_NODE_VERSION = 'v1';
const DEFAULT_TOPO_NODE_KIND = 'TopoNode';

interface K8sLikeResource {
  metadata?: {
    name?: string;
    namespace?: string;
    labels?: Record<string, unknown>;
  };
}

interface SchemaStringFieldHint {
  path: string[];
  keyName: string;
  format?: string;
}

function toPathKey(path: string[]): string {
  return path.join('.');
}

function shouldSkipSuggestionPath(path: string[]): boolean {
  if (path.length === 0) {
    return false;
  }

  if (path[0] === 'status') {
    return true;
  }

  if (path[0] === 'metadata' && path.length >= 2) {
    const hiddenMetadataKeys = new Set([
      'managedFields',
      'resourceVersion',
      'uid',
      'generation',
      'creationTimestamp'
    ]);
    return hiddenMetadataKeys.has(path[1]);
  }

  return false;
}

function addSuggestion(
  suggestions: Map<string, Set<string>>,
  path: string[],
  rawValue: unknown
): void {
  if (path.length === 0 || shouldSkipSuggestionPath(path)) {
    return;
  }
  if (rawValue === undefined || rawValue === null) {
    return;
  }
  const value = String(rawValue).trim();
  if (value.length === 0 || value.length > 180) {
    return;
  }

  const key = toPathKey(path);
  let bucket = suggestions.get(key);
  if (!bucket) {
    if (suggestions.size >= MAX_SUGGESTION_PATHS) {
      return;
    }
    bucket = new Set<string>();
    suggestions.set(key, bucket);
  }

  if (bucket.size < MAX_SUGGESTION_VALUES) {
    bucket.add(value);
  }
}

function collectSuggestionValues(
  value: unknown,
  path: string[],
  suggestions: Map<string, Set<string>>,
  depth = 0
): void {
  if (depth > MAX_SUGGESTION_DEPTH || shouldSkipSuggestionPath(path)) {
    return;
  }

  if (
    typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    addSuggestion(suggestions, path, value);
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value.slice(0, MAX_SUGGESTION_VALUES)) {
      collectSuggestionValues(entry, [...path, ARRAY_PATH_SEGMENT], suggestions, depth + 1);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    collectSuggestionValues(entry, [...path, key], suggestions, depth + 1);
  }
}

function toSuggestionRecord(map: Map<string, Set<string>>): Record<string, string[]> {
  const output: Record<string, string[]> = {};
  const keys = Array.from(map.keys()).sort((left, right) => left.localeCompare(right));
  for (const key of keys) {
    output[key] = Array.from(map.get(key) ?? []).sort((left, right) => left.localeCompare(right));
  }
  return output;
}

function schemaFormat(schema: JsonSchemaNode | undefined): string | undefined {
  if (!schema || !isRecord(schema)) {
    return undefined;
  }
  const format = schema.format;
  return typeof format === 'string' ? format : undefined;
}

function collectSchemaStringFieldHints(
  schema: JsonSchemaNode | undefined,
  path: string[] = [],
  hints: SchemaStringFieldHint[] = []
): SchemaStringFieldHint[] {
  if (!schema) {
    return hints;
  }
  const type = typeof schema.type === 'string' ? schema.type : '';

  if (type === 'object' || (!type && isRecord(schema.properties))) {
    const properties = schema.properties ?? {};
    for (const [key, child] of Object.entries(properties)) {
      collectSchemaStringFieldHints(child, [...path, key], hints);
    }
    return hints;
  }

  if (type === 'array' || (!type && schema.items)) {
    const itemSchema = schema.items;
    if (!itemSchema) {
      return hints;
    }
    const itemType = typeof itemSchema.type === 'string' ? itemSchema.type : '';
    if (itemType === 'string' || (!itemType && !itemSchema.items && !itemSchema.properties)) {
      hints.push({
        path: [...path, ARRAY_PATH_SEGMENT],
        keyName: path[path.length - 1] ?? '',
        format: schemaFormat(schema) ?? schemaFormat(itemSchema)
      });
      return hints;
    }
    collectSchemaStringFieldHints(itemSchema, [...path, ARRAY_PATH_SEGMENT], hints);
    return hints;
  }

  if (type === 'string') {
    hints.push({
      path,
      keyName: path[path.length - 1] ?? '',
      format: schemaFormat(schema)
    });
  }

  return hints;
}

function addResourceNamesToPath(
  suggestions: Map<string, Set<string>>,
  path: string[],
  resources: K8sLikeResource[]
): void {
  for (const resource of resources.slice(0, MAX_SUGGESTION_SAMPLE_RESOURCES)) {
    const name = resource.metadata?.name;
    if (typeof name === 'string' && name.length > 0) {
      addSuggestion(suggestions, path, name);
    }
  }
}

function addLabelSelectorsToPath(
  suggestions: Map<string, Set<string>>,
  path: string[],
  resources: K8sLikeResource[]
): void {
  for (const resource of resources.slice(0, MAX_SUGGESTION_SAMPLE_RESOURCES)) {
    const labels = resource.metadata?.labels;
    if (!isRecord(labels)) {
      continue;
    }
    for (const [key, rawValue] of Object.entries(labels)) {
      if (!key) {
        continue;
      }
      addSuggestion(suggestions, path, `${key}=`);
      if (typeof rawValue === 'string' && rawValue.length > 0) {
        addSuggestion(suggestions, path, `${key}=${rawValue}`);
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseYamlResource(yamlText: string): Record<string, unknown> {
  const parsed = yaml.load(yamlText) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('YAML must represent a single resource object.');
  }
  return parsed;
}

function dumpYamlResource(resource: Record<string, unknown>): string {
  return yaml.dump(resource, { indent: 2 });
}

function isWebviewMessage(message: unknown): message is ResourceCreateWebviewMessage {
  if (!isRecord(message)) {
    return false;
  }
  const command = message.command;
  return command === 'ready'
    || command === 'formUpdate'
    || command === 'executeAction'
    || command === 'refreshSuggestions';
}

export class ResourceCreatePanel extends BasePanel {
  private static readonly panels = new Map<string, ResourceCreatePanel>();

  private readonly resourceUri: vscode.Uri;
  private readonly crd: EdaCrd;
  private readonly schema: JsonSchemaNode | null;
  private readonly mode: 'create' | 'edit';
  private readonly subscriptions: vscode.Disposable[] = [];
  private pendingYamlFromForm: string | undefined;
  private disposed = false;
  private readonly suggestionsCache = new Map<string, ResourceValueSuggestions>();

  private constructor(
    context: vscode.ExtensionContext,
    input: ResourceCreatePanelInput,
    showOptions: vscode.ViewColumn | { readonly viewColumn: vscode.ViewColumn; readonly preserveFocus?: boolean }
  ) {
    const mode = input.mode ?? 'create';
    super(
      context,
      'edaCreateResourcePanel',
      `${mode === 'edit' ? 'Edit' : 'Create'} ${input.crd.kind}`,
      { enableFindWidget: true },
      BasePanel.getEdaIconPath(context),
      showOptions
    );
    this.resourceUri = input.resourceUri;
    this.crd = input.crd;
    this.schema = input.schema;
    this.mode = mode;

    this.panel.webview.html = this.buildHtml();
    this.registerListeners();
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'resourceCreatePanel.js');
    return `<script type="module" nonce="${nonce}" src="${scriptUri}"></script>`;
  }

  private registerListeners(): void {
    this.subscriptions.push(
      this.panel.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleWebviewMessage(message);
      })
    );

    this.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.uri.toString() === this.resourceUri.toString()) {
          this.handleYamlDocumentChange(event.document);
        }
      })
    );

    this.subscriptions.push(
      this.panel.onDidDispose(() => {
        this.dispose();
      })
    );
  }

  private async handleWebviewMessage(message: unknown): Promise<void> {
    if (!isWebviewMessage(message)) {
      return;
    }

    if (message.command === 'ready') {
      await this.sendInitState();
      return;
    }

    if (message.command === 'formUpdate') {
      if (!isRecord(message.resource)) {
        return;
      }
      await this.applyFormUpdate(message.resource);
      return;
    }

    if (message.command === 'executeAction') {
      await this.executeAction(message.action);
      return;
    }

    if (message.command === 'refreshSuggestions') {
      if (!isRecord(message.resource)) {
        return;
      }
      const suggestions = await this.getSuggestions(message.resource);
      this.postMessage({
        command: 'suggestions',
        suggestions
      });
    }
  }

  private async executeAction(action: 'commit' | 'dryRun' | 'basket'): Promise<void> {
    let commandOptions: {
      skipPrompt: true;
      bypassChangesCheck: true;
      action: 'apply' | 'dryRun' | 'basket';
    };
    if (action === 'basket') {
      commandOptions = { skipPrompt: true, bypassChangesCheck: true, action: 'basket' };
    } else if (action === 'dryRun') {
      commandOptions = { skipPrompt: true, bypassChangesCheck: true, action: 'dryRun' };
    } else {
      commandOptions = { skipPrompt: true, bypassChangesCheck: true, action: 'apply' };
    }

    try {
      await vscode.commands.executeCommand(
        'vscode-eda.applyResourceChanges',
        this.resourceUri,
        commandOptions
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to execute "${action}" action: ${message}`);
    }
  }

  private async sendInitState(): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(this.resourceUri);
      const yamlText = document.getText();
      const resource = parseYamlResource(yamlText);
      const suggestions = await this.getSuggestions(resource);

      this.postMessage({
        command: 'init',
        uri: this.resourceUri.toString(),
        crd: this.crd,
        schema: this.schema,
        resource,
        yaml: yamlText,
        suggestions
      });
    } catch (error: unknown) {
      this.postYamlError(error);
    }
  }

  private async getSuggestions(resource: Record<string, unknown>): Promise<ResourceValueSuggestions> {
    const metadata = isRecord(resource.metadata) ? resource.metadata : {};
    const selectedNamespace = typeof metadata.namespace === 'string'
      ? metadata.namespace.trim()
      : '';
    const scopedNamespace = selectedNamespace.length > 0 ? selectedNamespace : undefined;
    const cacheKey = selectedNamespace.length > 0 ? selectedNamespace : '__all__';
    const cachedSuggestions = this.suggestionsCache.get(cacheKey);
    if (cachedSuggestions) {
      return cachedSuggestions;
    }

    const fieldSuggestions = new Map<string, Set<string>>();
    collectSuggestionValues(resource, [], fieldSuggestions);

    const namespaces = new Set<string>();
    if (typeof metadata.namespace === 'string' && metadata.namespace.length > 0) {
      namespaces.add(metadata.namespace);
    }

    let edaClient: EdaClient | undefined;

    try {
      if (serviceManager.getServiceNames().includes('kubernetes-resources')) {
        const resourceService = serviceManager.getService<ResourceService>('kubernetes-resources');
        for (const namespace of resourceService.getAllNamespaces()) {
          if (typeof namespace === 'string' && namespace.length > 0) {
            namespaces.add(namespace);
          }
        }
      }
    } catch (error) {
      log(`Unable to read cached namespaces: ${error}`, LogLevel.DEBUG);
    }

    try {
      if (serviceManager.getClientNames().includes('eda')) {
        edaClient = serviceManager.getClient<EdaClient>('eda');
        const coreNamespace = edaClient.getCoreNamespace();
        if (coreNamespace) {
          namespaces.add(coreNamespace);
        }

        if (namespaces.size <= 1) {
          const discoveredNamespaces = await edaClient.listNamespaces();
          for (const namespace of discoveredNamespaces) {
            if (namespace) {
              namespaces.add(namespace);
            }
          }
        }

        const knownResources = await edaClient.listResources(
          this.crd.group,
          this.crd.version,
          this.crd.kind,
          this.crd.namespaced ? scopedNamespace : undefined
        );
        for (const item of knownResources.slice(0, MAX_SUGGESTION_SAMPLE_RESOURCES)) {
          collectSuggestionValues(item, [], fieldSuggestions);
          const ns = item.metadata?.namespace;
          if (typeof ns === 'string' && ns.length > 0) {
            namespaces.add(ns);
          }
        }
      }
    } catch (error) {
      log(`Unable to gather resource suggestions for ${this.crd.kind}: ${error}`, LogLevel.DEBUG);
    }

    if (edaClient && this.schema) {
      try {
        await this.augmentNodeSuggestionsFromSchema(
          fieldSuggestions,
          edaClient,
          namespaces,
          scopedNamespace
        );
      } catch (error) {
        log(`Unable to augment node suggestions for ${this.crd.kind}: ${error}`, LogLevel.DEBUG);
      }
    }

    const computedSuggestions = {
      namespaces: Array.from(namespaces).sort((left, right) => left.localeCompare(right)),
      fields: toSuggestionRecord(fieldSuggestions)
    };
    this.suggestionsCache.set(cacheKey, computedSuggestions);

    return computedSuggestions;
  }

  private async fetchTopoNodeResources(
    edaClient: EdaClient,
    namespaces: Set<string>,
    scopedNamespace?: string
  ): Promise<K8sLikeResource[]> {
    try {
      const listed = await edaClient.listResources(
        DEFAULT_TOPO_NODE_GROUP,
        DEFAULT_TOPO_NODE_VERSION,
        DEFAULT_TOPO_NODE_KIND,
        scopedNamespace
      );
      if (listed.length > 0) {
        return listed as K8sLikeResource[];
      }
    } catch {
      // Fall back to namespace-scoped list below.
    }

    let namespaceList: string[];
    if (scopedNamespace) {
      namespaceList = [scopedNamespace];
    } else if (namespaces.size > 0) {
      namespaceList = Array.from(namespaces);
    } else {
      namespaceList = await edaClient.listNamespaces();
    }
    const out: K8sLikeResource[] = [];
    for (const namespace of namespaceList.slice(0, MAX_SUGGESTION_VALUES)) {
      try {
        const nodes = await edaClient.listTopoNodes(namespace);
        out.push(...(nodes as K8sLikeResource[]));
      } catch {
        // Ignore per-namespace failures.
      }
    }
    return out;
  }

  private async augmentNodeSuggestionsFromSchema(
    fieldSuggestions: Map<string, Set<string>>,
    edaClient: EdaClient,
    namespaces: Set<string>,
    scopedNamespace?: string
  ): Promise<void> {
    const hints = collectSchemaStringFieldHints(this.schema ?? undefined);
    if (hints.length === 0) {
      return;
    }

    const needsNodeData = hints.some((hint) => hint.keyName.toLowerCase().includes('node'));
    if (!needsNodeData) {
      return;
    }

    const topoNodes = await this.fetchTopoNodeResources(edaClient, namespaces, scopedNamespace);
    if (topoNodes.length === 0) {
      return;
    }

    for (const hint of hints) {
      const key = hint.keyName.toLowerCase();
      const format = (hint.format ?? '').toLowerCase();
      const relatesToNode = key.includes('node');
      if (!relatesToNode) {
        continue;
      }
      const isSelectorField = format === 'labelselector' || key.includes('selector');
      if (isSelectorField) {
        addLabelSelectorsToPath(fieldSuggestions, hint.path, topoNodes);
        continue;
      }
      addResourceNamesToPath(fieldSuggestions, hint.path, topoNodes);
    }
  }

  private async applyFormUpdate(resource: Record<string, unknown>): Promise<void> {
    const normalizedYaml = dumpYamlResource(resource);
    const document = await vscode.workspace.openTextDocument(this.resourceUri);
    if (document.getText() === normalizedYaml) {
      return;
    }

    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(this.resourceUri, fullRange, normalizedYaml);
    this.pendingYamlFromForm = normalizedYaml;
    await vscode.workspace.applyEdit(edit);
  }

  private handleYamlDocumentChange(document: vscode.TextDocument): void {
    const yamlText = document.getText();
    if (this.pendingYamlFromForm && yamlText === this.pendingYamlFromForm) {
      this.pendingYamlFromForm = undefined;
      return;
    }

    try {
      const resource = parseYamlResource(yamlText);
      this.pendingYamlFromForm = undefined;
      this.postMessage({
        command: 'yamlModel',
        resource,
        yaml: yamlText
      });
    } catch (error: unknown) {
      this.postYamlError(error);
    }
  }

  private postYamlError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.postMessage({
      command: 'yamlError',
      error: message
    });
  }

  private postMessage(message: ResourceCreatePanelToWebviewMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private async revealYamlEditor(preserveFocus: boolean): Promise<void> {
    const document = await vscode.workspace.openTextDocument(this.resourceUri);
    await vscode.languages.setTextDocumentLanguage(document, 'yaml');
    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus,
      preview: false
    });
  }

  public static async show(
    context: vscode.ExtensionContext,
    input: ResourceCreatePanelInput
  ): Promise<ResourceCreatePanel> {
    const key = input.resourceUri.toString();
    const existing = ResourceCreatePanel.panels.get(key);
    if (existing) {
      existing.panel.reveal(existing.panel.viewColumn ?? vscode.ViewColumn.One);
      await existing.revealYamlEditor(true);
      return existing;
    }

    const baseColumn = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    const panel = new ResourceCreatePanel(
      context,
      input,
      { viewColumn: baseColumn, preserveFocus: false }
    );
    ResourceCreatePanel.panels.set(key, panel);
    await panel.revealYamlEditor(true);
    return panel;
  }

  public override dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    const key = this.resourceUri.toString();
    if (ResourceCreatePanel.panels.get(key) === this) {
      ResourceCreatePanel.panels.delete(key);
    }

    while (this.subscriptions.length > 0) {
      const disposable = this.subscriptions.pop();
      disposable?.dispose();
    }

    log(`Closed ${this.mode}-resource panel for ${this.crd.kind}`, LogLevel.DEBUG);
    super.dispose();
  }
}
