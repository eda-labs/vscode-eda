// src/commands/resourceEditCommands.ts
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

import type { EdaClient } from '../clients/edaClient';
import type { KubernetesClient } from '../clients/kubernetesClient';
import { log, LogLevel, edaOutputChannel, edaTransactionBasketProvider } from '../extension';
import { ResourceEditDocumentProvider } from '../providers/documents/resourceEditProvider';
import { ResourceViewDocumentProvider } from '../providers/documents/resourceViewProvider';
import type { ResourceService } from '../services/resourceService';
import { serviceManager } from '../services/serviceManager';
import { isEdaResource } from '../utils/edaGroupUtils';
import {
  getViewIsEda,
  setViewIsEda,
  setResourceOrigin,
  getResourceOrigin
} from '../utils/resourceOriginStore';
import { sanitizeResource, sanitizeResourceForEdit } from '../utils/yamlUtils';

// Command identifiers
const CMD_SWITCH_TO_EDIT = 'vscode-eda.switchToEditResource';
const CMD_SWITCH_TO_VIEW = 'vscode-eda.switchToViewResource';
const CMD_APPLY_CHANGES = 'vscode-eda.applyResourceChanges';

// UI strings
const BTN_VIEW_DETAILS = 'View Details';
const BTN_APPLY_CHANGES = 'Apply Changes';
const BTN_CANCEL = 'Cancel';

// Quick pick item constants
const LABEL_APPLY = 'Apply Changes';
const LABEL_DIFF = 'View Changes (Diff)';
const LABEL_VALIDATE = 'Validate (Dry Run)';
const LABEL_BASKET = 'Add to Basket';
const DESC_APPLY = 'Apply changes to the cluster';
const DESC_DIFF = 'Compare changes before proceeding';
const DESC_VALIDATE = 'Check if changes are valid without applying';
const DESC_BASKET = 'Save changes to the transaction basket';

// Scheme constants
const SCHEME_K8S = 'k8s';
const SCHEME_K8S_VIEW = 'k8s-view';

/** Standard Kubernetes object metadata */
interface K8sMetadata {
  name?: string;
  namespace?: string;
  uid?: string;
  resourceVersion?: string;
  annotations?: Record<string, string>;
  labels?: Record<string, string>;
  [key: string]: unknown;
}

/** Standard Kubernetes resource object */
interface K8sResource {
  apiVersion?: string;
  kind?: string;
  metadata?: K8sMetadata;
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Command argument passed from tree items or webview messages
 */
interface CommandArgument {
  name?: string;
  namespace?: string;
  kind?: string;
  resourceType?: string;
  label?: string;
  streamGroup?: string;
  raw?: K8sResource;
  rawResource?: K8sResource;
  resource?: {
    raw?: K8sResource;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// Interface for resource identification
interface ResourceInfo {
  namespace: string;
  kind: string;
  name: string;
  apiVersion?: string;
}

/** Type alias for command input that can be a CommandArgument, Uri, or undefined */
type CommandInput = CommandArgument | vscode.Uri | undefined;

// Keep track of resource URI pairs (view and edit versions of the same resource)
interface ResourceURIPair {
  viewUri: vscode.Uri;
  editUri: vscode.Uri;
  originalResource: K8sResource;
  isEdaResource: boolean;
}

const resourcePairs = new Map<string, ResourceURIPair>();

// Flag to suppress the apply prompt when saving programmatically
let suppressSavePrompt = false;

// Map resource identifier to URI pair
function getResourceKey(namespace: string, kind: string, name: string): string {
  return `${namespace}/${kind}/${name}`;
}


// Define interface for our custom quick pick items
interface ActionQuickPickItem extends vscode.QuickPickItem {
  id: string;
}

/**
 * Determines the EDA origin flag for a resource based on multiple sources.
 * Checks URI origin, stored origin, view flag, and apiVersion in order.
 */
function determineEdaOrigin(
  viewUri: vscode.Uri | undefined,
  resourceInfo: ResourceInfo,
  arg?: CommandArgument
): boolean {
  // Try to get origin from URI
  if (viewUri) {
    const originFromUri = ResourceViewDocumentProvider.getOrigin(viewUri);
    log(`determineEdaOrigin: origin from URI=${originFromUri}`, LogLevel.DEBUG);
    if (originFromUri) {
      return originFromUri === 'eda';
    }
  }

  // Try from stored origin
  const originStored = getResourceOrigin(resourceInfo.namespace, resourceInfo.kind, resourceInfo.name);
  log(`determineEdaOrigin: origin from store=${originStored}`, LogLevel.DEBUG);
  if (originStored !== undefined) {
    return originStored;
  }

  // Try from view flag
  if (viewUri) {
    const viewFlag = getViewIsEda(viewUri);
    log(`determineEdaOrigin: origin from view flag=${viewFlag}`, LogLevel.DEBUG);
    if (viewFlag !== undefined) {
      return viewFlag;
    }
  }

  // Try from apiVersion
  if (resourceInfo.apiVersion?.includes('.eda.nokia.com')) {
    log(`determineEdaOrigin: origin guessed from apiVersion=true`, LogLevel.DEBUG);
    return true;
  }

  // Try from arg
  if (arg) {
    const raw: K8sResource | undefined = arg.raw ?? arg.rawResource ?? arg.resource?.raw;
    return isEdaResource(arg, raw?.apiVersion);
  }

  return false;
}

/**
 * Extracts raw resource data from various argument formats.
 */
function extractRawResource(arg: CommandArgument | undefined): K8sResource | undefined {
  return arg?.raw ?? arg?.rawResource ?? arg?.resource?.raw;
}

/**
 * Gets a value from multiple sources with a default fallback.
 */
function getFirstDefined<T>(...values: (T | undefined | null)[]): T {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return values[values.length - 1] as T;
}

/**
 * Extracts resource info from arg with fallback values.
 */
function extractResourceInfoFromArg(arg: CommandArgument | undefined, raw: K8sResource | undefined): ResourceInfo {
  return {
    namespace: getFirstDefined(raw?.metadata?.namespace, arg?.namespace as string | undefined, 'default'),
    kind: getFirstDefined(raw?.kind, arg?.kind, arg?.resourceType, 'Resource'),
    name: getFirstDefined(raw?.metadata?.name, arg?.name, arg?.label, 'unknown'),
    apiVersion: raw?.apiVersion
  };
}

/**
 * Resolves the view document URI from various input sources.
 */
function resolveViewDocumentUri(arg: CommandArgument | vscode.Uri): { uri: vscode.Uri | undefined; resourceInfo: Partial<ResourceInfo> } {
  if (!arg) {
    return { uri: undefined, resourceInfo: {} };
  }

  // Case 1: Invoked with a URI (from active editor or command palette)
  if (arg instanceof vscode.Uri) {
    return { uri: arg, resourceInfo: {} };
  }

  // Case 2: Invoked from a tree item or resource data
  const raw = extractRawResource(arg);
  const resourceInfo = extractResourceInfoFromArg(arg, raw);

  const uri = ResourceViewDocumentProvider.createUri(
    resourceInfo.namespace,
    resourceInfo.kind,
    resourceInfo.name,
    isEdaResource(arg, raw?.apiVersion) ? 'eda' : 'k8s'
  );

  return { uri, resourceInfo };
}

/**
 * Fetches the resource YAML from the appropriate client.
 */
async function fetchResourceYaml(
  edaClient: EdaClient,
  resourceInfo: ResourceInfo,
  isEda: boolean
): Promise<string> {
  if (isEda) {
    return edaClient.getEdaResourceYaml(
      resourceInfo.kind,
      resourceInfo.name,
      resourceInfo.namespace,
      resourceInfo.apiVersion
    );
  }
  const k8s = serviceManager.getClient<KubernetesClient>('kubernetes');
  return k8s.getResourceYaml(resourceInfo.kind, resourceInfo.name, resourceInfo.namespace);
}

/**
 * Creates or updates a status bar item for mode switching.
 */
function createModeStatusBarItem(
  context: vscode.ExtensionContext,
  targetUri: vscode.Uri,
  mode: 'view' | 'edit'
): void {
  const isViewMode = mode === 'view';
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = isViewMode ? '$(eye) View Mode' : '$(edit) Edit Mode';
  statusBarItem.tooltip = isViewMode ? 'Switch back to read-only view' : 'Switch to edit mode';
  statusBarItem.command = {
    title: 'Switch mode',
    command: isViewMode ? CMD_SWITCH_TO_VIEW : CMD_SWITCH_TO_EDIT,
    arguments: [targetUri]
  };
  statusBarItem.show();

  const disposable = vscode.window.onDidChangeActiveTextEditor(editor => {
    if (!editor || editor.document.uri.toString() !== targetUri.toString()) {
      statusBarItem.dispose();
      disposable.dispose();
    }
  });

  context.subscriptions.push(disposable);
}

/**
 * Updates providers after a successful resource apply.
 */
function updateProvidersAfterApply(
  resourceEditProvider: ResourceEditDocumentProvider,
  resourceViewProvider: ResourceViewDocumentProvider,
  documentUri: vscode.Uri,
  resource: K8sResource,
  resourceKey: string
): void {
  resourceEditProvider.setOriginalResource(
    documentUri,
    sanitizeResourceForEdit(resource)
  );

  const pair = resourcePairs.get(resourceKey);
  if (pair) {
    const updatedYaml = yaml.dump(resource, { indent: 2 });
    resourceViewProvider.setResourceContent(pair.viewUri, updatedYaml);
    pair.originalResource = resource;
  }
}

/**
 * Shows success message with View Details option after applying a resource.
 */
function showApplySuccessMessage(resource: K8sResource): void {
  vscode.window.showInformationMessage(
    `Successfully applied ${resource.kind} "${resource.metadata?.name}"`,
    BTN_VIEW_DETAILS
  ).then(selection => {
    if (selection === BTN_VIEW_DETAILS) {
      edaOutputChannel.show();
    }
  });
}

/**
 * Gets the EDA origin flag from a document URI or stored values.
 */
function getEdaOriginFromDocument(documentUri: vscode.Uri, resource: K8sResource, pair?: ResourceURIPair): boolean {
  if (pair?.isEdaResource !== undefined) {
    return pair.isEdaResource;
  }

  const origin = ResourceEditDocumentProvider.getOrigin(documentUri);
  if (origin) {
    return origin === 'eda';
  }

  const { namespace, kind, name } = ResourceEditDocumentProvider.parseUri(documentUri);
  const originStored = getResourceOrigin(namespace, kind, name);
  return originStored ?? isEdaResource(undefined, resource.apiVersion);
}

/**
 * Handles document close cleanup for resource pairs.
 */
function handleDocumentClose(
  document: vscode.TextDocument,
  resourceEditProvider: ResourceEditDocumentProvider
): void {
  const scheme = document.uri.scheme;
  if (scheme !== SCHEME_K8S && scheme !== SCHEME_K8S_VIEW) {
    return;
  }

  for (const [key, pair] of resourcePairs.entries()) {
    const uriToCheck = scheme === SCHEME_K8S ? pair.editUri : pair.viewUri;

    if (uriToCheck.toString() !== document.uri.toString()) {
      continue;
    }

    const otherUri = scheme === SCHEME_K8S ? pair.viewUri : pair.editUri;
    const isOtherOpen = vscode.workspace.textDocuments.some(
      doc => doc.uri.toString() === otherUri.toString()
    );

    if (!isOtherOpen) {
      resourcePairs.delete(key);
      log(`Removed resource pair for ${key}`, LogLevel.DEBUG);

      if (scheme === SCHEME_K8S) {
        resourceEditProvider.cleanupDocument(uriToCheck);
      }
    }
    break;
  }
}

/**
 * Resolves and validates the view document URI from the command argument.
 */
async function resolveAndValidateViewUri(arg: CommandInput): Promise<vscode.Uri> {
  let viewDocumentUri: vscode.Uri | undefined;

  if (arg) {
    const resolved = resolveViewDocumentUri(arg);
    viewDocumentUri = resolved.uri;
  }

  if (!viewDocumentUri) {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor || activeEditor.document.uri.scheme !== SCHEME_K8S_VIEW) {
      throw new Error('No Kubernetes resource view document is active');
    }
    viewDocumentUri = activeEditor.document.uri;
  }

  if (viewDocumentUri.scheme !== SCHEME_K8S_VIEW) {
    throw new Error('Not a Kubernetes resource read-only view');
  }

  return viewDocumentUri;
}

/**
 * Extracts API version from the view document or argument.
 */
async function extractApiVersion(viewDocumentUri: vscode.Uri, arg: CommandInput): Promise<string | undefined> {
  // Check arg first (only if it's a CommandArgument, not a Uri)
  if (arg && !(arg instanceof vscode.Uri)) {
    const raw: K8sResource | undefined = arg.raw ?? arg.rawResource ?? arg.resource?.raw;
    if (raw?.apiVersion) {
      return raw.apiVersion;
    }
  }

  // Try to parse from document
  try {
    const doc = await vscode.workspace.openTextDocument(viewDocumentUri);
    const obj = yaml.load(doc.getText()) as K8sResource | undefined;
    if (obj && typeof obj === 'object' && typeof obj.apiVersion === 'string') {
      return obj.apiVersion;
    }
  } catch {
    // ignore parse errors
  }

  return undefined;
}

/**
 * Parses YAML text and removes status field.
 */
function parseAndSanitizeResource(yamlText: string): K8sResource {
  let resourceObject: K8sResource;
  try {
    resourceObject = yaml.load(yamlText) as K8sResource;
  } catch (parseErr) {
    throw new Error(`Invalid YAML fetched from cluster: ${parseErr}`);
  }

  if (resourceObject && typeof resourceObject === 'object') {
    delete resourceObject.status;
  }

  return resourceObject;
}

/**
 * Gets or creates an edit URI for a resource.
 */
function getOrCreateEditUri(
  resourceKey: string,
  viewDocumentUri: vscode.Uri,
  resourceObject: K8sResource,
  edaOrigin: boolean,
  resourceInfo: ResourceInfo
): { editUri: vscode.Uri; pair: ResourceURIPair | undefined } {
  let pair = resourcePairs.get(resourceKey);
  let editUri: vscode.Uri;

  if (pair) {
    editUri = pair.editUri;
    log(`Using existing edit URI for ${resourceKey}`, LogLevel.DEBUG);
    pair.isEdaResource = edaOrigin;
    pair.originalResource = resourceObject;
    pair.viewUri = viewDocumentUri;
  } else {
    editUri = ResourceEditDocumentProvider.createUri(
      resourceInfo.namespace,
      resourceInfo.kind,
      resourceInfo.name,
      edaOrigin ? 'eda' : 'k8s'
    );
    pair = {
      viewUri: viewDocumentUri,
      editUri: editUri,
      originalResource: resourceObject,
      isEdaResource: edaOrigin
    };
    resourcePairs.set(resourceKey, pair);
  }

  return { editUri, pair };
}

/**
 * Refreshes an existing open document with new content.
 */
async function refreshExistingDocument(editUri: vscode.Uri, sanitizedYaml: string): Promise<void> {
  const existingDoc = vscode.workspace.textDocuments.find(doc =>
    doc.uri.toString() === editUri.toString()
  );

  if (existingDoc) {
    const fullRange = new vscode.Range(
      existingDoc.positionAt(0),
      existingDoc.positionAt(existingDoc.getText().length)
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(editUri, fullRange, sanitizedYaml);
    await vscode.workspace.applyEdit(edit);
    suppressSavePrompt = true;
    await existingDoc.save();
    suppressSavePrompt = false;
  }
}

/**
 * Stores origin information for a resource in both view and resource stores.
 */
function storeOriginInfo(
  viewDocumentUri: vscode.Uri,
  resourceInfo: ResourceInfo,
  edaOrigin: boolean
): void {
  setViewIsEda(viewDocumentUri, edaOrigin);
  setResourceOrigin(resourceInfo.namespace, resourceInfo.kind, resourceInfo.name, edaOrigin);
  const originLabel = edaOrigin ? 'eda' : 'k8s';
  log(`switchToEditResource: final origin=${originLabel}`, LogLevel.DEBUG);
}

/**
 * Prepares edit document content and stores it in the provider.
 */
function prepareEditDocumentContent(
  resourceEditProvider: ResourceEditDocumentProvider,
  editUri: vscode.Uri,
  resourceObject: K8sResource
): string {
  const sanitizedForEdit = sanitizeResourceForEdit(resourceObject);
  const sanitizedYaml = yaml.dump(sanitizedForEdit, { indent: 2 });
  resourceEditProvider.setOriginalResource(editUri, sanitizedForEdit);
  resourceEditProvider.setResourceContent(editUri, sanitizedYaml);
  return sanitizedYaml;
}

/**
 * Opens and displays an edit document with proper language mode.
 */
async function openEditDocument(editUri: vscode.Uri): Promise<vscode.TextDocument> {
  const editDoc = await vscode.workspace.openTextDocument(editUri);
  await vscode.languages.setTextDocumentLanguage(editDoc, 'yaml');
  await vscode.window.showTextDocument(editDoc, { preserveFocus: false, preview: false });
  return editDoc;
}

/**
 * Opens and displays a view document with proper language mode.
 */
async function openViewDocument(viewUri: vscode.Uri): Promise<vscode.TextDocument> {
  const viewDoc = await vscode.workspace.openTextDocument(viewUri);
  await vscode.languages.setTextDocumentLanguage(viewDoc, 'yaml');
  await vscode.window.showTextDocument(viewDoc, { preserveFocus: false, preview: false });
  return viewDoc;
}

/**
 * Gets edit document URI from active editor or throws if not available.
 */
function getEditDocumentUri(editDocumentUri: vscode.Uri | undefined): vscode.Uri {
  if (editDocumentUri) {
    return editDocumentUri;
  }

  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor || activeEditor.document.uri.scheme !== SCHEME_K8S) {
    throw new Error('No Kubernetes resource edit document is active');
  }
  return activeEditor.document.uri;
}

/**
 * Validates that a URI is a k8s edit scheme.
 */
function validateEditScheme(uri: vscode.Uri): void {
  if (uri.scheme !== SCHEME_K8S) {
    throw new Error('Not a Kubernetes resource edit view');
  }
}

/**
 * Prompts user about unsaved changes and handles their choice.
 * Returns true if should continue with view switch, false to cancel.
 */
async function handleUnsavedChanges(
  editDocumentUri: vscode.Uri,
  kind: string,
  name: string
): Promise<boolean> {
  const promptText = `${kind}/${name}`;
  const answer = await vscode.window.showWarningMessage(
    `Save changes to ${promptText}?`,
    'Save', 'Discard', BTN_CANCEL
  );

  if (answer === BTN_CANCEL) {
    return false;
  }

  if (answer === 'Save') {
    await vscode.commands.executeCommand(
      CMD_APPLY_CHANGES,
      editDocumentUri,
      { skipPrompt: true }
    );
  }

  return true;
}

/**
 * Syncs view document content from edit document if not dirty.
 */
function syncViewDocumentContent(
  editDoc: vscode.TextDocument,
  resourceViewProvider: ResourceViewDocumentProvider,
  viewUri: vscode.Uri
): void {
  if (!editDoc.isDirty) {
    const editYaml = editDoc.getText();
    resourceViewProvider.setResourceContent(viewUri, editYaml);
  }
}

/**
 * Executes the switch to edit command logic.
 */
async function executeSwitchToEdit(
  arg: CommandInput,
  edaClient: EdaClient,
  resourceEditProvider: ResourceEditDocumentProvider,
  context: vscode.ExtensionContext
): Promise<void> {
  // Resolve view document URI from argument
  const viewDocumentUri = await resolveAndValidateViewUri(arg);

  // Parse resource info from the validated URI
  const parsedInfo = ResourceViewDocumentProvider.parseUri(viewDocumentUri);
  const apiVersion = await extractApiVersion(viewDocumentUri, arg);
  const resourceInfo: ResourceInfo = { ...parsedInfo, apiVersion };
  const resourceKey = getResourceKey(resourceInfo.namespace, resourceInfo.kind, resourceInfo.name);

  // Determine EDA origin - convert arg to CommandArgument if it's not a Uri
  const argAsCommand = arg instanceof vscode.Uri ? undefined : arg;
  const edaOrigin = determineEdaOrigin(viewDocumentUri, resourceInfo, argAsCommand);
  if (arg && !edaOrigin) {
    setResourceOrigin(resourceInfo.namespace, resourceInfo.kind, resourceInfo.name, edaOrigin);
  }

  // Fetch and parse resource YAML
  const yamlText = await fetchResourceYaml(edaClient, resourceInfo, edaOrigin);
  const resourceObject = parseAndSanitizeResource(yamlText);

  // Update origin stores
  storeOriginInfo(viewDocumentUri, resourceInfo, edaOrigin);

  // Create or update edit URI
  const { editUri } = getOrCreateEditUri(
    resourceKey, viewDocumentUri, resourceObject, edaOrigin, resourceInfo
  );

  // Store resource content in provider
  const sanitizedYaml = prepareEditDocumentContent(resourceEditProvider, editUri, resourceObject);

  // Refresh existing document if open
  await refreshExistingDocument(editUri, sanitizedYaml);

  // Open and display the edit document
  await openEditDocument(editUri);

  // Add status bar item for mode switching
  createModeStatusBarItem(context, editUri, 'view');
}

/**
 * Executes the switch to view command logic.
 */
async function executeSwitchToView(
  editDocumentUri: vscode.Uri | undefined,
  resourceViewProvider: ResourceViewDocumentProvider,
  context: vscode.ExtensionContext
): Promise<void> {
  // Get and validate the edit document URI
  const validatedUri = getEditDocumentUri(editDocumentUri);
  validateEditScheme(validatedUri);

  // Parse the edit URI to get resource info
  const { namespace, kind, name } = ResourceEditDocumentProvider.parseUri(validatedUri);
  const resourceKey = getResourceKey(namespace, kind, name);

  // Get the corresponding view URI
  const pair = resourcePairs.get(resourceKey);
  if (!pair) {
    throw new Error(`No view document found for ${resourceKey}`);
  }

  // Handle unsaved changes if present
  const editDoc = await vscode.workspace.openTextDocument(validatedUri);
  if (editDoc.isDirty) {
    const shouldContinue = await handleUnsavedChanges(validatedUri, kind, name);
    if (!shouldContinue) {
      return;
    }
  }

  // Sync view document content from edit document
  syncViewDocumentContent(editDoc, resourceViewProvider, pair.viewUri);

  // Open the view document
  await openViewDocument(pair.viewUri);

  // Add status bar item for mode switching
  createModeStatusBarItem(context, pair.viewUri, 'edit');
}

/**
 * Prepares a resource for apply by validating and parsing the document.
 */
async function prepareResourceForApply(
  documentUri: vscode.Uri,
  resourceEditProvider: ResourceEditDocumentProvider
): Promise<{ resource: K8sResource; resourceKey: string; originalResource: K8sResource }> {
  // Validate scheme
  if (documentUri.scheme !== SCHEME_K8S) {
    throw new Error('Not a Kubernetes resource document');
  }

  // Get and parse document
  const document = await vscode.workspace.openTextDocument(documentUri);
  const docText = document.getText();

  let resource: K8sResource;
  try {
    resource = yaml.load(docText) as K8sResource;
  } catch (yamlError) {
    throw new Error(`YAML validation error: ${yamlError}`);
  }

  const resourceKey = getResourceKey(
    resource.metadata?.namespace as string ?? 'default',
    resource.kind ?? '',
    resource.metadata?.name ?? ''
  );

  // Get or reconstruct original resource
  const originalResource = getOrReconstructOriginalResource(
    documentUri, resourceEditProvider, docText
  );

  // Validate resource
  const validationResult = validateResource(
    resource,
    originalResource,
    resourceEditProvider.isNewResource(documentUri)
  );
  if (!validationResult.valid) {
    throw new Error(`Validation error: ${validationResult.message}`);
  }

  return { resource, resourceKey, originalResource };
}

/**
 * Gets the original resource or reconstructs it from cache/document.
 */
function getOrReconstructOriginalResource(
  documentUri: vscode.Uri,
  resourceEditProvider: ResourceEditDocumentProvider,
  docText: string
): K8sResource {
  let originalResource: K8sResource | undefined = resourceEditProvider.getOriginalResource(documentUri) as K8sResource | undefined;
  if (originalResource) {
    return originalResource;
  }

  const { namespace, kind, name } = ResourceEditDocumentProvider.parseUri(documentUri);
  const pair = resourcePairs.get(getResourceKey(namespace, kind, name));
  originalResource = pair?.originalResource;

  if (!originalResource) {
    try {
      originalResource = yaml.load(docText) as K8sResource;
    } catch {
      // ignore parse errors
    }
  }

  if (originalResource) {
    resourceEditProvider.setOriginalResource(
      documentUri,
      sanitizeResourceForEdit(originalResource)
    );
    if (pair) {
      pair.originalResource = originalResource;
    }
  }

  if (!originalResource) {
    throw new Error('Could not find original resource data');
  }

  return originalResource;
}

/**
 * Handles apply when skipPrompt option is set.
 */
async function handleSkipPromptApply(
  options: { dryRun?: boolean },
  edaClient: EdaClient,
  resourceEditProvider: ResourceEditDocumentProvider,
  resourceViewProvider: ResourceViewDocumentProvider,
  documentUri: vscode.Uri,
  resource: K8sResource,
  resourceKey: string
): Promise<void> {
  if (options.dryRun) {
    await validateAndPromptForApply(
      edaClient, resourceEditProvider, resourceViewProvider, documentUri, resource
    );
    return;
  }

  // Direct apply - show diff and confirm
  const confirmed = await showResourceDiff(resourceEditProvider, documentUri, { confirmActionLabel: 'Apply' });
  if (confirmed) {
    const result = await applyResource(documentUri, edaClient, resourceEditProvider, resource, { dryRun: false });
    if (result) {
      updateProvidersAfterApply(resourceEditProvider, resourceViewProvider, documentUri, resource, resourceKey);
      showApplySuccessMessage(resource);
    }
  }
}

/**
 * Handles the selected action from the apply action prompt.
 */
async function handleApplyAction(
  action: string,
  isEda: boolean,
  edaClient: EdaClient,
  resourceEditProvider: ResourceEditDocumentProvider,
  resourceViewProvider: ResourceViewDocumentProvider,
  documentUri: vscode.Uri,
  resource: K8sResource,
  resourceKey: string
): Promise<void> {
  switch (action) {
    case 'diff':
      await handleDiffAction(
        isEda, edaClient, resourceEditProvider, resourceViewProvider,
        documentUri, resource, resourceKey
      );
      break;
    case 'basket':
      await addResourceToBasket(documentUri, resourceEditProvider, resource);
      break;
    case 'validate':
      await validateAndPromptForApply(
        edaClient, resourceEditProvider, resourceViewProvider, documentUri, resource
      );
      break;
    default:
      // Direct apply
      await handleDirectApply(
        edaClient, resourceEditProvider, resourceViewProvider,
        documentUri, resource, resourceKey
      );
  }
}

/**
 * Handles the diff action flow.
 */
async function handleDiffAction(
  isEda: boolean,
  edaClient: EdaClient,
  resourceEditProvider: ResourceEditDocumentProvider,
  resourceViewProvider: ResourceViewDocumentProvider,
  documentUri: vscode.Uri,
  resource: K8sResource,
  resourceKey: string
): Promise<void> {
  const shouldContinue = await showResourceDiff(resourceEditProvider, documentUri);
  if (!shouldContinue) {
    return;
  }

  const nextAction = await promptForNextAction(resource, 'diff', isEda);
  if (!nextAction) {
    return;
  }

  if (nextAction === 'validate') {
    await validateAndPromptForApply(
      edaClient, resourceEditProvider, resourceViewProvider, documentUri, resource
    );
  } else if (nextAction === 'basket') {
    await addResourceToBasket(documentUri, resourceEditProvider, resource);
  } else {
    const confirmed = await confirmResourceUpdate(resource.kind ?? '', resource.metadata?.name ?? '', false);
    if (confirmed) {
      const result = await applyResource(documentUri, edaClient, resourceEditProvider, resource, { dryRun: false });
      if (result) {
        updateProvidersAfterApply(resourceEditProvider, resourceViewProvider, documentUri, resource, resourceKey);
        showApplySuccessMessage(resource);
      }
    }
  }
}

/**
 * Handles direct apply action.
 */
async function handleDirectApply(
  edaClient: EdaClient,
  resourceEditProvider: ResourceEditDocumentProvider,
  resourceViewProvider: ResourceViewDocumentProvider,
  documentUri: vscode.Uri,
  resource: K8sResource,
  resourceKey: string
): Promise<void> {
  const confirmed = await showResourceDiff(resourceEditProvider, documentUri, { confirmActionLabel: 'Apply' });
  if (confirmed) {
    const result = await applyResource(documentUri, edaClient, resourceEditProvider, resource, { dryRun: false });
    if (result) {
      updateProvidersAfterApply(resourceEditProvider, resourceViewProvider, documentUri, resource, resourceKey);
      showApplySuccessMessage(resource);
    }
  }
}

export function registerResourceEditCommands(
  context: vscode.ExtensionContext,
  resourceEditProvider: ResourceEditDocumentProvider,
  resourceViewProvider: ResourceViewDocumentProvider
) {
  const edaClient = serviceManager.getClient<EdaClient>('eda');

  // Switch from read-only view to editable
  const switchToEditCommand = vscode.commands.registerCommand(
    CMD_SWITCH_TO_EDIT,
    async (arg: CommandInput) => {
      try {
        await executeSwitchToEdit(arg, edaClient, resourceEditProvider, context);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to switch to edit mode: ${error}`);
        log(`Error in switchToEditResource: ${error}`, LogLevel.ERROR, true);
      }
    }
  );

  // Switch from edit mode back to read-only view
  const switchToViewCommand = vscode.commands.registerCommand(
    CMD_SWITCH_TO_VIEW,
    async (editDocumentUri: vscode.Uri) => {
      try {
        await executeSwitchToView(editDocumentUri, resourceViewProvider, context);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to switch to view mode: ${error}`);
        log(`Error in switchToViewResource: ${error}`, LogLevel.ERROR, true);
      }
    }
  );

  // Apply changes to a resource
  const applyChangesCommand = vscode.commands.registerCommand(
    CMD_APPLY_CHANGES,
    async (documentUri: vscode.Uri, options: {
      dryRun?: boolean;
      skipPrompt?: boolean;
      bypassChangesCheck?: boolean;
    } = {}) => {
      try {
        // Validate and parse the document
        const { resource, resourceKey } = await prepareResourceForApply(
          documentUri, resourceEditProvider
        );

        // Check if there are changes to the resource (unless bypassed)
        const hasChanges = options.bypassChangesCheck || resourceEditProvider.hasChanges(documentUri);
        if (!hasChanges) {
          vscode.window.showInformationMessage('No changes detected in the resource');
          return;
        }

        // Handle skip prompt mode (direct apply or dry run)
        if (options.skipPrompt) {
          await handleSkipPromptApply(
            options, edaClient, resourceEditProvider, resourceViewProvider,
            documentUri, resource, resourceKey
          );
          return;
        }

        // Determine EDA origin and present action options
        const isEda = getEdaOriginFromDocument(documentUri, resource, resourcePairs.get(resourceKey));
        const action = await promptForApplyAction(resource, isEda);
        if (!action) {
          return;
        }

        // Handle the selected action
        await handleApplyAction(
          action, isEda, edaClient, resourceEditProvider, resourceViewProvider,
          documentUri, resource, resourceKey
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to apply changes: ${error}`);
        log(`Error in applyResourceChanges: ${error}`, LogLevel.ERROR, true);
        edaOutputChannel.show();
      }
    }
  );

  // Add separate command for dry run with different icon
  const applyDryRunCommand = vscode.commands.registerCommand(
    'vscode-eda.applyResourceChanges.dryRun',
    async (documentUri: vscode.Uri) => {
      // Just call the main apply command with dryRun flag
      return vscode.commands.executeCommand('vscode-eda.applyResourceChanges',
        documentUri, { dryRun: true, skipPrompt: true });
    }
  );

  // Show diff between original and modified resource
  const showDiffCommand = vscode.commands.registerCommand(
    'vscode-eda.showResourceDiff',
    async (documentUri: vscode.Uri) => {
      await showResourceDiff(resourceEditProvider, documentUri);
    }
  );

  // Add a save handler to intercept standard save
  const onWillSaveTextDocument = vscode.workspace.onWillSaveTextDocument(event => {
    if (event.document.uri.scheme === SCHEME_K8S && !suppressSavePrompt) {
      // This prevents the default save operation
      event.waitUntil(Promise.resolve([]));

      // Use a very short timeout to ensure the UI is responsive
      setTimeout(() => {
        // Always bypass the changes check when triggered by save
        vscode.commands.executeCommand(CMD_APPLY_CHANGES,
          event.document.uri,
          { bypassChangesCheck: true });
      }, 10);
    }
  });

  // Clean up resourcePairs when documents are closed
  const onDidCloseTextDocument = vscode.workspace.onDidCloseTextDocument(document => {
    handleDocumentClose(document, resourceEditProvider);
  });

  context.subscriptions.push(
    switchToEditCommand,
    switchToViewCommand,
    applyChangesCommand,
    applyDryRunCommand,
    showDiffCommand,
    onWillSaveTextDocument,
    onDidCloseTextDocument
  );
}

// Prompt user for what action they want to take with the resource
async function promptForApplyAction(resource: K8sResource, isEda: boolean): Promise<string | undefined> {
  const kind = resource.kind ?? '';
  const name = resource.metadata?.name ?? '';

  const choices: ActionQuickPickItem[] = [
    { label: LABEL_APPLY, id: 'apply', description: DESC_APPLY },
    { label: LABEL_DIFF, id: 'diff', description: DESC_DIFF },
    { label: LABEL_VALIDATE, id: 'validate', description: DESC_VALIDATE }
  ];
  if (isEda) {
    choices.push({ label: LABEL_BASKET, id: 'basket', description: DESC_BASKET });
  }

  const chosen = await vscode.window.showQuickPick(choices, {
    placeHolder: `Choose an action for ${kind} "${name}"`,
    title: 'Apply Resource Changes'
  });

  return chosen?.id;
}

// Prompt for next action after diff
async function promptForNextAction(resource: K8sResource, currentStep: string, isEda: boolean): Promise<string | undefined> {
  const kind = resource.kind ?? '';
  const name = resource.metadata?.name ?? '';

  let choices: ActionQuickPickItem[] = [];
  if (currentStep === 'diff') {
    choices = [
      { label: LABEL_APPLY, id: 'apply', description: DESC_APPLY },
      { label: LABEL_VALIDATE, id: 'validate', description: DESC_VALIDATE }
    ];
    if (isEda) {
      choices.push({ label: LABEL_BASKET, id: 'basket', description: DESC_BASKET });
    }
  } else if (currentStep === 'validate') {
    choices = [
      { label: LABEL_APPLY, id: 'apply', description: DESC_APPLY }
    ];
    if (isEda) {
      choices.push({ label: LABEL_BASKET, id: 'basket', description: DESC_BASKET });
    }
  }

  const chosen = await vscode.window.showQuickPick(choices, {
    placeHolder: `Choose next action for ${kind} "${name}"`,
    title: 'Apply Resource Changes'
  });

  return chosen?.id;
}

/**
 * Shows validation success message and returns user's chosen action.
 */
async function showValidationSuccessPrompt(
  resourceKind: string,
  resourceName: string
): Promise<string | undefined> {
  const message = `Validation successful for ${resourceKind} "${resourceName}"`;
  return vscode.window.showInformationMessage(
    message,
    BTN_APPLY_CHANGES, BTN_VIEW_DETAILS, BTN_CANCEL
  );
}

/**
 * Handles the apply action after successful validation.
 */
async function handlePostValidationApply(
  edaClient: EdaClient,
  resourceEditProvider: ResourceEditDocumentProvider,
  resourceViewProvider: ResourceViewDocumentProvider,
  documentUri: vscode.Uri,
  resource: K8sResource
): Promise<void> {
  const applyResult = await applyResource(documentUri, edaClient, resourceEditProvider, resource, { dryRun: false });
  if (applyResult) {
    const resourceKey = getResourceKey(
      resource.metadata?.namespace as string ?? 'default',
      resource.kind ?? '',
      resource.metadata?.name ?? ''
    );
    updateProvidersAfterApply(resourceEditProvider, resourceViewProvider, documentUri, resource, resourceKey);
    showApplySuccessMessage(resource);
  }
}

/**
 * Handles the user's action choice after validation success.
 */
async function handleValidationAction(
  validationAction: string | undefined,
  edaClient: EdaClient,
  resourceEditProvider: ResourceEditDocumentProvider,
  resourceViewProvider: ResourceViewDocumentProvider,
  documentUri: vscode.Uri,
  resource: K8sResource
): Promise<void> {
  if (validationAction === BTN_APPLY_CHANGES) {
    await handlePostValidationApply(
      edaClient, resourceEditProvider, resourceViewProvider, documentUri, resource
    );
    return;
  }

  if (validationAction === BTN_VIEW_DETAILS) {
    edaOutputChannel.show();
  }
}

// Validate and then prompt for apply
async function validateAndPromptForApply(
  edaClient: EdaClient,
  resourceEditProvider: ResourceEditDocumentProvider,
  resourceViewProvider: ResourceViewDocumentProvider,
  documentUri: vscode.Uri,
  resource: K8sResource
): Promise<void> {
  // Always show diff first
  const shouldContinue = await showResourceDiff(resourceEditProvider, documentUri);
  if (!shouldContinue) {
    return;
  }

  // Confirm validation
  const confirmed = await confirmResourceUpdate(resource.kind ?? '', resource.metadata?.name ?? '', true);
  if (!confirmed) {
    return;
  }

  // Perform validation (dry run)
  const validationResult = await applyResource(documentUri, edaClient, resourceEditProvider, resource, { dryRun: true });
  if (!validationResult) {
    return;
  }

  // Show success message and handle user's choice
  const validationAction = await showValidationSuccessPrompt(resource.kind ?? '', resource.metadata?.name ?? '');
  await handleValidationAction(
    validationAction, edaClient, resourceEditProvider, resourceViewProvider, documentUri, resource
  );
}

// Validate the resource for basic errors
interface ValidationResult {
  valid: boolean;
  message?: string;
}

function validateResource(
  resource: K8sResource | undefined,
  originalResource: K8sResource,
  isNew: boolean = false
): ValidationResult {
  // Check for required fields
  if (!resource) {
    return { valid: false, message: 'Resource is empty or invalid' };
  }

  if (!resource.kind) {
    return { valid: false, message: 'Resource kind is missing' };
  }

  if (!resource.metadata) {
    return { valid: false, message: 'Resource metadata is missing' };
  }

  if (!resource.metadata.name) {
    return { valid: false, message: 'Resource name is missing' };
  }

  // Check that the resource kind and name match the original
  if (resource.kind !== originalResource.kind) {
    return {
      valid: false,
      message: `Cannot change resource kind from "${originalResource.kind}" to "${resource.kind}"`
    };
  }

  if (!isNew && resource.metadata.name !== originalResource.metadata?.name) {
    return {
      valid: false,
      message: `Cannot change resource name from "${originalResource.metadata?.name}" to "${resource.metadata.name}"`
    };
  }

  // Check that the namespace matches (if present)
  if (
    !isNew &&
    originalResource.metadata?.namespace &&
    resource.metadata.namespace !== originalResource.metadata.namespace
  ) {
    return {
      valid: false,
      message: `Cannot change resource namespace from "${originalResource.metadata.namespace}" to "${resource.metadata.namespace}"`
    };
  }

  return { valid: true };
}

/**
 * Gets the original resource from the provider or returns null with error message.
 */
function getOriginalResourceForDiff(
  resourceProvider: ResourceEditDocumentProvider,
  documentUri: vscode.Uri
): K8sResource | null {
  const originalResource = resourceProvider.getOriginalResource(documentUri) as K8sResource | undefined;
  if (!originalResource) {
    vscode.window.showErrorMessage('Could not find original resource to compare');
    return null;
  }
  return originalResource;
}

/**
 * Parses the current document text and returns the updated resource.
 */
async function parseUpdatedResource(documentUri: vscode.Uri): Promise<K8sResource> {
  const document = await vscode.workspace.openTextDocument(documentUri);
  const currentText = document.getText();
  return yaml.load(currentText) as K8sResource;
}

/**
 * Creates diff URIs with a unique timestamp to avoid caching issues.
 */
function createDiffUris(
  resourceKind: string,
  resourceName: string,
  timestamp: number
): { originalUri: vscode.Uri; modifiedUri: vscode.Uri; title: string } {
  const title = `${resourceKind}-${resourceName}`;
  const originalUri = vscode.Uri.parse(`k8s-diff:/original/${title}-${timestamp}`);
  const modifiedUri = vscode.Uri.parse(`k8s-diff:/modified/${title}-${timestamp}`);
  return { originalUri, modifiedUri, title };
}

/**
 * Creates a temporary file system provider for diff viewing.
 */
function createDiffFileSystemProvider(
  originalYaml: string,
  updatedYaml: string,
  timestamp: number
): vscode.Disposable {
  return vscode.workspace.registerFileSystemProvider('k8s-diff', {
    onDidChangeFile: new vscode.EventEmitter<vscode.FileChangeEvent[]>().event,
    watch: () => ({ dispose: () => {} }),
    stat: () => ({ type: vscode.FileType.File, ctime: timestamp, mtime: timestamp, size: 0 }),
    readDirectory: () => [],
    createDirectory: () => {},
    readFile: (uri) => {
      if (uri.path.startsWith('/original/')) {
        return Buffer.from(originalYaml);
      }
      return Buffer.from(updatedYaml);
    },
    writeFile: () => {},
    delete: () => {},
    rename: () => {}
  }, { isCaseSensitive: true });
}

/**
 * Shows the VS Code diff view.
 */
async function showDiffView(
  originalUri: vscode.Uri,
  modifiedUri: vscode.Uri,
  title: string
): Promise<void> {
  const diffTitle = `Diff: ${title}`;
  await vscode.commands.executeCommand('vscode.diff',
    originalUri,
    modifiedUri,
    diffTitle,
    { preview: true }
  );
}

/**
 * Schedules cleanup of the diff provider after a delay.
 */
function scheduleDiffProviderCleanup(diffProvider: vscode.Disposable): void {
  setTimeout(() => {
    diffProvider.dispose();
  }, 5000);
}

/**
 * Gets the prompt message based on confirm label.
 */
function getDiffConfirmMessage(confirmLabel: string): string {
  if (confirmLabel === 'Continue') {
    return 'Continue with the operation?';
  }
  return 'Apply changes to the resource?';
}

/**
 * Shows confirmation dialog and returns whether user confirmed.
 */
async function showDiffConfirmation(confirmLabel: string): Promise<boolean> {
  const promptMessage = getDiffConfirmMessage(confirmLabel);
  const action = await vscode.window.showWarningMessage(
    promptMessage,
    { modal: true },
    confirmLabel,
    'Cancel'
  );
  return action === confirmLabel;
}

/**
 * Handles diff error by showing message and logging.
 */
function handleDiffError(error: unknown): void {
  vscode.window.showErrorMessage(`Error showing diff: ${error}`);
  log(`Error in showResourceDiff: ${error}`, LogLevel.ERROR, true);
  edaOutputChannel.show();
}

// Show a unified diff view of the changes
async function showResourceDiff(
  resourceProvider: ResourceEditDocumentProvider,
  documentUri: vscode.Uri,
  options: { confirmActionLabel?: string } = {}
): Promise<boolean> {
  try {
    // Get the original resource
    const originalResource = getOriginalResourceForDiff(resourceProvider, documentUri);
    if (!originalResource) {
      return false;
    }

    // Get the updated resource from document
    const updatedResource = await parseUpdatedResource(documentUri);

    // Convert both resources to formatted YAML for comparison
    const originalYaml = yaml.dump(originalResource, { indent: 2 });
    const updatedYaml = yaml.dump(updatedResource, { indent: 2 });

    // If no differences, inform the user and return
    if (originalYaml === updatedYaml) {
      vscode.window.showInformationMessage('No changes detected in the resource');
      return true;
    }

    // Create diff URIs and provider
    const timestamp = Date.now();
    const { originalUri, modifiedUri, title } = createDiffUris(
      originalResource.kind ?? '',
      originalResource.metadata?.name ?? '',
      timestamp
    );
    const diffProvider = createDiffFileSystemProvider(originalYaml, updatedYaml, timestamp);

    // Show the diff view
    await showDiffView(originalUri, modifiedUri, title);

    // Schedule cleanup
    scheduleDiffProviderCleanup(diffProvider);

    // Show confirmation and return result
    const confirmLabel = options.confirmActionLabel ?? 'Continue';
    return showDiffConfirmation(confirmLabel);

  } catch (error) {
    handleDiffError(error);
    return false;
  }
}

// Confirm with the user before applying changes
async function confirmResourceUpdate(kind: string, name: string, dryRun: boolean | undefined): Promise<boolean> {
  const action = dryRun ? 'validate' : 'apply changes to';
  const message = `Are you sure you want to ${action} ${kind} "${name}"?`;

  const result = await vscode.window.showWarningMessage(
    message,
    { modal: false },
    dryRun ? 'Validate' : 'Apply'
  );

  return result === (dryRun ? 'Validate' : 'Apply');
}

// Apply the resource changes to the cluster
/**
 * Applies an EDA resource via transaction.
 */
async function applyEdaResource(
  edaClient: EdaClient,
  resourceEditProvider: ResourceEditDocumentProvider,
  documentUri: vscode.Uri,
  resource: K8sResource,
  isNew: boolean,
  isDryRun: boolean
): Promise<K8sResource> {
  const tx = {
    crs: [
      {
        type: isNew
          ? { create: { value: resource } }
          : { replace: { value: resource } },
      },
    ],
    description: `vscode apply ${resource.kind}/${resource.metadata?.name}`,
    dryRun: isDryRun,
    retain: true,
    resultType: 'normal'
  };

  const txId = await edaClient.runTransaction(tx);
  log(
    `Transaction ${txId} created for ${resource.kind}/${resource.metadata?.name}`,
    LogLevel.INFO,
    true
  );

  if (!isDryRun) {
    resourceEditProvider.setOriginalResource(
      documentUri,
      sanitizeResourceForEdit(resource)
    );
    if (isNew) {
      resourceEditProvider.clearNewResource(documentUri);
    }
  }

  return resource;
}

/**
 * Applies a Kubernetes resource via the K8s client.
 */
async function applyK8sResource(
  resourceEditProvider: ResourceEditDocumentProvider,
  documentUri: vscode.Uri,
  resource: K8sResource,
  pair: ResourceURIPair | undefined,
  isNew: boolean,
  isDryRun: boolean
): Promise<K8sResource> {
  const k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');

  if (!isNew && pair?.originalResource?.metadata?.resourceVersion && resource.metadata) {
    resource.metadata.resourceVersion = pair.originalResource.metadata.resourceVersion;
  }

  const updated = await k8sClient.applyResource(resource, { dryRun: isDryRun, isNew }) as K8sResource | undefined;

  if (!isDryRun) {
    const sanitized = sanitizeResource(updated ?? resource);
    resourceEditProvider.setOriginalResource(
      documentUri,
      sanitizeResourceForEdit(updated ?? resource)
    );
    if (isNew) {
      resourceEditProvider.clearNewResource(documentUri);
    }
    if (pair) {
      pair.originalResource = sanitized;
    }
    return sanitized;
  }

  return resource;
}

/**
 * Logs success for a validation (dry run) operation.
 */
function logValidationSuccess(resource: K8sResource): void {
  log(`Validation successful for ${resource.kind} "${resource.metadata?.name}"`, LogLevel.INFO, true);
}

/**
 * Logs success and performs post-apply actions for a real apply operation.
 */
function logApplySuccess(resource: K8sResource, resourceKey: string, appliedResource: K8sResource): void {
  log(`Successfully applied ${resource.kind} "${resource.metadata?.name}"`, LogLevel.INFO, true);

  // Notify resource service of changes if registered
  const serviceNames = serviceManager.getServiceNames();
  if (serviceNames.includes('kubernetes-resources')) {
    const resourceService = serviceManager.getService<ResourceService>('kubernetes-resources');
    resourceService.forceRefresh();
  }

  // Update the resource pair with the newest resource
  const pair = resourcePairs.get(resourceKey);
  if (pair && appliedResource) {
    pair.originalResource = appliedResource;
  }
}

/**
 * Handles apply errors by logging and showing messages.
 */
function handleApplyError(error: unknown, operationType: 'validate' | 'apply'): void {
  const errorMessage = `Failed to ${operationType} resource: ${error}`;
  vscode.window.showErrorMessage(errorMessage);
  log(errorMessage, LogLevel.ERROR, true);

  if (error instanceof Error) {
    log('\n======== ERROR DETAILS ========', LogLevel.ERROR, true);
    log(error.message, LogLevel.ERROR, true);
    log('===============================\n', LogLevel.ERROR, true);
  }

  edaOutputChannel.show();
}

async function applyResource(
  documentUri: vscode.Uri,
  edaClient: EdaClient,
  resourceEditProvider: ResourceEditDocumentProvider,
  resource: K8sResource,
  options: { dryRun?: boolean }
): Promise<boolean> {
  const isDryRun = options.dryRun ?? false;
  const resourceKey = getResourceKey(
    resource.metadata?.namespace as string ?? 'default',
    resource.kind ?? '',
    resource.metadata?.name ?? ''
  );

  try {
    log(`${isDryRun ? 'Validating' : 'Applying'} resource ${resource.kind}/${resource.metadata?.name}...`, LogLevel.INFO, true);

    const pair = resourcePairs.get(resourceKey);
    const isEda = getEdaOriginFromDocument(documentUri, resource, pair);
    const isNew = resourceEditProvider.isNewResource(documentUri);

    const appliedResource = isEda
      ? await applyEdaResource(edaClient, resourceEditProvider, documentUri, resource, isNew, isDryRun)
      : await applyK8sResource(resourceEditProvider, documentUri, resource, pair, isNew, isDryRun);

    if (isDryRun) {
      logValidationSuccess(resource);
    } else {
      logApplySuccess(resource, resourceKey, appliedResource);
    }
    return true;

  } catch (error) {
    handleApplyError(error, isDryRun ? 'validate' : 'apply');
    return false;
  }
}

// Add resource changes as a transaction to the basket
async function addResourceToBasket(
  documentUri: vscode.Uri,
  resourceEditProvider: ResourceEditDocumentProvider,
  resource: K8sResource
): Promise<void> {
  const { namespace, kind, name } = ResourceEditDocumentProvider.parseUri(documentUri);
  const pair = resourcePairs.get(getResourceKey(namespace, kind, name));
  const origin = ResourceEditDocumentProvider.getOrigin(documentUri);
  let isEda = pair?.isEdaResource;
  if (isEda === undefined) {
    if (origin) {
      isEda = origin === 'eda';
    } else {
      const originStored = getResourceOrigin(namespace, kind, name);
      isEda = originStored ?? isEdaResource(undefined, resource.apiVersion);
    }
  }
  if (!isEda) {
    vscode.window.showErrorMessage('Adding to basket is only supported for EDA resources');
    return;
  }

  const isNew = resourceEditProvider.isNewResource(documentUri);
  const tx = {
    crs: [
      {
        type: isNew ? { create: { value: resource } } : { replace: { value: resource } }
      }
    ],
    description: `vscode basket ${resource.kind}/${resource.metadata?.name}`,
    retain: true,
    dryRun: false
  };
  await edaTransactionBasketProvider.addTransaction(tx);
  vscode.window.showInformationMessage(`Added ${resource.kind} "${resource.metadata?.name}" to transaction basket`);
}
