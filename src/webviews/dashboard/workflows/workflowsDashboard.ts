import * as os from 'os';
import * as path from 'path';

import * as yaml from 'js-yaml';
import * as vscode from 'vscode';

import { BasePanel } from '../../basePanel';
import { ALL_NAMESPACES } from '../../constants';
import { serviceManager } from '../../../services/serviceManager';
import type { EdaClient } from '../../../clients/edaClient';
import { kindToPlural } from '../../../utils/pluralUtils';
import { parseUpdateKey } from '../../../utils/parseUpdateKey';
import { getUpdates } from '../../../utils/streamMessageUtils';

const CORE_EDA_GROUP = 'core.eda.nokia.com';

/** Webview message received from the React frontend */
interface WebviewMessage {
  command: string;
  namespace?: string;
  name?: string;
  kind?: string;
  apiVersion?: string;
}

/** Kubernetes resource metadata */
interface K8sMetadata {
  name?: string;
  namespace?: string;
  creationTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  [key: string]: unknown;
}

/** Kubernetes resource data structure */
interface K8sResourceData {
  apiVersion?: string;
  kind?: string;
  metadata?: K8sMetadata;
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  workflowStatus?: Record<string, unknown>;
  [key: string]: unknown;
}

/** WorkflowDefinition resource details used by the create flow */
interface WorkflowDefinitionResource extends K8sResourceData {
  spec?: {
    flowDefinitionResource?: {
      group?: string;
      kind?: string;
      version?: string;
    };
    image?: string;
    [key: string]: unknown;
  };
}

/** Flattened row data for display */
type FlattenedRow = Record<string, unknown>;
type WorkflowExecutionMode = 'run' | 'dry-run';

interface WorkflowTargetRef {
  group: string;
  version: string;
  kind: string;
}

interface WorkflowBackedTarget extends WorkflowTargetRef {
  definitionName: string;
}

interface WorkflowDraftContext {
  definitionName: string;
  namespace: string;
  target?: WorkflowTargetRef;
}

interface WorkflowStreamPayload {
  updates?: WorkflowStreamUpdate[];
  Updates?: WorkflowStreamUpdate[];
}

interface WorkflowStreamMessage {
  msg?: WorkflowStreamPayload;
}

interface WorkflowStreamUpdate {
  key?: string;
  data?: K8sResourceData | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function countRows<T>(rowMap: Map<string, Map<string, T>>): number {
  let total = 0;
  for (const namespaceRows of rowMap.values()) {
    total += namespaceRows.size;
  }
  return total;
}

export class WorkflowsDashboardPanel extends BasePanel {
  private static currentPanel: WorkflowsDashboardPanel | undefined;
  private edaClient: EdaClient;
  private streamDisposable: { dispose(): void } | undefined;
  private rowMap: Map<string, Map<string, FlattenedRow>> = new Map();
  private columns: string[] = [];
  private columnSet: Set<string> = new Set();
  private selectedNamespace = ALL_NAMESPACES;
  private workflowStreamNames: Set<string> = new Set(['workflows']);
  private subscribedWorkflowStreams: Set<string> = new Set();
  private streamRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private isLoading = false;
  private rerunLoad = false;
  private workflowDrafts: Map<string, WorkflowDraftContext> = new Map();
  private workflowSaveDisposable: vscode.Disposable;
  private workflowCloseDisposable: vscode.Disposable;

  private constructor(context: vscode.ExtensionContext, title: string) {
    super(context, 'workflowsDashboard', title, undefined, BasePanel.getEdaIconPath(context));

    this.edaClient = serviceManager.getClient<EdaClient>('eda');
    this.workflowSaveDisposable = vscode.workspace.onDidSaveTextDocument((document) => {
      void this.handleWorkflowDraftSave(document);
    });
    this.workflowCloseDisposable = vscode.workspace.onDidCloseTextDocument((document) => {
      this.workflowDrafts.delete(document.uri.toString());
    });
    this.streamDisposable = this.edaClient.onStreamMessage((stream, msg) => {
      this.handleWorkflowStreamMessage(stream, msg);
    });

    this.panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.visible) {
        this.reloadPanelData();
      }
    });

    this.panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      await this.handleWebviewMessage(msg);
    });

    this.panel.webview.html = this.buildHtml();
  }

  private async initialize(): Promise<void> {
    await this.subscribeWorkflowStreams(this.workflowStreamNames);
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'workflowsDashboard.js');
    return `<script type="module" nonce="${nonce}" src="${scriptUri}"></script>`;
  }

  private async handleWebviewMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.command) {
      case 'ready':
        this.sendNamespaces();
        this.requestLoad(ALL_NAMESPACES);
        break;
      case 'setNamespace':
        this.requestLoad(msg.namespace ?? ALL_NAMESPACES);
        break;
      case 'showInTree':
        await vscode.commands.executeCommand('vscode-eda.filterTree', 'workflows');
        await vscode.commands.executeCommand('vscode-eda.expandAllNamespaces');
        break;
      case 'viewWorkflowYaml':
        if (msg.name) {
          await this.viewWorkflowYaml(msg.name, msg.namespace, msg.kind, msg.apiVersion);
        }
        break;
      case 'createWorkflow':
        await this.createWorkflow(msg.namespace);
        break;
    }
  }

  private requestLoad(namespace: string): void {
    this.selectedNamespace = namespace;
    if (this.isLoading) {
      this.rerunLoad = true;
      return;
    }
    void this.runLoad(namespace);
  }

  private async runLoad(namespace: string): Promise<void> {
    this.isLoading = true;
    try {
      await this.loadInitial(namespace);
    } finally {
      this.isLoading = false;
    }

    if (this.rerunLoad) {
      this.rerunLoad = false;
      this.requestLoad(this.selectedNamespace);
    }
  }

  private sendNamespaces(): void {
    const namespaces = Array.from(new Set([
      ...this.edaClient.getCachedNamespaces(),
      ...this.rowMap.keys()
    ]));
    namespaces.sort((a, b) => a.localeCompare(b));
    namespaces.unshift(ALL_NAMESPACES);

    if (!namespaces.includes(this.selectedNamespace)) {
      this.selectedNamespace = ALL_NAMESPACES;
    }

    this.panel.webview.postMessage({
      command: 'init',
      namespaces,
      selected: this.selectedNamespace
    });
  }

  private normalizeStreamName(streamName: string): string {
    return streamName.trim().toLowerCase();
  }

  private async subscribeWorkflowStreams(streamNames: Iterable<string>): Promise<void> {
    for (const streamName of streamNames) {
      const normalized = this.normalizeStreamName(streamName);
      if (!normalized || this.subscribedWorkflowStreams.has(normalized)) {
        continue;
      }
      try {
        await this.edaClient.streamByName(normalized);
        this.subscribedWorkflowStreams.add(normalized);
      } catch {
        // Ignore unsupported or unavailable streams.
      }
    }
  }

  private ensureWorkflowStreams(streamNames: Iterable<string>): void {
    const newStreams: string[] = [];
    for (const streamName of streamNames) {
      const normalized = this.normalizeStreamName(streamName);
      if (!normalized || this.workflowStreamNames.has(normalized)) {
        continue;
      }
      this.workflowStreamNames.add(normalized);
      newStreams.push(normalized);
    }
    if (newStreams.length > 0) {
      void this.subscribeWorkflowStreams(newStreams);
    }
  }

  private extractStreamUpdateNamespace(update: WorkflowStreamUpdate): string | undefined {
    const namespace = update.data?.metadata?.namespace;
    if (typeof namespace === 'string' && namespace.length > 0) {
      return namespace;
    }
    if (typeof update.key === 'string' && update.key.length > 0) {
      return parseUpdateKey(update.key).namespace;
    }
    return undefined;
  }

  private shouldRefreshFromStreamMessage(msg: unknown): boolean {
    const updates = getUpdates((msg as WorkflowStreamMessage | undefined)?.msg) as WorkflowStreamUpdate[];
    if (updates.length === 0) {
      return false;
    }
    if (this.selectedNamespace === ALL_NAMESPACES) {
      return true;
    }
    return updates.some(update => this.extractStreamUpdateNamespace(update) === this.selectedNamespace);
  }

  private scheduleStreamRefresh(): void {
    if (this.streamRefreshTimer) {
      clearTimeout(this.streamRefreshTimer);
    }
    this.streamRefreshTimer = setTimeout(() => {
      this.streamRefreshTimer = undefined;
      this.requestLoad(this.selectedNamespace);
    }, 200);
  }

  private handleWorkflowStreamMessage(stream: string, msg: unknown): void {
    const normalized = this.normalizeStreamName(stream);
    if (!this.workflowStreamNames.has(normalized)) {
      return;
    }
    if (!this.panel.visible) {
      return;
    }
    if (!this.shouldRefreshFromStreamMessage(msg)) {
      return;
    }
    this.scheduleStreamRefresh();
  }

  private flattenObject(obj: Record<string, unknown>, prefix = ''): FlattenedRow {
    const result: FlattenedRow = {};
    for (const [key, value] of Object.entries(obj)) {
      const outKey = prefix ? `${prefix}.${key}` : key;
      this.flattenValue(result, outKey, value);
    }
    return result;
  }

  private flattenArray(result: FlattenedRow, prefix: string, values: unknown[]): void {
    if (values.length === 0) {
      result[prefix] = '';
      return;
    }

    const hasNestedChildren = values.some((value) => isObject(value) || Array.isArray(value));
    if (!hasNestedChildren) {
      result[prefix] = values.join(', ');
      return;
    }

    values.forEach((value, index) => {
      const childPrefix = `${prefix}[${index}]`;
      this.flattenValue(result, childPrefix, value);
    });
  }

  private flattenValue(result: FlattenedRow, key: string, value: unknown): void {
    if (Array.isArray(value)) {
      this.flattenArray(result, key, value);
      return;
    }

    if (isObject(value)) {
      Object.assign(result, this.flattenObject(value, key));
      return;
    }

    result[key] = value;
  }

  private normalizeWorkflowName(value: string): string {
    let normalized = '';
    let lastWasDash = false;
    const lower = value.toLowerCase();

    for (const ch of lower) {
      const isAlphaNum = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
      if (isAlphaNum) {
        normalized += ch;
        lastWasDash = false;
        continue;
      }
      if (!lastWasDash) {
        normalized += '-';
        lastWasDash = true;
      }
    }

    while (normalized.startsWith('-')) {
      normalized = normalized.slice(1);
    }
    while (normalized.endsWith('-')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  }

  private buildDefaultWorkflowName(definitionName: string): string {
    const timestamp = Date.now().toString(36).slice(-6);
    const baseName = this.normalizeWorkflowName(definitionName) || 'workflow';
    return `${baseName}-${timestamp}`.slice(0, 63);
  }

  private isLowerAlphaNumeric(ch: string | undefined): boolean {
    if (!ch) {
      return false;
    }
    return (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
  }

  private isDns1123Name(name: string): boolean {
    if (!this.isLowerAlphaNumeric(name[0]) || !this.isLowerAlphaNumeric(name[name.length - 1])) {
      return false;
    }
    for (const ch of name) {
      if (!this.isLowerAlphaNumeric(ch) && ch !== '-') {
        return false;
      }
    }
    return true;
  }

  private validateWorkflowName(name: string): string | undefined {
    if (!name) {
      return 'Workflow name is required.';
    }
    if (name.length > 253) {
      return 'Workflow name must be 253 characters or less.';
    }
    if (!this.isDns1123Name(name)) {
      return 'Workflow name must be lowercase DNS-1123 (a-z, 0-9, -).';
    }
    return undefined;
  }

  private getWorkflowDefinitionCategory(definition: WorkflowDefinitionResource): string {
    const flowDef = definition.spec?.flowDefinitionResource;
    const group = flowDef?.group;
    if (typeof group === 'string' && group.includes('.')) {
      return group.split('.')[0];
    }
    const name = definition.metadata?.name ?? '';
    if (name.includes('-')) {
      return name.split('-')[0];
    }
    return 'other';
  }

  private async resolveTargetNamespace(preferred?: string): Promise<string | undefined> {
    if (preferred && preferred !== ALL_NAMESPACES) {
      return preferred;
    }

    const namespaces = Array.from(new Set(this.edaClient.getCachedNamespaces()))
      .sort((a, b) => a.localeCompare(b));

    if (namespaces.length === 0) {
      void vscode.window.showWarningMessage('No namespaces available for workflow creation.');
      return undefined;
    }

    return vscode.window.showQuickPick(namespaces, {
      placeHolder: 'Select namespace for the new workflow'
    });
  }

  private mergeWorkflowDefinitions(
    merged: Map<string, WorkflowDefinitionResource>,
    items: WorkflowDefinitionResource[]
  ): void {
    for (const item of items) {
      const name = item.metadata?.name;
      const namespace = item.metadata?.namespace ?? this.edaClient.getCoreNamespace();
      if (!name) {
        continue;
      }
      merged.set(`${namespace}/${name}`, item);
    }
  }

  private async getWorkflowDefinitions(): Promise<WorkflowDefinitionResource[]> {
    const merged = new Map<string, WorkflowDefinitionResource>();
    try {
      const definitions = await this.edaClient.listResources(CORE_EDA_GROUP, 'v1', 'WorkflowDefinition');
      this.mergeWorkflowDefinitions(merged, definitions as WorkflowDefinitionResource[]);
    } catch {
      return [];
    }

    return Array.from(merged.values());
  }

  private async pickWorkflowDefinition(): Promise<WorkflowDefinitionResource | undefined> {
    const definitions = await this.getWorkflowDefinitions();
    if (definitions.length === 0) {
      void vscode.window.showWarningMessage('No WorkflowDefinitions found.');
      return undefined;
    }

    const items = definitions.map(definition => {
      const name = definition.metadata?.name ?? '';
      const namespace = definition.metadata?.namespace ?? this.edaClient.getCoreNamespace();
      const category = this.getWorkflowDefinitionCategory(definition);
      const flowDef = definition.spec?.flowDefinitionResource;
      const detail = flowDef
        ? `${flowDef.group ?? ''}/${flowDef.version ?? ''} ${flowDef.kind ?? ''}`.trim()
        : (definition.spec?.image ?? '');

      return {
        label: name,
        description: `${namespace} • ${category}`,
        detail,
        definition
      };
    });

    items.sort((a, b) =>
      a.description.localeCompare(b.description)
      || a.label.localeCompare(b.label)
    );

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select WorkflowDefinition (topology, oam, routing, services, ...)',
      matchOnDescription: true,
      matchOnDetail: true
    });

    return selected?.definition;
  }

  private buildWorkflowDraft(
    definition: WorkflowDefinitionResource,
    definitionName: string,
    name: string,
    namespace: string
  ): { resource: K8sResourceData; target?: WorkflowTargetRef } {
    const flowDef = definition.spec?.flowDefinitionResource;
    if (flowDef?.group && flowDef.version && flowDef.kind) {
      return {
        target: {
          group: flowDef.group,
          version: flowDef.version,
          kind: flowDef.kind
        },
        resource: {
          apiVersion: `${flowDef.group}/${flowDef.version}`,
          kind: flowDef.kind,
          metadata: {
            name,
            namespace
          },
          spec: {}
        }
      };
    }

    return {
      resource: {
        apiVersion: 'core.eda.nokia.com/v1',
        kind: 'Workflow',
        metadata: {
          name,
          namespace
        },
        spec: {
          type: definitionName
        }
      }
    };
  }

  private buildWorkflowDraftContent(resource: K8sResourceData): string {
    const yamlContent = yaml.dump(resource, { indent: 2 });
    return [
      '# Save this file to execute the workflow.',
      '# On each save, choose Run Workflow or Dry Run Workflow.',
      '',
      yamlContent
    ].join('\n');
  }

  private buildWorkflowDraftFileName(name: string): string {
    const normalized = this.normalizeWorkflowName(name) || 'workflow';
    const stamp = Date.now().toString(36).slice(-8);
    return `vscode-eda-workflow-${normalized}-${stamp}.yaml`;
  }

  private async openWorkflowDraftDocument(
    resource: K8sResourceData,
    context: WorkflowDraftContext
  ): Promise<void> {
    const resourceName = typeof resource.metadata?.name === 'string'
      ? resource.metadata.name
      : context.definitionName;
    const draftFilePath = path.join(
      os.tmpdir(),
      this.buildWorkflowDraftFileName(resourceName)
    );
    const uri = vscode.Uri.file(draftFilePath);
    const content = this.buildWorkflowDraftContent(resource);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));

    this.workflowDrafts.set(uri.toString(), context);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.languages.setTextDocumentLanguage(document, 'yaml');
    await vscode.window.showTextDocument(document, { preview: false });
  }

  private parseWorkflowDraftDocument(document: vscode.TextDocument): K8sResourceData | undefined {
    try {
      const parsed = yaml.load(document.getText());
      if (!isObject(parsed)) {
        throw new Error('YAML root must be an object');
      }
      return parsed as K8sResourceData;
    } catch (error) {
      void vscode.window.showErrorMessage(`Invalid workflow YAML: ${String(error)}`);
      return undefined;
    }
  }

  private prepareWorkflowDraftForSubmission(
    resource: K8sResourceData,
    draft: WorkflowDraftContext
  ): K8sResourceData | undefined {
    const candidate = JSON.parse(JSON.stringify(resource)) as K8sResourceData;
    const metadata = isObject(candidate.metadata) ? candidate.metadata as K8sMetadata : {};
    if (!metadata.name || typeof metadata.name !== 'string' || !metadata.name.trim()) {
      void vscode.window.showErrorMessage('Workflow draft is missing metadata.name.');
      return undefined;
    }
    if (!metadata.namespace) {
      metadata.namespace = draft.namespace;
    }
    candidate.metadata = metadata;

    if (!candidate.kind || !candidate.apiVersion) {
      void vscode.window.showErrorMessage('Workflow draft must include apiVersion and kind.');
      return undefined;
    }

    return candidate;
  }

  private applyWorkflowExecutionMode(
    resource: K8sResourceData,
    mode: WorkflowExecutionMode
  ): K8sResourceData {
    const candidate = JSON.parse(JSON.stringify(resource)) as K8sResourceData;
    const spec = isObject(candidate.spec) ? { ...candidate.spec } : {};
    if (mode === 'dry-run') {
      spec.dryRun = true;
    } else if (Object.prototype.hasOwnProperty.call(spec, 'dryRun')) {
      spec.dryRun = false;
    }
    candidate.spec = spec;
    return candidate;
  }

  private async pickWorkflowExecutionMode(
    draft: WorkflowDraftContext
  ): Promise<WorkflowExecutionMode | undefined> {
    const choice = await vscode.window.showQuickPick([
      {
        label: 'Run Workflow',
        description: 'Create and execute the workflow resource',
        mode: 'run' as WorkflowExecutionMode
      },
      {
        label: 'Dry Run Workflow',
        description: 'Set spec.dryRun=true before creating the workflow resource',
        mode: 'dry-run' as WorkflowExecutionMode
      }
    ], {
      placeHolder: `Save action for ${draft.definitionName}`
    });
    return choice?.mode;
  }

  private async submitWorkflowDraft(
    draft: WorkflowDraftContext,
    resource: K8sResourceData,
    mode: WorkflowExecutionMode
  ): Promise<void> {
    const prepared = this.applyWorkflowExecutionMode(resource, mode);
    const namespace = prepared.metadata?.namespace ?? draft.namespace;

    if (draft.target) {
      await this.edaClient.createResource(
        draft.target.group,
        draft.target.version,
        draft.target.kind,
        prepared,
        namespace
      );
    } else {
      await this.edaClient.createResource(CORE_EDA_GROUP, 'v1', 'Workflow', prepared, namespace);
    }

    const resourceName = prepared.metadata?.name ?? 'workflow';
    const actionLabel = mode === 'dry-run' ? 'Dry-run submitted' : 'Run submitted';
    void vscode.window.showInformationMessage(`${actionLabel}: ${namespace}/${resourceName}`);
    this.requestLoad(this.selectedNamespace);
  }

  private async handleWorkflowDraftSave(document: vscode.TextDocument): Promise<void> {
    const draft = this.workflowDrafts.get(document.uri.toString());
    if (!draft) {
      return;
    }

    const parsed = this.parseWorkflowDraftDocument(document);
    if (!parsed) {
      return;
    }

    const prepared = this.prepareWorkflowDraftForSubmission(parsed, draft);
    if (!prepared) {
      return;
    }

    const mode = await this.pickWorkflowExecutionMode(draft);
    if (!mode) {
      return;
    }

    try {
      await this.submitWorkflowDraft(draft, prepared, mode);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to ${mode} workflow: ${String(error)}`);
    }
  }

  private async createWorkflow(preferredNamespace?: string): Promise<void> {
    const namespace = await this.resolveTargetNamespace(preferredNamespace);
    if (!namespace) {
      return;
    }

    const definition = await this.pickWorkflowDefinition();
    if (!definition) {
      return;
    }

    const definitionName = definition.metadata?.name;
    if (!definitionName) {
      void vscode.window.showErrorMessage('Selected WorkflowDefinition is missing metadata.name.');
      return;
    }

    const suggestedName = this.buildDefaultWorkflowName(definitionName);
    const name = await vscode.window.showInputBox({
      prompt: 'Workflow resource name',
      value: suggestedName,
      validateInput: (value) => this.validateWorkflowName(value)
    });
    if (!name) {
      return;
    }

    try {
      const draft = this.buildWorkflowDraft(definition, definitionName, name, namespace);
      await this.openWorkflowDraftDocument(draft.resource, {
        definitionName,
        namespace,
        target: draft.target
      });
      void vscode.window.showInformationMessage(
        `Workflow draft opened for ${namespace}/${name}. Save to run or dry-run.`
      );
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to open workflow draft: ${String(error)}`);
    }
  }

  private extractWorkflowStatus(status: Record<string, unknown> | undefined): string {
    if (!status) {
      return '';
    }
    const output = isObject(status.output) ? status.output : undefined;
    const candidates: unknown[] = [
      status.status,
      status.state,
      status.phase,
      status.result,
      output?.status,
      output?.state,
      output?.phase,
      output?.result
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate;
      }
    }
    return '';
  }

  private extractWorkflowStateFromResource(item: K8sResourceData): string {
    if (isObject(item.workflowStatus)) {
      const workflowState = item.workflowStatus.state;
      if (typeof workflowState === 'string' && workflowState.trim()) {
        return workflowState;
      }
    }

    const annotationState = item.metadata?.annotations?.['workflows.core.eda.nokia.com/state'];
    if (typeof annotationState === 'string' && annotationState.trim()) {
      return annotationState;
    }

    return this.extractWorkflowStatus(item.status);
  }

  private applyIdentityFields(
    result: FlattenedRow,
    item: K8sResourceData,
    definitionName?: string
  ): void {
    if (item.kind) {
      result.kind = item.kind;
    }
    if (item.apiVersion) {
      result.apiVersion = item.apiVersion;
    }
    if (definitionName) {
      result['workflow-definition'] = definitionName;
    }
  }

  private applyMetadataFields(
    result: FlattenedRow,
    meta: K8sMetadata,
    namespaceHint?: string
  ): void {
    if (meta.name) {
      result.name = meta.name;
    }
    if (meta.namespace || namespaceHint) {
      result.namespace = meta.namespace ?? namespaceHint;
    }
    if (meta.creationTimestamp) {
      result.created = meta.creationTimestamp;
    }
    if (meta.labels && typeof meta.labels === 'object') {
      result.labels = Object.entries(meta.labels)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
    }

    const workflowId = meta.annotations?.['workflows.core.eda.nokia.com/id'];
    if (typeof workflowId === 'string' && workflowId) {
      if (/^(0|[1-9]\d*)$/.test(workflowId)) {
        result['workflow-id'] = Number(workflowId);
      } else {
        result['workflow-id'] = workflowId;
      }
    }
  }

  private applySpecAndStatusFields(result: FlattenedRow, item: K8sResourceData): void {
    if (item.spec) {
      Object.assign(result, this.flattenObject(item.spec));
      if (typeof item.spec.type === 'string') {
        result['workflow-type'] = item.spec.type;
      }
    }

    if (isObject(item.workflowStatus)) {
      Object.assign(result, this.flattenObject(item.workflowStatus, 'workflowStatus'));
    }

    if (item.status) {
      Object.assign(result, this.flattenObject(item.status));
    }
  }

  private flatten(
    item: K8sResourceData,
    definitionName?: string,
    namespaceHint?: string
  ): FlattenedRow {
    const result: FlattenedRow = {};
    const meta = item.metadata ?? {};

    this.applyIdentityFields(result, item, definitionName);
    this.applyMetadataFields(result, meta, namespaceHint);
    this.applySpecAndStatusFields(result, item);

    const workflowStatus = this.extractWorkflowStateFromResource(item);
    if (workflowStatus) {
      result['workflow-status'] = workflowStatus;
    }

    return result;
  }

  private getOrCreateNamespaceMap(namespace: string): Map<string, FlattenedRow> {
    let map = this.rowMap.get(namespace);
    if (!map) {
      map = new Map();
      this.rowMap.set(namespace, map);
    }
    return map;
  }

  private addWorkflowRow(
    resource: K8sResourceData,
    definitionName?: string,
    namespaceHint?: string
  ): void {
    const name = resource.metadata?.name;
    if (!name) {
      return;
    }

    const namespace = resource.metadata?.namespace ?? namespaceHint ?? 'cluster';
    const flat = this.flatten(resource, definitionName, namespace);
    this.ensureColumns(flat);

    const rowKey = `${resource.apiVersion ?? ''}/${resource.kind ?? ''}/${name}`;
    const map = this.getOrCreateNamespaceMap(namespace);
    map.set(rowKey, flat);
  }

  private async loadCoreWorkflowResources(ns: string): Promise<void> {
    try {
      const workflows = await this.edaClient.listResources(
        CORE_EDA_GROUP, 'v1', 'Workflow',
        ns === ALL_NAMESPACES ? undefined : ns
      ) as K8sResourceData[];
      for (const workflow of workflows) {
        this.addWorkflowRow(
          workflow,
          undefined,
          ns === ALL_NAMESPACES ? undefined : ns
        );
      }
    } catch {
      // Ignore workflow list failures.
    }
  }

  private collectWorkflowBackedTargets(
    definitions: WorkflowDefinitionResource[]
  ): { flowTargetMap: Map<string, WorkflowBackedTarget>; flowStreamNames: Set<string> } {
    const flowTargetMap = new Map<string, WorkflowBackedTarget>();
    const flowStreamNames = new Set<string>();

    for (const definition of definitions) {
      const flowDef = definition.spec?.flowDefinitionResource;
      const definitionName = definition.metadata?.name;
      if (
        !flowDef
        || !flowDef.group
        || !flowDef.version
        || !flowDef.kind
        || !definitionName
      ) {
        continue;
      }
      const key = `${flowDef.group}/${flowDef.version}/${flowDef.kind}`;
      if (!flowTargetMap.has(key)) {
        flowTargetMap.set(key, {
          group: flowDef.group,
          version: flowDef.version,
          kind: flowDef.kind,
          definitionName
        });
      }
      flowStreamNames.add(kindToPlural(flowDef.kind));
    }

    return { flowTargetMap, flowStreamNames };
  }

  private async loadWorkflowBackedResources(ns: string): Promise<void> {
    const definitions = await this.getWorkflowDefinitions();
    const { flowTargetMap, flowStreamNames } = this.collectWorkflowBackedTargets(definitions);
    this.ensureWorkflowStreams(flowStreamNames);

    for (const target of flowTargetMap.values()) {
      try {
        const resources = await this.edaClient.listResources(
          target.group,
          target.version,
          target.kind,
          ns === ALL_NAMESPACES ? undefined : ns
        ) as K8sResourceData[];
        for (const resource of resources) {
          this.addWorkflowRow(
            resource,
            target.definitionName,
            ns === ALL_NAMESPACES ? undefined : ns
          );
        }
      } catch {
        // Ignore per-target errors and continue loading others.
      }
    }
  }

  private ensureColumns(data: FlattenedRow): void {
    for (const key of Object.keys(data)) {
      this.columnSet.add(key);
    }
    this.columns = Array.from(this.columnSet);
  }

  private getOrderedColumns(): string[] {
    const priorityColumns = ['workflow-id', 'workflow-status'];
    const ordered: string[] = [];

    for (const column of priorityColumns) {
      if (this.columnSet.has(column)) {
        ordered.push(column);
      }
    }

    for (const column of this.columns) {
      if (!priorityColumns.includes(column)) {
        ordered.push(column);
      }
    }

    return ordered;
  }

  private async loadInitial(ns: string): Promise<void> {
    this.selectedNamespace = ns;
    const previousRowMap = this.rowMap;
    const previousColumns = this.columns;
    const previousColumnSet = this.columnSet;

    this.rowMap = new Map();
    this.columnSet = new Set();
    this.columns = [];

    await this.loadCoreWorkflowResources(ns);
    await this.loadWorkflowBackedResources(ns);

    if (countRows(this.rowMap) === 0 && countRows(previousRowMap) > 0) {
      this.rowMap = previousRowMap;
      this.columns = previousColumns;
      this.columnSet = previousColumnSet;
    }

    this.sendNamespaces();
    this.postResults();
  }

  private reloadPanelData(): void {
    this.sendNamespaces();
    this.requestLoad(this.selectedNamespace);
  }

  private postResults(): void {
    const orderedColumns = this.getOrderedColumns();
    const namespaces =
      this.selectedNamespace === ALL_NAMESPACES
        ? Array.from(this.rowMap.keys())
        : [this.selectedNamespace];

    const rows: unknown[][] = [];
    for (const ns of namespaces) {
      const map = this.rowMap.get(ns);
      if (!map) continue;
      for (const data of map.values()) {
        rows.push(orderedColumns.map(column => data[column]));
      }
    }

    this.panel.webview.postMessage({
      command: 'results',
      columns: orderedColumns,
      rows,
      status: `Count: ${rows.length}`
    });
  }

  private async viewWorkflowYaml(
    name: string,
    namespace?: string,
    kind?: string,
    apiVersion?: string
  ): Promise<void> {
    try {
      let yaml: string;
      if (kind && apiVersion && apiVersion.includes('/') && kind.toLowerCase() !== 'workflow') {
        const [group, version] = apiVersion.split('/');
        yaml = await this.edaClient.getResourceYaml(
          group,
          version,
          kind,
          name,
          namespace
        );
      } else {
        yaml = await this.edaClient.getEdaResourceYaml(
          'workflow',
          name,
          namespace ?? '',
          'core.eda.nokia.com/v1'
        );
      }
      const document = await vscode.workspace.openTextDocument({
        content: yaml,
        language: 'yaml'
      });
      await vscode.window.showTextDocument(document);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to get workflow YAML: ${String(error)}`);
    }
  }

  static show(context: vscode.ExtensionContext, title: string): WorkflowsDashboardPanel {
    if (WorkflowsDashboardPanel.currentPanel) {
      const wasVisible = WorkflowsDashboardPanel.currentPanel.panel.visible;
      WorkflowsDashboardPanel.currentPanel.panel.title = title;
      WorkflowsDashboardPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
      if (wasVisible) {
        WorkflowsDashboardPanel.currentPanel.reloadPanelData();
      }
      return WorkflowsDashboardPanel.currentPanel;
    }

    const panel = new WorkflowsDashboardPanel(context, title);
    void panel.initialize();
    WorkflowsDashboardPanel.currentPanel = panel;
    panel.panel.onDidDispose(() => {
      panel.streamDisposable?.dispose();
      if (panel.streamRefreshTimer) {
        clearTimeout(panel.streamRefreshTimer);
      }
      for (const streamName of panel.subscribedWorkflowStreams) {
        panel.edaClient.closeStreamByName(streamName);
      }
      panel.subscribedWorkflowStreams.clear();
      panel.workflowSaveDisposable.dispose();
      panel.workflowCloseDisposable.dispose();
      panel.workflowDrafts.clear();
      if (WorkflowsDashboardPanel.currentPanel === panel) {
        WorkflowsDashboardPanel.currentPanel = undefined;
      }
    });
    return panel;
  }
}
