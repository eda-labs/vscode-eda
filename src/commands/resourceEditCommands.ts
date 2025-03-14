// src/commands/resourceEditCommands.ts
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { execSync } from 'child_process';
import { serviceManager } from '../services/serviceManager';
import { KubernetesClient } from '../clients/kubernetesClient';
import { EdactlClient } from '../clients/edactlClient';
import { ResourceService } from '../services/resourceService';
import { ResourceViewDocumentProvider } from '../providers/documents/resourceViewProvider';
import { ResourceEditDocumentProvider } from '../providers/documents/resourceEditProvider';
import { log, LogLevel, edaOutputChannel } from '../extension';

// Keep track of open resource editors
const openResourceEditors = new Set<string>();

// Store last command execution timestamp to prevent rapid multiple executions
let lastCommandTime = 0;
const COMMAND_DEBOUNCE_MS = 300; // Prevent multiple executions within 300ms

// Define interface for our custom quick pick items
interface ActionQuickPickItem extends vscode.QuickPickItem {
  id: string;
}

export function registerResourceEditCommands(
  context: vscode.ExtensionContext,
  resourceEditProvider: ResourceEditDocumentProvider
) {
  const k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');
  const edactlClient = serviceManager.getClient<EdactlClient>('edactl');
  const resourceService = serviceManager.getService<ResourceService>('kubernetes-resources');

  // Switch from read-only view to editable
  const switchToEditCommand = vscode.commands.registerCommand(
    'vscode-eda.switchToEditResource',
    async (viewDocumentUri: vscode.Uri) => {
      try {
        // 1) Ensure this is a k8s-view document
        if (viewDocumentUri.scheme !== 'k8s-view') {
          throw new Error('Not a Kubernetes resource read-only view');
        }

        // 2) Parse the read-only URI to get resource info (namespace/kind/name)
        const { namespace, kind, name } = ResourceViewDocumentProvider.parseUri(viewDocumentUri);

        // 3) Create the new "k8s:" (editable) URI
        const editorUri = ResourceEditDocumentProvider.createUri(namespace, kind, name);

        // 4) Open the *existing* (read-only) doc so we can read its text
        const readOnlyDoc = await vscode.workspace.openTextDocument(viewDocumentUri);
        const readOnlyYaml = readOnlyDoc.getText();

        // 5) Parse the YAML to verify it's valid
        let resourceObject: any;
        try {
          resourceObject = yaml.load(readOnlyYaml);
        } catch (parseErr) {
          throw new Error(`Invalid YAML in read-only view: ${parseErr}`);
        }

        // 6) Store the resource in your editable file system provider
        //    so that changes can be tracked, diffs are possible, etc.
        resourceEditProvider.setOriginalResource(editorUri, resourceObject);
        resourceEditProvider.setResourceContent(editorUri, readOnlyYaml);

        // 7) Open the new "k8s:" doc in the editor
        await closeAllEditorsWithUri(viewDocumentUri);

        // 8) Only then open the new "k8s:" doc in the editor
        const editDoc = await vscode.workspace.openTextDocument(editorUri);
        await vscode.languages.setTextDocumentLanguage(editDoc, 'yaml');
        await vscode.window.showTextDocument(editDoc, { preview: false });

        // 9) Now show the editable document
        await vscode.window.showTextDocument(editDoc, { preview: false });
        // 9) Optionally track this doc so you can clean it up on close
        openResourceEditors.add(editorUri.toString());

        // 10) Register a handler so that when this new doc closes, we remove it from tracking and clean up
        const closeDisposable = vscode.workspace.onDidCloseTextDocument((closedDoc) => {
          if (closedDoc.uri.toString() === editorUri.toString()) {
            resourceEditProvider.cleanupDocument(editorUri);
            openResourceEditors.delete(editorUri.toString());
            closeDisposable.dispose();
          }
        });

        // Keep the close handler in your extension context’s subscriptions so it’s disposed automatically.
        context.subscriptions.push(closeDisposable);

      } catch (error) {
        vscode.window.showErrorMessage(`Failed to switch to edit mode: ${error}`);
        log(`Error in switchToEditResource: ${error}`, LogLevel.ERROR, true);
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
        // Debounce protection for multiple rapid calls
        const now = Date.now();
        if (now - lastCommandTime < COMMAND_DEBOUNCE_MS) {
          log(`Command execution debounced (${now - lastCommandTime}ms since last call)`, LogLevel.DEBUG);
          return;
        }
        lastCommandTime = now;

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

        // Get the original resource
        const originalResource = resourceEditProvider.getOriginalResource(documentUri);
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
            return await validateAndPromptForApply(k8sClient, edactlClient, resourceEditProvider, documentUri, resource);
          } else {
            // Direct apply - still show diff first
            const shouldContinue = await showResourceDiff(resourceEditProvider, documentUri);
            if (!shouldContinue) {
              return;
            }

            // Confirm and apply
            const confirmed = await confirmResourceUpdate(resource.kind, resource.metadata?.name, false);
            if (confirmed) {
              const result = await applyResource(k8sClient, edactlClient, resource, { dryRun: false });
              if (result) {
                resourceEditProvider.setOriginalResource(documentUri, resource);
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

        // Present options to the user
        const action = await promptForApplyAction(resource);

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
          const nextAction = await promptForNextAction(resource, 'diff');
          if (!nextAction) {
            return; // User cancelled
          }

          if (nextAction === 'validate') {
            // Validate and then ask for apply
            return await validateAndPromptForApply(k8sClient, edactlClient, resourceEditProvider, documentUri, resource);
          } else {
            // Direct apply after diff
            const confirmed = await confirmResourceUpdate(resource.kind, resource.metadata?.name, false);
            if (confirmed) {
              const result = await applyResource(k8sClient, edactlClient, resource, { dryRun: false });
              if (result) {
                resourceEditProvider.setOriginalResource(documentUri, resource);
                vscode.window.showInformationMessage(`Successfully applied ${resource.kind} "${resource.metadata?.name}"`,
                  'View Details').then(selection => {
                    if (selection === 'View Details') {
                      edaOutputChannel.show();
                    }
                  });
              }
            }
          }
        } else if (action === 'validate') {
          // Validate and then ask for apply
          return await validateAndPromptForApply(k8sClient, edactlClient, resourceEditProvider, documentUri, resource);
        } else {
          // Direct apply - still show diff first as a safeguard
          const shouldContinue = await showResourceDiff(resourceEditProvider, documentUri);
          if (!shouldContinue) {
            return;
          }

          // Confirm and apply
          const confirmed = await confirmResourceUpdate(resource.kind, resource.metadata?.name, false);
          if (confirmed) {
            const result = await applyResource(k8sClient, edactlClient, resource, { dryRun: false });
            if (result) {
              resourceEditProvider.setOriginalResource(documentUri, resource);
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
    if (event.document.uri.scheme === 'k8s') {
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

  context.subscriptions.push(
    switchToEditCommand,
    applyChangesCommand,
    applyDryRunCommand,
    showDiffCommand,
    onWillSaveTextDocument
  );
}

// Prompt user for what action they want to take with the resource
async function promptForApplyAction(resource: any): Promise<string | undefined> {
  const kind = resource.kind;
  const name = resource.metadata?.name;

  const choices: ActionQuickPickItem[] = [
    { label: '👁 View Changes (Diff)', id: 'diff', description: 'Compare changes before proceeding' },
    { label: '✓ Validate (Dry Run)', id: 'validate', description: 'Check if changes are valid without applying' },
    { label: '💾 Apply Changes', id: 'apply', description: 'Apply changes to the cluster' }
  ];

  const chosen = await vscode.window.showQuickPick(choices, {
    placeHolder: `Choose an action for ${kind} "${name}"`,
    title: 'Apply Resource Changes'
  });

  return chosen?.id;
}

// Prompt for next action after diff
async function promptForNextAction(resource: any, currentStep: string): Promise<string | undefined> {
  const kind = resource.kind;
  const name = resource.metadata?.name;

  let choices: ActionQuickPickItem[] = [];
  if (currentStep === 'diff') {
    choices = [
      { label: '✓ Validate (Dry Run)', id: 'validate', description: 'Check if changes are valid without applying' },
      { label: '💾 Apply Changes', id: 'apply', description: 'Apply changes to the cluster' }
    ];
  } else if (currentStep === 'validate') {
    choices = [
      { label: '💾 Apply Changes', id: 'apply', description: 'Apply changes to the cluster' }
    ];
  }

  const chosen = await vscode.window.showQuickPick(choices, {
    placeHolder: `Choose next action for ${kind} "${name}"`,
    title: 'Apply Resource Changes'
  });

  return chosen?.id;
}

// Validate and then prompt for apply
async function validateAndPromptForApply(
  k8sClient: KubernetesClient,
  edactlClient: EdactlClient,
  resourceProvider: ResourceEditDocumentProvider,
  documentUri: vscode.Uri,
  resource: any
): Promise<void> {
  // Always show diff first
  const shouldContinue = await showResourceDiff(resourceProvider, documentUri);
  if (!shouldContinue) {
    return;
  }

  // Confirm validation
  const confirmed = await confirmResourceUpdate(resource.kind, resource.metadata?.name, true);
  if (!confirmed) {
    return;
  }

  // Perform validation (dry run)
  const validationResult = await applyResource(k8sClient, edactlClient, resource, { dryRun: true });

  if (validationResult) {
    // Show success message for validation
    const validationAction = await vscode.window.showInformationMessage(
      `✅ Validation successful for ${resource.kind} "${resource.metadata?.name}"`,
      'Apply Changes', 'View Details', 'Cancel'
    );

    if (validationAction === 'Apply Changes') {
      // Now apply the changes
      const applyResult = await applyResource(k8sClient, edactlClient, resource, { dryRun: false });
      if (applyResult) {
        resourceProvider.setOriginalResource(documentUri, resource);
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
  k8sClient: KubernetesClient,
  edactlClient: EdactlClient,
  resource: any,
  options: { dryRun?: boolean }
): Promise<boolean> {
  const isDryRun = options.dryRun || false;

  // Store URI so we can reopen it if needed
  let resourceUri: vscode.Uri | undefined;

  try {
    log(`${isDryRun ? 'Validating' : 'Applying'} resource ${resource.kind}/${resource.metadata.name}...`, LogLevel.INFO, true);

    // Create a URI for this resource to use later if needed
    resourceUri = ResourceEditDocumentProvider.createUri(
      resource.metadata.namespace || 'default',
      resource.kind,
      resource.metadata.name
    );

    // Determine if this is an EDA resource
    const isEdaResource = resource.apiVersion?.endsWith('.eda.nokia.com');
    let result: string;

    // Convert resource to YAML
    const resourceYaml = yaml.dump(resource);

    if (isEdaResource) {
      // Use edactl for EDA resources if possible
      try {
        if (isDryRun) {
          log(`Validating EDA resource via kubectl --dry-run=server`, LogLevel.INFO);
          result = execSync(`kubectl apply -f - --dry-run=server`, {
            input: resourceYaml,
            encoding: 'utf-8'
          });
        } else {
          log(`Applying EDA resource via kubectl`, LogLevel.INFO);
          result = execSync(`kubectl apply -f -`, {
            input: resourceYaml,
            encoding: 'utf-8'
          });
        }
      } catch (error: any) {
        // Handle error output from execSync
        throw new Error(error.stderr || error.message || String(error));
      }
    } else {
      // Use kubectl for standard resources
      try {
        if (isDryRun) {
          result = execSync(`kubectl apply -f - --dry-run=server`, {
            input: resourceYaml,
            encoding: 'utf-8'
          });
        } else {
          result = execSync(`kubectl apply -f -`, {
            input: resourceYaml,
            encoding: 'utf-8'
          });
        }
      } catch (error: any) {
        // Handle error output from execSync
        throw new Error(error.stderr || error.message || String(error));
      }
    }

    if (isDryRun) {
      log(`Validation successful for ${resource.kind} "${resource.metadata.name}"`, LogLevel.INFO, true);
    } else {
      log(`Successfully applied ${resource.kind} "${resource.metadata.name}"`, LogLevel.INFO, true);

      // Notify resource service of changes
      serviceManager.getService<ResourceService>('kubernetes-resources').forceRefresh();

      // Close any open diff editors
      await closeDiffEditor();

      // Switch back to read-only view with fresh content
      await switchToReadOnlyView(resource);
    }

    // Always show results in output channel
    if (result && typeof result === 'string' && result.length > 0) {
      log('\n======== APPLY RESULT ========', LogLevel.INFO, true);
      log(result, LogLevel.INFO, true);
      log('==============================\n', LogLevel.INFO, true);
    }

    // Always show the output channel
    edaOutputChannel.show();

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

    // If the resource isn't open anymore, try to reopen it
    if (resourceUri) {
      try {
        const isResourceOpen = vscode.window.visibleTextEditors.some(
          editor => editor.document.uri.toString() === resourceUri?.toString()
        );

        if (!isResourceOpen) {
          const document = await vscode.workspace.openTextDocument(resourceUri);
          await vscode.window.showTextDocument(document, { preview: false });
        }
      } catch (reopenErr) {
        log(`Failed to reopen resource after error: ${reopenErr}`, LogLevel.ERROR);
      }
    }

    return false;
  }
}

/**
 * Helper function to switch from editable to read-only view
 */
async function switchToReadOnlyView(resource: any): Promise<void> {
  try {
    const namespace = resource.metadata.namespace || 'default';
    const kind = resource.kind;
    const name = resource.metadata.name;

    // Create URI for the editable document
    const editableUri = ResourceEditDocumentProvider.createUri(namespace, kind, name);

    // Close all instances of the editable document
    await closeAllEditorsWithUri(editableUri);

    // Create a fake tree item that the viewResource command expects
    const treeItem = {
      namespace: namespace,
      resourceType: kind.toLowerCase(),
      label: name,
      contextValue: 'crd-instance',
      resource: {
        name: name,
        kind: kind,
        raw: {
          apiVersion: resource.apiVersion,
          kind: resource.kind,
          metadata: {
            name: name,
            namespace: namespace
          }
        }
      }
    };

    // Now open a fresh read-only view using the viewResource command
    log(`Opening fresh read-only view for ${kind}/${name}`, LogLevel.DEBUG);
    await vscode.commands.executeCommand('vscode-eda.viewResource', treeItem);

  } catch (error) {
    log(`Error switching to read-only view: ${error}`, LogLevel.ERROR);
  }
}

/**
 * Helper function to close all editors displaying a document with the given URI
 */
async function closeAllEditorsWithUri(uri: vscode.Uri): Promise<void> {
  try {
    // Find all editors displaying the document
    const editors = vscode.window.visibleTextEditors.filter(
      editor => editor.document.uri.toString() === uri.toString()
    );

    // No editors to close
    if (editors.length === 0) {
      return;
    }

    log(`Closing ${editors.length} editors for URI: ${uri}`, LogLevel.DEBUG);

    // Save the currently active editor to restore focus after closing
    let activeEditor = vscode.window.activeTextEditor;

    // For each editor showing the document
    for (const editor of editors) {
      // First make this editor active
      await vscode.window.showTextDocument(editor.document, { preserveFocus: false });
      // Close the active editor (which is now our target)
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }

    // Add a small delay to ensure VSCode UI updates
    await new Promise(resolve => setTimeout(resolve, 100));

    // If we had an active editor before and it's not one we closed, restore focus to it
    if (activeEditor && !editors.includes(activeEditor)) {
      await vscode.window.showTextDocument(activeEditor.document, { preserveFocus: false });
    }
  } catch (error) {
    log(`Error closing editors: ${error}`, LogLevel.ERROR);
  }
}

// Helper function to close diff editors and then reopen the resource
async function closeDiffEditor(): Promise<void> {
  try {
    // First, identify if there's a k8s resource open that we'll need to reopen
    let resourceUri: vscode.Uri | undefined;
    const resourceEditor = vscode.window.visibleTextEditors.find(
      editor => editor.document.uri.scheme === 'k8s'
    );

    if (resourceEditor) {
      resourceUri = resourceEditor.document.uri;
      log(`Found resource to reopen: ${resourceUri.toString()}`, LogLevel.DEBUG);
    }

    // Find if there's a diff editor open
    const hasDiffEditor = vscode.window.visibleTextEditors.some(
      editor => editor.document.uri.scheme === 'k8s-diff'
    );

    if (hasDiffEditor) {
      // Close the active editor (which should be the diff)
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

      // If we had a resource open, reopen it
      if (resourceUri) {
        log(`Reopening resource: ${resourceUri.toString()}`, LogLevel.DEBUG);
        // Small delay to ensure the editor has closed
        await new Promise(resolve => setTimeout(resolve, 100));
        const document = await vscode.workspace.openTextDocument(resourceUri);
        await vscode.window.showTextDocument(document, { preview: false });
      }
    }
  } catch (error) {
    log(`Error in closeDiffEditor: ${error}`, LogLevel.ERROR);
  }
}