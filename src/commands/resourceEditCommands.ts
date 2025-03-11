// src/commands/resourceEditCommands.ts
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { K8sFileSystemProvider } from '../providers/documents/resourceProvider';
import { log, LogLevel, edaOutputChannel } from '../extension.js';
import { serviceManager } from '../services/serviceManager';
import { ResourceService } from '../services/resourceService';
import { CrdService } from '../services/crdService';


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
  fileSystemProvider: K8sFileSystemProvider,
  providers?: {
    namespaceProvider?: any;
    systemProvider?: any;
    transactionProvider?: any;
  }
) {

  // Get services
  const resourceService = serviceManager.getService<ResourceService>('resource');
  const crdService = serviceManager.getService<CrdService>('crd');

  // Edit resource in editor - accept either tree item or direct resource parameters
  const editResourceCommand = vscode.commands.registerCommand(
    'vscode-eda.editResource',
    async (treeItemOrResourceInfo: any) => {
      // Debounce protection for multiple rapid calls
      const now = Date.now();
      if (now - lastCommandTime < COMMAND_DEBOUNCE_MS) {
        log(`Command execution debounced (${now - lastCommandTime}ms since last call)`, LogLevel.DEBUG);
        return;
      }
      lastCommandTime = now;

      try {
        let resource, resourceKind, resourceName, namespace;

        // Handle two ways of calling this command:
        // 1. With a tree item that has resource property
        // 2. With a plain object containing resource data

        if (treeItemOrResourceInfo?.resource) {
          // Called with a tree item
          resource = treeItemOrResourceInfo.resource;
          resourceKind = resource.kind || 'Resource';
          resourceName = resource.metadata?.name || 'unnamed';
          namespace = resource.metadata?.namespace || treeItemOrResourceInfo.namespace || 'default';
        }
        else if (treeItemOrResourceInfo?.kind && treeItemOrResourceInfo?.name) {
          // Called with direct parameters
          resourceKind = treeItemOrResourceInfo.kind;
          resourceName = treeItemOrResourceInfo.name;
          namespace = treeItemOrResourceInfo.namespace || 'default';

          // We need to fetch the resource
          log(`Fetching ${resourceKind}/${resourceName} from ${namespace} for editing...`, LogLevel.INFO);
          let yamlContent = await resourceService.getResourceYaml(resourceKind, resourceName, namespace);

          // Check if the YAML has apiVersion (might be missing in edactl output)
          const hasApiVersion = yamlContent.includes('apiVersion:');

          if (!hasApiVersion) {
            log(`YAML for ${resourceKind}/${resourceName} is missing apiVersion, fetching from CRD definition...`, LogLevel.INFO);

            try {
              // Get the CRD definition directly from the Kubernetes service
              const crdDef = await crdService.getCrdDefinitionForKind(resourceKind);

              if (crdDef && crdDef.spec?.group) {
                // Get the preferred version (storage: true, or first served version)
                const version = crdDef.spec.versions?.find(v => v.storage === true) ||
                              crdDef.spec.versions?.find(v => v.served === true) ||
                              crdDef.spec.versions?.[0];

                if (version?.name) {
                  const apiVersion = `${crdDef.spec.group}/${version.name}`;
                  log(`Found API version for ${resourceKind}: ${apiVersion}`, LogLevel.INFO);
                  yamlContent = `apiVersion: ${apiVersion}\n${yamlContent}`;
                } else {
                  log(`Could not determine version for ${resourceKind} from CRD, falling back to v1alpha1`, LogLevel.WARN);
                  yamlContent = `apiVersion: ${crdDef.spec.group}/v1alpha1\n${yamlContent}`;
                }
              } else {
                // For standard Kubernetes resources
                const k8sResources: Record<string, string> = {
                  'Pod': 'v1',
                  'Service': 'v1',
                  'Deployment': 'apps/v1',
                  'ConfigMap': 'v1',
                  'Secret': 'v1',
                  'Node': 'v1'
                };

                if (k8sResources[resourceKind]) {
                  yamlContent = `apiVersion: ${k8sResources[resourceKind]}\n${yamlContent}`;
                } else {
                  log(`Could not find CRD for ${resourceKind}, using fallback`, LogLevel.WARN);
                  yamlContent = `apiVersion: ${resourceKind.toLowerCase()}s.eda.nokia.com/v1alpha1\n${yamlContent}`;
                }
              }
            } catch (error) {
              log(`Error fetching CRD for ${resourceKind}: ${error}`, LogLevel.ERROR);
              // Last resort fallback - this should rarely be reached since we're fixing the issue at its source
              yamlContent = `apiVersion: ${resourceKind.toLowerCase()}s.eda.nokia.com/v1alpha1\n${yamlContent}`;
            }
          }

          try {
            resource = yaml.load(yamlContent);

            // Create a URI for this resource
            const uri = K8sFileSystemProvider.createUri(namespace, resourceKind, resourceName);

            // Store both the resource and the YAML content to avoid duplicate fetching
            fileSystemProvider.setOriginalResource(uri, resource);
            fileSystemProvider.setFileContent(uri, Buffer.from(yamlContent, 'utf8'));
          } catch (error) {
            log(`Failed to parse resource YAML: ${error}`, LogLevel.ERROR);
            vscode.window.showErrorMessage(`Failed to parse resource YAML: ${error}`);
            return;
          }
        }

        if (!resource || !resourceKind || !resourceName) {
          vscode.window.showErrorMessage('Invalid resource parameters');
          return;
        }

        // Create a URI for this resource
        const uri = K8sFileSystemProvider.createUri(namespace, resourceKind, resourceName);

        // Store the original resource
        fileSystemProvider.setOriginalResource(uri, resource);

        // Open the document and register it
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.languages.setTextDocumentLanguage(document, 'yaml');
        const editor = await vscode.window.showTextDocument(document);

        // Track this resource document
        openResourceEditors.add(uri.toString());

        // Register close handler for this document
        const closeDisposable = vscode.workspace.onDidCloseTextDocument(doc => {
          if (doc.uri.toString() === uri.toString()) {
            fileSystemProvider.cleanupDocument(uri);
            openResourceEditors.delete(uri.toString());
            closeDisposable.dispose();
          }
        });

        // Add to disposables
        context.subscriptions.push(closeDisposable);

      } catch (error) {
        vscode.window.showErrorMessage(`Failed to edit resource: ${error}`);
        log(`Error in editResource: ${error}`, LogLevel.ERROR, true);
      }
    }
  );

  // Apply changes to a resource - modified to support new interactive flow
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
        const originalResource = fileSystemProvider.getOriginalResource(documentUri);
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
          true : await fileSystemProvider.hasChanges(documentUri);

        if (!hasChanges) {
          vscode.window.showInformationMessage('No changes detected in the resource');
          return;
        }

        // If we have an explicit option (dry run or direct apply), skip the initial prompt
        if (options.skipPrompt) {
          if (options.dryRun) {
            return await validateAndPromptForApply(resourceService, fileSystemProvider, documentUri, resource, providers);
          } else {
            // Direct apply - still show diff first
            const shouldContinue = await showResourceDiff(fileSystemProvider, documentUri);
            if (!shouldContinue) {
              return;
            }

            // Confirm and apply
            const confirmed = await confirmResourceUpdate(resource.kind, resource.metadata?.name, false);
            if (confirmed) {
              const result = await applyResource(resourceService, resource, { dryRun: false }, providers);
              if (result) {
                fileSystemProvider.setOriginalResource(documentUri, resource);
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
          const shouldContinue = await showResourceDiff(fileSystemProvider, documentUri);
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
            return await validateAndPromptForApply(resourceService, fileSystemProvider, documentUri, resource, providers);
          } else {
            // Direct apply after diff
            const confirmed = await confirmResourceUpdate(resource.kind, resource.metadata?.name, false);
            if (confirmed) {
              const result = await applyResource(resourceService, resource, { dryRun: false }, providers);
              if (result) {
                fileSystemProvider.setOriginalResource(documentUri, resource);
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
          return await validateAndPromptForApply(resourceService, fileSystemProvider, documentUri, resource, providers);
        } else {
          // Direct apply - still show diff first as a safeguard
          const shouldContinue = await showResourceDiff(fileSystemProvider, documentUri);
          if (!shouldContinue) {
            return;
          }

          // Confirm and apply
          const confirmed = await confirmResourceUpdate(resource.kind, resource.metadata?.name, false);
          if (confirmed) {
            const result = await applyResource(resourceService, resource, { dryRun: false }, providers);
            if (result) {
              fileSystemProvider.setOriginalResource(documentUri, resource);
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
      await showResourceDiff(fileSystemProvider, documentUri);
    }
  );

  // Add a save handler to intercept standard save - MODIFIED FOR BETTER SAVE HANDLING
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
    editResourceCommand,
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
  k8sService: ResourceService,
  fileSystemProvider: K8sFileSystemProvider,
  documentUri: vscode.Uri,
  resource: any,
  providers?: {
    namespaceProvider?: any;
    systemProvider?: any;
    transactionProvider?: any;
  }
): Promise<void> {
  // Always show diff first
  const shouldContinue = await showResourceDiff(fileSystemProvider, documentUri);
  if (!shouldContinue) {
    return;
  }

  // Confirm validation
  const confirmed = await confirmResourceUpdate(resource.kind, resource.metadata?.name, true);
  if (!confirmed) {
    return;
  }

  // Perform validation (dry run)
  const validationResult = await applyResource(k8sService, resource, { dryRun: true }, providers);

  if (validationResult) {
    // Show success message for validation
    const validationAction = await vscode.window.showInformationMessage(
      `✅ Validation successful for ${resource.kind} "${resource.metadata?.name}"`,
      'Apply Changes', 'View Details', 'Cancel'
    );

    if (validationAction === 'Apply Changes') {
      // Now apply the changes
      const applyResult = await applyResource(k8sService, resource, { dryRun: false }, providers);
      if (applyResult) {
        fileSystemProvider.setOriginalResource(documentUri, resource);
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
  fileSystemProvider: K8sFileSystemProvider,
  documentUri: vscode.Uri
): Promise<boolean> {
  try {
    // Get the original resource
    const originalResource = fileSystemProvider.getOriginalResource(documentUri);
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
  k8sService: ResourceService,
  resource: any,
  options: { dryRun?: boolean },
  providers?: {
    namespaceProvider?: any;
    systemProvider?: any;
    transactionProvider?: any;
  }
): Promise<boolean> {
  const isDryRun = options.dryRun || false;

  // Store URI so we can reopen it if needed
  let resourceUri: vscode.Uri | undefined;

  try {
    log(`${isDryRun ? 'Validating' : 'Applying'} resource ${resource.kind}/${resource.metadata.name}...`, LogLevel.INFO, true);

    // Create a URI for this resource to use later if needed
    resourceUri = K8sFileSystemProvider.createUri(
      resource.metadata.namespace || k8sService.getCurrentNamespace(),
      resource.kind,
      resource.metadata.name
    );

    const result = await k8sService.applyResource(resource, isDryRun);

    if (isDryRun) {
      log(`Validation successful for ${resource.kind} "${resource.metadata.name}"`, LogLevel.INFO, true);
    } else {
      log(`Successfully applied ${resource.kind} "${resource.metadata.name}"`, LogLevel.INFO, true);

      // Refresh all views after successful apply
      if (providers) {
        if (providers.namespaceProvider) {
          providers.namespaceProvider.refresh();
        }
        if (providers.systemProvider) {
          providers.systemProvider.refresh();
        }
        if (providers.transactionProvider) {
          providers.transactionProvider.refresh();
        }
      }

      // Close any open diff editors
      await closeDiffEditor();

      // If the resource isn't open anymore, reopen it
      const isResourceOpen = vscode.window.visibleTextEditors.some(
        editor => editor.document.uri.toString() === resourceUri?.toString()
      );

      if (!isResourceOpen && resourceUri) {
        try {
          const document = await vscode.workspace.openTextDocument(resourceUri);
          await vscode.window.showTextDocument(document, { preview: false });
        } catch (err) {
          log(`Failed to reopen resource: ${err}`, LogLevel.ERROR);
        }
      }
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