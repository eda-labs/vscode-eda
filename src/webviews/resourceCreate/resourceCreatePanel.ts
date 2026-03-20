import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

import type { EdaClient } from '../../clients/edaClient';
import type { EdaCrd } from '../../types';
import { log, LogLevel } from '../../extension';
import type { ResourceService } from '../../services/resourceService';
import type { SchemaProviderService } from '../../services/schemaProviderService';
import { serviceManager } from '../../services/serviceManager';
import type { ResolvedJsonSchema, AutoCompleteHint } from '../../providers/yaml/types';
import { DynamicValueProvider } from '../../providers/yaml/dynamicValueProvider';

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

/** Collected auto-complete hint with its field path */
interface FieldAutoCompleteHint {
  path: string[];
  hint: AutoCompleteHint;
}

/**
 * Walk a resolved schema recursively, collecting all `x-eda-nokia-com.ui-auto-completes`
 * entries with their field paths.
 */
function collectAutoCompleteHintsFromSchema(
  schema: ResolvedJsonSchema | undefined,
  path: string[] = [],
  results: FieldAutoCompleteHint[] = [],
  depth = 0
): FieldAutoCompleteHint[] {
  if (!schema || depth > MAX_SUGGESTION_DEPTH) {
    return results;
  }

  const hints = schema['x-eda-nokia-com']?.['ui-auto-completes'];
  if (hints) {
    for (const hint of hints) {
      results.push({ path: [...path], hint });
    }
  }

  if (schema.properties) {
    for (const [key, child] of Object.entries(schema.properties)) {
      collectAutoCompleteHintsFromSchema(child, [...path, key], results, depth + 1);
    }
  }

  if (schema.items) {
    collectAutoCompleteHintsFromSchema(schema.items, [...path, ARRAY_PATH_SEGMENT], results, depth + 1);
  }

  for (const composition of [schema.allOf, schema.anyOf, schema.oneOf]) {
    if (!composition) continue;
    for (const sub of composition) {
      collectAutoCompleteHintsFromSchema(sub, path, results, depth + 1);
    }
  }

  return results;
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
  private readonly dynamicValueProvider = new DynamicValueProvider();

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

  private getSuggestionScope(resource: Record<string, unknown>): {
    metadata: Record<string, unknown>;
    selectedNamespace: string;
    scopedNamespace: string | undefined;
    cacheKey: string;
  } {
    const metadata = isRecord(resource.metadata) ? resource.metadata : {};
    const selectedNamespace = typeof metadata.namespace === 'string'
      ? metadata.namespace.trim()
      : '';
    const scopedNamespace = selectedNamespace.length > 0 ? selectedNamespace : undefined;
    const cacheKey = scopedNamespace ?? '__all__';
    return { metadata, selectedNamespace, scopedNamespace, cacheKey };
  }

  private collectCachedNamespaces(namespaces: Set<string>): void {
    try {
      if (!serviceManager.getServiceNames().includes('kubernetes-resources')) {
        return;
      }
      const resourceService = serviceManager.getService<ResourceService>('kubernetes-resources');
      for (const namespace of resourceService.getAllNamespaces()) {
        if (typeof namespace === 'string' && namespace.length > 0) {
          namespaces.add(namespace);
        }
      }
    } catch (error) {
      log(`Unable to read cached namespaces: ${error}`, LogLevel.DEBUG);
    }
  }

  private getEdaClientSafe(): EdaClient | undefined {
    try {
      if (!serviceManager.getClientNames().includes('eda')) {
        return undefined;
      }
      return serviceManager.getClient<EdaClient>('eda');
    } catch {
      return undefined;
    }
  }

  private async addDiscoveredNamespaces(
    edaClient: EdaClient,
    namespaces: Set<string>
  ): Promise<void> {
    if (namespaces.size > 1) {
      return;
    }
    const discoveredNamespaces = await edaClient.listNamespaces();
    for (const namespace of discoveredNamespaces) {
      if (namespace) {
        namespaces.add(namespace);
      }
    }
  }

  private async collectSuggestionsFromKnownResources(
    edaClient: EdaClient,
    fieldSuggestions: Map<string, Set<string>>,
    namespaces: Set<string>,
    scopedNamespace: string | undefined
  ): Promise<void> {
    const knownResources = await edaClient.listResources(
      this.crd.group,
      this.crd.version,
      this.crd.kind,
      this.crd.namespaced ? scopedNamespace : undefined
    );
    for (const item of knownResources.slice(0, MAX_SUGGESTION_SAMPLE_RESOURCES)) {
      collectSuggestionValues(item, [], fieldSuggestions);
      const namespace = item.metadata?.namespace;
      if (typeof namespace === 'string' && namespace.length > 0) {
        namespaces.add(namespace);
      }
    }
  }

  private async collectEdaSuggestions(
    edaClient: EdaClient,
    fieldSuggestions: Map<string, Set<string>>,
    namespaces: Set<string>,
    scopedNamespace: string | undefined
  ): Promise<void> {
    const coreNamespace = edaClient.getCoreNamespace();
    if (coreNamespace) {
      namespaces.add(coreNamespace);
    }

    await this.addDiscoveredNamespaces(edaClient, namespaces);
    await this.collectSuggestionsFromKnownResources(
      edaClient,
      fieldSuggestions,
      namespaces,
      scopedNamespace
    );
  }

  private async augmentSuggestionsWithLogging(
    fieldSuggestions: Map<string, Set<string>>,
    scopedNamespace: string | undefined
  ): Promise<void> {
    try {
      await this.augmentSuggestionsFromAutoCompleteHints(fieldSuggestions, scopedNamespace);
    } catch (error) {
      log(`Unable to augment schema-driven suggestions for ${this.crd.kind}: ${error}`, LogLevel.DEBUG);
    }
  }

  private buildComputedSuggestions(
    fieldSuggestions: Map<string, Set<string>>,
    namespaces: Set<string>
  ): ResourceValueSuggestions {
    return {
      namespaces: Array.from(namespaces).sort((left, right) => left.localeCompare(right)),
      fields: toSuggestionRecord(fieldSuggestions)
    };
  }

  private async getSuggestions(resource: Record<string, unknown>): Promise<ResourceValueSuggestions> {
    const {
      metadata,
      selectedNamespace,
      scopedNamespace,
      cacheKey
    } = this.getSuggestionScope(resource);
    const cachedSuggestions = this.suggestionsCache.get(cacheKey);
    if (cachedSuggestions) {
      return cachedSuggestions;
    }

    const fieldSuggestions = new Map<string, Set<string>>();
    collectSuggestionValues(resource, [], fieldSuggestions);

    const namespaces = new Set<string>();
    if (selectedNamespace.length > 0) {
      namespaces.add(selectedNamespace);
    }
    if (typeof metadata.namespace === 'string' && metadata.namespace.length > 0) {
      namespaces.add(metadata.namespace);
    }

    this.collectCachedNamespaces(namespaces);

    const edaClient = this.getEdaClientSafe();
    if (edaClient) {
      try {
        await this.collectEdaSuggestions(edaClient, fieldSuggestions, namespaces, scopedNamespace);
      } catch (error) {
        log(`Unable to gather resource suggestions for ${this.crd.kind}: ${error}`, LogLevel.DEBUG);
      }
    }

    await this.augmentSuggestionsWithLogging(fieldSuggestions, scopedNamespace);

    const computedSuggestions = this.buildComputedSuggestions(fieldSuggestions, namespaces);
    this.suggestionsCache.set(cacheKey, computedSuggestions);

    return computedSuggestions;
  }

  private async augmentSuggestionsFromAutoCompleteHints(
    fieldSuggestions: Map<string, Set<string>>,
    scopedNamespace?: string
  ): Promise<void> {
    let resolvedSchema: ResolvedJsonSchema | null = null;
    try {
      const schemaService = serviceManager.getService<SchemaProviderService>('schema-provider');
      resolvedSchema = schemaService.getResolvedSchemaForKindSync(this.crd.kind);
    } catch {
      // Schema service not available
    }

    if (!resolvedSchema) {
      return;
    }

    const fieldHints = collectAutoCompleteHintsFromSchema(resolvedSchema);
    if (fieldHints.length === 0) {
      return;
    }

    const fetchPromises = fieldHints.map(async ({ path, hint }) => {
      const values = await this.dynamicValueProvider.getValuesForHint(hint, scopedNamespace);
      for (const value of values) {
        addSuggestion(fieldSuggestions, path, value);
      }
    });

    await Promise.all(fetchPromises);
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
