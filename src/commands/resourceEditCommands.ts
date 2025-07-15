// src/commands/resourceEditCommands.ts
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { serviceManager } from '../services/serviceManager';
import { EdaClient } from '../clients/edaClient';
import type { ResourceService } from '../services/resourceService';
import { ResourceViewDocumentProvider } from '../providers/documents/resourceViewProvider';
import { ResourceEditDocumentProvider } from '../providers/documents/resourceEditProvider';
import { log, LogLevel, edaOutputChannel, edaTransactionBasketProvider } from '../extension';
import { isEdaResource } from '../utils/edaGroupUtils';
import { KubernetesClient } from '../clients/kubernetesClient';
import { sanitizeResource } from '../utils/yamlUtils';

// Keep track of resource URI pairs (view and edit versions of the same resource)
interface ResourceURIPair {
  viewUri: vscode.Uri;
  editUri: vscode.Uri;
  originalResource: any;
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

export function registerResourceEditCommands(
  context: vscode.ExtensionContext,
  resourceEditProvider: ResourceEditDocumentProvider,
  resourceViewProvider: ResourceViewDocumentProvider
) {
  const edaClient = serviceManager.getClient<EdaClient>('eda');

  // Switch from read-only view to editable
  const switchToEditCommand = vscode.commands.registerCommand(
    'vscode-eda.switchToEditResource',
    async (arg: any) => {
      try {
        let viewDocumentUri: vscode.Uri | undefined;
        let namespace: string;
        let kind: string;
        let name: string;
        let resourceObject: any | undefined;

        if (arg) {
          // Case 1: Invoked with a URI (from active editor or command palette)
          if (arg instanceof vscode.Uri || (arg.scheme && typeof arg.scheme === 'string')) {
            viewDocumentUri = arg as vscode.Uri;
          } else {
            // Case 2: Invoked from a tree item/resource data
            resourceObject = arg.raw || arg.rawResource || arg.resource?.raw;
            if (!resourceObject) {
              throw new Error('No resource data found');
            }
            namespace = resourceObject.metadata?.namespace || arg.namespace || 'default';
            kind = resourceObject.kind || arg.kind || arg.resourceType || 'Resource';
            name = resourceObject.metadata?.name || arg.name || arg.label || 'unknown';

            viewDocumentUri = ResourceViewDocumentProvider.createUri(namespace, kind, name);
            const yamlText = yaml.dump(resourceObject, { indent: 2 });
            resourceViewProvider.setResourceContent(viewDocumentUri, yamlText);
          }
        }

        if (!viewDocumentUri) {
          const activeEditor = vscode.window.activeTextEditor;
          if (!activeEditor || activeEditor.document.uri.scheme !== 'k8s-view') {
            throw new Error('No Kubernetes resource view document is active');
          }
          viewDocumentUri = activeEditor.document.uri;
        }

        if (viewDocumentUri.scheme !== 'k8s-view') {
          throw new Error('Not a Kubernetes resource read-only view');
        }

        ({ namespace, kind, name } = ResourceViewDocumentProvider.parseUri(viewDocumentUri));
        const resourceKey = getResourceKey(namespace, kind, name);

        // 3) Check if we already have an edit URI for this resource
        let editUri: vscode.Uri;
        let pair = resourcePairs.get(resourceKey);

        let readOnlyYaml: string;
        const readOnlyDoc = await vscode.workspace.openTextDocument(viewDocumentUri);
        readOnlyYaml = readOnlyDoc.getText();
        try {
          resourceObject = yaml.load(readOnlyYaml);
        } catch (parseErr) {
          throw new Error(`Invalid YAML in read-only view: ${parseErr}`);
        }

        let edaOrigin = isEdaResource(arg, (resourceObject as any)?.apiVersion);

        if (resourceObject && typeof resourceObject === 'object') {
          delete (resourceObject as any).status;
        }

        const sanitizedYaml = yaml.dump(resourceObject, { indent: 2 });

        if (pair) {
          // Reuse existing edit URI but refresh content from current view
          editUri = pair.editUri;
          log(`Using existing edit URI for ${resourceKey}`, LogLevel.DEBUG);
          pair.isEdaResource = edaOrigin;
          pair.originalResource = resourceObject;
          pair.viewUri = viewDocumentUri; // update view URI to the latest
        } else {
          // Create a new edit URI and track the pair
          editUri = ResourceEditDocumentProvider.createUri(namespace, kind, name);
          resourcePairs.set(resourceKey, {
            viewUri: viewDocumentUri,
            editUri: editUri,
            originalResource: resourceObject,
            isEdaResource: edaOrigin
          });
        }

        // Store the resource in your editable file system provider (overwrite existing)
        resourceEditProvider.setOriginalResource(editUri, resourceObject);
        resourceEditProvider.setResourceContent(editUri, sanitizedYaml);

        // If the edit document is already open, refresh its contents
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

        // 4) Open the edit document WITHOUT closing the view document
        const editDoc = await vscode.workspace.openTextDocument(editUri);
        await vscode.languages.setTextDocumentLanguage(editDoc, 'yaml');

        // Use showTextDocument with preserveFocus: false to ensure focus
        await vscode.window.showTextDocument(editDoc, {
          preserveFocus: false,
          preview: false
        });

        // 5) Add status bar item to switch back to view mode
        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        statusBarItem.text = "$(eye) View Mode";
        statusBarItem.tooltip = "Switch back to read-only view";
        statusBarItem.command = {
          title: "Switch to edit mode",
          command: "vscode-eda.switchToViewResource",
          arguments: [editUri]
        };
        statusBarItem.show();

        // Dispose the status bar item when this document is no longer active
        const disposable = vscode.window.onDidChangeActiveTextEditor(editor => {
          if (!editor || editor.document.uri.toString() !== editUri.toString()) {
            statusBarItem.dispose();
            disposable.dispose();
          }
        });

        context.subscriptions.push(disposable);

      } catch (error) {
        vscode.window.showErrorMessage(`Failed to switch to edit mode: ${error}`);
        log(`Error in switchToEditResource: ${error}`, LogLevel.ERROR, true);
      }
    }
  );

  // Switch from edit mode back to read-only view
  const switchToViewCommand = vscode.commands.registerCommand(
    'vscode-eda.switchToViewResource',
    async (editDocumentUri: vscode.Uri) => {
      try {
        // If no URI is provided, use the active editor
        if (!editDocumentUri) {
          const activeEditor = vscode.window.activeTextEditor;
          if (!activeEditor || activeEditor.document.uri.scheme !== 'k8s') {
            throw new Error('No Kubernetes resource edit document is active');
          }
          editDocumentUri = activeEditor.document.uri;
        }

        // 1) Ensure this is a k8s document
        if (editDocumentUri.scheme !== 'k8s') {
          throw new Error('Not a Kubernetes resource edit view');
        }

        // 2) Parse the edit URI to get resource info
        const { namespace, kind, name } = ResourceEditDocumentProvider.parseUri(editDocumentUri);
        const resourceKey = getResourceKey(namespace, kind, name);

        // 3) Get the corresponding view URI
        const pair = resourcePairs.get(resourceKey);
        if (!pair) {
          throw new Error(`No view document found for ${resourceKey}`);
        }

        // 4) If the edit document has unsaved changes, ask if user wants to save
        const editDoc = await vscode.workspace.openTextDocument(editDocumentUri);
        if (editDoc.isDirty) {
          const answer = await vscode.window.showWarningMessage(
            `Save changes to ${kind}/${name}?`,
            'Save', 'Discard', 'Cancel'
          );

          if (answer === 'Cancel') {
            return;
          }

          if (answer === 'Save') {
            // Use your existing apply changes command
            await vscode.commands.executeCommand(
              'vscode-eda.applyResourceChanges',
              editDocumentUri,
              { skipPrompt: true }
            );
          }
        }

        // 5) Get the current content of the edit document and update the view document
        // Only do this if the document isn't dirty or user chose to discard changes
        if (!editDoc.isDirty) {
          const editYaml = editDoc.getText();
          resourceViewProvider.setResourceContent(pair.viewUri, editYaml);
        }

        // 6) Open the view document WITHOUT closing the edit document
        const viewDoc = await vscode.workspace.openTextDocument(pair.viewUri);
        await vscode.languages.setTextDocumentLanguage(viewDoc, 'yaml');

        await vscode.window.showTextDocument(viewDoc, {
          preserveFocus: false,
          preview: false
        });

        // 7) Add status bar item to switch back to edit mode
        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        statusBarItem.text = "$(edit) Edit Mode";
        statusBarItem.tooltip = "Switch to edit mode";
        statusBarItem.command = {
          title: "Switch to edit mode",
          command: "vscode-eda.switchToEditResource",
          arguments: [pair.viewUri]
        };
        statusBarItem.show();

        // Dispose the status bar item when this document is no longer active
        const disposable = vscode.window.onDidChangeActiveTextEditor(editor => {
          if (!editor || editor.document.uri.toString() !== pair.viewUri.toString()) {
            statusBarItem.dispose();
            disposable.dispose();
          }
        });

        context.subscriptions.push(disposable);

      } catch (error) {
        vscode.window.showErrorMessage(`Failed to switch to view mode: ${error}`);
        log(`Error in switchToViewResource: ${error}`, LogLevel.ERROR, true);
      }
    }
  );

  // Apply changes to a resource
  const applyChangesCommand = vscode.commands.registerCommand(
    'vscode-eda.applyResourceChanges',
    async (documentUri: vscode.Uri, options: {
      dryRun?: boolean;
      skipPrompt?: boolean;
      bypassChangesCheck?: boolean;
    } = {}) => {
      try {

        // Get the document by URI
        const document = await vscode.workspace.openTextDocument(documentUri);
        const docText = document.getText();

        // Make sure this is our k8s resource document
        if (documentUri.scheme !== 'k8s') {
          vscode.window.showErrorMessage('Not a Kubernetes resource document');
          return;
        }

        // Parse the YAML
        let resource: any;
        try {
          resource = yaml.load(docText);
        } catch (yamlError) {
          vscode.window.showErrorMessage(`YAML validation error: ${yamlError}`);
          return;
        }

        const resourceKey = getResourceKey(
          resource.metadata?.namespace || 'default',
          resource.kind,
          resource.metadata?.name
        );

        // Get the original resource. If it's missing (e.g. document was reopened),
        // fall back to the cached pair or reconstruct it from the current YAML.
        let originalResource = resourceEditProvider.getOriginalResource(documentUri);
        if (!originalResource) {
          const { namespace, kind, name } = ResourceEditDocumentProvider.parseUri(documentUri);
          const pair = resourcePairs.get(getResourceKey(namespace, kind, name));
          originalResource = pair?.originalResource;
          if (!originalResource) {
            // As a last resort, parse the current document content as the baseline
            try {
              originalResource = yaml.load(docText);
            } catch {
              originalResource = undefined;
            }
          }
          if (originalResource) {
            resourceEditProvider.setOriginalResource(documentUri, originalResource);
            if (pair) {
              pair.originalResource = originalResource;
            }
          }
        }
        if (!originalResource) {
          throw new Error('Could not find original resource data');
        }

        // Validate the resource
        const validationResult = validateResource(resource, originalResource);
        if (!validationResult.valid) {
          vscode.window.showErrorMessage(`Validation error: ${validationResult.message}`);
          return;
        }

        // Check if there are changes to the resource (unless bypassed)
        const hasChanges = options.bypassChangesCheck ?
          true : await resourceEditProvider.hasChanges(documentUri);

        if (!hasChanges) {
          vscode.window.showInformationMessage('No changes detected in the resource');
          return;
        }

        // If we have an explicit option (dry run or direct apply), skip the initial prompt
        if (options.skipPrompt) {
          if (options.dryRun) {
            return await validateAndPromptForApply(edaClient, resourceEditProvider, resourceViewProvider, documentUri, resource);
          } else {
            // Direct apply - still show diff first
            const shouldContinue = await showResourceDiff(resourceEditProvider, documentUri);
            if (!shouldContinue) {
              return;
            }

            // Confirm and apply
            const confirmed = await confirmResourceUpdate(resource.kind, resource.metadata?.name, false);
            if (confirmed) {
                const result = await applyResource(documentUri, edaClient, resourceEditProvider, resource, { dryRun: false });
              if (result) {
                // Update both providers with the applied resource
                resourceEditProvider.setOriginalResource(documentUri, resource);

                // Update the view document if we have a pair
                const pair = resourcePairs.get(resourceKey);
                if (pair) {
                  // Update the view URI's content
                  const updatedYaml = yaml.dump(resource, { indent: 2 });
                  resourceViewProvider.setResourceContent(pair.viewUri, updatedYaml);
                  pair.originalResource = resource;
                }

                vscode.window.showInformationMessage(`Successfully applied ${resource.kind} "${resource.metadata?.name}"`,
                  'View Details').then(selection => {
                    if (selection === 'View Details') {
                      edaOutputChannel.show();
                    }
                  });
              }
            }
            return;
          }
        }

        const pairForPrompt = resourcePairs.get(resourceKey);
        const isEda = pairForPrompt?.isEdaResource ?? isEdaResource(undefined, resource.apiVersion);

        // Present options to the user
        const action = await promptForApplyAction(resource, isEda);

        if (!action) {
          return; // User cancelled
        }

        if (action === 'diff') {
          // Show diff and then ask for validate or direct apply
          const shouldContinue = await showResourceDiff(resourceEditProvider, documentUri);
          if (!shouldContinue) {
            return;
          }

          // After showing diff, ask if user wants to validate or direct apply
          const nextAction = await promptForNextAction(resource, 'diff', isEda);
          if (!nextAction) {
            return; // User cancelled
          }

          if (nextAction === 'validate') {
            // Validate and then ask for apply
            return await validateAndPromptForApply(edaClient, resourceEditProvider, resourceViewProvider, documentUri, resource);
          } else {
            // Direct apply after diff
            const confirmed = await confirmResourceUpdate(resource.kind, resource.metadata?.name, false);
            if (confirmed) {
            const result = await applyResource(documentUri, edaClient, resourceEditProvider, resource, { dryRun: false });
              if (result) {
                // Update both providers
                resourceEditProvider.setOriginalResource(documentUri, resource);

                // Update the view document if we have a pair
                const pair = resourcePairs.get(resourceKey);
                if (pair) {
                  const updatedYaml = yaml.dump(resource, { indent: 2 });
                  resourceViewProvider.setResourceContent(pair.viewUri, updatedYaml);
                  pair.originalResource = resource;
                }

                vscode.window.showInformationMessage(`Successfully applied ${resource.kind} "${resource.metadata?.name}"`,
                  'View Details').then(selection => {
                    if (selection === 'View Details') {
                      edaOutputChannel.show();
                    }
                  });
              }
            }
          }
        } else if (action === 'basket') {
          await addResourceToBasket(documentUri, resourceEditProvider, resource);
        } else if (action === 'validate') {
          // Validate and then ask for apply
          return await validateAndPromptForApply(edaClient, resourceEditProvider, resourceViewProvider, documentUri, resource);
        } else {
          // Direct apply - still show diff first as a safeguard
          const shouldContinue = await showResourceDiff(resourceEditProvider, documentUri);
          if (!shouldContinue) {
            return;
          }

          // Confirm and apply
          const confirmed = await confirmResourceUpdate(resource.kind, resource.metadata?.name, false);
          if (confirmed) {
            const result = await applyResource(documentUri, edaClient, resourceEditProvider, resource, { dryRun: false });
            if (result) {
              // Update both providers
              resourceEditProvider.setOriginalResource(documentUri, resource);

              // Update the view document if we have a pair
              const pair = resourcePairs.get(resourceKey);
              if (pair) {
                const updatedYaml = yaml.dump(resource, { indent: 2 });
                resourceViewProvider.setResourceContent(pair.viewUri, updatedYaml);
                pair.originalResource = resource;
              }

              vscode.window.showInformationMessage(`Successfully applied ${resource.kind} "${resource.metadata?.name}"`,
                'View Details').then(selection => {
                  if (selection === 'View Details') {
                    edaOutputChannel.show();
                  }
                });
            }
          }
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to apply changes: ${error}`);
        log(`Error in applyResourceChanges: ${error}`, LogLevel.ERROR, true);
        // Always show output channel on error
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
    if (event.document.uri.scheme === 'k8s' && !suppressSavePrompt) {
      // This prevents the default save operation
      event.waitUntil(Promise.resolve([]));

      // Use a very short timeout to ensure the UI is responsive
      setTimeout(() => {
        // Always bypass the changes check when triggered by save
        vscode.commands.executeCommand('vscode-eda.applyResourceChanges',
          event.document.uri,
          { bypassChangesCheck: true });
      }, 10);
    }
  });

  // Clean up resourcePairs when documents are closed
  const onDidCloseTextDocument = vscode.workspace.onDidCloseTextDocument(document => {
    // If a k8s or k8s-view document is closed, check if we need to clean up pairs
    if (document.uri.scheme === 'k8s' || document.uri.scheme === 'k8s-view') {
      let scheme = document.uri.scheme;

      // Find any matching pairs
      for (const [key, pair] of resourcePairs.entries()) {
        const uriToCheck = scheme === 'k8s' ? pair.editUri : pair.viewUri;

        if (uriToCheck.toString() === document.uri.toString()) {
          // Check if the other document in the pair is still open
          const otherUri = scheme === 'k8s' ? pair.viewUri : pair.editUri;
          const isOtherOpen = vscode.workspace.textDocuments.some(
            doc => doc.uri.toString() === otherUri.toString()
          );

          // If other document is not open, remove the pair
          if (!isOtherOpen) {
            resourcePairs.delete(key);
            log(`Removed resource pair for ${key}`, LogLevel.DEBUG);

            // If this was a k8s document being closed, clean up the provider
            if (scheme === 'k8s') {
              resourceEditProvider.cleanupDocument(uriToCheck);
            }
          }
          break;
        }
      }
    }
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
async function promptForApplyAction(resource: any, isEda: boolean): Promise<string | undefined> {
  const kind = resource.kind;
  const name = resource.metadata?.name;

  const choices: ActionQuickPickItem[] = [
    { label: '👁 View Changes (Diff)', id: 'diff', description: 'Compare changes before proceeding' },
    { label: '✓ Validate (Dry Run)', id: 'validate', description: 'Check if changes are valid without applying' },
    { label: '💾 Apply Changes', id: 'apply', description: 'Apply changes to the cluster' }
  ];
  if (isEda) {
    choices.push({ label: '🧺 Add to Basket', id: 'basket', description: 'Save changes to the transaction basket' });
  }

  const chosen = await vscode.window.showQuickPick(choices, {
    placeHolder: `Choose an action for ${kind} "${name}"`,
    title: 'Apply Resource Changes'
  });

  return chosen?.id;
}

// Prompt for next action after diff
async function promptForNextAction(resource: any, currentStep: string, isEda: boolean): Promise<string | undefined> {
  const kind = resource.kind;
  const name = resource.metadata?.name;

  let choices: ActionQuickPickItem[] = [];
  if (currentStep === 'diff') {
    choices = [
      { label: '✓ Validate (Dry Run)', id: 'validate', description: 'Check if changes are valid without applying' },
      { label: '💾 Apply Changes', id: 'apply', description: 'Apply changes to the cluster' }
    ];
    if (isEda) {
      choices.push({ label: '🧺 Add to Basket', id: 'basket', description: 'Save changes to the transaction basket' });
    }
  } else if (currentStep === 'validate') {
    choices = [
      { label: '💾 Apply Changes', id: 'apply', description: 'Apply changes to the cluster' }
    ];
    if (isEda) {
      choices.push({ label: '🧺 Add to Basket', id: 'basket', description: 'Save changes to the transaction basket' });
    }
  }

  const chosen = await vscode.window.showQuickPick(choices, {
    placeHolder: `Choose next action for ${kind} "${name}"`,
    title: 'Apply Resource Changes'
  });

  return chosen?.id;
}

// Validate and then prompt for apply
async function validateAndPromptForApply(
  edaClient: EdaClient,
  resourceEditProvider: ResourceEditDocumentProvider,
  resourceViewProvider: ResourceViewDocumentProvider,
  documentUri: vscode.Uri,
  resource: any
): Promise<void> {
  // Always show diff first
  const shouldContinue = await showResourceDiff(resourceEditProvider, documentUri);
  if (!shouldContinue) {
    return;
  }

  // Confirm validation
  const confirmed = await confirmResourceUpdate(resource.kind, resource.metadata?.name, true);
  if (!confirmed) {
    return;
  }

  // Perform validation (dry run)
  const validationResult = await applyResource(documentUri, edaClient, resourceEditProvider, resource, { dryRun: true });

  if (validationResult) {
    // Show success message for validation
    const validationAction = await vscode.window.showInformationMessage(
      `✅ Validation successful for ${resource.kind} "${resource.metadata?.name}"`,
      'Apply Changes', 'View Details', 'Cancel'
    );

    if (validationAction === 'Apply Changes') {
      // Now apply the changes
      const applyResult = await applyResource(documentUri, edaClient, resourceEditProvider, resource, { dryRun: false });
      if (applyResult) {
        resourceEditProvider.setOriginalResource(documentUri, resource);

        // Update the view document if we have a pair
        const resourceKey = getResourceKey(
          resource.metadata.namespace || 'default',
          resource.kind,
          resource.metadata.name
        );
        const pair = resourcePairs.get(resourceKey);
        if (pair) {
          const updatedYaml = yaml.dump(resource, { indent: 2 });
          resourceViewProvider.setResourceContent(pair.viewUri, updatedYaml);
          pair.originalResource = resource;
        }

        vscode.window.showInformationMessage(`Successfully applied ${resource.kind} "${resource.metadata?.name}"`,
          'View Details').then(selection => {
            if (selection === 'View Details') {
              edaOutputChannel.show();
            }
          });
      }
    } else if (validationAction === 'View Details') {
      edaOutputChannel.show();
    }
  }
}

// Validate the resource for basic errors
interface ValidationResult {
  valid: boolean;
  message?: string;
}

function validateResource(resource: any, originalResource: any): ValidationResult {
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

  if (resource.metadata.name !== originalResource.metadata.name) {
    return {
      valid: false,
      message: `Cannot change resource name from "${originalResource.metadata.name}" to "${resource.metadata.name}"`
    };
  }

  // Check that the namespace matches (if present)
  if (originalResource.metadata.namespace &&
      resource.metadata.namespace !== originalResource.metadata.namespace) {
    return {
      valid: false,
      message: `Cannot change resource namespace from "${originalResource.metadata.namespace}" to "${resource.metadata.namespace}"`
    };
  }

  return { valid: true };
}

// Show a unified diff view of the changes
async function showResourceDiff(
  resourceProvider: ResourceEditDocumentProvider,
  documentUri: vscode.Uri
): Promise<boolean> {
  try {
    // Get the original resource
    const originalResource = resourceProvider.getOriginalResource(documentUri);
    if (!originalResource) {
      vscode.window.showErrorMessage('Could not find original resource to compare');
      return false;
    }

    // Get the current document text and parse it
    const document = await vscode.workspace.openTextDocument(documentUri);
    const currentText = document.getText();
    const updatedResource = yaml.load(currentText);

    // Convert both resources to formatted YAML for comparison
    const originalYaml = yaml.dump(originalResource, { indent: 2 });
    const updatedYaml = yaml.dump(updatedResource, { indent: 2 });

    // If no differences, inform the user and return
    if (originalYaml === updatedYaml) {
      vscode.window.showInformationMessage('No changes detected in the resource');
      return true; // Continue with apply even though there are no changes
    }

    // Create URIs for the diff editor - use a timestamp to avoid caching issues
    const timestamp = Date.now();
    const title = `${originalResource.kind}-${originalResource.metadata.name}`;
    const originalUri = vscode.Uri.parse(`k8s-diff:/original/${title}-${timestamp}`);
    const modifiedUri = vscode.Uri.parse(`k8s-diff:/modified/${title}-${timestamp}`);

    // Create one-time file system provider for the diff
    const diffProvider = vscode.workspace.registerFileSystemProvider('k8s-diff', {
      onDidChangeFile: new vscode.EventEmitter<vscode.FileChangeEvent[]>().event,
      watch: () => ({ dispose: () => {} }),
      stat: () => ({ type: vscode.FileType.File, ctime: timestamp, mtime: timestamp, size: 0 }),
      readDirectory: () => [],
      createDirectory: () => {},
      readFile: (uri) => {
        if (uri.path.startsWith('/original/')) {
          return Buffer.from(originalYaml);
        } else {
          return Buffer.from(updatedYaml);
        }
      },
      writeFile: () => {},
      delete: () => {},
      rename: () => {}
    }, { isCaseSensitive: true });

    // Show the diff
    await vscode.commands.executeCommand('vscode.diff',
      originalUri,
      modifiedUri,
      `Diff: ${title}`,
      { preview: true }
    );

    // Clean up provider after a delay
    setTimeout(() => {
      diffProvider.dispose();
    }, 5000);

    // Show a message with action buttons - no information message, just buttons
    const action = await vscode.window.showWarningMessage(
      'Continue with the operation?',
      'Continue',
      'Cancel'
    );

    // Return whether the user wants to proceed
    return action === 'Continue';

  } catch (error) {
    vscode.window.showErrorMessage(`Error showing diff: ${error}`);
    log(`Error in showResourceDiff: ${error}`, LogLevel.ERROR, true);
    edaOutputChannel.show();
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
async function applyResource(
  documentUri: vscode.Uri,
  edaClient: EdaClient,
  resourceEditProvider: ResourceEditDocumentProvider,
  resource: any,
  options: { dryRun?: boolean }
): Promise<boolean> {
  const isDryRun = options.dryRun || false;
  const resourceKey = getResourceKey(
    resource.metadata.namespace || 'default',
    resource.kind,
    resource.metadata.name
  );

  try {
    log(`${isDryRun ? 'Validating' : 'Applying'} resource ${resource.kind}/${resource.metadata.name}...`, LogLevel.INFO, true);

    // Determine if this is an EDA resource
    const pair = resourcePairs.get(resourceKey);
    const isEda = pair?.isEdaResource ?? isEdaResource(undefined, resource.apiVersion);
    const isNew = resourceEditProvider.isNewResource(documentUri);
    let result: string;
    let appliedResource: any = resource;

    if (isEda) {
      const tx = {
        crs: [
          {
            type: isNew
              ? { create: { value: resource } }
              : { replace: { value: resource } },
          },
        ],
        description: `vscode apply ${resource.kind}/${resource.metadata.name}`,
        dryRun: isDryRun,
      };

      const txId = await edaClient.runTransaction(tx);
      log(
        `Transaction ${txId} created for ${resource.kind}/${resource.metadata.name}`,
        LogLevel.INFO,
        true
      );

      if (!isDryRun) {
        resourceEditProvider.setOriginalResource(documentUri, resource);
        if (isNew) {
          resourceEditProvider.clearNewResource(documentUri);
        }
      }

      result = '';
    } else {
      const k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');
      if (!isNew && pair?.originalResource?.metadata?.resourceVersion) {
        resource.metadata.resourceVersion =
          pair.originalResource.metadata.resourceVersion;
      }
      const updated = await k8sClient.applyResource(resource, {
        dryRun: isDryRun,
        isNew
      });

      if (!isDryRun) {
        const sanitized = sanitizeResource(updated ?? resource);
        resourceEditProvider.setOriginalResource(documentUri, sanitized);
        if (isNew) {
          resourceEditProvider.clearNewResource(documentUri);
        }
        if (pair) {
          pair.originalResource = sanitized;
        }
        appliedResource = sanitized;
      }
      result = '';
    }

    if (isDryRun) {
      log(`Validation successful for ${resource.kind} "${resource.metadata.name}"`, LogLevel.INFO, true);
    } else {
      log(`Successfully applied ${resource.kind} "${resource.metadata.name}"`, LogLevel.INFO, true);

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

    // Always show results in output channel
    if (result && typeof result === 'string' && result.length > 0) {
      log('\n======== APPLY RESULT ========', LogLevel.INFO, true);
      log(result, LogLevel.INFO, true);
      log('==============================\n', LogLevel.INFO, true);
    }

    return true;

  } catch (error) {
    const errorMessage = `Failed to ${isDryRun ? 'validate' : 'apply'} resource: ${error}`;
    vscode.window.showErrorMessage(errorMessage);
    log(errorMessage, LogLevel.ERROR, true);

    // Show detailed error in output channel
    if (error instanceof Error) {
      log('\n======== ERROR DETAILS ========', LogLevel.ERROR, true);
      log(error.message, LogLevel.ERROR, true);
      log('===============================\n', LogLevel.ERROR, true);
    }

    // Always show the output channel
    edaOutputChannel.show();

    return false;
  }
}

// Add resource changes as a transaction to the basket
async function addResourceToBasket(
  documentUri: vscode.Uri,
  resourceEditProvider: ResourceEditDocumentProvider,
  resource: any
): Promise<void> {
  const { namespace, kind, name } = ResourceEditDocumentProvider.parseUri(documentUri);
  const pair = resourcePairs.get(getResourceKey(namespace, kind, name));
  const isEda = pair?.isEdaResource ?? isEdaResource(undefined, resource.apiVersion);
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
    description: `vscode basket ${resource.kind}/${resource.metadata.name}`,
    retain: true,
    dryRun: false
  };
  await edaTransactionBasketProvider.addTransaction(tx);
  vscode.window.showInformationMessage(`Added ${resource.kind} "${resource.metadata?.name}" to transaction basket`);
}