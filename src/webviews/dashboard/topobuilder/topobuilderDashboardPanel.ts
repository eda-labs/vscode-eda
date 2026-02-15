import * as yaml from 'js-yaml';
import * as vscode from 'vscode';

import type {
  WorkflowGetInputsRespElem,
  WorkflowIdentifier,
  WorkflowInputDataElem
} from '../../../clients/edaApiClient';
import type { EdaClient, K8sMetadata, K8sResource } from '../../../clients/edaClient';
import { serviceManager } from '../../../services/serviceManager';
import { BasePanel } from '../../basePanel';

type TopoBuilderWorkflowAction = 'run';
type TopoBuilderLegacyAction = 'apply' | 'dryRun' | 'basket';
type TopoBuilderIncomingCommand =
  | 'topobuilderWorkflowAction'
  | 'topobuilderTransactionAction'
  | 'topobuilderConfirmInput';

const WORKFLOW_INPUT_POLL_INTERVAL_MS = 2000;
const TOPOLOGY_WORKFLOW_BASE_PATH = '/workflows/v1/topologies.eda.nokia.com/v1alpha1/namespaces';

interface TopoBuilderWorkflowRequest {
  command: 'topobuilderWorkflowAction';
  action: TopoBuilderWorkflowAction;
  requestId: string;
  yaml: string;
}

interface TopoBuilderLegacyRequest {
  command: 'topobuilderTransactionAction';
  action: TopoBuilderLegacyAction;
  requestId: string;
  yaml: string;
}

interface TopoBuilderConfirmInputRequest {
  command: 'topobuilderConfirmInput';
  requestId: string;
  ack: boolean;
  subflows: WorkflowIdentifier[];
}

interface TopoBuilderWorkflowResponse {
  command: 'topobuilderWorkflowResult';
  requestId: string;
  action: TopoBuilderWorkflowAction;
  success: boolean;
  message: string;
}

interface TopoBuilderLegacyResponse {
  command: 'topobuilderTransactionResult';
  requestId: string;
  action: TopoBuilderLegacyAction;
  success: boolean;
  message: string;
}

interface TopoBuilderInputRequiredResponse {
  command: 'topobuilderInputRequired';
  requestId: string;
  inputs: WorkflowGetInputsRespElem[];
}

interface TopoBuilderWorkflowCompleteResponse {
  command: 'topobuilderWorkflowComplete';
  requestId: string;
  success: boolean;
  message: string;
}

interface ActiveWorkflowInputSession {
  requestId: string;
  inputPath: string;
  workflowPath: string;
  lastInputSignature: string | null;
  pendingInputs: WorkflowGetInputsRespElem[];
  awaitingUserResponse: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class TopoBuilderDashboardPanel extends BasePanel {
  private static currentPanel: TopoBuilderDashboardPanel | undefined;
  private edaClient: EdaClient;
  private activeWorkflowInputSession: ActiveWorkflowInputSession | undefined;
  private workflowInputPollTimer: ReturnType<typeof setTimeout> | undefined;
  private workflowInputPollInFlight = false;

  private constructor(context: vscode.ExtensionContext, title: string) {
    super(context, 'topobuilderDashboard', title, undefined, BasePanel.getEdaIconPath(context));
    this.edaClient = serviceManager.getClient<EdaClient>('eda');
    this.panel.webview.onDidReceiveMessage((msg: unknown) => {
      void this.handleWebviewMessage(msg);
    });
    this.panel.onDidDispose(() => {
      this.stopWorkflowInputPolling();
    });
    this.panel.webview.html = this.buildHtml();
  }

  protected getCustomStyles(): string {
    return this.readWebviewFile('dashboard', 'topobuilder', 'topobuilderDashboard.css');
  }

  protected getScriptTags(nonce: string): string {
    const scriptUri = this.getResourceUri('dist', 'topobuilderDashboard.js');
    return `<script type="module" nonce="${nonce}" src="${scriptUri}"></script>`;
  }

  protected buildHtml(): string {
    const nonce = this.getNonce();
    const csp = this.panel.webview.cspSource;
    const scriptTags = this.getScriptTags(nonce);
    const styles = this.getCustomStyles();
    const packageStylesUri = this.getResourceUri('dist', 'topobuilderDashboard.css');
    const logoUri = this.getResourceUri('resources', 'eda.svg').toString();
    const bootstrapScript = `<script nonce="${nonce}">window.__TOPOBUILDER_LOGO_URI__ = ${JSON.stringify(logoUri)};</script>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} https: data:; style-src ${csp} 'unsafe-inline'; font-src ${csp} https: data:; script-src 'nonce-${nonce}' ${csp} 'unsafe-eval'; worker-src ${csp} blob:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${packageStylesUri}" rel="stylesheet">
  <style>${styles}</style>
</head>
<body>
  <div id="root"></div>
  ${bootstrapScript}
  ${scriptTags}
</body>
</html>`;
  }

  private async handleWebviewMessage(msg: unknown): Promise<void> {
    if (!isObject(msg)) {
      return;
    }

    const command = this.getMessageCommand(msg.command);
    if (!command) {
      return;
    }

    if (command === 'topobuilderConfirmInput') {
      await this.handleConfirmInputMessage(msg as Partial<TopoBuilderConfirmInputRequest>);
      return;
    }

    const message = msg as Partial<TopoBuilderWorkflowRequest | TopoBuilderLegacyRequest>;
    try {
      const request = this.normalizeIncomingRequest(message, command);
      const resource = this.parseWorkflowResource(request.yaml);
      const submission = await this.submitWorkflow(resource);

      this.postWorkflowSuccess(
        command,
        request.requestId,
        request.originalAction,
        submission.namespace,
        submission.name,
        submission.retriedWithAlternateName
      );

      this.stopWorkflowInputPolling();
      this.startWorkflowInputPolling(request.requestId, submission.namespace, submission.name);
    } catch (error: unknown) {
      const messageText = error instanceof Error ? error.message : String(error);
      this.postWorkflowError(command, message, messageText);
    }
  }

  private getMessageCommand(command: unknown): TopoBuilderIncomingCommand | undefined {
    if (
      command === 'topobuilderWorkflowAction'
      || command === 'topobuilderTransactionAction'
      || command === 'topobuilderConfirmInput'
    ) {
      return command;
    }
    return undefined;
  }

  private normalizeIncomingRequest(
    message: Partial<TopoBuilderWorkflowRequest | TopoBuilderLegacyRequest>,
    command: 'topobuilderWorkflowAction' | 'topobuilderTransactionAction'
  ): {
    requestId: string;
    yaml: string;
    workflowAction: TopoBuilderWorkflowAction;
    originalAction: TopoBuilderWorkflowAction | TopoBuilderLegacyAction;
  } {
    if (!message.requestId || typeof message.requestId !== 'string') {
      throw new Error('Missing request identifier.');
    }
    if (typeof message.yaml !== 'string' || !message.yaml.trim()) {
      throw new Error('Topology YAML is empty.');
    }

    if (!message.action || typeof message.action !== 'string') {
      throw new Error('Unsupported workflow action.');
    }

    if (command === 'topobuilderWorkflowAction') {
      if (!this.isValidAction(message.action)) {
        throw new Error('Unsupported workflow action.');
      }
      return {
        requestId: message.requestId,
        yaml: message.yaml,
        workflowAction: message.action,
        originalAction: message.action
      };
    }

    if (!this.isLegacyAction(message.action)) {
      throw new Error('Unsupported topology action.');
    }

    if (message.action === 'basket') {
      throw new Error('Workflow resources cannot be added to basket. Use Run Workflow.');
    }

    return {
      requestId: message.requestId,
      yaml: message.yaml,
      workflowAction: 'run',
      originalAction: message.action
    };
  }

  private async handleConfirmInputMessage(message: Partial<TopoBuilderConfirmInputRequest>): Promise<void> {
    const requestId = typeof message.requestId === 'string'
      ? message.requestId
      : (this.activeWorkflowInputSession?.requestId ?? '');

    try {
      const request = this.normalizeConfirmInputRequest(message);
      const session = this.activeWorkflowInputSession;
      if (!session || session.requestId !== request.requestId) {
        throw new Error('No active workflow input request found for this workflow run.');
      }

      const payload: WorkflowInputDataElem[] = request.subflows.map(subflow => ({
        ack: request.ack,
        subflow
      }));
      await this.edaClient.submitWorkflowInput(session.inputPath, payload);
      session.awaitingUserResponse = false;
      session.pendingInputs = [];
      session.lastInputSignature = null;
      this.scheduleWorkflowInputPoll(0);
    } catch (error: unknown) {
      const messageText = error instanceof Error ? error.message : String(error);
      if (requestId) {
        this.postWorkflowComplete({
          command: 'topobuilderWorkflowComplete',
          requestId,
          success: false,
          message: `Failed to submit workflow input: ${messageText}`
        });
      }
      this.stopWorkflowInputPolling();
    }
  }

  private normalizeConfirmInputRequest(message: Partial<TopoBuilderConfirmInputRequest>): {
    requestId: string;
    ack: boolean;
    subflows: WorkflowIdentifier[];
  } {
    if (!message.requestId || typeof message.requestId !== 'string') {
      throw new Error('Missing request identifier.');
    }
    if (typeof message.ack !== 'boolean') {
      throw new Error('Missing workflow input acknowledgement value.');
    }
    if (!Array.isArray(message.subflows) || message.subflows.length === 0) {
      throw new Error('Missing workflow subflow identifiers.');
    }

    return {
      requestId: message.requestId,
      ack: message.ack,
      subflows: message.subflows.map((subflow, index) => this.normalizeWorkflowIdentifier(subflow, index))
    };
  }

  private normalizeWorkflowIdentifier(value: unknown, index: number): WorkflowIdentifier {
    if (!isObject(value)) {
      throw new Error(`Invalid subflow identifier at index ${index}.`);
    }

    const group = typeof value.group === 'string' ? value.group.trim() : '';
    const kind = typeof value.kind === 'string' ? value.kind.trim() : '';
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    const version = typeof value.version === 'string' ? value.version.trim() : '';
    const namespace = typeof value.namespace === 'string' ? value.namespace.trim() : undefined;

    if (!group || !kind || !name || !version) {
      throw new Error(`Invalid subflow identifier at index ${index}.`);
    }

    return {
      group,
      kind,
      name,
      namespace: namespace || undefined,
      version
    };
  }

  private parseWorkflowResource(yamlText: string): K8sResource {
    const parsed = yaml.load(yamlText);
    if (!isObject(parsed)) {
      throw new Error('YAML root must be an object.');
    }

    const resource = parsed as K8sResource;
    if (!resource.kind || typeof resource.kind !== 'string' || !resource.kind.trim()) {
      throw new Error('YAML must include kind.');
    }
    if (!resource.apiVersion || typeof resource.apiVersion !== 'string' || !resource.apiVersion.trim()) {
      throw new Error('YAML must include apiVersion.');
    }

    const metadata = this.normalizeMetadata(resource.metadata);
    const name = typeof metadata.name === 'string' ? metadata.name.trim() : '';
    const generateName = typeof metadata.generateName === 'string' ? metadata.generateName.trim() : '';
    if (!name && !generateName) {
      throw new Error('YAML must include metadata.name or metadata.generateName.');
    }
    if (name) {
      metadata.name = name;
    } else {
      metadata.name = this.nextNameFromPrefix(generateName);
    }
    delete metadata.generateName;
    if (!metadata.namespace || !metadata.namespace.trim()) {
      metadata.namespace = this.edaClient.getCoreNamespace();
    }
    resource.metadata = metadata;

    return resource;
  }

  private normalizeMetadata(metadata: unknown): K8sMetadata {
    if (!isObject(metadata)) {
      return {};
    }
    return metadata as K8sMetadata;
  }

  private async submitWorkflow(resource: K8sResource): Promise<{ namespace: string; name: string; retriedWithAlternateName: boolean }> {
    const namespace = resource.metadata?.namespace ?? this.edaClient.getCoreNamespace();
    const name = this.getDisplayName(resource.metadata);
    try {
      await this.createWorkflowResource(resource, namespace);
      return { namespace, name, retriedWithAlternateName: false };
    } catch (error: unknown) {
      if (!this.isAlreadyExistsError(error)) {
        throw error;
      }

      const retryResource = this.withAlternateNameResource(resource);
      if (!retryResource) {
        throw error;
      }

      await this.createWorkflowResource(retryResource, namespace);
      return {
        namespace,
        name: this.getDisplayName(retryResource.metadata),
        retriedWithAlternateName: true
      };
    }
  }

  private async createWorkflowResource(resource: K8sResource, namespace: string): Promise<void> {
    const kind = resource.kind ?? '';
    const { group, version } = this.parseGroupVersion(resource.apiVersion ?? '');
    await this.edaClient.createResource(group, version, kind, resource, namespace);
  }

  private startWorkflowInputPolling(requestId: string, namespace: string, name: string): void {
    const encodedNamespace = encodeURIComponent(namespace);
    const encodedName = encodeURIComponent(name);
    const workflowPath = `${TOPOLOGY_WORKFLOW_BASE_PATH}/${encodedNamespace}/networktopologies/${encodedName}`;
    const inputPath = `${workflowPath}/_input`;

    this.activeWorkflowInputSession = {
      requestId,
      inputPath,
      workflowPath,
      lastInputSignature: null,
      pendingInputs: [],
      awaitingUserResponse: false
    };
    this.scheduleWorkflowInputPoll(0);
  }

  private stopWorkflowInputPolling(): void {
    if (this.workflowInputPollTimer) {
      clearTimeout(this.workflowInputPollTimer);
      this.workflowInputPollTimer = undefined;
    }
    this.activeWorkflowInputSession = undefined;
    this.workflowInputPollInFlight = false;
  }

  private scheduleWorkflowInputPoll(delayMs = WORKFLOW_INPUT_POLL_INTERVAL_MS): void {
    if (!this.activeWorkflowInputSession) {
      return;
    }
    if (this.workflowInputPollTimer) {
      clearTimeout(this.workflowInputPollTimer);
    }
    this.workflowInputPollTimer = setTimeout(() => {
      void this.pollWorkflowInputSession();
    }, delayMs);
  }

  private async pollWorkflowInputSession(): Promise<void> {
    const session = this.activeWorkflowInputSession;
    if (!session || this.workflowInputPollInFlight) {
      return;
    }

    this.workflowInputPollInFlight = true;
    try {
      const workflow = await this.edaClient.getResource(session.workflowPath);
      const result = this.getWorkflowResult(workflow);
      if (result) {
        this.postWorkflowComplete({
          command: 'topobuilderWorkflowComplete',
          requestId: session.requestId,
          success: result === 'Success',
          message: this.buildWorkflowCompletionMessage(result, workflow, session.workflowPath)
        });
        this.stopWorkflowInputPolling();
        return;
      }

      if (!session.awaitingUserResponse) {
        const inputs = await this.edaClient.getWorkflowInputs(session.inputPath);
        const normalizedInputs = this.normalizeWorkflowInputs(inputs);
        if (normalizedInputs.length > 0) {
          const signature = this.buildWorkflowInputSignature(normalizedInputs);
          if (signature !== session.lastInputSignature) {
            session.pendingInputs = normalizedInputs;
            session.lastInputSignature = signature;
            session.awaitingUserResponse = true;
            this.postInputRequired({
              command: 'topobuilderInputRequired',
              requestId: session.requestId,
              inputs: normalizedInputs
            });
          }
        } else {
          session.pendingInputs = [];
          session.lastInputSignature = null;
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (!this.isRetryablePollingError(message)) {
        this.postWorkflowComplete({
          command: 'topobuilderWorkflowComplete',
          requestId: session.requestId,
          success: false,
          message: `Failed while polling workflow input: ${message}`
        });
        this.stopWorkflowInputPolling();
        return;
      }
    } finally {
      this.workflowInputPollInFlight = false;
    }

    if (this.activeWorkflowInputSession === session) {
      this.scheduleWorkflowInputPoll();
    }
  }

  private isRetryablePollingError(message: string): boolean {
    return message.includes('HTTP 404');
  }

  private normalizeWorkflowInputs(inputs: WorkflowGetInputsRespElem[]): WorkflowGetInputsRespElem[] {
    const normalized: WorkflowGetInputsRespElem[] = [];
    for (const input of inputs) {
      if (!isObject(input)) {
        continue;
      }
      const group = typeof input.group === 'string' ? input.group.trim() : '';
      const kind = typeof input.kind === 'string' ? input.kind.trim() : '';
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      const version = typeof input.version === 'string' ? input.version.trim() : '';
      const namespace = typeof input.namespace === 'string' ? input.namespace.trim() : undefined;
      const ackPrompt = typeof input.ackPrompt === 'string' ? input.ackPrompt : undefined;

      if (!group || !kind || !name || !version) {
        continue;
      }

      normalized.push({
        group,
        kind,
        name,
        namespace: namespace || undefined,
        version,
        ackPrompt
      });
    }

    return normalized;
  }

  private buildWorkflowInputSignature(inputs: WorkflowGetInputsRespElem[]): string {
    return JSON.stringify(inputs.map(input => ({
      ackPrompt: input.ackPrompt ?? '',
      group: input.group,
      kind: input.kind,
      name: input.name,
      namespace: input.namespace ?? '',
      version: input.version
    })));
  }

  private getWorkflowResult(resource: K8sResource): 'Success' | 'Failed' | undefined {
    if (!isObject(resource.status)) {
      return undefined;
    }
    const result = resource.status.result;
    if (result === 'Success' || result === 'Failed') {
      return result;
    }
    return undefined;
  }

  private buildWorkflowCompletionMessage(result: 'Success' | 'Failed', workflow: K8sResource, workflowPath: string): string {
    const statusMessage =
      isObject(workflow.status) && typeof workflow.status.message === 'string'
        ? workflow.status.message.trim()
        : '';
    if (result === 'Success') {
      return statusMessage || `Workflow completed successfully: ${workflowPath}`;
    }
    return statusMessage || `Workflow failed: ${workflowPath}`;
  }

  private isAlreadyExistsError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    if (!error.message.includes('HTTP 409')) {
      return false;
    }
    return error.message.includes('AlreadyExists');
  }

  private withAlternateNameResource(resource: K8sResource): K8sResource | null {
    const name = typeof resource.metadata?.name === 'string' ? resource.metadata.name.trim() : '';
    if (!name) {
      return null;
    }
    const candidate = JSON.parse(JSON.stringify(resource)) as K8sResource;
    const metadata = this.normalizeMetadata(candidate.metadata);
    metadata.name = this.nextNameFromExistingName(name);
    delete metadata.resourceVersion;
    delete metadata.uid;
    delete metadata.generateName;
    candidate.metadata = metadata;
    return candidate;
  }

  private parseGroupVersion(apiVersion: string): { group: string; version: string } {
    const pieces = apiVersion.split('/');
    if (pieces.length !== 2) {
      throw new Error(`Invalid apiVersion "${apiVersion}". Expected "group/version".`);
    }
    const group = pieces[0].trim();
    const version = pieces[1].trim();
    if (!group || !version) {
      throw new Error(`Invalid apiVersion "${apiVersion}". Expected "group/version".`);
    }
    return { group, version };
  }

  private getDisplayName(metadata: K8sMetadata | undefined): string {
    const name = typeof metadata?.name === 'string' ? metadata.name.trim() : '';
    if (name) {
      return name;
    }
    const generateName = typeof metadata?.generateName === 'string' ? metadata.generateName.trim() : '';
    if (generateName) {
      return `${generateName}*`;
    }
    return 'workflow';
  }

  private nextNameFromPrefix(prefix: string): string {
    const suffix = Date.now().toString(36).slice(-6);
    const trimmedPrefix = prefix.trim();
    const prefixWithDash = trimmedPrefix.endsWith('-') ? trimmedPrefix : `${trimmedPrefix}-`;
    const maxPrefixLength = Math.max(1, 63 - suffix.length);
    const boundedPrefix = prefixWithDash.slice(0, maxPrefixLength);
    return `${boundedPrefix}${suffix}`;
  }

  private nextNameFromExistingName(name: string): string {
    const suffix = Date.now().toString(36).slice(-6);
    const maxBaseLength = Math.max(1, 63 - suffix.length - 1);
    const trimmed = this.stripTrailingDashes(name.trim());
    const base = trimmed.slice(0, maxBaseLength);
    return `${base}-${suffix}`;
  }

  private stripTrailingDashes(value: string): string {
    let end = value.length;
    while (end > 0 && value.charCodeAt(end - 1) === 45) {
      end -= 1;
    }
    return value.slice(0, end);
  }

  private buildSuccessMessage(namespace: string, name: string, retriedWithAlternateName: boolean): string {
    if (retriedWithAlternateName) {
      return `Workflow run submitted with alternate name: ${namespace}/${name}`;
    }
    return `Workflow run submitted: ${namespace}/${name}`;
  }

  private postWorkflowResponse(message: TopoBuilderWorkflowResponse): void {
    void this.panel.webview.postMessage(message);
  }

  private postLegacyResponse(message: TopoBuilderLegacyResponse): void {
    void this.panel.webview.postMessage(message);
  }

  private postInputRequired(message: TopoBuilderInputRequiredResponse): void {
    void this.panel.webview.postMessage(message);
  }

  private postWorkflowComplete(message: TopoBuilderWorkflowCompleteResponse): void {
    void this.panel.webview.postMessage(message);
  }

  private postWorkflowSuccess(
    command: 'topobuilderWorkflowAction' | 'topobuilderTransactionAction',
    requestId: string,
    originalAction: TopoBuilderWorkflowAction | TopoBuilderLegacyAction,
    namespace: string,
    name: string,
    retriedWithAlternateName: boolean
  ): void {
    const successMessage = this.buildSuccessMessage(namespace, name, retriedWithAlternateName);
    if (command === 'topobuilderTransactionAction') {
      this.postLegacyResponse({
        command: 'topobuilderTransactionResult',
        requestId,
        action: originalAction as TopoBuilderLegacyAction,
        success: true,
        message: successMessage
      });
      return;
    }
    this.postWorkflowResponse({
      command: 'topobuilderWorkflowResult',
      requestId,
      action: originalAction as TopoBuilderWorkflowAction,
      success: true,
      message: successMessage
    });
  }

  private postWorkflowError(
    command: 'topobuilderWorkflowAction' | 'topobuilderTransactionAction',
    message: Partial<TopoBuilderWorkflowRequest | TopoBuilderLegacyRequest>,
    errorMessage: string
  ): void {
    const requestId = typeof message.requestId === 'string' ? message.requestId : '';
    const text = `Failed to submit workflow: ${errorMessage}`;

    if (command === 'topobuilderTransactionAction') {
      const action = this.isLegacyAction(message.action) ? message.action : 'apply';
      this.postLegacyResponse({
        command: 'topobuilderTransactionResult',
        requestId,
        action,
        success: false,
        message: text
      });
      return;
    }

    const action = this.isValidAction(message.action) ? message.action : 'run';
    this.postWorkflowResponse({
      command: 'topobuilderWorkflowResult',
      requestId,
      action,
      success: false,
      message: text
    });
  }

  private isValidAction(action: unknown): action is TopoBuilderWorkflowAction {
    return action === 'run';
  }

  private isLegacyAction(action: unknown): action is TopoBuilderLegacyAction {
    return action === 'apply' || action === 'dryRun' || action === 'basket';
  }

  static show(context: vscode.ExtensionContext, title: string): TopoBuilderDashboardPanel {
    if (TopoBuilderDashboardPanel.currentPanel) {
      TopoBuilderDashboardPanel.currentPanel.panel.title = title;
      TopoBuilderDashboardPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
      return TopoBuilderDashboardPanel.currentPanel;
    }

    const panel = new TopoBuilderDashboardPanel(context, title);
    TopoBuilderDashboardPanel.currentPanel = panel;
    panel.panel.onDidDispose(() => {
      if (TopoBuilderDashboardPanel.currentPanel === panel) {
        TopoBuilderDashboardPanel.currentPanel = undefined;
      }
    });
    return panel;
  }
}
