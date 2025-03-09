// Updated src/commands/resourceViewCommand.ts with read-only enforcement
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { KubernetesService } from '../services/kubernetes/kubernetes';
import { ResourceViewDocumentProvider } from '../providers/documents/resourceViewProvider';
import { log, LogLevel } from '../extension';

/**
 * Registers the "viewResource" command that opens a read-only YAML view (k8s-view:)
 */
export function registerResourceViewCommands(
  context: vscode.ExtensionContext,
  k8sService: KubernetesService,
  viewProvider: ResourceViewDocumentProvider
) {
  const viewResourceCommand = vscode.commands.registerCommand(
    'vscode-eda.viewResource',
    async (treeItemOrResourceInfo: any) => {
      try {
        let kind, name, namespace;

        // If called from a tree item:
        if (treeItemOrResourceInfo?.resource) {
          const resource = treeItemOrResourceInfo.resource;
          kind = resource.kind;
          name = resource.metadata?.name;
          namespace = resource.metadata?.namespace || treeItemOrResourceInfo.namespace || 'default';
        }
        // Or if called programmatically with { kind, name, namespace }:
        else if (treeItemOrResourceInfo?.kind && treeItemOrResourceInfo?.name) {
          kind = treeItemOrResourceInfo.kind;
          name = treeItemOrResourceInfo.name;
          namespace = treeItemOrResourceInfo.namespace || 'default';
        } else {
          vscode.window.showErrorMessage('Invalid resource to view.');
          return;
        }

        // 1) Fetch resource YAML
        let yamlContent = await k8sService.getResourceYaml(kind, name, namespace);
        try {
          const resource = yaml.load(yamlContent) as any;
          if (!resource.apiVersion) {
            // Compute the appropriate apiVersion (as you already do)
            let computedApiVersion = '';
            const isEdaCrd = await k8sService.isEdaCrd(kind);
            if (isEdaCrd) {
              try {
                const crdDef = await k8sService.getCrdDefinitionForKind(kind);
                if (crdDef && crdDef.spec?.group) {
                  const version = crdDef.spec.versions?.find(v => v.storage === true) ||
                                  crdDef.spec.versions?.find(v => v.served === true) ||
                                  crdDef.spec.versions?.[0];
                  computedApiVersion = version?.name ? `${crdDef.spec.group}/${version.name}` : `${crdDef.spec.group}/v1alpha1`;
                }
              } catch (error) {
                // Fallback for EDA CRDs
                let plural = kind.toLowerCase();
                if (plural.endsWith('f')) {
                  plural = plural.slice(0, -1) + 'ves';
                } else if (plural.endsWith('y')) {
                  plural = plural.slice(0, -1) + 'ies';
                } else if (!plural.endsWith('s')) {
                  plural += 's';
                }
                computedApiVersion = `${plural}.eda.nokia.com/v1alpha1`;
              }
            } else {
              const k8sResources: Record<string, string> = {
                'Pod': 'v1',
                'Service': 'v1',
                'Deployment': 'apps/v1',
                'ConfigMap': 'v1',
                'Secret': 'v1',
                'Node': 'v1'
              };
              computedApiVersion = k8sResources[kind] || '';
            }
            resource.apiVersion = computedApiVersion;
            // Instead of dumping the entire object (which reorders keys),
            // manually prepend the apiVersion line to the original YAML.
            // You might want to remove any old apiVersion line from yamlContent first.
            yamlContent = yamlContent.replace(/^apiVersion:.*\n/, '');
            yamlContent = `apiVersion: ${resource.apiVersion}\n${yamlContent}`;
          }
        } catch (error) {
          log(`Error processing YAML for view: ${error}`, LogLevel.WARN);
          // Proceed with original yamlContent if parsing fails
        }

        // 3) Build a read-only URI
        const viewUri = vscode.Uri.parse(
          `k8s-view:/${namespace}/${kind}/${name}?ts=${Date.now()}`
        );

        // 4) Store the YAML content in your read-only provider
        viewProvider.setResourceContent(viewUri, yamlContent);

        // 5) Open the doc & set language to 'yaml'
        const doc = await vscode.workspace.openTextDocument(viewUri);
        await vscode.languages.setTextDocumentLanguage(doc, 'yaml');

        // 6) Open the document as read-only
        await vscode.window.showTextDocument(doc, {
          preview: true,
          preserveFocus: false,
          viewColumn: vscode.ViewColumn.Active
        });

        // 7) Add a status bar item to easily switch to edit mode
        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        statusBarItem.text = "$(edit) Edit Resource";
        statusBarItem.tooltip = "Switch to editable mode";
        statusBarItem.command = "vscode-eda.switchToEditResource";
        statusBarItem.show();

        // Dispose the status bar item when the document is closed
        const disposable = vscode.workspace.onDidCloseTextDocument(closedDoc => {
          if (closedDoc.uri.toString() === viewUri.toString()) {
            statusBarItem.dispose();
            disposable.dispose();
          }
        });

        context.subscriptions.push(disposable);

      } catch (error) {
        log(`Failed to view resource: ${error}`, LogLevel.ERROR, true);
        vscode.window.showErrorMessage(`Failed to view resource: ${error}`);
      }
    }
  );

  context.subscriptions.push(viewResourceCommand);
}

export function registerSwitchToEditCommand(context: vscode.ExtensionContext) {
  const switchToEditCommand = vscode.commands.registerCommand(
    'vscode-eda.switchToEditResource',
    async () => {
      // We'll get the "activeTextEditor", parse the URI to figure out the resource
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor to switch to edit mode.');
        return;
      }

      const docUri = editor.document.uri;
      if (docUri.scheme !== 'k8s-view') {
        vscode.window.showErrorMessage('This document is not in read-only view mode.');
        return;
      }

      // Parse the URI to get namespace, kind, name
      const parts = docUri.path.split('/').filter(p => p.length > 0); // e.g. /my-namespace/Pod/my-resource
      if (parts.length !== 3) {
        vscode.window.showErrorMessage(`Invalid k8s-view URI: ${docUri}`);
        return;
      }

      const [namespace, kind, resourceName] = parts;

      // Now we can simply call your "editResource" command with the same data
      await vscode.commands.executeCommand('vscode-eda.editResource', {
        kind,
        name: resourceName,
        namespace
      });
    }
  );

  context.subscriptions.push(switchToEditCommand);
}